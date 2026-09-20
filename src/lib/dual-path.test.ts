import { describe, it, expect } from 'vitest';
import type { ExitDef, Lockdown, Point } from '../types';
import { buildGrid, findExitPath, findTwoExitPaths } from './pathfinding';

/**
 * 小网格测试夹具（g=1 m），用封控区域把展厅“挖”成指定图结构，
 * 从而能确定性地构造“贪心陷阱”。
 */
const G = 1;
const NEI = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const wall = (x: number, y: number, w: number, h: number) => ({
  id: `w-${x}-${y}-${w}-${h}`,
  x,
  y,
  w,
  h,
});

function toCell(p: Point, g: number) {
  return {
    cx: Math.round((p.x - g / 2) / g),
    cy: Math.round((p.y - g / 2) / g),
  };
}

/** 路径（米坐标）→ 格索引集合（可剔除起点格）。 */
function pathCells(
  path: Point[],
  g: number,
  cols: number,
  rows: number,
): Set<number> {
  const set = new Set<number>();
  for (const p of path) {
    const { cx, cy } = toCell(p, g);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
    set.add(cy * cols + cx);
  }
  return set;
}

function expectValidPath(
  path: Point[],
  g: number,
  onExit: (end: Point) => void,
) {
  expect(path.length).toBeGreaterThan(1);
  for (let i = 2; i < path.length; i++) {
    const manhattan =
      Math.abs(path[i].x - path[i - 1].x) / g +
      Math.abs(path[i].y - path[i - 1].y) / g;
    expect(Math.round(manhattan)).toBe(1);
  }
  onExit(path[path.length - 1]);
}

/**
 * 朴素贪心策略（产品不能犯的错误）：
 * 1) BFS 找到最近出口的一条最短路 P1；2) 删除 P1 占用格（起点除外）；
 * 3) 再判断另一出口是否可达。
 */
function greedyTwoRoutes(
  zones: Lockdown['zones'],
  start: Point,
  exits: ExitDef[],
  bounds: { width: number; height: number },
): number {
  const { cols, rows, blocked } = buildGrid([], zones, G, bounds);
  const startCell = toCell(start, G);
  const sIdx = startCell.cy * cols + startCell.cx;

  // 出口目标格：仅该出口最短路的终点格（开口内侧）
  const targetsOf = new Map<string, Set<number>>();
  for (const e of exits) {
    const r = findExitPath([], start, [e], G, zones, [], bounds);
    const set = new Set<number>();
    if (r.reachable) {
      const last = r.path[r.path.length - 1];
      const c = toCell(last, G);
      set.add(c.cy * cols + c.cx);
    }
    targetsOf.set(e.id, set);
  }

  const bfs = (extraBlocked: Set<number>) => {
    const prev = new Int32Array(cols * rows).fill(-1);
    const seen = new Uint8Array(cols * rows);
    const q = [sIdx];
    seen[sIdx] = 1;
    let head = 0;
    let goal: { idx: number; exitId: string } | null = null;
    while (head < q.length) {
      const idx = q[head++];
      for (const [exitId, set] of targetsOf) {
        if (set.has(idx)) {
          goal = { idx, exitId };
          break;
        }
      }
      if (goal) break;
      const cx = idx % cols;
      const cy = Math.floor(idx / cols);
      for (const [dx, dy] of NEI) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (seen[ni] || blocked[ni] || extraBlocked.has(ni)) continue;
        seen[ni] = 1;
        prev[ni] = idx;
        q.push(ni);
      }
    }
    if (!goal) return null;
    const cells = new Set<number>();
    let cur = goal.idx;
    while (cur !== -1) {
      cells.add(cur);
      if (cur === sIdx) break;
      cur = prev[cur];
    }
    return { cells, exitId: goal.exitId };
  };

  const first = bfs(new Set());
  if (!first) return 0;
  const used = new Set([...first.cells].filter((i) => i !== sIdx));
  const otherExit = exits.find((e) => e.id !== first!.exitId)!;
  const other = targetsOf.get(otherExit.id)!;
  // 第二次 BFS：第一路径被占后，另一出口目标格是否可达
  const seen = new Uint8Array(cols * rows);
  const q = [sIdx];
  seen[sIdx] = 1;
  let head = 0;
  let ok = false;
  while (head < q.length) {
    const idx = q[head++];
    if (other.has(idx)) {
      ok = true;
      break;
    }
    const cx = idx % cols;
    const cy = Math.floor(idx / cols);
    for (const [dx, dy] of NEI) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (seen[ni] || blocked[ni] || used.has(ni)) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  return ok ? 2 : 1;
}

