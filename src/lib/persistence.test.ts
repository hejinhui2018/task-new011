import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlan, migratePlan, savePlan } from './persistence';
import { STORAGE_KEY } from '../constants';
import type { PlanState } from '../types';

/** Node 测试环境没有 localStorage，用内存 Map 模拟。 */
function installFakeStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
  return store;
}

beforeEach(() => installFakeStorage());

describe('migratePlan 旧数据迁移', () => {
  it('v1 旧存档 { booths } 可直接打开：补齐空封控字段，展位原样保留', () => {
    const old = {
      booths: [
        {
          id: 'old-1',
          x: 1,
          y: 2,
          w: 3,
          h: 2,
          orientation: 'north',
          label: 'A09',
          color: '#123456',
        },
      ],
    };
    const plan = migratePlan(old)!;
    expect(plan.booths).toHaveLength(1);
    expect(plan.booths[0]).toMatchObject({
      id: 'old-1',
      x: 1,
      y: 2,
      w: 3,
      h: 2,
      orientation: 'north',
      label: 'A09',
      kind: 'booth',
    });
    // 旧展位默认不是重点展位，继续按普通展位做单路检查
    expect(plan.booths[0].critical).toBe(false);
    expect(plan.closedExits).toEqual([]);
    expect(plan.zones).toEqual([]);
  });

  it('含 kind/color 缺省字段的旧展位也能迁移并补默认值', () => {
    const plan = migratePlan({
      booths: [{ id: 'p', x: 0, y: 0, w: 1, h: 1, orientation: 'south', label: 'P' }],
    })!;
    expect(plan.booths[0].color).toBeTypeOf('string');
    expect(plan.booths[0].kind).toBe('booth');
  });

  it('新版本带封控的数据原样保留', () => {
    const plan = migratePlan({
      booths: [
        {
          id: 'c', x: 1, y: 1, w: 2, h: 2, orientation: 'south',
          label: 'C01', color: '#000', critical: true,
        },
      ],
      closedExits: ['exit-north'],
      zones: [{ id: 'zone-1', x: 3, y: 3, w: 2, h: 1 }],
    })!;
    expect(plan.booths[0].critical).toBe(true);
    expect(plan.closedExits).toEqual(['exit-north']);
    expect(plan.zones).toEqual([{ id: 'zone-1', x: 3, y: 3, w: 2, h: 1 }]);
  });

  it('脏数据：不是对象 / 缺 booths / 展位字段损坏 -> 返回 null', () => {
    expect(migratePlan(null)).toBeNull();
    expect(migratePlan('nope')).toBeNull();
    expect(migratePlan({})).toBeNull();
    expect(migratePlan({ booths: 'x' })).toBeNull();
    expect(
      migratePlan({
        booths: [{ id: 1, x: 0, y: 0, w: 1, h: 1, orientation: 'south', label: 'x' }],
      }),
    ).toBeNull();
    expect(
      migratePlan({
        booths: [
          { id: 'b', x: 0, y: 0, w: 1, h: 1, orientation: 'sideways', label: 'x' },
        ],
      }),
    ).toBeNull();
  });

  it('损坏的 zones 条目被跳过但展位保留', () => {
    const plan = migratePlan({
      booths: [
        { id: 'b', x: 0, y: 0, w: 1, h: 1, orientation: 'south', label: 'x' },
      ],
      zones: [{ id: 'bad' }, { id: 'ok', x: 1, y: 1, w: 1, h: 1 }],
    })!;
    expect(plan.zones).toEqual([{ id: 'ok', x: 1, y: 1, w: 1, h: 1 }]);
  });
});

describe('loadPlan / savePlan 往返兼容', () => {
  it('旧版页面只保存 { booths }，新版 loadPlan 能读且行为同 migratePlan', () => {
    const store = installFakeStorage();
    store.set(
      STORAGE_KEY,
      JSON.stringify({
        booths: [
          { id: 'b', x: 1, y: 1, w: 2, h: 2, orientation: 'south', label: 'A' },
        ],
      }),
    );
    const plan = loadPlan()!;
    expect(plan.booths[0].label).toBe('A');
    expect(plan.closedExits).toEqual([]);
    expect(plan.zones).toEqual([]);
  });

  it('新版保存（含重点展位与封控）后能原样读回', () => {
    const state: PlanState = {
      booths: [
        {
          id: 'c', x: 1, y: 1, w: 2, h: 2, orientation: 'south',
          label: 'C01', color: '#000', kind: 'booth', critical: true,
        },
      ],
      closedExits: ['exit-south'],
      zones: [{ id: 'z', x: 4, y: 4, w: 2, h: 2 }],
    };
    savePlan(state);
    const loaded = loadPlan()!;
    expect(loaded).toEqual(state);
  });

  it('存储内容损坏时返回 null 而不抛异常', () => {
    const store = installFakeStorage();
    store.set(STORAGE_KEY, '{not-json');
    expect(loadPlan()).toBeNull();
  });
});
