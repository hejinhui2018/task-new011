import { describe, it, expect } from 'vitest';
import type { PlanState } from '../types';
import {
  addLockdownZoneFromCorners,
  clearLockdown,
  getLockdown,
  removeLockdownZone,
  setBoothCritical,
  toggleExitClosed,
} from './actions';
import { analyzePlan } from './validation';
import {
  blockedExitScenario,
  dualRouteScenario,
} from './scenarios';
import { History } from './history';

function boothByLabel(plan: PlanState, label: string) {
  return plan.booths.find((b) => b.label === label)!;
}

function stateEquals(a: PlanState, b: PlanState) {
  return JSON.stringify(a) === JSON.stringify(b);
}

describe('封控 actions', () => {
  it('开关出口写入/移除 closedExits', () => {
    const s0: PlanState = { booths: [] };
    const s1 = toggleExitClosed(s0, 'exit-south');
    expect(getLockdown(s1).closedExits).toEqual(['exit-south']);
    const s2 = toggleExitClosed(s1, 'exit-north');
    expect(getLockdown(s2).closedExits).toEqual(['exit-south', 'exit-north']);
    const s3 = toggleExitClosed(s2, 'exit-south');
    expect(getLockdown(s3).closedExits).toEqual(['exit-north']);
  });

  it('拖出的角点吸附 0.5m、裁剪进展厅，不足一格不生成区域', () => {
    const s0: PlanState = { booths: [] };
    const tiny = addLockdownZoneFromCorners(s0, { x: 1, y: 1 }, { x: 1.2, y: 1.2 });
    expect(getLockdown(tiny).zones).toHaveLength(0);
    expect(tiny).toBe(s0);

    const s1 = addLockdownZoneFromCorners(s0, { x: 19.3, y: 13.4 }, { x: 21, y: 15.6 });
    expect(getLockdown(s1).zones).toHaveLength(1);
    const z = getLockdown(s1).zones[0];
    expect([z.x, z.y, z.w, z.h]).toEqual([19.5, 13.5, 0.5, 0.5]);

    const s2 = removeLockdownZone(s1, z.id);
    expect(getLockdown(s2).zones).toHaveLength(0);
  });

  it('clearLockdown 一次性清空封控区域与关闭出口；空操作返回同一引用', () => {
    let s: PlanState = { booths: [] };
    s = toggleExitClosed(s, 'exit-north');
    s = addLockdownZoneFromCorners(s, { x: 2, y: 2 }, { x: 4, y: 4 });
    expect(getLockdown(s).zones.length + getLockdown(s).closedExits.length).toBe(2);
    const cleared = clearLockdown(s);
    expect(getLockdown(cleared).zones).toEqual([]);
    expect(getLockdown(cleared).closedExits).toEqual([]);
    expect(clearLockdown(cleared)).toBe(cleared);
  });

  it('标记/取消重点展位；围挡不可标记', () => {
    const plan = blockedExitScenario();
    const a01 = boothByLabel(plan, 'A01');
    const marked = setBoothCritical(plan, a01.id, true);
    expect(marked.booths.find((b) => b.id === a01.id)!.critical).toBe(true);
    const partition = boothByLabel(plan, '围挡-横');
    const tryPartition = setBoothCritical(marked, partition.id, true);
    expect(tryPartition.booths.find((b) => b.id === partition.id)!.critical).toBeFalsy();
  });
});

