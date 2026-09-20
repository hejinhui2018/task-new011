/**
 * 内置方案：
 * - emptyPlan：空白展厅
 * - blockedExitScenario：出口被堵示例（原有）
 *   1) 左上角由“围挡-横”(0,5) 与“围挡-竖”(7,0) 两面围挡与两面外墙
 *      围出一个封闭区，A01 困在区内，两个出口都不可达；
 *      把“围挡-竖”拖走，封闭区打开，A01 的疏散路径立即恢复。
 *   2) B09 紧贴南墙，整体盖住南出口（x 3~5 m），南出口被封，
 *      所有疏散路径只能绕去北出口；把 B09 拖开后路径重新分流。
 * - dualRouteScenario：重点展位“双通道”演练示例
 *   K01 被四面临时封控墙围在厅中央，只在北墙留一个 0.5 m 缺口：
 *   去南/北出口的两条路线都必须挤过同一个缺口格（空间瓶颈）→ 仅单路；
 *   清空封控后双路恢复；再关闭南出口则降级为单路（出口关闭）；撤销即恢复。
 * 正常展位之间均预留 ≥1.5 m 净宽，告警只来自刻意设计的部分。
 */
import type { Booth, PlanState } from '../types';
import { nextId } from './id';
import { emptyLockdown } from './actions';

const PALETTE = [
  '#4f86c6',
  '#8a6cb8',
  '#b35c6b',
  '#c98a3d',
  '#3f9e7c',
  '#4a9aa8',
  '#5f7d8f',
  '#9c7a4d',
  '#6d8b5a',
  '#a85d84',
  '#7d7d7d',
];

export interface BoothSeed {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  orientation?: Booth['orientation'];
  color?: string;
  kind?: 'booth' | 'partition';
  critical?: boolean;
}

function makeBooths(seeds: BoothSeed[]): Booth[] {
  return seeds.map((s, i) => ({
    id: nextId(),
    x: s.x,
    y: s.y,
    w: s.w,
    h: s.h,
    orientation: s.orientation ?? 'south',
    label: s.label,
    color: s.color ?? PALETTE[i % PALETTE.length],
    kind: s.kind ?? 'booth',
    critical: s.critical ?? false,
  }));
}

export function emptyPlan(): PlanState {
  return { booths: [], lockdown: emptyLockdown() };
}

export function blockedExitScenario(): PlanState {
  return {
    booths: makeBooths([
      // —— 封闭区围挡（转角相接，0 间距，与北墙、西墙合围）——
      {
        x: 0, y: 5, w: 7, h: 1, label: '围挡-横',
        orientation: 'south', color: '#8d6e63', kind: 'partition',
      },
      {
        x: 7, y: 0, w: 1, h: 6, label: '围挡-竖',
        orientation: 'east', color: '#8d6e63', kind: 'partition',
      },
      // —— 被困展位：封闭区内，两个出口都不可达 ——
      { x: 1.5, y: 1.5, w: 2.5, h: 1.5, label: 'A01', orientation: 'south' },
      // —— 南出口正前方的堵点：3 m 宽整体盖住 2 m 宽出口 ——
      {
        x: 2.5, y: 12, w: 3, h: 2, label: 'B09',
        orientation: 'north', color: '#c0504d',
      },
      // —— 正常展位（相互净宽均 ≥1.5 m）——
      { x: 9.5, y: 0.5, w: 3, h: 2, label: 'A02', orientation: 'south' },
      { x: 14, y: 4.5, w: 3, h: 2, label: 'A03', orientation: 'west' },
      { x: 9.5, y: 6.5, w: 2, h: 2, label: 'A04', orientation: 'east' },
      { x: 13.5, y: 8, w: 2.5, h: 2, label: 'A05', orientation: 'north' },
      { x: 9, y: 11, w: 3, h: 2, label: 'A06', orientation: 'south' },
      { x: 14.5, y: 11.5, w: 3, h: 2, label: 'A07', orientation: 'west' },
      { x: 0.5, y: 8.5, w: 3, h: 2, label: 'A08', orientation: 'east' },
    ]),
    lockdown: emptyLockdown(),
  };
}

/**
 * 重点展位双通道演练：K01 在封控围墙内，仅北墙留 0.5 m 缺口
 * （x 9.5~10，即网格第 19 列），初始为“仅单路（空间瓶颈）”。
 */
export function dualRouteScenario(): PlanState {
  const zones = [
    // 北墙两段，中间留 0.5 m 缺口
    { id: nextId('zone'), x: 6, y: 4, w: 3.5, h: 0.5 },
    { id: nextId('zone'), x: 10, y: 4, w: 4, h: 0.5 },
    // 南墙、东西墙合围
    { id: nextId('zone'), x: 6, y: 9.5, w: 8, h: 0.5 },
    { id: nextId('zone'), x: 6, y: 4, w: 0.5, h: 6 },
    { id: nextId('zone'), x: 13.5, y: 4, w: 0.5, h: 6 },
  ];
  return {
    booths: makeBooths([
      // —— 重点展位：封控围合区内 ——
      {
        x: 9, y: 6, w: 2, h: 2, label: 'K01',
        orientation: 'south', color: '#d97706', critical: true,
      },
      // —— 周围普通展位（相互净宽均 ≥1.5 m）——
      { x: 0.5, y: 0.5, w: 3, h: 2, label: 'A02', orientation: 'south' },
      { x: 16.5, y: 0.5, w: 3, h: 2, label: 'A03', orientation: 'south' },
      { x: 0.5, y: 11, w: 3, h: 2, label: 'A04', orientation: 'north' },
      { x: 16.5, y: 11, w: 3, h: 2, label: 'A05', orientation: 'north' },
      { x: 15, y: 5.5, w: 2, h: 2, label: 'A06', orientation: 'west' },
      { x: 1, y: 6, w: 2, h: 2, label: 'A07', orientation: 'east' },
      { x: 9.5, y: 11.5, w: 2, h: 2, label: 'A08', orientation: 'south' },
    ]),
    lockdown: { closedExits: [], zones },
  };
}

/** 新建展位的默认参数。 */
export function newBoothAt(x: number, y: number, index: number): Booth {
  return {
    id: nextId(),
    x,
    y,
    w: 3,
    h: 2,
    orientation: 'south',
    label: `B${String(index + 1).padStart(2, '0')}`,
    color: PALETTE[index % PALETTE.length],
    kind: 'booth',
    critical: false,
  };
}
