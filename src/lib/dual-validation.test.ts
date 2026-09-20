import { describe, it, expect } from 'vitest';
import type { Booth, ControlState, PlanState } from '../types';
import { analyzePlan } from './validation';
import {
  dualRouteScenario,
  withGateOpened,
} from './scenarios';
import { History } from './history';
import { SOUTH_EXIT_ID, dualRouteDemoPlans } from './demo';

function booth(p: Partial<Booth>): Booth {
  return {
    id: p.id ?? 'b',
    x: p.x ?? 9,
    y: p.y ?? 6,
    w: p.w ?? 2,
    h: p.h ?? 2,
    orientation: p.orientation ?? 'south',
    label: p.label ?? p.id ?? 'T',
    color: '#000',
    kind: p.kind ?? 'booth',
    critical: p.critical ?? false,
  };
}

const NO_CONTROLS: ControlState = { closedExits: [], zones: [] };

function criticalBooths(): Booth[] {
  return [booth({ id: 'c', x: 9, y: 6, label: 'C01', critical: true })];
}

describe('重点展位双通道分析', () => {
  it('空展厅：双路可用，通往不同出口，无告警', () => {
    const r = analyzePlan(criticalBooths(), NO_CONTROLS);
    const d = r.dual['c'];
    expect(d.status).toBe('dual');
    expect(new Set(d.exitIds)).toEqual(new Set(['exit-south', 'exit-north']));
    expect(d.paths[0].length).toBeGreaterThan(1);
    expect(d.paths[1].length).toBeGreaterThan(1);
    // 除接待起点外不共用格点
    const cells = (pathIndex: number) => {
      const pts = d.paths[pathIndex].slice(1);
      return new Set(pts.map((p) => `${Math.round(p.x * 2)}:${Math.round(p.y * 2)}`));
    };
    const [a, b] = [cells(0), cells(1)];
    expect([...a].filter((k) => b.has(k))).toEqual([]);
    expect(r.alerts).toEqual([]);
  });

  it('关闭南出口：降级为单路，原因标记为出口关闭', () => {
    const r = analyzePlan(criticalBooths(), {
      closedExits: [SOUTH_EXIT_ID],
      zones: [],
    });
    const d = r.dual['c'];
    expect(d.status).toBe('single');
    expect(d.exitIds[0]).toBe('exit-north');
    expect(d.reason).toBe('exit-closed');
    const alert = r.alerts.find((a) => a.kind === 'single-route')!;
    expect(alert.boothId).toBe('c');
    expect(alert.reason).toBe('exit-closed');
    expect(r.closedExitIds).toEqual([SOUTH_EXIT_ID]);
  });

  it('两个出口都关闭：完全不可达，原因为出口关闭', () => {
    const r = analyzePlan(criticalBooths(), {
      closedExits: ['exit-south', 'exit-north'],
      zones: [],
    });
    const d = r.dual['c'];
    expect(d.status).toBe('none');
    expect(d.reason).toBe('exit-closed');
    expect(r.alerts.some((a) => a.kind === 'no-path' && a.boothId === 'c')).toBe(
      true,
    );
  });

  it('围挡封出单门封闭区：单路原因为空间瓶颈（并非出口关闭）', () => {
    // 与双通道示例同构的小院：东西墙各留严格一格的门，东门被一格挡墙堵死
    const walls: Booth[] = [
      booth({ id: 'n', x: 7, y: 3.5, w: 6.5, h: 0.5, kind: 'partition' }),
      booth({ id: 's', x: 7, y: 10, w: 6.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'w1', x: 7, y: 3.5, w: 0.5, h: 3, kind: 'partition' }),
      booth({ id: 'w2', x: 7, y: 7, w: 0.5, h: 3.5, kind: 'partition' }),
      booth({ id: 'e1', x: 13, y: 3.5, w: 0.5, h: 3, kind: 'partition' }),
      booth({ id: 'e2', x: 13, y: 7, w: 0.5, h: 3.5, kind: 'partition' }),
      booth({ id: 'eg', x: 13, y: 6.5, w: 0.5, h: 0.5, kind: 'partition' }),
    ];
    const c = booth({ id: 'c', x: 9, y: 5.5, w: 2.5, h: 2, critical: true });
    const r = analyzePlan([...walls, c], NO_CONTROLS);
    const d = r.dual['c'];
    expect(d.status).toBe('single');
    expect(d.reason).toBe('bottleneck');
    expect(r.alerts.find((a) => a.kind === 'single-route')?.reason).toBe(
      'bottleneck',
    );
  });

  it('封控区域把重点展位彻底困住：完全断路而不是出口关闭', () => {
    // 重点展位在封控方框内，封控墙厚 1 m（两格），
    // 起点兜底搜索（半径 2 格）无法越过封控墙 -> 真正完全断路。
    const c = booth({ id: 'c', x: 4, y: 4, w: 2, h: 2, critical: true });
    const zones = [
      { id: 'z1', x: 2.5, y: 2.5, w: 5, h: 1 },
      { id: 'z2', x: 2.5, y: 6.5, w: 5, h: 1 },
      { id: 'z3', x: 2.5, y: 2.5, w: 1, h: 5 },
      { id: 'z4', x: 6.5, y: 2.5, w: 1, h: 5 },
    ];
    const r = analyzePlan([c], { closedExits: [], zones });
    const d = r.dual['c'];
    expect(d.status).toBe('none');
    expect(d.reason).toBe('disconnected');
  });

  it('普通展位在封控区域堵路时仍按原单路规则报 no-path', () => {
    const b = booth({ id: 'n', x: 4, y: 1, critical: false });
    const walls: Booth[] = [
      booth({ id: 'wn', x: 0, y: 4, w: 8, h: 0.5, kind: 'partition' }),
      booth({ id: 'we', x: 7.5, y: 0, w: 0.5, h: 4.5, kind: 'partition' }),
    ];
    const r = analyzePlan([...walls, b], NO_CONTROLS);
    expect(r.dual['n']).toBeUndefined();
    expect(r.paths['n']).toEqual([]);
    expect(r.alerts.some((a) => a.kind === 'no-path' && a.boothId === 'n')).toBe(
      true,
    );
  });

  it('封控区域增量：先双路，封掉一扇门后降级，移除后恢复（纯函数重算）', () => {
    // 东西墙各留一格门的小院，两门均开 -> 双路
    const walls: Booth[] = [
      booth({ id: 'n', x: 7, y: 3.5, w: 6.5, h: 0.5, kind: 'partition' }),
      booth({ id: 's', x: 7, y: 10, w: 6.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'w1', x: 7, y: 3.5, w: 0.5, h: 3, kind: 'partition' }),
      booth({ id: 'w2', x: 7, y: 7, w: 0.5, h: 3.5, kind: 'partition' }),
      booth({ id: 'e1', x: 13, y: 3.5, w: 0.5, h: 3, kind: 'partition' }),
      booth({ id: 'e2', x: 13, y: 7, w: 0.5, h: 3.5, kind: 'partition' }),
    ];
    const c = booth({ id: 'c', x: 9, y: 5.5, w: 2.5, h: 2, critical: true });
    const booths = [...walls, c];
    expect(analyzePlan(booths, NO_CONTROLS).dual['c'].status).toBe('dual');

    // 封控西门那一格：只剩东门 -> 双路被迫共用 -> 降级（空间瓶颈，因为出口没关）
    const degraded = analyzePlan(booths, {
      closedExits: [],
      zones: [{ id: 'z', x: 7, y: 6.5, w: 0.5, h: 0.5 }],
    });
    expect(degraded.dual['c'].status).toBe('single');
    expect(degraded.dual['c'].reason).toBe('bottleneck');

    // 移除封控：双路立即恢复
    expect(analyzePlan(booths, NO_CONTROLS).dual['c'].status).toBe('dual');
  });
});

