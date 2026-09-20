import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import type { PlanState } from '../types';
import { loadPlan, migratePlan, savePlan, clearSavedPlan } from './persistence';
import { analyzePlan } from './validation';
import { STORAGE_KEY } from '../constants';

/** Node 测试环境没有 localStorage，用一个最小内存实现占位（不引入 jsdom）。 */
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
beforeAll(() => {
  if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  }
});

/** 旧版本字段：只有 booths，booth 没有 critical，颜色可有可无。 */
const LEGACY_PLAN = {
  booths: [
    {
      id: 'legacy-1',
      x: 9,
      y: 6,
      w: 2,
      h: 2,
      orientation: 'south',
      label: '旧展位',
      color: '#333',
    },
  ],
};

describe('旧方案数据迁移', () => {
  it('旧结构 { booths } 迁移出空 lockdown 与 critical=false', () => {
    const migrated = migratePlan(LEGACY_PLAN as unknown);
    expect(migrated).not.toBeNull();
    expect(migrated!.lockdown).toEqual({ closedExits: [], zones: [] });
    expect(migrated!.booths[0].critical).toBe(false);
    expect(migrated!.booths[0].kind).toBe('booth');
  });

  it('迁移后的旧展位仍按普通展位做单路检查，且在空厅可达', () => {
    const migrated = migratePlan(LEGACY_PLAN as unknown)!;
    const r = analyzePlan(migrated.booths, migrated.lockdown);
    expect(r.dualPaths[migrated.booths[0].id]).toBeUndefined();
    expect(r.paths[migrated.booths[0].id].length).toBeGreaterThan(1);
  });

  it('旧数据缺 color 时补默认颜色而不是判废', () => {
    const { color, ...noColor } = LEGACY_PLAN.booths[0];
    void color;
    const migrated = migratePlan({ booths: [noColor] } as unknown);
    expect(migrated!.booths[0].color).toEqual(expect.any(String));
  });

  it('新结构（含 critical / lockdown）原样保留', () => {
    const modern: PlanState = {
      booths: [
        {
          id: 'm1', x: 1, y: 1, w: 2, h: 2, orientation: 'south',
          label: 'M1', color: '#000', kind: 'booth', critical: true,
        },
      ],
      lockdown: {
        closedExits: ['exit-south'],
        zones: [{ id: 'z1', x: 2, y: 2, w: 3, h: 3 }],
      },
    };
    const migrated = migratePlan(modern);
    expect(migrated).toEqual(modern);
  });

  it('非法数据返回 null（回退示例），不抛异常', () => {
    expect(migratePlan(null)).toBeNull();
    expect(migratePlan('nope')).toBeNull();
    expect(migratePlan({})).toBeNull();
    expect(migratePlan({ booths: [{ id: 1 }] })).toBeNull();
    expect(migratePlan({ booths: [], lockdown: { closedExits: [1] } })).toBeNull();
  });
});

describe('localStorage 读写往返', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('保存新结构后能读回，封控与重点展位不丢失', () => {
    const state: PlanState = {
      booths: [
        {
          id: 'p1', x: 9, y: 6, w: 2, h: 2, orientation: 'south',
          label: 'P1', color: '#123', kind: 'booth', critical: true,
        },
      ],
      lockdown: { closedExits: ['exit-north'], zones: [] },
    };
    savePlan(state);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    const loaded = loadPlan();
    expect(loaded).toEqual(state);
    expect(loaded!.booths[0].critical).toBe(true);
  });

  it('localStorage 里已经存在的旧方案（旧键、旧字段）继续能打开', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(LEGACY_PLAN));
    const loaded = loadPlan();
    expect(loaded).not.toBeNull();
    expect(loaded!.booths[0].label).toBe('旧展位');
    expect(loaded!.lockdown!.zones).toEqual([]);
  });

  it('清除后读取为 null', () => {
    savePlan({ booths: [], lockdown: { closedExits: [], zones: [] } });
    clearSavedPlan();
    expect(loadPlan()).toBeNull();
  });
});
