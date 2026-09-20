/** 全局领域类型：所有坐标、尺寸单位均为“米”，展厅坐标系原点在左上角，x 向右、y 向下。 */

/** 展位朝向：接待点（正面）所在方向。旋转 90° 时在 north/east 间切换。 */
export type Orientation = 'north' | 'east' | 'south' | 'west';

export interface Point {
  x: number;
  y: number;
}

/** 轴对齐矩形展位。x/y 为左上角坐标；w/h 为未旋转尺寸。 */
export interface Booth {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  orientation: Orientation;
  label: string;
  color: string;
  /** booth=普通展位（适用 1.5 m 净空规则）；partition=围挡/隔断，允许互相拼接 */
  kind?: 'booth' | 'partition';
  /**
   * 重点展位：需要“双通道”保障——除接待起点外不能共用通行网格的
   * 两条通往不同出口的疏散路径。旧数据（无此字段）按 false 处理。
   */
  critical?: boolean;
}

/** 固定出口：位于某面墙上的一段开口（沿墙方向的起止坐标）。 */
export interface ExitDef {
  id: string;
  wall: 'north' | 'south' | 'west' | 'east';
  /** 沿墙方向的起始坐标（米） */
  start: number;
  /** 沿墙方向的结束坐标（米，start < end） */
  end: number;
}

/** 临时封控区域：在 0.5 m 网格上拖出的轴对齐矩形（米，含越界裁剪）。 */
export interface LockdownZone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 临时封控模式状态：被关闭的出口 id 集合 + 拖出的封控区域。 */
export interface Lockdown {
  closedExits: string[];
  zones: LockdownZone[];
}

/**
 * 完整方案。旧版本只保存 { booths }（booths 也没有 critical 字段），
 * 读取时由 persistence 迁移为带 lockdown 的新结构。
 */
export interface PlanState {
  booths: Booth[];
  /** 临时封控；旧方案迁移时为空（无封控）。 */
  lockdown?: Lockdown;
}

/** 告警归类原因（选中告警时展示，便于区分“为什么降级/断路”）。 */
export type AlertCause =
  | 'exit-closed' // 出口关闭（或被展位堵死）导致通道减少
  | 'bottleneck' // 两条候选路径在起点之外被迫共用通行网格（空间瓶颈）
  | 'cutoff'; // 接待点完全无法抵达任何出口（完全断路）

export type AlertKind =
  | 'out-of-bounds'
  | 'overlap'
  | 'clearance'
  | 'exit-blocked'
  | 'exit-closed'
  | 'single-route'
  | 'no-path';

export interface Alert {
  id: string;
  kind: AlertKind;
  /** 主展位 id（越界/净空/不可达是一个展位，重叠取两个中的第一个） */
  boothId: string;
  /** 相关展位：重叠时为对方；净空时为距离过近的展位；其他情况为空 */
  relatedBoothId?: string;
  message: string;
  /** 单路/不可达告警的根因分类（出口关闭 / 空间瓶颈 / 完全断路）。 */
  cause?: AlertCause;
  /** 单路告警：当前唯一可达出口 id（用于提示“还能从哪走”）。 */
  exitId?: string;
}

/** 重点展位的双通道状态。 */
export type DualRouteStatus = 'dual' | 'single' | 'none';

export interface DualRouteResult {
  status: DualRouteStatus;
  /** 双路可用时：两条路径；第二条为空表示仅单路。 */
  primary: Point[];
  secondary: Point[];
  /** 两条路径各自到达的出口 id。 */
  primaryExitId?: string;
  secondaryExitId?: string;
  /** 单路/不可达的根因。 */
  cause?: AlertCause;
  /** 单路时唯一可达出口 id。 */
  reachableExitId?: string;
}

/** 一次分析结果：告警 + 每个展位正面接待点到最近出口的路径（网格点，米坐标）。 */
export interface AnalysisResult {
  alerts: Alert[];
  paths: Record<string, Point[]>;
  /** 被展位直接封住（开口内侧网格被占）的出口 id */
  blockedExitIds: string[];
  /** 重点展位的双通道结果（普通展位不出现）。 */
  dualPaths: Record<string, DualRouteResult>;
  /** 参与本次分析的封控状态（便于 UI 直接读取）。 */
  lockdown: Lockdown;
}