describe('双通道演练示例的完整状态序列', () => {
  const plan = dualRouteScenario();
  const c01 = () => plan.booths.find((b) => b.label === 'C01')!;

  it('① 初始：挡墙堵门 -> C01 仅单路（空间瓶颈），无其他告警', () => {
    const r = analyzePlan(plan.booths, {
      closedExits: plan.closedExits ?? [],
      zones: plan.zones ?? [],
    });
    const d = r.dual[c01().id];
    expect(d.status).toBe('single');
    expect(d.reason).toBe('bottleneck');
    // 初始没有出口关闭，不能误报为出口关闭
    expect(r.closedExitIds).toEqual([]);
    // 其余普通展位可达，除 C01 的 single-route 外无告警
    expect(r.alerts.filter((a) => a.kind !== 'single-route')).toEqual([]);
  });

  it('② 移走挡墙：双路可用，两个不同出口', () => {
    const opened = withGateOpened(plan);
    const r = analyzePlan(opened.booths, { closedExits: [], zones: [] });
    const d = r.dual[c01().id];
    expect(d.status).toBe('dual');
    expect(new Set(d.exitIds)).toEqual(new Set(['exit-south', 'exit-north']));
    expect(r.alerts).toEqual([]);
  });

  it('③ 关闭南出口：降级单路，原因变为出口关闭', () => {
    const opened = withGateOpened(plan);
    const r = analyzePlan(opened.booths, {
      closedExits: [SOUTH_EXIT_ID],
      zones: [],
    });
    const d = r.dual[c01().id];
    expect(d.status).toBe('single');
    expect(d.reason).toBe('exit-closed');
    expect(d.exitIds[0]).toBe('exit-north');
  });

  it('④ 用 History 复刻“单路→双路→降级→撤销恢复”，撤销后状态与 ② 完全一致', () => {
    const plans = dualRouteDemoPlans();
    const h = new History<PlanState>(plans[0]);
    h.commit(plans[1]); // 开门
    h.commit(plans[2]); // 关闭南出口
    expect(h.canUndo).toBe(true);
    const restored = h.undo();

    const before = analyzePlan(plans[1].booths, {
      closedExits: plans[1].closedExits ?? [],
      zones: plans[1].zones ?? [],
    });
    const after = analyzePlan(restored.booths, {
      closedExits: restored.closedExits ?? [],
      zones: restored.zones ?? [],
    });
    // 双路状态、路径与告警全部恢复
    expect(JSON.stringify(after.dual)).toEqual(JSON.stringify(before.dual));
    expect(after.alerts).toEqual([]);
    expect(after.closedExitIds).toEqual([]);

    // 重做能再次得到降级状态
    const redone = h.redo();
    expect(redone.closedExits).toEqual([SOUTH_EXIT_ID]);
  });

  it('演练四步期望方案的状态依次为 single / dual / single(exit-closed) / dual', () => {
    const [s1, s2, s3, s4] = dualRouteDemoPlans();
    const statusOf = (p: PlanState) => {
      const cid = p.booths.find((b) => b.label === 'C01')!.id;
      return analyzePlan(p.booths, {
        closedExits: p.closedExits ?? [],
        zones: p.zones ?? [],
      }).dual[cid];
    };
    expect(statusOf(s1).status).toBe('single');
    expect(statusOf(s2).status).toBe('dual');
    expect(statusOf(s3).status).toBe('single');
    expect(statusOf(s3).reason).toBe('exit-closed');
    expect(statusOf(s4).status).toBe('dual');
  });
});
