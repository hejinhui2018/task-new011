/**
 * 方案实时分析：出口封堵/关闭、越界、重叠、净空不足、接待点到出口不可达，
 * 以及重点展位的“双通道”判定。
 * 纯函数：输入展位列表与封控状态，输出告警、单路路径与重点展位双路结果。
 */
import type {
  Alert,
  AnalysisResult,
  Booth,
  Lockdown,
  Point,
} from '../types';
import { CLEARANCE, EXITS } from '../constants';
import {
  clearanceViolation,
  outOfBounds,
  receptionPoint,
  rectOf,
  intersects,
} from './geometry';
import {
  exitBlockingBooth,
  findExitPath,
  findTwoExitPaths,
} from './pathfinding';

export function exitName(id: string): string {
  if (id.includes('south')) return '南出口';
  if (id.includes('north')) return '北出口';
  return id;
}

function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

const AXIS_TEXT: Record<'x' | 'y', string> = {
  x: '左右间距',
  y: '前后间距',
};

export function analyzePlan(
  booths: Booth[],
  lockdown: Lockdown = { closedExits: [], zones: [] },
): AnalysisResult {
  const alerts: Alert[] = [];
  const paths: Record<string, Point[]> = {};
  const dualPaths: AnalysisResult['dualPaths'] = {};
  const blockedExitIds: string[] = [];
  const labelOf = new Map(booths.map((b) => [b.id, b.label]));
  const zones = lockdown.zones ?? [];
  const closedExitIds = lockdown.closedExits ?? [];

  // 0a) 出口是否被展位直接封住
  for (const exitDef of EXITS) {
    const blocker = exitBlockingBooth(booths, exitDef);
    if (blocker) {
      blockedExitIds.push(exitDef.id);
      alerts.push({
        id: `exit-blocked:${exitDef.id}`,
        kind: 'exit-blocked',
        boothId: blocker.id,
        message: `${exitName(exitDef.id)}被展位 ${blocker.label} 封住，疏散出口不可用`,
        cause: 'exit-closed',
      });
    }
  }

  // 0b) 出口是否被临时关闭（全局告警，不绑定具体展位）
  for (const exitId of closedExitIds) {
    alerts.push({
      id: `exit-closed:${exitId}`,
      kind: 'exit-closed',
      boothId: '',
      exitId,
      cause: 'exit-closed',
      message: `${exitName(exitId)}已被临时封控关闭，疏散需改走其他出口`,
    });
  }

  // 1) 越界
  for (const b of booths) {
    const reason = outOfBounds(b);
    if (reason) {
      alerts.push({
        id: `out-of-bounds:${b.id}`,
        kind: 'out-of-bounds',
        boothId: b.id,
        message: `展位 ${b.label} 越界：${reason}`,
      });
    }
  }

  // 2) 两两：重叠 / 净空
  for (let i = 0; i < booths.length; i++) {
    for (let j = i + 1; j < booths.length; j++) {
      const a = booths[i];
      const b = booths[j];
      // 围挡是设施隔断，允许彼此拼接（不互相检查重叠/净空）；仍作为寻路障碍。
      if (a.kind === 'partition' && b.kind === 'partition') continue;
      const [lo, hi] = pairKey(a.id, b.id);
      if (intersects(rectOf(a), rectOf(b))) {
        alerts.push({
          id: `overlap:${lo}:${hi}`,
          kind: 'overlap',
          boothId: a.id,
          relatedBoothId: b.id,
          message: `展位 ${labelOf.get(a.id)} 与 ${labelOf.get(
            b.id,
          )} 区域重叠，请错开布置`,
        });
        continue; // 重叠时不再重复报净空
      }
      const violation = clearanceViolation(a, b, CLEARANCE);
      if (violation) {
        alerts.push({
          id: `clearance:${lo}:${hi}`,
          kind: 'clearance',
          boothId: a.id,
          relatedBoothId: b.id,
          message: `展位 ${labelOf.get(a.id)} 与 ${labelOf.get(
            b.id,
          )} ${AXIS_TEXT[violation.axis]}仅 ${
            Math.round(violation.gap * 100) / 100
          } m，不足 ${CLEARANCE} m 通道`,
        });
      }
    }
  }

  // 物理封堵 + 临时关闭都不可作为疏散目标
  const unavailableExits = new Set([...blockedExitIds, ...closedExitIds]);

  // 3) 接待点 -> 出口（围挡没有接待点，不参与疏散检查）
  for (const b of booths) {
    if (b.kind === 'partition') continue;
    const start = receptionPoint(b);

    if (b.critical) {
      // —— 重点展位：双通道判定 ——
      const dual = findTwoExitPaths(booths, start, lockdown, blockedExitIds);
      dualPaths[b.id] = dual;
      if (dual.status === 'dual') {
        paths[b.id] = dual.primary;
      } else if (dual.status === 'single') {
        paths[b.id] = dual.primary;
        const openCount = EXITS.filter((e) => !unavailableExits.has(e.id)).length;
        const cause = dual.cause ?? (openCount < 2 ? 'exit-closed' : 'bottleneck');
        alerts.push({
          id: `single-route:${b.id}`,
          kind: 'single-route',
          boothId: b.id,
          cause,
          exitId: dual.reachableExitId,
          message:
            cause === 'exit-closed'
              ? `重点展位 ${b.label} 只剩一条疏散通道（仅可达${exitName(
                  dual.reachableExitId ?? '',
                )}）：另一出口已关闭，关闭期间无双通道保障`
              : `重点展位 ${b.label} 只剩一条疏散通道（通往${exitName(
                  dual.reachableExitId ?? '',
                )}）：两条路线在接待点之外被迫共用通道网格，存在空间瓶颈`,
        });
      } else {
        paths[b.id] = [];
        // 所有出口都不可用（关闭/封堵）归为出口关闭；仍有出口却到不了是完全断路
        const allExitsDown = unavailableExits.size >= EXITS.length;
        alerts.push({
          id: `no-path:${b.id}`,
          kind: 'no-path',
          boothId: b.id,
          cause: allExitsDown ? 'exit-closed' : 'cutoff',
          message: allExitsDown
            ? `重点展位 ${b.label} 无法疏散：全部出口均已关闭/封堵`
            : `重点展位 ${b.label} 正面接待点无法抵达任一可用出口，疏散通道被完全堵断`,
        });
      }
      continue;
    }

    // —— 普通展位：维持原单路 BFS 检查（同时尊重封控区域与关闭出口）——
    const result = findExitPath(
      booths,
      start,
      EXITS,
      undefined,
      zones,
      [...unavailableExits],
    );
    if (result.reachable) {
      paths[b.id] = result.path;
      continue;
    }
    paths[b.id] = [];
    // 归因：若忽略“临时关闭”（仍承认被物理封堵的出口不可用）就能到达，
    // 则断路是出口关闭造成的；否则是完全断路。
    const ignoringClosures = findExitPath(
      booths,
      start,
      EXITS,
      undefined,
      zones,
      blockedExitIds,
    );
    alerts.push({
      id: `no-path:${b.id}`,
      kind: 'no-path',
      boothId: b.id,
      cause: ignoringClosures.reachable ? 'exit-closed' : 'cutoff',
      message: ignoringClosures.reachable
        ? `展位 ${b.label} 无法抵达仍开放的出口：可走路线所依赖的出口已被临时关闭`
        : `展位 ${b.label} 正面接待点无法抵达任一出口，疏散通道被堵`,
    });
  }

  return { alerts, paths, blockedExitIds, dualPaths, lockdown };
}

export function alertsForBooth(
  analysis: AnalysisResult,
  boothId: string,
): Alert[] {
  return analysis.alerts.filter(
    (a) => a.boothId === boothId || a.relatedBoothId === boothId,
  );
}
