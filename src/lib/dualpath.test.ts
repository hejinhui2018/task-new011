import { describe, it, expect } from 'vitest';
import { findDualOnGrid, findDualExitPaths } from './dualpath';
import type { GridModel } from './pathfinding';
import type { Booth, ControlZone, Point } from '../types';
import { EXITS, HALL_WIDTH, PATH_GRID } from '../constants';
import { receptionPoint } from './geometry';

/** 用字符地图构造网格：'#'=障碍，'.'/其它=可通行；g 取 1 便于人工设计。 */
function gridFromMap(rows: string[]): GridModel {
  const r = rows.length;
  const c = rows[0].length;
  const blocked = new Uint8Array(c * r);
  rows.forEach((line, y) => {
    for (let x = 0; x < c; x++) {
      if (line[x] === '#') blocked[y * c + x] = 1;
    }
  });
  return { cols: c, rows: r, g: 1, blocked, blockedCellCount: blocked.filter(Boolean).length };
}

const idx = (g: GridModel, x: number, y: number) => y * g.cols + x;

/** 除起点外两条路线是否格点不相交。 */
function disjointExceptStart(a: number[], b: number[], start: number): boolean {
  const setA = new Set(a);
  setA.delete(start);
  return b.every((cell) => cell === start || !setA.has(cell));
}

/** 两条路线各自是否 4 邻接连续。 */
function isContinuous(cells: number[], cols: number): boolean {
  for (let i = 1; i < cells.length; i++) {
    const ax = cells[i - 1] % cols;
    const ay = Math.floor(cells[i - 1] / cols);
    const bx = cells[i] % cols;
    const by = Math.floor(cells[i] / cols);
    if (Math.abs(ax - bx) + Math.abs(ay - by) !== 1) return false;
  }
  return true;
}