/* ---------- 夹具 A：开放小展厅，双路天然存在 ---------- */
const OPEN_BOUNDS = { width: 13, height: 9 };
const OPEN_START: Point = { x: 1.5, y: 4.5 };
const OPEN_EXITS: ExitDef[] = [
  { id: 'e1', wall: 'east', start: 1, end: 1 },
  { id: 'e2', wall: 'south', start: 12, end: 12 },
];

/* ---------- 夹具 B：唯一瓶颈缺口（去两出口都必须挤过同一格） ---------- */
const bottleneckZones = [
  wall(6, 0, 1, 4), // 纵向隔断 x=6 封 (6,0..3)
  wall(6, 5, 1, 4), // 封 (6,5..8)，只留 (6,4)
];

/* ---------- 夹具 C：贪心陷阱（4×6 网格，g=1，封控挖出指定走廊） ----------
 * 自由格：s=(0,1)，a=(1,1)，b=(0,0)，c=(1,0)，
 *   东向走廊 c→(2,0)→(3,0)=e1（距 s 4 步）；
 *   南向走廊 a→(1,2)→(1,3)→(1,4)→(1,5)=e2（距 s 5 步，且只能经 a）。
 * 可行不相交双路：s-b-c-…→e1 与 s-a-…→e2（仅共用 s）。
 * 但贪心先选更近的 e1；e1 的 BFS 最短路因邻居展开顺序经 a→c，占用 a，
 * e2 唯一走廊被掐断 ⇒ 贪心误报“仅 1 条”。
 */
const TRAP_BOUNDS = { width: 4, height: 6 };
const TRAP_START: Point = { x: 0.5, y: 1.5 };
const TRAP_EXITS: ExitDef[] = [
  { id: 'e1', wall: 'east', start: 0, end: 0 },
  { id: 'e2', wall: 'south', start: 1, end: 1 },
];
const trapZones = [
  wall(2, 1, 2, 5), // x 2..3、y 1..5 封死
  wall(0, 2, 1, 4), // (0,2..5) 封死
];

