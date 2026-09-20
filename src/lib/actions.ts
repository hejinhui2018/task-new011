/**
 * 方案变更的纯函数：所有编辑操作都是 (prevPlan, ...args) => nextPlan，
 * 不触碰 React/历史栈，便于单测与撤销重做。
 */
import type {
  Booth,
  Lockdown,
  LockdownZone,
  PlanState,
  Point,
} from '../types';
import { GRID_SIZE, HALL_HEIGHT, HALL_WIDTH } from '../constants';
import { snapToGrid } from './grid';
import { nextId } from './id';

export function emptyLockdown(): Lockdown {
  return { closedExits: [], zones: [] };
}

export function getLockdown(plan: PlanState): Lockdown {
  return plan.lockdown ?? emptyLockdown();
}

function withLockdown(plan: PlanState, lockdown: Lockdown): PlanState {
  return { ...plan, lockdown };
}

/** 把普通展位标记/取消标记为重点展位（围挡不可标记）。 */
export function setBoothCritical(
  plan: PlanState,
  boothId: string,
  critical: boolean,
): PlanState {
  return {
    ...plan,
    booths: plan.booths.map((b) =>
      b.id === boothId && b.kind !== 'partition'
        ? ({ ...b, critical } as Booth)
        : b,
    ),
  };
}

export function toggleBoothCritical(plan: PlanState, boothId: string): PlanState {
  const b = plan.booths.find((x) => x.id === boothId);
  if (!b || b.kind === 'partition') return plan;
  return setBoothCritical(plan, boothId, !b.critical);
}

/** 关闭/重新打开某个出口。 */
export function toggleExitClosed(plan: PlanState, exitId: string): PlanState {
  const ld = getLockdown(plan);
  const closed = ld.closedExits.includes(exitId)
    ? ld.closedExits.filter((id) => id !== exitId)
    : [...ld.closedExits, exitId];
  return withLockdown(plan, { ...ld, closedExits: closed });
}

export function setExitClosed(
  plan: PlanState,
  exitId: string,
  closed: boolean,
): PlanState {
  const ld = getLockdown(plan);
  const has = ld.closedExits.includes(exitId);
  if (closed === has) return plan;
  return toggleExitClosed(plan, exitId);
}

/** 删除一个临时封控区域。 */
export function removeLockdownZone(plan: PlanState, zoneId: string): PlanState {
  const ld = getLockdown(plan);
  return withLockdown(plan, {
    ...ld,
    zones: ld.zones.filter((z) => z.id !== zoneId),
  });
}

/** 清空全部临时封控（删除封控区域、重新开放所有出口）。 */
export function clearLockdown(plan: PlanState): PlanState {
  const ld = getLockdown(plan);
  if (ld.zones.length === 0 && ld.closedExits.length === 0) return plan;
  return withLockdown(plan, emptyLockdown());
}

/**
 * 由拖出的两个角点生成一个吸附到 0.5 m、裁剪进展厅的封控区域并加入方案。
 * 太小（拖动不足一格）时忽略，返回原方案。
 */
export function addLockdownZoneFromCorners(
  plan: PlanState,
  a: Point,
  b: Point,
): PlanState {
  const zone = zoneFromCorners(a, b);
  if (!zone) return plan;
  const ld = getLockdown(plan);
  const next: LockdownZone = { id: nextId('zone'), ...zone };
  return withLockdown(plan, { ...ld, zones: [...ld.zones, next] });
}

/** 两角点（米）→ 吸附、裁剪后的轴对齐矩形；不足一个网格返回 null。 */
export function zoneFromCorners(
  a: Point,
  b: Point,
): { x: number; y: number; w: number; h: number } | null {
  const x0 = snapToGrid(Math.min(a.x, b.x));
  const y0 = snapToGrid(Math.min(a.y, b.y));
  const x1 = snapToGrid(Math.max(a.x, b.x));
  const y1 = snapToGrid(Math.max(a.y, b.y));
  const x = Math.max(0, x0);
  const y = Math.max(0, y0);
  const right = Math.min(HALL_WIDTH, x1);
  const bottom = Math.min(HALL_HEIGHT, y1);
  const w = right - x;
  const h = bottom - y;
  if (w < GRID_SIZE || h < GRID_SIZE) return null;
  return { x, y, w, h };
}