describe('findDualOnGrid 网格级双路径', () => {
  it('空场两个出口：存在双路，终点为不同出口，除起点外不共格', () => {
    // 3×3 开放场，S 在下方中央，A/B 在左上/右上
    const g = gridFromMap([
      'A...B',
      '.....',
      '.....',
      '.....',
      '..S..',
    ]);
    const s = idx(g, 2, 4);
    const targets = new Map([
      [idx(g, 0, 0), 'A'],
      [idx(g, 4, 0), 'B'],
    ]);
    const res = findDualOnGrid(g, s, targets);
    expect(res.flow).toBe(2);
    expect(res.routes).toHaveLength(2);
    expect(new Set(res.routes.map((r) => r.exitId))).toEqual(new Set(['A', 'B']));
    const [r1, r2] = res.routes;
    expect(r1.cells[0]).toBe(s);
    expect(r2.cells[0]).toBe(s);
    expect(disjointExceptStart(r1.cells, r2.cells, s)).toBe(true);
    expect(isContinuous(r1.cells, g.cols)).toBe(true);
    expect(isContinuous(r2.cells, g.cols)).toBe(true);
  });

  it('贪心反例：短路先占咽喉会误判单路，最大流仍正确找到双路', () => {
    // 11 列 × 7 行：
    //   row0:  ......A....   A=(6,0)
    //   row1:  .....#.....
    //   row2:  ....##.#...   直上走廊 col6，B 的凹室在其左侧
    //   row3:  ....#B.#...   B=(5,3) 是单格凹室，唯一入口 (6,3)
    //   row4:  ######.###.   横墙，唯一近口 X=(6,4)，墙在 col10 留远端绕行口
    //   row5:  ...........
    //   row6:  ......S....   S=(6,6)
    //
    // S->A 的唯一最短路是直上 col6 穿 X（6 步），贪心先选它会占掉 (6,3)——
    // B 凹室的唯一入口，于是 B 不可达，贪心误报“仅一条”。
    // 实际上 A 还可以向右绕 col10、过墙端缺口、沿 row0 回来；最大流判定双路成立。
    const g = gridFromMap([
      '......A....',
      '.....#.....',
      '....##.#...',
      '....#B.#...',
      '######.###.',
      '...........',
      '......S....',
    ]);
    const s = idx(g, 6, 6);
    const A = idx(g, 6, 0);
    const B = idx(g, 5, 3);

    // 贪心基线复现：占掉 S->A 的唯一最短路后，凹室 B 确实不可达
    {
      const greedyPath = [
        s,
        idx(g, 6, 5),
        idx(g, 6, 4),
        idx(g, 6, 3),
        idx(g, 6, 2),
        idx(g, 6, 1),
        A,
      ];
      const blocked = new Uint8Array(g.blocked);
      greedyPath.slice(1).forEach((c) => (blocked[c] = 1));
      const g2: GridModel = { ...g, blocked };
      expect(findDualOnGrid(g2, s, new Map([[B, 'B']])).flow).toBe(0);
    }

    // 最大流全局判定：双路成立
    const res = findDualOnGrid(g, s, new Map([[A, 'A'], [B, 'B']]));
    expect(res.flow).toBe(2);
    expect(new Set(res.routes.map((r) => r.exitId))).toEqual(new Set(['A', 'B']));
    const [r1, r2] = res.routes;
    expect(disjointExceptStart(r1.cells, r2.cells, s)).toBe(true);
    expect(isContinuous(r1.cells, g.cols)).toBe(true);
    expect(isContinuous(r2.cells, g.cols)).toBe(true);
    // 去 A 的路绕墙端缺口 (10,4)，不再占用咽喉 X=(6,4) 与凹室入口 (6,3)
    const toA = res.routes.find((r) => r.exitId === 'A')!;
    expect(toA.cells).toContain(idx(g, 10, 4));
    expect(toA.cells).not.toContain(idx(g, 6, 4));
    expect(toA.cells).not.toContain(idx(g, 6, 3));
    // 去 B 的路穿过 X 进入凹室
    const toB = res.routes.find((r) => r.exitId === 'B')!;
    expect(toB.cells).toContain(idx(g, 6, 4));
    expect(toB.cells).toContain(B);
  });

  it('空间瓶颈：两条出口共用唯一咽喉格时只有单路', () => {
    // S 所在的下半区与上半区（A、B 两个出口）之间只有 col4 一个缺口
    const g = gridFromMap([
      'A...B',
      '.....',
      '####.',
      '.....',
      '..S..',
    ]);
    const s = idx(g, 2, 4);
    const res = findDualOnGrid(
      g,
      s,
      new Map([
        [idx(g, 0, 0), 'A'],
        [idx(g, 4, 0), 'B'],
      ]),
    );
    expect(res.flow).toBe(1);
    expect(res.routes).toHaveLength(1);
    // 唯一的路线必须经过咽喉 (4,2)
    expect(res.routes[0].cells).toContain(idx(g, 4, 2));
  });

  it('只有一个出口时：出口闸门容量为 1，最多一条路', () => {
    const g = gridFromMap([
      '.....',
      '.....',
      '..A..',
      '.....',
      '..S..',
    ]);
    const res = findDualOnGrid(
      g,
      idx(g, 2, 4),
      new Map([[idx(g, 2, 2), 'A']]),
    );
    expect(res.flow).toBe(1);
    expect(res.routes[0].exitId).toBe('A');
  });

  it('接待起点被四周围死：flow=0', () => {
    const g = gridFromMap([
      'A...B',
      '.....',
      '.....',
      '.###.',
      '###S#',
    ]);
    // S=(3,4) 的四个邻格全部是墙/边界，与两个出口完全隔绝
    const res = findDualOnGrid(
      g,
      idx(g, 3, 4),
      new Map([
        [idx(g, 0, 0), 'A'],
        [idx(g, 4, 0), 'B'],
      ]),
    );
    expect(res.flow).toBe(0);
    expect(res.routes).toEqual([]);
  });
});

function booth(p: Partial<Booth>): Booth {
  return {
    id: p.id ?? 'b',
    x: p.x ?? 9,
    y: p.y ?? 6,
    w: p.w ?? 2,
    h: p.h ?? 2,
    orientation: p.orientation ?? 'south',
    label: p.label ?? 'T',
    color: '#000',
    kind: p.kind ?? 'booth',
    critical: p.critical,
  };
}

/** 把米坐标路径转成格点索引集合。 */
function cellSet(path: Point[]): Set<number> {
  const cols = Math.round(HALL_WIDTH / PATH_GRID);
  const set = new Set<number>();
  // path[0] 是真实接待点，从第 2 个点起才是格心
  for (const p of path.slice(1)) {
    const cx = Math.round((p.x - PATH_GRID / 2) / PATH_GRID);
    const cy = Math.round((p.y - PATH_GRID / 2) / PATH_GRID);
    set.add(cy * cols + cx);
  }
  return set;
}

