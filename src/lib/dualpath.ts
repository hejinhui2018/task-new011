/**
 * 重点展位“双通道”演练：求两条除接待起点外、通行网格完全不共用的疏散路径，
 * 且两条路径必须通往【不同的出口】。
 *
 * 为什么不用“先走一条再绕开它找第二条”的贪心：
 *   先选中的最短路径可能恰好卡住第二条通道的咽喉，贪心会误报“只有一条”，
 *   而换一种走法双路其实都通。顶点不相交双路径是否存在是全局判定，
 *   这里用节点拆分（vertex splitting）+ 最大流求解，流值为 2 才是真正双路可用。
 *
 * 容量网络：
 *   每个可通行格点 v 拆成 v_in -> v_out，容量 1（起点格容量 2，允许两条路共用接待点）；
 *   相邻格点间 v_out -> u_in，容量 1；
 *   每个出口加一个“出口闸门”节点，该出口的全部目标格 v_out -> 闸门，
 *   闸门 -> 超级汇点容量 1（保证两条路终点出口不同）；
 *   超级源点 -> 起点 v_in，容量 2。
 * 在该网络上跑 Edmonds-Karp，最大流即互不相交路径数（最多 2）。
 */
import type { Booth, ControlZone, ExitDef, Point } from '../types';
import {
  buildGrid,
  cellCenter,
  exitTargetCellMap,
  resolveStartCell,
} from './pathfinding';
import type { GridModel } from './pathfinding';

export interface DualPath {
  path: Point[];
  exitId: string;
}

export interface DualPathSearchResult {
  /** 真正找到的不相交路径数：0 / 1 / 2 */
  flow: number;
  /** flow 条路径（米坐标，首点为接待点），按出口顺序无关 */
  routes: DualPath[];
}

interface Edge {
  from: number;
  to: number;
  rev: number;
  cap: number;
  /** 正向边的初始容量（流 = origCap - cap）；反向边为 0 */
  origCap: number;
  kind: 'cell' | 'adj' | 'togate' | 'gate' | 'source';
  /** cell/togate 边携带格点索引；gate 边携带出口闸门序号 */
  meta?: number;
}

const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function findDualExitPaths(
  booths: Booth[],
  start: Point,
  exits: ExitDef[],
  zones: ControlZone[] = [],
): DualPathSearchResult {
  const grid = buildGrid(booths, zones);
  const startCell = resolveStartCell(start, grid);
  if (!startCell || exits.length === 0) {
    return { flow: 0, routes: [] };
  }

  const targetMap = exitTargetCellMap(exits, grid.cols, grid.rows, grid.g);
  if (targetMap.size === 0) return { flow: 0, routes: [] };

  const gridResult = findDualOnGrid(grid, startCell.idx, targetMap);
  const routes: DualPath[] = gridResult.routes.map((r) => ({
    exitId: r.exitId,
    path: (() => {
      const path = r.cells.map((idx) => cellCenter(idx, grid.cols, grid.g));
      path[0] = start; // 首点用真实接待点
      return path;
    })(),
  }));
  return { flow: gridResult.flow, routes };
}

export interface GridDualRoute {
  cells: number[];
  exitId: string;
}

/**
 * 网格级双路搜索：targets 为“目标格 -> 出口 id”映射。
 * 同一出口可有多个目标格，但每条路径的终点出口必须互不相同。
 */
export function findDualOnGrid(
  grid: GridModel,
  startIdx: number,
  targets: Map<number, string>,
): { flow: number; routes: GridDualRoute[] } {
  const exitIds = [...new Set(targets.values())];
  const exitIndex = new Map(exitIds.map((id, i) => [id, i]));
  const cellToGate = new Map<number, number>();
  for (const [cell, exitId] of targets) {
    cellToGate.set(cell, exitIndex.get(exitId)!);
  }

  const network = buildFlow(grid, startIdx, cellToGate, exitIds.length);
  const flow = edmondsKarp(network.graph, network.source, network.sink, 2);
  if (flow === 0) return { flow: 0, routes: [] };

  const routes = decompose(network, flow, grid, exitIds, startIdx);
  return { flow: routes.length, routes };
}

interface FlowNetwork {
  source: number;
  sink: number;
  graph: Edge[][];
  /** 全部正向边（用于按流分解） */
  edges: Edge[];
}

