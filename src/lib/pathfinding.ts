/**
 * 疏散可达性：在展厅 0.5 m 网格上做 BFS / 最大流。
 * 展位 footprint 与临时封控区域为障碍（仅边相接不算阻挡，允许贴边通行），
 * 从展位正面接待点出发，4 邻接（不斜穿对角）。
 *
 * - findExitPath：到任一可用出口的最近路径（普通展位的单路检查）。
 * - findTwoExitPaths：重点展位的“双通道”判定。用顶点分裂（in/out）+
 *   每个出口容量 1 的网络做最大流：
 *     · 每个通行格 in→out 容量 1 ⇒ 两条路径除接待起点外不能共用任何网格；
 *     · 每个出口 E→汇点容量 1 ⇒ 两条路径必须通向不同出口；
 *     · 最大流为 2 才是真正双路。最大流是全局判定，不会因为贪心先选的
 *       第一条路径堵死第二条而误报（顶点不相交路径的标准充要条件）。
 */
import type { Booth, ExitDef, Lockdown, Point } from '../types';
import type { DualRouteResult } from '../types';
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
  /** 可达时路径抵达的出口 id */
  exitId?: string;
}

const EPS = 1e-9;

export interface GridModel {
  cols: number;
  rows: number;
  g: number;
  blocked: Uint8Array;
  blockedCellCount: number;
}

export interface GridBounds {
  width: number;
  height: number;
}

const HALL_BOUNDS: GridBounds = { width: HALL_WIDTH, height: HALL_HEIGHT };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function cellRect(cx: number, cy: number, g: number): Rect {
  return { x: cx * g, y: cy * g, w: g, h: g };
}

function rectsTouchIntersect(a: Rect, b: Box): boolean {
  // 与 geometry.intersects 同规则：仅边重合（可贴边）不算相交。
  return (
    a.x < b.x + b.w - EPS &&
    a.x + a.w > b.x + EPS &&
    a.y < b.y + b.h - EPS &&
    a.y + a.h > b.y + EPS
  );
}

/**
 * 构建障碍位图：展位 + 临时封控区域覆盖的格子为障碍。
 * 边与格线重合不算阻挡（可贴边通行）。
 */
export function buildGrid(
  booths: Booth[],
  zones: Box[] = [],
  g: number = PATH_GRID,
  bounds: GridBounds = HALL_BOUNDS,
): GridModel {
  const cols = Math.round(bounds.width / g);
  const rows = Math.round(bounds.height / g);
  const blocked = new Uint8Array(cols * rows);
  const boxes: Box[] = [
    ...booths.map((b) => rectOf(b)),
    ...zones.map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h })),
  ];
  let blockedCellCount = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const cell = cellRect(cx, cy, g);
      for (const box of boxes) {
        if (rectsTouchIntersect(cell, box)) {
          blocked[cy * cols + cx] = 1;
          blockedCellCount++;
          break;
        }
      }
    }
  }
  return { cols, rows, g, blocked, blockedCellCount };
}

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

function nearestCell(p: Point, g: number): { cx: number; cy: number } {
  return {
    cx: Math.round((p.x - g / 2) / g),
    cy: Math.round((p.y - g / 2) / g),
  };
}

