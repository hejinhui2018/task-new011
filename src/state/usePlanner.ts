/**
 * 排展工作台应用状态：展位列表 + 封控 + 选中 + 撤销/重做 + 本地持久化。
 * 拖拽过程中用 liveUpdateBooth 实时刷新画面（不入历史），松手时 commit 一次，
 * 保证一次拖动 = 一条撤销记录。标记重点、出口开关、封控区域增删都走同一条
 * History，因此撤销/重做/恢复示例对所有改动保持状态一致。
 *
 * 注意：所有对外部可变 History 的读写都在事件处理中基于 planRef 完成，
 * 不放进 setState 的 updater 内（StrictMode 会双调用 updater）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Booth, PlanState, Point } from '../types';
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
import {
  addLockdownZoneFromCorners,
  clearLockdown,
  getLockdown,
  removeLockdownZone,
  setBoothCritical,
  toggleExitClosed,
} from '../lib/actions';

function planEquals(a: PlanState, b: PlanState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function initialPlan(): PlanState {
  return loadPlan() ?? blockedExitScenario();
}

export type ScenarioTarget = 'empty' | 'blocked-exit' | 'dual-route';

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
    planRef.current = next;
    setPlanState(next);
  }, []);

  // 持久化
  useEffect(() => {
    savePlan(plan);
  }, [plan]);

  const lockdown = getLockdown(plan);
  const analysis = useMemo(
    () => analyzePlan(plan.booths, getLockdown(plan)),
    [plan],
  );

  const replaceBooth = useCallback(
    (id: string, patch: Partial<Booth>) => {
      const prev = planRef.current;
      const next: PlanState = {
        ...prev,
        booths: prev.booths.map((b) =>
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

  /** 离散操作（旋转、删除、改参数、封控变更）立即提交一条历史。 */
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
    commitNow((p) => ({ ...p, booths: [...p.booths, booth] }));
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
      commitNow((p) => ({ ...p, booths: [...p.booths, booth] }));
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

  /** 标记 / 取消重点展位。 */
  const toggleCritical = useCallback(
    (id: string) => {
      commitNow((prev) => {
        const b = prev.booths.find((x) => x.id === id);
        if (!b || b.kind === 'partition') return prev;
        return setBoothCritical(prev, id, !b.critical);
      });
    },
    [commitNow],
  );

  /** 临时封控：开关某个出口。 */
  const toggleExitClosedState = useCallback(
    (exitId: string) => {
      commitNow((prev) => toggleExitClosed(prev, exitId));
    },
    [commitNow],
  );

  /** 临时封控：由拖出的两个角点提交一个封控区域（一条历史）。 */
  const addLockdownZone = useCallback(
    (a: Point, b: Point) => {
      commitNow((prev) => addLockdownZoneFromCorners(prev, a, b));
    },
    [commitNow],
  );

  const removeZone = useCallback(
    (zoneId: string) => {
      commitNow((prev) => removeLockdownZone(prev, zoneId));
    },
    [commitNow],
  );

  const clearAllLockdown = useCallback(() => {
    commitNow((prev) => clearLockdown(prev));
  }, [commitNow]);

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

  const undo = useCallback(() => {
    applyPlan(history.undo());
    bumpHistory();
  }, [history, applyPlan]);

  const redo = useCallback(() => {
    applyPlan(history.redo());
    bumpHistory();
  }, [history, applyPlan]);

  const resetPlan = useCallback(
    (target: ScenarioTarget = 'empty') => {
      const next =
        target === 'empty'
          ? emptyPlan()
          : target === 'dual-route'
            ? dualRouteScenario()
            : blockedExitScenario();
      // 作为一条历史提交，重置/载入示例后可用 Ctrl+Z 恢复原方案
      applyPlan(history.commit(next));
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
    lockdown,
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
    toggleExitClosed: toggleExitClosedState,
    addLockdownZone,
    removeZone,
    clearLockdown: clearAllLockdown,
    deleteBooth,
    deleteSelected,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    resetPlan,
  };
}

export type PlannerApi = ReturnType<typeof usePlanner>;
