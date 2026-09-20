/**
 * 排展工作台应用状态：展位列表 + 选中 + 撤销/重做 + 本地持久化。
 * 拖拽过程中用 liveUpdateBooth 实时刷新画面（不入历史），松手时 commit 一次，
 * 保证一次拖动 = 一条撤销记录。
 *
 * 重点展位标记、出口封控、封控区域等离散操作同样走 commitNow，
 * 因此撤销/重做/恢复示例后，双路状态与告警作为派生数据始终与快照一致。
 *
 * 注意：所有对外部可变 History 的读写都在事件处理中基于 planRef 完成，
 * 不放进 setState 的 updater 内（StrictMode 会双调用 updater）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Booth, ControlZone, PlanState } from '../types';
import { History } from '../lib/history';
import { analyzePlan } from '../lib/validation';
import {
  blockedExitScenario,
  dualRouteScenario,
  emptyPlan,
  newBoothAt,
} from '../lib/scenarios';
import { loadPlan, savePlan } from '../lib/persistence';
import { GRID_SIZE } from '../constants';
import { snapToGrid } from '../lib/grid';
import { rotate90 } from '../lib/geometry';
import { nextId } from '../lib/id';

function planEquals(a: PlanState, b: PlanState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 补齐可选的封控字段（内置示例与旧快照可能缺省）。 */
export function normalizePlan(p: PlanState): PlanState {
  return {
    booths: p.booths,
    closedExits: p.closedExits ?? [],
    zones: p.zones ?? [],
  };
}

function initialPlan(): PlanState {
  return normalizePlan(loadPlan() ?? blockedExitScenario());
}

export type ResetTarget = 'empty' | 'blocked-exit' | 'dual-route';