/** 出口 id → 该出口在网格上的所有内侧目标格（越界格自动剔除）。 */
function exitTargetCellMap(
  exits: ExitDef[],
  cols: number,
  rows: number,
  g: number,
  bounds: GridBounds,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const exitDef of exits) {
    for (const t of exitTargetsForBounds(exitDef, bounds)) {
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
 * 出口内侧目标点（开口内 0.25 m、沿开口每 0.5 m 一个）。
 * 与 geometry.exitTargetPoints 同规则，但尺寸来自 bounds，便于在小网格上单测。
 */
function exitTargetsForBounds(
  e: ExitDef,
  bounds: GridBounds,
  inset: number = 0.25,
  step: number = 0.5,
): Point[] {
  const points: Point[] = [];
  const fixed =
    e.wall === 'south'
      ? bounds.height - inset
      : e.wall === 'north'
        ? inset
        : e.wall === 'east'
          ? bounds.width - inset
          : inset;
  for (let t = e.start; t <= e.end + 1e-9; t += step) {
    if (e.wall === 'north' || e.wall === 'south') points.push({ x: t, y: fixed });
    else points.push({ x: fixed, y: t });
  }
  return points;
}

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

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

/** 解析起点格：起点被堵时在 2 格范围内找最近可行走单元（与既有单路策略一致）。 */
function resolveStartCell(
  start: Point,
  model: GridModel,
): { cx: number; cy: number } | null {
  const { cols, rows, g, blocked } = model;
  const s = nearestCell(start, g);
  if (s.cx >= 0 && s.cx < cols && s.cy >= 0 && s.cy < rows && !blocked[s.cy * cols + s.cx]) {
    return s;
  }
  return nearestFreeNeighbor(s.cx, s.cy, blocked, cols, rows);
}

function cellsToMeters(cells: number[], model: GridModel): Point[] {
  const { cols, g } = model;
  return cells.map((idx) => ({
    x: (idx % cols) * g + g / 2,
    y: Math.floor(idx / cols) * g + g / 2,
  }));
}

/**
 * 从 start 寻路到任一“可用”出口。
 * @param booths 当前全部展位（障碍）
 * @param start 起点（通常是展位接待点）
 * @param zones 临时封控区域（障碍）
 * @param closedExitIds 被临时关闭（或被展位堵死）的出口 id，不作为目标
 */
export function findExitPath(
  booths: Booth[],
  start: Point,
  exits: ExitDef[] = EXITS,
  g: number = PATH_GRID,
  zones: Box[] = [],
  closedExitIds: readonly string[] = [],
  bounds: GridBounds = HALL_BOUNDS,
): PathResult {
  const model = buildGrid(booths, zones, g, bounds);
  const { cols, rows, blocked, blockedCellCount } = model;
  const closed = new Set(closedExitIds);
  const targetOf = exitTargetCellMap(
    exits.filter((e) => !closed.has(e.id)),
    cols,
    rows,
    g,
    bounds,
  );

  const startCell = resolveStartCell(start, model);
  if (!startCell) {
    return { reachable: false, path: [], blockedCellCount };
  }

  // BFS
  const prev = new Int32Array(cols * rows).fill(-1);
  const seen = new Uint8Array(cols * rows);
  const queue: number[] = [];
  const startIdx = startCell.cy * cols + startCell.cx;
  seen[startIdx] = 1;
  queue.push(startIdx);

  let goalIdx = -1;
  while (queue.length) {
    const idx = queue.shift()!;
    if (targetOf.has(idx)) {
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

  if (goalIdx === -1) {
    return { reachable: false, path: [], blockedCellCount };
  }

  // 回溯路径并转为米坐标（单元中心）。
  const cells: number[] = [];
  let cur = goalIdx;
  while (cur !== -1) {
    cells.push(cur);
    if (cur === startIdx) break;
    cur = prev[cur];
  }
  cells.reverse();
  const path = cellsToMeters(cells, model);
  // 首点用真实接待点，路径从展位正面出发而不是格子中心。
  path[0] = start;

  return {
    reachable: true,
    path,
    blockedCellCount,
    exitId: targetOf.get(goalIdx),
  };
}

/* ===================== 重点展位：双通道（顶点分裂最大流） ===================== */

interface FlowEdge {
  to: number;
  rev: number;
  cap: number;
  /** 初始容量，用于事后识别带流边。 */
  cap0: number;
}

class FlowNet {
  adj: FlowEdge[][] = [];

  node(): number {
    this.adj.push([]);
    return this.adj.length - 1;
  }

  /** 加一条有向容量边（同时建立残量反向边）。 */
  addEdge(from: number, to: number, cap: number): void {
    this.adj[from].push({ to, rev: this.adj[to].length, cap, cap0: cap });
    this.adj[to].push({ to: from, rev: this.adj[from].length - 1, cap: 0, cap0: 0 });
  }

  /** Edmonds–Karp：一次 BFS 增广，返回本次增广流量（0 表示已最大）。 */
  augment(s: number, t: number, limit: number): number {
    const n = this.adj.length;
    const pvNode = new Int32Array(n).fill(-1);
    const pvEdge = new Int32Array(n).fill(-1);
    pvNode[s] = s;
    const queue = [s];
    let head = 0;
    while (head < queue.length) {
      const v = queue[head++];
      if (v === t) break;
      const edges = this.adj[v];
      for (let ei = 0; ei < edges.length; ei++) {
        const e = edges[ei];
        if (e.cap > 0 && pvNode[e.to] === -1) {
          pvNode[e.to] = v;
          pvEdge[e.to] = ei;
          queue.push(e.to);
        }
      }
    }
    if (pvNode[t] === -1) return 0;
    // 找瓶颈
    let add = limit;
    for (let v = t; v !== s; v = pvNode[v]) {
      const e = this.adj[pvNode[v]][pvEdge[v]];
      add = Math.min(add, e.cap);
    }
    for (let v = t; v !== s; v = pvNode[v]) {
      const u = pvNode[v];
      const e = this.adj[u][pvEdge[v]];
      e.cap -= add;
      this.adj[v][e.rev].cap += add;
    }
    return add;
  }

  maxFlow(s: number, t: number, need: number): number {
    let flow = 0;
    while (flow < need) {
      const add = this.augment(s, t, need - flow);
      if (add === 0) break;
      flow += add;
    }
    return flow;
  }
}

/** BFS 可达格集合（从起点出发，4 邻接）。 */
function reachableCells(startIdx: number, model: GridModel): Uint8Array {
  const { cols, rows, blocked } = model;
  const seen = new Uint8Array(cols * rows);
  seen[startIdx] = 1;
  const queue = [startIdx];
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const cx = idx % cols;
    const cy = Math.floor(idx / cols);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nIdx = ny * cols + nx;
      if (seen[nIdx] || blocked[nIdx]) continue;
      seen[nIdx] = 1;
      queue.push(nIdx);
    }
  }
  return seen;
}

/**
 * 重点展位双通道判定。
 *
 * @param booths 展位障碍
 * @param start 接待起点
 * @param lockdown 封控（关闭出口 + 封控区域）
 * @param physicallyBlockedExitIds 被展位直接堵死的出口（同样不可作为目标）
 * @param exits 出口定义
 */
export function findTwoExitPaths(
  booths: Booth[],
  start: Point,
  lockdown?: Lockdown,
  physicallyBlockedExitIds: readonly string[] = [],
  exits: ExitDef[] = EXITS,
  g: number = PATH_GRID,
  bounds: GridBounds = HALL_BOUNDS,
): DualRouteResult {
  const zones = lockdown?.zones ?? [];
  const closed = new Set([
    ...(lockdown?.closedExits ?? []),
    ...physicallyBlockedExitIds,
  ]);
  const model = buildGrid(booths, zones, g, bounds);
  const { cols, rows, blocked } = model;
  const N = cols * rows;

  const startCell = resolveStartCell(start, model);
  if (!startCell) {
    return { status: 'none', primary: [], secondary: [], cause: 'cutoff' };
  }
  const startIdx = startCell.cy * cols + startCell.cx;

  // 1) 单源可达性：哪些出口“理论上”至少能到
  const reach = reachableCells(startIdx, model);
  const targetOf = exitTargetCellMap(exits, cols, rows, g, bounds);
  const reachableExits: { id: string; cells: number[] }[] = [];
  for (const exitDef of exits) {
    if (closed.has(exitDef.id)) continue;
    const cells: number[] = [];
    for (const [idx, id] of targetOf) {
      if (id === exitDef.id && !blocked[idx] && reach[idx]) cells.push(idx);
    }
    if (cells.length) reachableExits.push({ id: exitDef.id, cells });
  }

  if (reachableExits.length === 0) {
    return { status: 'none', primary: [], secondary: [], cause: 'cutoff' };
  }

  // 2) 顶点分裂网络：格 i → in=2i / out=2i+1
  const net = new FlowNet();
  const inNode = new Int32Array(N);
  const outNode = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    inNode[i] = net.node();
    outNode[i] = net.node();
  }
  const exitNode = new Map<string, number>();
  for (const e of reachableExits) exitNode.set(e.id, net.node());
  const S = net.node();
  const T = net.node();

  // 顶点容量：普通格 1（不可共用）；接待起点格 2（允许两条路同时从这里出发）
  for (let i = 0; i < N; i++) {
    if (blocked[i]) continue;
    net.addEdge(inNode[i], outNode[i], i === startIdx ? 2 : 1);
  }
  // 4 邻接（无向：两个方向各加一条容量边）
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const idx = cy * cols + cx;
      if (blocked[idx]) continue;
      if (cx + 1 < cols && !blocked[idx + 1]) {
        net.addEdge(outNode[idx], inNode[idx + 1], 2);
        net.addEdge(outNode[idx + 1], inNode[idx], 2);
      }
      if (cy + 1 < rows && !blocked[idx + cols]) {
        net.addEdge(outNode[idx], inNode[idx + cols], 2);
        net.addEdge(outNode[idx + cols], inNode[idx], 2);
      }
    }
  }
  // 出口：目标格 → 出口节点 → 汇点；出口节点容量 1 ⇒ 每出口至多一条路
  for (const e of reachableExits) {
    const en = exitNode.get(e.id)!;
    for (const cellIdx of e.cells) {
      net.addEdge(outNode[cellIdx], en, 1);
    }
    net.addEdge(en, T, 1);
  }
  net.addEdge(S, inNode[startIdx], 2);

  const flow = net.maxFlow(S, T, 2);

  if (flow < 1) {
    return { status: 'none', primary: [], secondary: [], cause: 'cutoff' };
  }

  // 3) 从带流边拆出各 1 单位的 S→T 路径
  const routes = decomposeFlow(net, S, T, inNode, outNode, exitNode, flow, model, start);
  if (routes.length === 0) {
    return { status: 'none', primary: [], secondary: [], cause: 'cutoff' };
  }
  // 稳定排序：按出口 id，保证主/次路渲染确定
  routes.sort((a, b) => a.exitId.localeCompare(b.exitId));

  if (flow === 2 && routes.length === 2 && routes[0].exitId !== routes[1].exitId) {
    return {
      status: 'dual',
      primary: routes[0].path,
      secondary: routes[1].path,
      primaryExitId: routes[0].exitId,
      secondaryExitId: routes[1].exitId,
    };
  }

  // 仅 1 条：能到两个以上出口却凑不出不共格双路 ⇒ 空间瓶颈；只剩一个出口 ⇒ 出口关闭
  const only = routes[0];
  const cause: DualRouteResult['cause'] =
    reachableExits.length >= 2 ? 'bottleneck' : 'exit-closed';
  return {
    status: 'single',
    primary: only.path,
    secondary: [],
    primaryExitId: only.exitId,
    reachableExitId: only.exitId,
    cause,
  };
}