describe('findTwoExitPaths 重点展位双通道', () => {
  it('开放展厅：两条路通往不同出口，且除起点外不共格', () => {
    const r = findTwoExitPaths([], OPEN_START, { closedExits: [], zones: [] }, [], OPEN_EXITS, G, OPEN_BOUNDS);
    expect(r.status).toBe('dual');
    expect(r.primaryExitId).not.toBe(r.secondaryExitId);
    expect([r.primaryExitId, r.secondaryExitId].sort()).toEqual(['e1', 'e2']);

    const cols = Math.round(OPEN_BOUNDS.width / G);
    const rows = Math.round(OPEN_BOUNDS.height / G);
    const sIdx = (() => {
      const s = toCell(OPEN_START, G);
      return s.cy * cols + s.cx;
    })();
    const a = pathCells(r.primary, G, cols, rows);
    const b = pathCells(r.secondary, G, cols, rows);
    expect([...a].filter((c) => b.has(c) && c !== sIdx)).toEqual([]);
    expectValidPath(r.primary, G, (end) => {
      expect(end.x).toBeGreaterThan(OPEN_BOUNDS.width - 0.6);
    });
    expectValidPath(r.secondary, G, (end) => {
      expect(end.y).toBeGreaterThan(OPEN_BOUNDS.height - 0.6);
    });
  });

  it('单一瓶颈缺口：两出口都可达但只能凑一条，判空间瓶颈', () => {
    const r = findTwoExitPaths(
      [],
      OPEN_START,
      { closedExits: [], zones: bottleneckZones },
      [],
      OPEN_EXITS,
      G,
      OPEN_BOUNDS,
    );
    expect(r.status).toBe('single');
    expect(r.cause).toBe('bottleneck');
    expect(['e1', 'e2']).toContain(r.reachableExitId);
    expect(r.secondary).toEqual([]);
    expect(r.primary.length).toBeGreaterThan(1);
  });

  it('贪心陷阱：朴素贪心误报仅 1 条，但最大流判定真正双路存在', () => {
    // 证明陷阱真实存在：贪心策略在该夹具上只能找到 1 条
    expect(greedyTwoRoutes(trapZones, TRAP_START, TRAP_EXITS, TRAP_BOUNDS)).toBe(1);

    const r = findTwoExitPaths(
      [],
      TRAP_START,
      { closedExits: [], zones: trapZones },
      [],
      TRAP_EXITS,
      G,
      TRAP_BOUNDS,
    );
    expect(r.status).toBe('dual');
    expect(r.primaryExitId).not.toBe(r.secondaryExitId);

    const cols = Math.round(TRAP_BOUNDS.width / G);
    const rows = Math.round(TRAP_BOUNDS.height / G);
    const sIdx = (() => {
      const s = toCell(TRAP_START, G);
      return s.cy * cols + s.cx;
    })();
    const a = pathCells(r.primary, G, cols, rows);
    const b = pathCells(r.secondary, G, cols, rows);
    expect([...a].filter((c) => b.has(c) && c !== sIdx)).toEqual([]);
    // 两条路确实分赴东墙、南墙两个不同出口
    const toE1 = r.primaryExitId === 'e1' ? r.primary : r.secondary;
    const toE2 = r.primaryExitId === 'e2' ? r.primary : r.secondary;
    expectValidPath(toE1, G, (end) => {
      expect(end.x).toBeGreaterThan(TRAP_BOUNDS.width - 0.6);
    });
    expectValidPath(toE2, G, (end) => {
      expect(end.y).toBeGreaterThan(TRAP_BOUNDS.height - 0.6);
    });
  });

  it('关闭一个出口：降级单路并归因为出口关闭', () => {
    const r = findTwoExitPaths(
      [],
      OPEN_START,
      { closedExits: ['e2'], zones: [] },
      [],
      OPEN_EXITS,
      G,
      OPEN_BOUNDS,
    );
    expect(r.status).toBe('single');
    expect(r.cause).toBe('exit-closed');
    expect(r.reachableExitId).toBe('e1');
  });

  it('关闭全部出口：完全不可达（cutoff）', () => {
    const r = findTwoExitPaths(
      [],
      OPEN_START,
      { closedExits: ['e1', 'e2'], zones: [] },
      [],
      OPEN_EXITS,
      G,
      OPEN_BOUNDS,
    );
    expect(r.status).toBe('none');
    expect(r.cause).toBe('cutoff');
    expect(r.primary).toEqual([]);
    expect(r.secondary).toEqual([]);
  });

  it('被展位物理封堵的出口不能作为双路目标', () => {
    const r = findTwoExitPaths(
      [],
      OPEN_START,
      { closedExits: [], zones: [] },
      ['e1'],
      OPEN_EXITS,
      G,
      OPEN_BOUNDS,
    );
    expect(r.status).toBe('single');
    expect(r.reachableExitId).toBe('e2');
  });

  it('封控区域四面围住起点：完全不可达', () => {
    const zones = [
      wall(0, 3, 4, 1),
      wall(0, 5, 4, 1),
      wall(0, 3, 1, 3),
      wall(3, 3, 1, 3),
    ];
    const r = findTwoExitPaths(
      [],
      OPEN_START,
      { closedExits: [], zones },
      [],
      OPEN_EXITS,
      G,
      OPEN_BOUNDS,
    );
    expect(r.status).toBe('none');
    expect(r.cause).toBe('cutoff');
  });
});