describe('封控变化后双路/单路/告警立即重算', () => {
  it('标记重点展位后，开放展厅双路可用，无相关告警', () => {
    // 单展位空厅（无任何封控/封堵），两个出口都可达 → 双路
    const plan: PlanState = {
      booths: [
        {
          id: 'c1', x: 9, y: 6, w: 2, h: 2, orientation: 'south',
          label: 'C1', color: '#000', kind: 'booth', critical: true,
        },
      ],
    };
    const r = analyzePlan(plan.booths, getLockdown(plan));
    expect(r.dualPaths['c1']?.status).toBe('dual');
    expect(
      r.alerts.filter(
        (a) => a.kind === 'single-route' || a.kind === 'no-path',
      ),
    ).toEqual([]);
  });

  it('关闭一个开放出口：重点展位从双路降级为单路，告警归因为出口关闭', () => {
    const plan = blockedExitScenario();
    const a02 = boothByLabel(plan, 'A02');
    let next = setBoothCritical(plan, a02.id, true);
    next = toggleExitClosed(next, 'exit-south'); // 南出口本就被 B09 封堵，这里再关北出口更明显
    next = toggleExitClosed(next, 'exit-north');
    // 两出口都不可用（南物理封堵 + 北临时关闭）→ 完全不可达
    const bothDown = analyzePlan(next.booths, getLockdown(next));
    expect(bothDown.dualPaths[a02.id]?.status).toBe('none');
    const alert = bothDown.alerts.find(
      (a) => a.kind === 'no-path' && a.boothId === a02.id,
    )!;
    expect(alert.cause).toBe('exit-closed');

    // 撤销北出口关闭（仅南出口封堵）→ 单路，可达北出口
    const reopened = toggleExitClosed(next, 'exit-north');
    const r = analyzePlan(reopened.booths, getLockdown(reopened));
    expect(r.dualPaths[a02.id]?.status).toBe('single');
    expect(r.dualPaths[a02.id]?.cause).toBe('exit-closed');
    expect(r.dualPaths[a02.id]?.reachableExitId).toBe('exit-north');
    const single = r.alerts.find(
      (a) => a.kind === 'single-route' && a.boothId === a02.id,
    )!;
    expect(single.cause).toBe('exit-closed');
  });

  it('全局出口关闭告警出现，且选中该告警可见原因', () => {
    const plan: PlanState = { booths: [] };
    const closed = toggleExitClosed(plan, 'exit-north');
    const r = analyzePlan([], getLockdown(closed));
    const alert = r.alerts.find((a) => a.kind === 'exit-closed')!;
    expect(alert).toBeTruthy();
    expect(alert.cause).toBe('exit-closed');
    expect(alert.exitId).toBe('exit-north');
    expect(alert.message).toContain('北出口');
  });

  it('封控区域四面围住重点展位：完全断路（cutoff），清除封控后恢复双路', () => {
    // 围合区 x4..9 × y4..9，四面 0.5 m 封控墙；展位与墙之间留 1 m 通道
    const booth = {
      id: 'c1', x: 6, y: 5.5, w: 1.5, h: 1.5,
      orientation: 'south' as const, label: 'C1', color: '#000', kind: 'booth' as const,
      critical: true,
    };
    const ring = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      // 直接构造 zone 形状（不依赖 id）
      ({
        id: `z-${a.x}-${a.y}`,
        x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y),
      });
    const zones = [
      ring({ x: 4, y: 4 }, { x: 9, y: 4.5 }), // 北
      ring({ x: 4, y: 8.5 }, { x: 9, y: 9 }), // 南
      ring({ x: 4, y: 4 }, { x: 4.5, y: 9 }), // 西
      ring({ x: 8.5, y: 4 }, { x: 9, y: 9 }), // 东
    ];
    const cut = analyzePlan([booth], { closedExits: [], zones });
    expect(cut.dualPaths[booth.id].status).toBe('none');
    expect(cut.dualPaths[booth.id].cause).toBe('cutoff');

    const ok = analyzePlan([booth], { closedExits: [], zones: [] });
    expect(ok.dualPaths[booth.id].status).toBe('dual');
  });

  it('普通展位在出口临时关闭导致无路时归因为出口关闭（区别于空间断路）', () => {
    // A08 在左下 (0.5,8.5)：南出口是其最近出口；南出口被 B09 物理封堵后它本可去北出口。
    // 再临时关闭北出口 → A08 无路，但忽略“临时关闭”后它可达 → 归因 exit-closed。
    const plan = blockedExitScenario();
    const a08 = boothByLabel(plan, 'A08');
    const next = toggleExitClosed(plan, 'exit-north');
    const r = analyzePlan(next.booths, getLockdown(next));
    const alert = r.alerts.find(
      (a) => a.kind === 'no-path' && a.boothId === a08.id,
    );
    expect(alert?.cause).toBe('exit-closed');
  });
});

