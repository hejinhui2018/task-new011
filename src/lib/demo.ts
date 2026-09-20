/**
 * “双通道”90 秒演练的状态序列（纯数据，UI 用定时器逐步播放）：
 *   ① 单路：挡墙堵住院落 2 号门，重点展位 C01 两条疏散线被迫共用 1 号门
 *   ② 双路：移走挡墙，1 号门奔北出口、2 号门奔南出口，通行网格互不共用
 *   ③ 降级：临时关闭南出口，只剩北出口，双路降级为单路（出口关闭）
 *   ④ 恢复：撤销关闭操作，双路立即恢复（验证历史与派生状态一致）
 *
 * 播放器按顺序把每个 action 提交到同一条 History；第 ④ 步是 undo，
 * 因此测试里可以用 History + analyzePlan 完整复刻整条演练。
 */
import type { PlanState } from '../types';
import { dualRouteScenario, withGateOpened } from './scenarios';

export type DemoAction =
  | { type: 'reset'; plan: PlanState }
  | { type: 'open-gate' }
  | { type: 'close-south-exit' }
  | { type: 'undo' };

export interface DemoStep {
  key: 'single' | 'dual' | 'degraded' | 'restored';
  title: string;
  detail: string;
  action: DemoAction;
}

export const SOUTH_EXIT_ID = 'exit-south';

export function dualRouteDemoSteps(): DemoStep[] {
  return [
    {
      key: 'single',
      title: '① 仅单路',
      detail:
        '重点展位 C01 的 2 号门被“挡墙-二门”堵死，两条疏散线只能在 1 号门汇合——存在空间瓶颈，双通道演练不通过。',
      action: { type: 'reset', plan: dualRouteScenario() },
    },
    {
      key: 'dual',
      title: '② 双路可用',
      detail:
        '移走挡墙后，1 号门绕西去北出口、2 号门绕东去南出口，两条路线除接待点外不共用任何通行格。',
      action: { type: 'open-gate' },
    },
    {
      key: 'degraded',
      title: '③ 关闭出口后降级',
      detail:
        '临时封控南出口后，只剩北出口可用，双路立即降级为单路，告警原因标注为“出口关闭”。',
      action: { type: 'close-south-exit' },
    },
    {
      key: 'restored',
      title: '④ 撤销恢复',
      detail:
        '一次 Ctrl+Z 撤销出口关闭，双路状态、路径与告警全部恢复——标记、封控与历史快照保持一致。',
      action: { type: 'undo' },
    },
  ];
}

/** 供测试/播放器直接取用的每一步期望方案（不经过定时器）。 */
export function dualRouteDemoPlans(): PlanState[] {
  const single = dualRouteScenario();
  const dual = withGateOpened(single);
  const degraded: PlanState = {
    ...dual,
    closedExits: [SOUTH_EXIT_ID],
  };
  const restored = dual; // 撤销关闭后回到 ②
  return [single, dual, degraded, restored];
}
