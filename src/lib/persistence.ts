/**
 * 方案本地持久化：localStorage，带版本键与容错。无后端。
 * 旧版本只存 { booths }（且 booth 没有 critical 字段）；读取时迁移为
 * 带空 lockdown 的新 PlanState，保证浏览器里已有的旧方案继续能打开。
 */
import type { Lockdown, PlanState } from '../types';
import { STORAGE_KEY } from '../constants';
import { emptyLockdown } from './actions';

export function savePlan(state: PlanState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式 / 配额不足时静默降级，不影响编辑。
  }
}

export function loadPlan(): PlanState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    return migratePlan(data);
  } catch {
    return null;
  }
}

export function clearSavedPlan(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function isValidLockdown(value: unknown): value is Lockdown {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  const closedExits = Array.isArray(o.closedExits)
    ? o.closedExits.every((x) => typeof x === 'string')
    : o.closedExits === undefined;
  const zones = Array.isArray(o.zones)
    ? o.zones.every(
        (z) =>
          typeof z === 'object' &&
          z !== null &&
          typeof (z as Record<string, unknown>).id === 'string' &&
          typeof (z as Record<string, unknown>).x === 'number' &&
          typeof (z as Record<string, unknown>).y === 'number' &&
          typeof (z as Record<string, unknown>).w === 'number' &&
          typeof (z as Record<string, unknown>).h === 'number',
      )
    : o.zones === undefined;
  return closedExits && zones;
}

/**
 * 把任意历史版本的数据迁移为当前 PlanState；无法识别时返回 null（回退到示例）。
 * 导出供迁移测试使用。
 */
export function migratePlan(data: unknown): PlanState | null {
  if (typeof data !== 'object' || data === null) return null;
  const booths = (data as { booths?: unknown }).booths;
  if (!Array.isArray(booths)) return null;
  if (!booths.every(isValidBooth)) return null;

  const rawLockdown = (data as { lockdown?: unknown }).lockdown;
  let lockdown: Lockdown;
  if (rawLockdown === undefined || rawLockdown === null) {
    // 旧方案：没有封控概念
    lockdown = emptyLockdown();
  } else if (isValidLockdown(rawLockdown)) {
    lockdown = {
      closedExits: rawLockdown.closedExits ?? [],
      zones: rawLockdown.zones ?? [],
    };
  } else {
    return null;
  }

  return {
    booths: booths.map((b) => migrateBooth(b)),
    lockdown,
  };
}

type RawBooth = Record<string, unknown>;

function isValidBooth(b: unknown): boolean {
  if (typeof b !== 'object' || b === null) return false;
  const o = b as RawBooth;
  return (
    typeof o.id === 'string' &&
    typeof o.x === 'number' &&
    typeof o.y === 'number' &&
    typeof o.w === 'number' &&
    typeof o.h === 'number' &&
    typeof o.label === 'string' &&
    (o.orientation === 'north' ||
      o.orientation === 'east' ||
      o.orientation === 'south' ||
      o.orientation === 'west') &&
    (o.kind === undefined || o.kind === 'booth' || o.kind === 'partition') &&
    (o.critical === undefined || typeof o.critical === 'boolean')
  );
}

/** 单条展位迁移：旧数据缺 critical/kind 时补默认值。 */
function migrateBooth(b: RawBooth) {
  return {
    id: b.id as string,
    x: b.x as number,
    y: b.y as number,
    w: b.w as number,
    h: b.h as number,
    orientation: b.orientation as PlanState['booths'][number]['orientation'],
    label: b.label as string,
    color: typeof b.color === 'string' ? (b.color as string) : '#4f86c6',
    kind: (b.kind ?? 'booth') as 'booth' | 'partition',
    critical: b.critical === true,
  };
}