describe('“双通道”演练示例：单路 → 双路 → 关闭出口降级 → 撤销恢复', () => {
  it('初始为仅单路（空间瓶颈），且只找到 K01 一条路', () => {
    const plan = dualRouteScenario();
    const k01 = boothByLabel(plan, 'K01');
    const r = analyzePlan(plan.booths, getLockdown(plan));
    expect(k01.critical).toBe(true);
    expect(r.dualPaths[k01.id].status).toBe('single');
    expect(r.dualPaths[k01.id].cause).toBe('bottleneck');
    expect(r.dualPaths[k01.id].primary.length).toBeGreaterThan(1);
    expect(r.dualPaths[k01.id].secondary).toEqual([]);
  });

  it('清空封控后恢复双路（绿/蓝两条通往不同出口）', () => {
    const plan = clearLockdown(dualRouteScenario());
    const k01 = boothByLabel(plan, 'K01');
    const r = analyzePlan(plan.booths, getLockdown(plan));
    expect(r.dualPaths[k01.id].status).toBe('dual');
    expect(r.dualPaths[k01.id].primaryExitId).not.toBe(
      r.dualPaths[k01.id].secondaryExitId,
    );
  });

  it('双路状态下关闭一个出口立即降级为单路（出口关闭）', () => {
    let plan = clearLockdown(dualRouteScenario());
    plan = toggleExitClosed(plan, 'exit-south');
    const k01 = boothByLabel(plan, 'K01');
    const r = analyzePlan(plan.booths, getLockdown(plan));
    expect(r.dualPaths[k01.id].status).toBe('single');
    expect(r.dualPaths[k01.id].cause).toBe('exit-closed');
    expect(r.dualPaths[k01.id].reachableExitId).toBe('exit-north');
  });

  it('整条演练通过 History 撤销可完整恢复到初始单路，再重做回到降级', () => {
    const history = new History<PlanState>(dualRouteScenario(), 100, stateEquals);
    // ① 清空封控（双路）
    let p = history.commit(clearLockdown(history.current));
    expect(analyzePlan(p.booths, getLockdown(p)).dualPaths[boothByLabel(p, 'K01').id].status).toBe('dual');
    // ② 关闭南出口（单路）
    p = history.commit(toggleExitClosed(p, 'exit-south'));
    expect(analyzePlan(p.booths, getLockdown(p)).dualPaths[boothByLabel(p, 'K01').id].status).toBe('single');
    // 撤销 ② → 恢复双路
    p = history.undo();
    expect(analyzePlan(p.booths, getLockdown(p)).dualPaths[boothByLabel(p, 'K01').id].status).toBe('dual');
    // 重做 ② → 再次单路
    p = history.redo();
    expect(analyzePlan(p.booths, getLockdown(p)).dualPaths[boothByLabel(p, 'K01').id].status).toBe('single');
    // 连续撤销 ① → 回到初始瓶颈单路，封控区域回来
    p = history.undo();
    p = history.undo();
    expect(getLockdown(p).zones.length).toBeGreaterThan(0);
    expect(analyzePlan(p.booths, getLockdown(p)).dualPaths[boothByLabel(p, 'K01').id].status).toBe('single');
    expect(analyzePlan(p.booths, getLockdown(p)).dualPaths[boothByLabel(p, 'K01').id].cause).toBe('bottleneck');
  });

  it('标记重点展位、添加封控、撤销、重做状态一致', () => {
    const history = new History<PlanState>(dualRouteScenario(), 100, stateEquals);
    const k01 = boothByLabel(history.current, 'K01');
    // 取消重点 → 恢复重点
    let p = history.commit(setBoothCritical(history.current, k01.id, false));
    expect(analyzePlan(p.booths, getLockdown(p)).dualPaths[k01.id]).toBeUndefined();
    p = history.undo();
    expect(analyzePlan(p.booths, getLockdown(p)).dualPaths[k01.id].status).toBe('single');
    p = history.redo();
    expect(analyzePlan(p.booths, getLockdown(p)).dualPaths[k01.id]).toBeUndefined();

    // 添加封控 → 撤销消失 → 重做回来
    const zonesBefore = getLockdown(p).zones.length;
    p = history.commit(addLockdownZoneFromCorners(p, { x: 14, y: 10 }, { x: 16, y: 12 }));
    expect(getLockdown(p).zones.length).toBe(zonesBefore + 1);
    p = history.undo();
    expect(getLockdown(p).zones.length).toBe(zonesBefore);
    p = history.redo();
    expect(getLockdown(p).zones.length).toBe(zonesBefore + 1);
  });
});