/** 从最大流残量网络中拆出若干条带 1 单位流量的 S→T 路径。 */
function decomposeFlow(
  net: FlowNet,
  S: number,
  T: number,
  inNode: Int32Array,
  outNode: Int32Array,
  exitNode: Map<string, number>,
  units: number,
  model: GridModel,
  realStart: Point,
): { path: Point[]; exitId: string }[] {
  const { cols, g } = model;
  const N = inNode.length;
  const nodeToCell = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    nodeToCell.set(inNode[i], i);
    nodeToCell.set(outNode[i], i);
  }
  const nodeToExit = new Map<number, string>();
  for (const [id, node] of exitNode) nodeToExit.set(node, id);

  // 复制一份“剩余可消费流量”，避免修改原网络
  const used: { to: number; flow: number }[][] = net.adj.map((edges) =>
    edges.map((e) => ({ to: e.to, flow: e.cap0 - e.cap })),
  );

  /** 在正流图上 DFS 找到 S→T，并只在成功时消费沿边流量；返回节点序列。 */
  const findFlowPath = (): number[] | null => {
    const pathNodes: number[] = [];
    const edgePos: number[] = [];
    const seen = new Set<number>([S]);
    const dfs = (v: number): boolean => {
      if (v === T) return true;
      const edges = used[v];
      for (let ei = 0; ei < edges.length; ei++) {
        const e = edges[ei];
        if (e.flow <= 0 || seen.has(e.to)) continue;
        seen.add(e.to);
        pathNodes.push(e.to);
        edgePos.push(ei);
        if (dfs(e.to)) return true;
        pathNodes.pop();
        edgePos.pop();
        seen.delete(e.to);
      }
      return false;
    };
    pathNodes.push(S);
    if (!dfs(S)) return null;
    // 消费沿边 1 单位流量
    let u = S;
    for (let k = 1; k < pathNodes.length; k++) {
      const w = pathNodes[k];
      const e = used[u].find((x) => x.to === w && x.flow > 0)!;
      e.flow -= 1;
      u = w;
    }
    return pathNodes;
  };

  const routes: { path: Point[]; exitId: string }[] = [];
  for (let unit = 0; unit < units; unit++) {
    const nodeSeq = findFlowPath();
    if (!nodeSeq) break;
    const cellSeq: number[] = [];
    let exitId: string | null = null;
    for (const v of nodeSeq) {
      if (nodeToExit.has(v)) exitId = nodeToExit.get(v)!;
      // out 节点（编号为奇数且落在 in/out 区间）代表“离开该格”
      if (v >= 0 && v < 2 * N && v % 2 === 1) {
        cellSeq.push(nodeToCell.get(v)!);
      }
    }
    if (!exitId || cellSeq.length === 0) continue;
    const path = cellSeq.map((cellIdx) => ({
      x: (cellIdx % cols) * g + g / 2,
      y: Math.floor(cellIdx / cols) * g + g / 2,
    }));
    path[0] = realStart; // 首点用真实接待点
    routes.push({ path, exitId });
  }
  return routes;
}
