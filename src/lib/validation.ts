/**
 * 方案实时分析：出口封堵/临时关闭、越界、重叠、净空不足、接待点到出口不可达，
 * 以及重点展位的双通道演练。
 * 纯函数：输入展位列表与封控状态，输出告警、单路与双路疏散路径。
 */
import type {
  Alert,
  AnalysisResult,
  Booth,
  ControlState,
  DualRouteResult,
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
import { exitBlockingBooth, findExitPath } from './pathfinding';
import { findDualExitPaths } from './dualpath';

export function exitName(id: string): string {
  if (id.includes('south')) return '南出口';
  if (id.includes('north')) return '北出口';
  if (id.includes('west')) return '西出口';
  if (id.includes('east')) return '东出口';
  return id;
}

function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

const AXIS_TEXT: Record<'x' | 'y', string> = {
  x: '左右间距',
  y: '前后间距',
};

const EMPTY_CONTROLS: ControlState = { closedExits: [], zones: [] };

export function analyzePlan(
  booths: Booth[],
  controls: ControlState = EMPTY_CONTROLS,
): AnalysisResult {
  const alerts: Alert[] = [];
  const paths: Record<string, Point[]> = {};
  const blockedExitIds: string[] = [];
  const closedExitIds = controls.closedExits ?? [];
  const zones = controls.zones ?? [];
  const dual: Record<string, DualRouteResult> = {};
  const labelOf = new Map(booths.map((b) => [b.id, b.label]));

  // 0) 出口是否被展位直接封住（物理封堵）
  for (const exitDef of EXITS) {
    const blocker = exitBlockingBooth(booths, exitDef);
    if (blocker) {
      blockedExitIds.push(exitDef.id);
      alerts.push({
        id: `exit-blocked:${exitDef.id}`,
        kind: 'exit-blocked',
        boothId: blocker.id,
        exitId: exitDef.id,
        message: `${exitName(exitDef.id)}被展位 ${blocker.label} 封住，疏散出口不可用`,
      });
    }
  }

  // 0b) 临时关闭出口（封控模式）——独立于展位物理封堵
  for (const exitId of closedExitIds) {
    alerts.push({
      id: `exit-closed:${exitId}`,
      kind: 'exit-closed',
      boothId: '',
      exitId,
      message: `${exitName(exitId)}已临时关闭，疏散时不得使用该出口`,
    });
  }

  // 当前真正可用于疏散的出口：未临时关闭；物理封堵出口的目标格不可达，会自然失效
  const unavailableExitIds = new Set([...blockedExitIds, ...closedExitIds]);
  const availableExits = EXITS.filter((e) => !unavailableExitIds.has(e.id));

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

  // 3) 疏散检查（围挡是设施障碍，没有接待点，不参与）
  for (const b of booths) {
    if (b.kind === 'partition') continue;
    const start = receptionPoint(b);

    if (b.critical) {
      // —— 重点展位：双通道演练 ——
      const result = findDualExitPaths(booths, start, availableExits, zones);
      if (result.flow >= 2 && result.routes.length >= 2) {
        const [r1, r2] = [result.routes[0], result.routes[1]];
        dual[b.id] = {
          status: 'dual',
          paths: [r1.path, r2.path],
          exitIds: [r1.exitId, r2.exitId],
        };
        // 主路径仍写入单路表，供既有渲染/可达性标记复用
        paths[b.id] = r1.path;
      } else {
        // 诊断：忽略“临时关闭”、仅排除物理封堵出口后能否双路/单路，
        // 以区分降级究竟来自出口关闭还是空间瓶颈/完全断路。
        const physicalExits = EXITS.filter((e) => !blockedExitIds.includes(e.id));
        const diag = findDualExitPaths(booths, start, physicalExits, zones);
        let reason: DualRouteResult['reason'];
        if (result.flow === 1 && result.routes.length === 1) {
          reason = diag.flow >= 2 ? 'exit-closed' : 'bottleneck';
          const r = result.routes[0];
          dual[b.id] = {
            status: 'single',
            paths: [r.path, []],
            exitIds: [r.exitId, null],
            reason,
          };
          paths[b.id] = r.path;
          alerts.push({
            id: `single-route:${b.id}`,
            kind: 'single-route',
            boothId: b.id,
            reason,
            message: singleRouteMessage(b.label, reason, unavailableExitIds),
          });
        } else {
          reason = diag.flow >= 1 ? 'exit-closed' : 'disconnected';
          dual[b.id] = {
            status: 'none',
            paths: [[], []],
            exitIds: [null, null],
            reason,
          };
          paths[b.id] = [];
          alerts.push({
            id: `no-path:${b.id}`,
            kind: 'no-path',
            boothId: b.id,
            reason,
            message: noRouteMessage(b.label, reason),
          });
        }
      }
      continue;
    }

    // —— 普通展位：原单路检查（出口封控/封控区域同样生效）——
    const result = findExitPath(booths, start, availableExits, undefined, zones);
    if (result.reachable) {
      paths[b.id] = result.path;
    } else {
      paths[b.id] = [];
      alerts.push({
        id: `no-path:${b.id}`,
        kind: 'no-path',
        boothId: b.id,
        reason: availableExits.length === 0 ? 'exit-closed' : 'disconnected',
        message:
          availableExits.length === 0
            ? `展位 ${b.label} 无法疏散：所有出口均已关闭或封堵`
            : `展位 ${b.label} 正面接待点无法抵达任一开放出口，疏散通道被堵`,
      });
    }
  }

  return { alerts, paths, blockedExitIds, closedExitIds, dual };
}

function unavailableNames(ids: Set<string>): string {
  return [...ids].map(exitName).join('、');
}

function singleRouteMessage(
  label: string,
  reason: 'exit-closed' | 'bottleneck',
  unavailable: Set<string>,
): string {
  if (reason === 'exit-closed') {
    return `重点展位 ${label} 仅剩一条疏散通道：${unavailableNames(
      unavailable,
    )}不可用，双通道演练降级为单路`;
  }
  return `重点展位 ${label} 只有一条疏散通道：存在空间瓶颈，找不到第二条不共用通行网格的路线`;
}

function noRouteMessage(
  label: string,
  reason: 'exit-closed' | 'disconnected',
): string {
  if (reason === 'exit-closed') {
    return `重点展位 ${label} 无法疏散：所有出口均已关闭或被封堵`;
  }
  return `重点展位 ${label} 接待点完全无法抵达任何开放出口，疏散通道彻底中断`;
}

export function alertsForBooth(
  analysis: AnalysisResult,
  boothId: string,
): Alert[] {
  return analysis.alerts.filter(
    (a) => a.boothId === boothId || a.relatedBoothId === boothId,
  );
}
