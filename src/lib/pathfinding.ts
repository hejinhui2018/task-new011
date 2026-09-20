/**
 * 疏散可达性：在展厅 0.5 m 网格上做 BFS。
 * 展位 footprint 与临时封控区域为障碍（边相不算阻挡，允许贴边通行），
 * 从展位正面接待点出发，4 邻接（不斜穿对角），到达任一出口目标点即成功。
 */
import type { Booth, ControlZone, ExitDef, Point } from '../types';
import {
  EXITS,
  HALL_HEIGHT,
  HALL_WIDTH,
  PATH_GRID,
} from '../constants';
import { exitTargetPoints, rectOf } from './geometry';
import type { Rect } from './geometry';

export interface PathResult {
  reachable: boolean;
  /** 可走路径（米坐标）；不可达时为空数组 */
  path: Point[];
  /** 调试/测试用：本次搜索的障碍信息 */
  blockedCellCount: number;
}

const EPS = 1e-9;

/** 出口开口内侧网格是否全部可通行；任一目标格被展位占据即视为出口被堵。 */
export function exitBlockingBooth(
  booths: Booth[],
  exitDef: ExitDef,
  g: number = PATH_GRID,
): Booth | null {
  const cols = Math.round(HALL_WIDTH / g);
  const rows = Math.round(HALL_HEIGHT / g);
  for (const t of exitTargetPoints([exitDef])) {
    const c = nearestCell(t, g);
    if (isBlockedCell(c.cx, c.cy, booths, cols, rows, g)) {
      const cell = cellRect(c.cx, c.cy, g);
      const hit = booths.find((b) => rectsTouchIntersect(cell, rectOf(b)));
      if (hit) return hit;
    }
  }
  return null;
}

function cellRect(cx: number, cy: number, g: number): Rect {
  return { x: cx * g, y: cy * g, w: g, h: g };
}

function rectsTouchIntersect(a: Rect, b: Rect): boolean {
  // 与 geometry.intersects 同规则：仅边重合（可贴边）不算相交。
  return (
    a.x < b.x + b.w - EPS &&
    a.x + a.w > b.x + EPS &&
    a.y < b.y + b.h - EPS &&
    a.y + a.h > b.y + EPS
  );
}

/**
 * 判断某个网格单元中心所在单元是否被展位占据。
 * 导出供测试使用。
 */
export function isBlockedCell(
  cx: number,
  cy: number,
  booths: Booth[],
  cols: number,
  rows: number,
  g: number = PATH_GRID,
): boolean {
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return true;
  const cell = cellRect(cx, cy, g);
  for (const b of booths) {
    if (rectsTouchIntersect(cell, rectOf(b))) return true;
  }
  return false;
}

export function nearestCell(p: Point, g: number): { cx: number; cy: number } {
  return {
    cx: Math.round((p.x - g / 2) / g),
    cy: Math.round((p.y - g / 2) / g),
  };
}

/** 单元索引 -> 单元中心米坐标。 */
export function cellCenter(idx: number, cols: number, g: number): Point {
  return {
    x: (idx % cols) * g + g / 2,
    y: Math.floor(idx / cols) * g + g / 2,
  };
}

/** 可通行网格模型：booths + 临时封控区域共同构成障碍位图。 */
export interface GridModel {
  cols: number;
  rows: number;
  g: number;
  blocked: Uint8Array;
  blockedCellCount: number;
}

