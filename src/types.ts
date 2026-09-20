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
  /** 重点展位：需要演练“双通道”疏散（两条通往不同出口的不相交路径）。 */
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

/** 临时封控区域：在通行网格上圈出的轴对齐矩形（米，吸附 0.5 m）。 */
export interface ControlZone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 临时封控状态：关闭的出口 + 封控区域。 */
export interface ControlState {
  closedExits: string[];
  zones: ControlZone[];
}

export interface PlanState {
  booths: Booth[];
  /** 临时关闭的出口 id 列表（封控模式下点击出口切换）。旧数据缺省为空。 */
  closedExits?: string[];
  /** 临时封控区域。旧数据缺省为空。 */
  zones?: ControlZone[];
}

/** 封控原因分类：出口关闭 / 空间瓶颈（只走得通一条）/ 完全断路。 */
export type RouteReason = 'exit-closed' | 'bottleneck' | 'disconnected';

export type AlertKind =
  | 'out-of-bounds'
  | 'overlap'
  | 'clearance'
  | 'exit-blocked'
  | 'exit-closed'
  | 'no-path'
  | 'single-route';

export interface Alert {
  id: string;
  kind: AlertKind;
  /** 主展位 id（越界/净空/不可达是一个展位，重叠取两个中的第一个） */
  boothId: string;
  /** 相关展位：重叠时为对方；净空时为距离过近的展位；其他情况为空 */
  relatedBoothId?: string;
  message: string;
  /** 重点展位双路告警的原因细分（普通告警缺省）。 */
  reason?: RouteReason;
  /** 涉及的出口名（出口关闭类告警使用）。 */
  exitId?: string;
}

/** 重点展位的双路疏散状态。 */
export type DualRouteStatus = 'dual' | 'single' | 'none';

export interface DualRouteResult {
  status: DualRouteStatus;
  /** 双路可用时两条路径（均从接待点出发，终点为不同出口）。 */
  paths: [Point[], Point[]];
  /** 每条路径到达的出口 id（双路时两个不同；单路时仅第一个有值）。 */
  exitIds: [string | null, string | null];
  /** 非双路时的原因：出口关闭 / 空间瓶颈 / 完全断路。 */
  reason?: RouteReason;
}

/** 一次分析结果：告警 + 每个展位正面接待点到最近出口的路径（网格点，米坐标）。 */
export interface AnalysisResult {
  alerts: Alert[];
  paths: Record<string, Point[]>;
  /** 被展位直接封住（开口内侧网格被占）的出口 id */
  blockedExitIds: string[];
  /** 因临时封控而关闭的出口 id（与 blockedExitIds 区分：后者是展位物理封堵）。 */
  closedExitIds: string[];
  /** 重点展位的双通道演练结果，按展位 id 索引。 */
  dual: Record<string, DualRouteResult>;
}