export function usePlanner() {
  const [plan, setPlanState] = useState<PlanState>(initialPlan);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const planRef = useRef(plan);
  const historyRef = useRef<History<PlanState> | null>(null);
  if (historyRef.current === null) {
    historyRef.current = new History<PlanState>(plan, 100, planEquals);
  }
  const history = historyRef.current;

  // 历史能力标志（undo/redo 后刷新）
  const [, setHistoryVersion] = useState(0);
  const bumpHistory = () => setHistoryVersion((v) => v + 1);

  /** 统一的状态写入：同步更新 ref，供事件处理中立即读到最新值。 */
  const applyPlan = useCallback((next: PlanState) => {
    const normalized = normalizePlan(next);
    planRef.current = normalized;
    setPlanState(normalized);
  }, []);

  // 持久化
  useEffect(() => {
    savePlan(plan);
  }, [plan]);

  const analysis = useMemo(
    () =>
      analyzePlan(plan.booths, {
        closedExits: plan.closedExits ?? [],
        zones: plan.zones ?? [],
      }),
    [plan],
  );

  const replaceBooth = useCallback(
    (id: string, patch: Partial<Booth>) => {
      const next: PlanState = {
        ...planRef.current,
        booths: planRef.current.booths.map((b) =>
          b.id === id ? { ...b, ...patch } : b,
        ),
      };
      planRef.current = next;
      setPlanState(next);
    },
    [],
  );

  /** 拖拽/缩放过程中调用：只更新画面，不入历史。 */
  const liveUpdateBooth = replaceBooth;

  /** 交互结束：把最终状态作为一条历史提交。 */
  const commitInteraction = useCallback(() => {
    applyPlan(history.commit(planRef.current));
    bumpHistory();
  }, [history, applyPlan]);

  /** 离散操作（旋转、删除、改参数、标记/封控）立即提交一条历史。 */
  const commitNow = useCallback(
    (updater: (prev: PlanState) => PlanState) => {
      applyPlan(history.commit(updater(planRef.current)));
      bumpHistory();
    },
    [history, applyPlan],
  );

  const addBooth = useCallback(() => {
    const prev = planRef.current;
    const index = prev.booths.length;
    // 阶梯偏移，避免新展位完全叠在一起；全部落在网格上。
    const booth = newBoothAt(
      snapToGrid(1 + (index % 8) * GRID_SIZE),
      snapToGrid(1 + (index % 8) * GRID_SIZE),
      index,
    );
    commitNow(() => ({ ...prev, booths: [...prev.booths, booth] }));
    setSelectedId(booth.id);
  }, [commitNow]);

  /** 在指定米坐标处添加（双击画布），坐标已吸附。 */
  const addBoothAt = useCallback(
    (x: number, y: number) => {
      const prev = planRef.current;
      const index = prev.booths.length;
      const booth = newBoothAt(
        snapToGrid(x - 1.5, GRID_SIZE),
        snapToGrid(y - 1, GRID_SIZE),
        index,
      );
      commitNow(() => ({ ...prev, booths: [...prev.booths, booth] }));
      setSelectedId(booth.id);
    },
    [commitNow],
  );

  const rotateBooth = useCallback(
    (id: string) => {
      commitNow((prev) => ({
        ...prev,
        booths: prev.booths.map((b) => (b.id === id ? rotate90(b) : b)),
      }));
    },
    [commitNow],
  );

  const rotateSelected = useCallback(() => {
    if (selectedId) rotateBooth(selectedId);
  }, [rotateBooth, selectedId]);

  /** 重点展位标记切换（普通展位 ⇄ 双通道演练展位）。 */
  const toggleCritical = useCallback(
    (id: string) => {
      commitNow((prev) => ({
        ...prev,
        booths: prev.booths.map((b) =>
          b.id === id && b.kind !== 'partition'
            ? { ...b, critical: !b.critical }
            : b,
        ),
      }));
    },
    [commitNow],
  );

  /** 检查器：修改朝向（不交换宽高）。 */
  const setOrientation = useCallback(
    (id: string, orientation: Booth['orientation']) => {
      commitNow((prev) => ({
        ...prev,
        booths: prev.booths.map((b) =>
          b.id === id ? { ...b, orientation } : b,
        ),
      }));
    },
    [commitNow],
  );

  /** 检查器：修改标签/数值字段（数值吸附到网格）。 */
  const updateBoothField = useCallback(
    (
      id: string,
      field: 'label' | 'x' | 'y' | 'w' | 'h',
      value: string | number,
    ) => {
      commitNow((prev) => ({
        ...prev,
        booths: prev.booths.map((b) => {
          if (b.id !== id) return b;
          if (field === 'label') return { ...b, label: String(value) };
          const num = snapToGrid(Math.max(GRID_SIZE, Number(value) || 0));
          return { ...b, [field]: num };
        }),
      }));
    },
    [commitNow],
  );

  const deleteBooth = useCallback(
    (id: string) => {
      commitNow((prev) => ({
        ...prev,
        booths: prev.booths.filter((b) => b.id !== id),
      }));
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [commitNow],
  );

  const deleteSelected = useCallback(() => {
    if (selectedId) deleteBooth(selectedId);
  }, [deleteBooth, selectedId]);

  /* ---------- 临时封控 ---------- */

  /** 切换某出口的临时关闭状态。 */
  const toggleExitClosed = useCallback(
    (exitId: string) => {
      commitNow((prev) => {
        const closed = prev.closedExits ?? [];
        return {
          ...prev,
          closedExits: closed.includes(exitId)
            ? closed.filter((id) => id !== exitId)
            : [...closed, exitId],
        };
      });
    },
    [commitNow],
  );

  /** 拖出一个临时封控区域（坐标已吸附、尺寸 ≥0.5 m），作为一条历史。 */
  const addZone = useCallback(
    (zone: Omit<ControlZone, 'id'>) => {
      const normalized = {
        x: snapToGrid(zone.x),
        y: snapToGrid(zone.y),
        w: snapToGrid(zone.w),
        h: snapToGrid(zone.h),
      };
      if (normalized.w < GRID_SIZE || normalized.h < GRID_SIZE) return;
      const item: ControlZone = { id: nextId('zone'), ...normalized };
      commitNow((prev) => ({
        ...prev,
        zones: [...(prev.zones ?? []), item],
      }));
    },
    [commitNow],
  );

  /** 删除一个临时封控区域（封控模式下点击区域）。 */
  const removeZone = useCallback(
    (zoneId: string) => {
      commitNow((prev) => ({
        ...prev,
        zones: (prev.zones ?? []).filter((z) => z.id !== zoneId),
      }));
    },
    [commitNow],
  );

  /** 清空全部临时封控（关闭出口 + 封控区域）。 */
  const clearControls = useCallback(() => {
    commitNow((prev) => ({ ...prev, closedExits: [], zones: [] }));
  }, [commitNow]);

  const undo = useCallback(() => {
    applyPlan(history.undo());
    bumpHistory();
  }, [history, applyPlan]);

  const redo = useCallback(() => {
    applyPlan(history.redo());
    bumpHistory();
  }, [history, applyPlan]);

  const resetPlan = useCallback(
    (target: ResetTarget = 'empty') => {
      const next =
        target === 'empty'
          ? emptyPlan()
          : target === 'dual-route'
            ? dualRouteScenario()
            : blockedExitScenario();
      // 作为一条历史提交，重置/载入示例后可用 Ctrl+Z 恢复原方案
      applyPlan(history.commit(normalizePlan(next)));
      setSelectedId(null);
      bumpHistory();
    },
    [history, applyPlan],
  );

  // 键盘快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (mod && e.key.toLowerCase() === 'y') ||
        (mod && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      } else if (mod && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        rotateSelected();
      } else if (e.key.startsWith('Arrow') && selectedId) {
        e.preventDefault();
        const id = selectedId;
        const dx =
          e.key === 'ArrowRight'
            ? GRID_SIZE
            : e.key === 'ArrowLeft'
              ? -GRID_SIZE
              : 0;
        const dy =
          e.key === 'ArrowDown'
            ? GRID_SIZE
            : e.key === 'ArrowUp'
              ? -GRID_SIZE
              : 0;
        if (dx || dy) {
          commitNow((prev) => ({
            ...prev,
            booths: prev.booths.map((b) =>
              b.id === id
                ? {
                    ...b,
                    x: snapToGrid(b.x + dx),
                    y: snapToGrid(b.y + dy),
                  }
                : b,
            ),
          }));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, deleteSelected, rotateSelected, selectedId, commitNow]);

  return {
    booths: plan.booths,
    closedExits: plan.closedExits ?? [],
    zones: plan.zones ?? [],
    selectedId,
    analysis,
    selectBooth: setSelectedId,
    addBooth,
    addBoothAt,
    replaceBooth,
    liveUpdateBooth,
    commitInteraction,
    commitNow,
    rotateSelected,
    rotateBooth,
    setOrientation,
    updateBoothField,
    toggleCritical,
    deleteBooth,
    deleteSelected,
    toggleExitClosed,
    addZone,
    removeZone,
    clearControls,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    resetPlan,
  };
}

export type PlannerApi = ReturnType<typeof usePlanner>;
