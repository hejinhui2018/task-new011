import { useEffect, useRef, useState } from 'react';
import { usePlanner } from './state/usePlanner';
import { Toolbar } from './components/Toolbar';
import { FloorPlan } from './components/FloorPlan';
import { AlertPanel } from './components/AlertPanel';
import { Inspector } from './components/Inspector';
import type { Alert } from './types';
import { EXITS } from './constants';

interface DemoStep {
  at: number;
  text: string;
  act?: (api: ReturnType<typeof usePlanner>, ui: DemoUi) => void;
}

interface DemoUi {
  setLockdownMode: (on: boolean) => void;
}

/**
 * 90 秒内的自动演练脚本（实际约 60 秒，留出讲解余量）：
 * 单路（空间瓶颈）→ 清空封控恢复双路 → 关闭南出口后降级为单路 → 撤销恢复双路。
 * 每一步都是真实的历史操作，因此最后用 Ctrl+Z 即可完整还原。
 */
const DEMO_STEPS: DemoStep[] = [
  {
    at: 0,
    text: '① 重点展位 K01 初始只有一条通道：两条候选路线都必须挤过同一个 0.5 m 缺口（空间瓶颈）。',
    act: (api, ui) => {
      ui.setLockdownMode(false);
      api.resetPlan('dual-route');
    },
  },
  {
    at: 14000,
    text: '② 清空临时封控：围墙消失，系统立即重算出两条通往不同出口、互不共格的路线——双路可用。',
    act: (api) => api.clearLockdown(),
  },
  {
    at: 30000,
    text: '③ 进入封控模式并关闭南出口：双通道立即降级为仅单路，告警标注“出口关闭”。',
    act: (api, ui) => {
      ui.setLockdownMode(true);
      const south = EXITS.find((e) => e.wall === 'south')!.id;
      api.toggleExitClosed(south);
    },
  },
  {
    at: 46000,
    text: '④ 撤销关闭操作：南出口重新开放，K01 恢复双路可用。所有封控与标记都在同一条历史里。',
    act: (api, ui) => {
      api.undo();
      ui.setLockdownMode(false);
    },
  },
  {
    at: 60000,
    text: '演练结束：可用 Ctrl+Z 继续回退（包括载入示例本身），或在封控模式下自行拖出封控区域。',
  },
];

export default function App() {
  const planner = usePlanner();
  const [activeAlertId, setActiveAlertId] = useState<string | null>(null);
  const [showPaths, setShowPaths] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [lockdownMode, setLockdownMode] = useState(false);
  const [demoStep, setDemoStep] = useState<string | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const timersRef = useRef<number[]>([]);

  const clearDemoTimers = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  };

  useEffect(() => () => clearDemoTimers(), []);

  const startDemo = () => {
    clearDemoTimers();
    setDemoRunning(true);
    const ui: DemoUi = { setLockdownMode };
    for (const step of DEMO_STEPS) {
      const t = window.setTimeout(() => {
        step.act?.(planner, ui);
        setDemoStep(step.text);
        if (step.at === DEMO_STEPS[DEMO_STEPS.length - 1].at) {
          setDemoRunning(false);
        }
      }, step.at);
      timersRef.current.push(t);
    }
  };

  const focusAlert = (alert: Alert) => {
    setActiveAlertId(alert.id);
    if (alert.boothId) planner.selectBooth(alert.boothId);
  };

  const alertCount = planner.analysis.alerts.length;
  const criticalCount = planner.booths.filter(
    (b) => b.critical && b.kind !== 'partition',
  ).length;
  const dualOk = planner.booths.filter(
    (b) => planner.analysis.dualPaths[b.id]?.status === 'dual',
  ).length;
  const lockdownActive =
    planner.lockdown.zones.length > 0 ||
    planner.lockdown.closedExits.length > 0;

  return (
    <div className="app">
      <Toolbar
        canUndo={planner.canUndo}
        canRedo={planner.canRedo}
        onUndo={planner.undo}
        onRedo={planner.redo}
        onAddBooth={planner.addBooth}
        onReset={planner.resetPlan}
        showPaths={showPaths}
        onTogglePaths={() => setShowPaths((v) => !v)}
        lockdownMode={lockdownMode}
        onToggleLockdownMode={() => setLockdownMode((v) => !v)}
        onClearLockdown={planner.clearLockdown}
        lockdownActive={lockdownActive}
        onAutoDemo={startDemo}
        demoRunning={demoRunning}
      />

      <div className="workspace">
        <div className="canvas-wrap">
          <FloorPlan
            planner={planner}
            showPaths={showPaths}
            activeAlertId={activeAlertId}
            onActiveAlertChange={setActiveAlertId}
            onZoomChange={setZoom}
            lockdownMode={lockdownMode}
          />
          <div className="hint-chip">
            {lockdownMode ? (
              <>
                <b>封控模式</b>：单击出口开/关 · 在空白处拖出封控区域 ·
                单击封控区域后点右上角 ✕ 删除
              </>
            ) : (
              <>
                双击空白添加展位 · 拖动移动 · 手柄缩放 · <b>R</b> 旋转 ·
                滚轮缩放 · 拖空白平移
              </>
            )}
          </div>
          {lockdownMode && <div className="lockdown-banner">临时封控模式</div>}
          {demoStep && (
            <div className={`demo-narration ${demoRunning ? 'live' : 'done'}`}>
              {demoStep}
            </div>
          )}
          <Legend />
        </div>

        <div className="sidebar">
          <AlertPanel
            alerts={planner.analysis.alerts}
            activeAlertId={activeAlertId}
            onSelect={focusAlert}
          />
          <Inspector planner={planner} onAlertClick={focusAlert} />
        </div>
      </div>

      <footer className="statusbar">
        <span className="stat">展位 {planner.booths.length} 个</span>
        <span className="stat">重点展位 {criticalCount} 个</span>
        <span className="stat">双路可用 {dualOk} 个</span>
        {lockdownActive && <span className="stat lockdown-stat">🚧 封控生效中</span>}
        <span className="stat">
          <span
            className="dot"
            style={{ background: alertCount ? '#b91c1c' : '#15803d' }}
          />
          {alertCount === 0 ? '检查通过，无告警' : `${alertCount} 条告警待处理`}
        </span>
        <span className="stat">{Math.round(zoom * 100)}% 缩放</span>
        <span className="save-state">方案已自动保存到本地浏览器</span>
      </footer>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <div className="row">
        <span className="swatch exit" /> 安全出口（绿色开口）
      </div>
      <div className="row">
        <span className="swatch path" /> 普通展位单路 / 双路主路线（绿）
      </div>
      <div className="row">
        <span className="swatch path-alt" /> 双路备用路线（蓝，通往另一出口）
      </div>
      <div className="row">
        <span className="swatch path-single" /> 仅单路（琥珀）
      </div>
      <div className="row">
        <span className="swatch lockdown" /> 临时封控区域 / 出口关闭
      </div>
      <div className="row">
        <span className="swatch overlap" /> 重叠 / 越界 / 出口封堵
      </div>
      <div className="row">
        <span className="swatch clearance" /> 净空不足 1.5 m
      </div>
      <div className="row">
        <span className="swatch nopath" /> 接待点不可达
      </div>
    </div>
  );
}