function buildFlow(
  grid: GridModel,
  startIdx: number,
  cellToGate: Map<number, number>,
  exitCount: number,
): FlowNetwork {
  const { cols, rows, blocked } = grid;
  const cells = cols * rows;
  const inNode = (idx: number) => 2 * idx;
  const outNode = (idx: number) => 2 * idx + 1;
  const gateNode = (gi: number) => 2 * cells + gi;
  const source = 2 * cells + exitCount;
  const sink = source + 1;

  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const edges: Edge[] = [];

  const addEdge = (
    from: number,
    to: number,
    cap: number,
    kind: Edge['kind'],
    meta?: number,
  ) => {
    const fwd: Edge = {
      from,
      to,
      rev: graph[to].length,
      cap,
      origCap: cap,
      kind,
      meta,
    };
    const back: Edge = {
      from: to,
      to: from,
      rev: graph[from].length,
      cap: 0,
      origCap: 0,
      kind,
      meta,
    };
    graph[from].push(fwd);
    graph[to].push(back);
    edges.push(fwd);
  };

  // 格点容量边（节点拆分）
  for (let idx = 0; idx < cells; idx++) {
    if (blocked[idx]) continue;
    addEdge(inNode(idx), outNode(idx), idx === startIdx ? 2 : 1, 'cell', idx);
  }
  // 邻接边
  for (let idx = 0; idx < cells; idx++) {
    if (blocked[idx]) continue;
    const cx = idx % cols;
    const cy = Math.floor(idx / cols);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nIdx = ny * cols + nx;
      if (blocked[nIdx]) continue;
      addEdge(outNode(idx), inNode(nIdx), 1, 'adj', nIdx);
    }
  }
  // 出口目标格 -> 出口闸门 -> 汇点
  for (const [idx, gi] of cellToGate) {
    if (blocked[idx]) continue;
    addEdge(outNode(idx), gateNode(gi), 1, 'togate', idx);
  }
  for (let gi = 0; gi < exitCount; gi++) {
    addEdge(gateNode(gi), sink, 1, 'gate', gi);
  }
  // 源点 -> 起点
  addEdge(source, inNode(startIdx), 2, 'source', startIdx);

  return { source, sink, graph, edges };
}

/** Edmonds-Karp：BFS 找增广路，最多增广到目标流值 2。 */
function edmondsKarp(
  graph: Edge[][],
  source: number,
  sink: number,
  target: number,
): number {
  let flow = 0;
  while (flow < target) {
    const prevNode = new Int32Array(graph.length).fill(-1);
    const prevEdge = new Int32Array(graph.length).fill(-1);
    const queue = [source];
    prevNode[source] = source;
    while (queue.length && prevNode[sink] === -1) {
      const v = queue.shift()!;
      for (let ei = 0; ei < graph[v].length; ei++) {
        const e = graph[v][ei];
        if (e.cap > 0 && prevNode[e.to] === -1) {
          prevNode[e.to] = v;
          prevEdge[e.to] = ei;
          queue.push(e.to);
          if (e.to === sink) break;
        }
      }
    }
    if (prevNode[sink] === -1) break;

    let bottleneck = target - flow;
    for (let v = sink; v !== source; v = prevNode[v]) {
      bottleneck = Math.min(bottleneck, graph[prevNode[v]][prevEdge[v]].cap);
    }
    for (let v = sink; v !== source; v = prevNode[v]) {
      const e = graph[prevNode[v]][prevEdge[v]];
      e.cap -= bottleneck;
      graph[v][e.rev].cap += bottleneck;
    }
    flow += bottleneck;
  }
  return flow;
}

/**
 * 把最终整数流分解成 flow 条 source->sink 路径：
 * 沿仍有流量（origCap-cap>0）的正向边从源点行走，每经过一条边消耗 1 单位，
 * 直到汇点。流量守恒保证从源点出发的单位流必然在汇点结束；
 * 残余流中若夹带环流，用节点位置表摘除回路。
 */
function decompose(
  net: FlowNetwork,
  flow: number,
  grid: GridModel,
  exitIds: string[],
  startIdx: number,
): GridDualRoute[] {
  const remaining = net.edges.map((e) => e.origCap - e.cap);
  const edgeIndex = new Map<Edge, number>();
  net.edges.forEach((e, i) => edgeIndex.set(e, i));
  const outgoing = new Map<number, Edge[]>();
  for (const e of net.edges) {
    const list = outgoing.get(e.from) ?? [];
    list.push(e);
    outgoing.set(e.from, list);
  }

  const routes: GridDualRoute[] = [];
  for (let unit = 0; unit < flow; unit++) {
    let node = net.source;
    let gateIdx = -1;
    const cellSeq: number[] = [];
    // 格点在序列中的位置，用于摘除环流。
    const cellPos = new Map<number, number>();
    let steps = 0;
    const maxSteps = grid.cols * grid.rows * 4 + 16;

    while (node !== net.sink && steps++ < maxSteps) {
      const list = outgoing.get(node);
      const edge = list?.find((e) => remaining[edgeIndex.get(e)!] > 0);
      if (!edge) break;
      remaining[edgeIndex.get(edge)!] -= 1;
      node = edge.to;
      if (edge.kind === 'cell') {
        const cell = edge.meta!;
        const prior = cellPos.get(cell);
        if (prior !== undefined) {
          // 走入环流：删掉环路段
          const removed = cellSeq.splice(prior + 1);
          removed.forEach((c) => cellPos.delete(c));
          cellPos.set(cell, prior);
        } else {
          cellPos.set(cell, cellSeq.length);
          cellSeq.push(cell);
        }
      } else if (edge.kind === 'gate') {
        gateIdx = edge.meta!;
      }
    }

    if (gateIdx === -1 || !cellSeq.includes(startIdx)) continue;
    while (cellSeq[0] !== startIdx) cellSeq.shift();
    routes.push({ cells: cellSeq, exitId: exitIds[gateIdx] });
  }

  return routes;
}