describe('findDualExitPaths 展厅级双路径', () => {
  it('空展厅中央重点展位：两条路通往南/北不同出口且不共用通行格', () => {
    const b = booth({ id: 'c', x: 9, y: 6, critical: true });
    const res = findDualExitPaths([b], receptionPoint(b), EXITS);
    expect(res.flow).toBe(2);
    expect(res.routes).toHaveLength(2);
    const ids = new Set(res.routes.map((r) => r.exitId));
    expect(ids).toEqual(new Set(['exit-south', 'exit-north']));
    const [s1, s2] = [cellSet(res.routes[0].path), cellSet(res.routes[1].path)];
    const overlap = [...s1].filter((c) => s2.has(c));
    expect(overlap).toEqual([]);
  });

  it('关闭一个出口后只剩单路', () => {
    const b = booth({ id: 'c', x: 9, y: 6, critical: true });
    const res = findDualExitPaths(
      [b],
      receptionPoint(b),
      EXITS.filter((e) => e.id !== 'exit-south'),
    );
    expect(res.flow).toBe(1);
    expect(res.routes[0].exitId).toBe('exit-north');
  });

  it('封控区域切断全部通行时 flow=0', () => {
    const b = booth({ id: 'c', x: 4, y: 1, w: 2, h: 2, critical: true });
    // 用围挡 + 封控区域把展位困在左上角封闭区
    const walls: Booth[] = [
      booth({ id: 'wn', x: 0, y: 4, w: 8, h: 0.5, kind: 'partition' }),
      booth({ id: 'ww', x: 7.5, y: 0, w: 0.5, h: 4.5, kind: 'partition' }),
    ];
    const res = findDualExitPaths([...walls, b], receptionPoint(b), EXITS, []);
    expect(res.flow).toBe(0);
  });

  it('封控区域变化后双路立即重算：封掉一扇门降为单路、撤掉恢复双路', () => {
    // 围挡小院 [8,12.5] × [8,12.5]，南墙留两扇 0.5 m 的门（各一格）：
    // 门 A 格列 x∈[9,9.5]，门 B 格列 x∈[11,11.5]。
    const walls: Booth[] = [
      booth({ id: 'wn', x: 8, y: 8, w: 4.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'ws1', x: 8, y: 12, w: 1, h: 0.5, kind: 'partition' }),
      booth({ id: 'ws2', x: 9.5, y: 12, w: 1.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'ws3', x: 11.5, y: 12, w: 1, h: 0.5, kind: 'partition' }),
      booth({ id: 'ww', x: 8, y: 8, w: 0.5, h: 4.5, kind: 'partition' }),
      booth({ id: 'we', x: 12, y: 8, w: 0.5, h: 4.5, kind: 'partition' }),
    ];
    const b = booth({ id: 'c', x: 9.5, y: 9, w: 2, h: 2, critical: true });
    const all = [...walls, b];

    const before = findDualExitPaths(all, receptionPoint(b), EXITS, []);
    expect(before.flow).toBe(2);
    expect(new Set(before.routes.map((r) => r.exitId))).toEqual(
      new Set(['exit-south', 'exit-north']),
    );

    // 封控门 A（恰好占一个格）：只剩门 B 一扇，两条路线被迫共用 -> 单路
    const zone: ControlZone = { id: 'z', x: 9, y: 12, w: 0.5, h: 0.5 };
    const after = findDualExitPaths(all, receptionPoint(b), EXITS, [zone]);
    expect(after.flow).toBe(1);

    // 撤掉封控：双路立即恢复
    const reopened = findDualExitPaths(all, receptionPoint(b), EXITS, []);
    expect(reopened.flow).toBe(2);
  });

  it('路径首点始终是真实接待点而不是格心', () => {
    const b = booth({ id: 'c', x: 9, y: 6, orientation: 'east', critical: true });
    const res = findDualExitPaths([b], receptionPoint(b), EXITS);
    for (const r of res.routes) {
      expect(r.path[0]).toEqual(receptionPoint(b));
    }
  });
});
