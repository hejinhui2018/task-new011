/** 方案本地持久化：localStorage，带版本键、容错与旧数据迁移。无后端。 */
import type { Booth, ControlZone, PlanState } from '../types';
import { STORAGE_KEY } from '../constants';

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

const ORIENTATIONS = ['north', 'east', 'south', 'west'] as const;

/**
 * 把任意历史版本的数据规整为当前 PlanState：
 * - v1：{ booths }（普通展位单路检查时代的存档）——补齐封控字段，原样保留展位；
 * - 当前版本：{ booths, closedExits?, zones? }；
 * - booth.critical 缺省为 false（旧展位仍按普通展位做单路检查）。
 * 返回 null 表示数据损坏到无法使用。
 */
export function migratePlan(data: unknown): PlanState | null {
  if (typeof data !== 'object' || data === null) return null;
  const rawBooths = (data as { booths?: unknown }).booths;
  if (!Array.isArray(rawBooths)) return null;

  const booths: Booth[] = [];
  for (const item of rawBooths) {
    if (typeof item !== 'object' || item === null) return null;
    const o = item as Record<string, unknown>;
    if (
      typeof o.id !== 'string' ||
      typeof o.x !== 'number' ||
      typeof o.y !== 'number' ||
      typeof o.w !== 'number' ||
      typeof o.h !== 'number' ||
      typeof o.label !== 'string' ||
      !(ORIENTATIONS as readonly string[]).includes(o.orientation as string)
    ) {
      return null;
    }
    if (o.kind !== undefined && o.kind !== 'booth' && o.kind !== 'partition') {
      return null;
    }
    booths.push({
      id: o.id,
      x: o.x,
      y: o.y,
      w: o.w,
      h: o.h,
      orientation: o.orientation as Booth['orientation'],
      label: o.label,
      color: typeof o.color === 'string' ? o.color : '#4f86c6',
      kind: (o.kind as Booth['kind']) ?? 'booth',
      critical: o.critical === true,
    });
  }

  const closedExits = migrateStringList(
    (data as { closedExits?: unknown }).closedExits,
  );
  const rawZones = (data as { zones?: unknown }).zones;
  const zones: ControlZone[] = [];
  if (Array.isArray(rawZones)) {
    for (const item of rawZones) {
      if (typeof item !== 'object' || item === null) continue;
      const z = item as Record<string, unknown>;
      if (
        typeof z.id === 'string' &&
        typeof z.x === 'number' &&
        typeof z.y === 'number' &&
        typeof z.w === 'number' &&
        typeof z.h === 'number'
      ) {
        zones.push({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h });
      }
    }
  }

  return { booths, closedExits, zones };
}

function migrateStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}