export function buildGrid(
  booths: Booth[],
  zones: ControlZone[] = [],
  g: number = PATH_GRID,
): GridModel {
  const cols = Math.round(HALL_WIDTH / g);
  const rows = Math.round(HALL_HEIGHT / g);
  const blocked = new Uint8Array(cols * rows);
  let blockedCellCount = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = cellRect(cx, cy, g);
      let occupied = false;
      for (const b of booths) {
        if (rectsTouchIntersect(cell, rectOf(b))) {
          occupied = true;
          break;
        }
      }
      if (!occupied) {
        for (const z of zones) {
          if (rectsTouchIntersect(cell, z)) {
            occupied = true;
            break;
          }
        }
      }
      if (occupied) {
        blocked[cy * cols + cx] = 1;
        blockedCellCount++;
      }
    }
  }
  return { cols, rows, g, blocked, blockedCellCount };
}

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** 在网格上从起点单元 BFS 到任一目标单元；返回单元索引路径。 */
export function bfsCells(
  grid: GridModel,
  startIdx: number,
  targets: Set<number>,
): { reachable: boolean; goalIdx: number; cells: number[] } {
  const { cols, rows, blocked } = grid;
  const prev = new Int32Array(cols * rows).fill(-1);
  const seen = new Uint8Array(cols * rows);
  const queue: number[] = [startIdx];
  seen[startIdx] = 1;

  let goalIdx = -1;
  while (queue.length) {
    const idx = queue.shift()!;
    if (targets.has(idx)) {
      goalIdx = idx;
      break;
    }
    const cx = idx % cols;
    const cy = Math.floor(idx / cols);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nIdx = ny * cols + nx;
      if (seen[nIdx] || blocked[nIdx]) continue;
      seen[nIdx] = 1;
      prev[nIdx] = idx;
      queue.push(nIdx);
    }
  }

  if (goalIdx === -1) return { reachable: false, goalIdx: -1, cells: [] };

  const cells: number[] = [];
  let cur = goalIdx;
  while (cur !== -1) {
    cells.push(cur);
    if (cur === startIdx) break;
    cur = prev[cur];
  }
  cells.reverse();
  return { reachable: true, goalIdx, cells };
}

/** 解析可行走起点：起点被堵时在 1~2 格范围内找最近的空闲单元。 */
export function resolveStartCell(
  start: Point,
  grid: GridModel,
): { idx: number } | null {
  const s = nearestCell(start, grid.g);
  const { cols, rows, blocked } = grid;
  if (
    s.cx >= 0 &&
    s.cy >= 0 &&
    s.cx < cols &&
    s.cy < rows &&
    !blocked[s.cy * cols + s.cx]
  ) {
    return { idx: s.cy * cols + s.cx };
  }
  const alt = nearestFreeNeighbor(s.cx, s.cy, blocked, cols, rows);
  return alt ? { idx: alt.cy * cols + alt.cx } : null;
}

/** 出口开口内侧目标单元集合（去重）。 */
export function exitTargetCellMap(
  exits: ExitDef[],
  cols: number,
  rows: number,
  g: number,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const exitDef of exits) {
    for (const t of exitTargetPoints([exitDef])) {
      const c = nearestCell(t, g);
      if (c.cx >= 0 && c.cx < cols && c.cy >= 0 && c.cy < rows) {
        const idx = c.cy * cols + c.cx;
        if (!map.has(idx)) map.set(idx, exitDef.id);
      }
    }
  }
  return map;
}

/**
 * 从 start 寻路到任一出口。
 * @param booths 当前全部展位（障碍）
 * @param start 起点（通常是展位接待点）
 * @param exits 可用出口（默认全部；封控时传入未关闭出口）
 * @param zones 临时封控区域（障碍）
 */
export function findExitPath(
  booths: Booth[],
  start: Point,
  exits: ExitDef[] = EXITS,
  g: number = PATH_GRID,
  zones: ControlZone[] = [],
): PathResult {
  const grid = buildGrid(booths, zones, g);

  const startCell = resolveStartCell(start, grid);
  if (!startCell) {
    return { reachable: false, path: [], blockedCellCount: grid.blockedCellCount };
  }

  const targetMap = exitTargetCellMap(exits, grid.cols, grid.rows, g);
  const result = bfsCells(grid, startCell.idx, new Set(targetMap.keys()));
  if (!result.reachable) {
    return { reachable: false, path: [], blockedCellCount: grid.blockedCellCount };
  }

  const path: Point[] = result.cells.map((idx) =>
    cellCenter(idx, grid.cols, g),
  );
  // 首点用真实接待点，路径从展位正面出发而不是格子中心。
  path[0] = start;

  return { reachable: true, path, blockedCellCount: grid.blockedCellCount };
}

function nearestFreeNeighbor(
  cx: number,
  cy: number,
  blocked: Uint8Array,
  cols: number,
  rows: number,
): { cx: number; cy: number } | null {
  for (let r = 1; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (!blocked[ny * cols + nx]) return { cx: nx, cy: ny };
      }
    }
  }
  return null;
}
