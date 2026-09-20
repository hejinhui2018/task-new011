import { useEffect, useRef, useState } from 'react';
import { usePlanner } from './state/usePlanner';
import { Toolbar } from './components/Toolbar';
import { FloorPlan } from './components/FloorPlan';
import { AlertPanel } from './components/AlertPanel';
import { Inspector } from './components/Inspector';
import type { Alert } from './types';
import { dualRouteDemoSteps, SOUTH_EXIT_ID } from './lib/demo';
import { withGateOpened } from './lib/scenarios';

/** 每个演练步骤停留毫秒数；全程约 22 秒，远在 90 秒演示预算内。 */
const DEMO_STEP_MS = 6500;

export default function App() {
  const planner = usePlanner();
  const [activeAlertId, setActiveAlertId] = useState<string | null>(null);
  const [showPaths, setShowPaths] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [controlMode, setControlMode] = useState(false);
  const [demoStep, setDemoStep] = useState<number | null>(null);
  const timersRef = useRef<number[]>([]);

  const clearTimers = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  };

  const focusAlert = (alert: Alert) => {
    setActiveAlertId(alert.id);
    if (alert.boothId) planner.selectBooth(alert.boothId);
  };

  const alertCount = planner.analysis.alerts.length;
  const criticalCount = planner.booths.filter((b) => b.critical).length;
  const dualOk = planner.booths.filter(
    (b) => b.critical && planner.analysis.dual[b.id]?.status === 'dual',
  ).length;
  const hasControls =
    planner.closedExits.length > 0 || planner.zones.length > 0;

  /** 播放 90 秒演练：单路 → 双路 → 关闭出口降级 → 撤销恢复。 */
  const playDemo = () => {
    clearTimers();
    const steps = dualRouteDemoSteps();
    setShowPaths(true);
    setDemoStep(0);

    // 注意：定时器回调闭包里的 planner 是播放瞬间的快照，不能读其中的最新状态，
    // 所有变更都通过函数式 updater 基于 prev 完成。
    const runAction = (index: number) => {
      const action = steps[index].action;
      switch (action.type) {
        case 'reset':
          planner.resetPlan('dual-route');
          setControlMode(false);
          break;
        case 'open-gate':
          planner.commitNow((prev) => withGateOpened(prev));
          break;
        case 'close-south-exit':
          setControlMode(true);
          planner.commitNow((prev) =>
            (prev.closedExits ?? []).includes(SOUTH_EXIT_ID)
              ? prev
              : {
                  ...prev,
                  closedExits: [...(prev.closedExits ?? []), SOUTH_EXIT_ID],
                },
          );
          break;
        case 'undo':
          planner.undo();
          setControlMode(false);
          break;
      }
    };

    runAction(0);
    for (let i = 1; i < steps.length; i++) {
      const t = window.setTimeout(() => {
        setDemoStep(i);
        runAction(i);
      }, i * DEMO_STEP_MS);
      timersRef.current.push(t);
    }
    // 结束后停留展示最后一步，4 秒后自动收起卡片。
    const end = window.setTimeout(
      () => setDemoStep(null),
      steps.length * DEMO_STEP_MS + 4000,
    );
    timersRef.current.push(end);
  };

  // 演练期间始终聚焦重点展位 C01（planner.booths 随每次渲染刷新）。
  useEffect(() => {
    if (demoStep === null) return;
    const c01 = planner.booths.find((b) => b.label === 'C01');
    if (c01) planner.selectBooth(c01.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoStep, planner.booths]);

  const stopDemo = () => {
    clearTimers();
    setDemoStep(null);
  };

  useEffect(() => clearTimers, []);

  const steps = dualRouteDemoSteps();

  return (
    <div className="app">
      <Toolbar
        canUndo={planner.canUndo}
        canRedo={planner.canRedo}
        onUndo={planner.undo}
        onRedo={planner.redo}
        onAddBooth={planner.addBooth}
        onReset={(t) => {
          stopDemo();
          planner.resetPlan(t);
        }}
        showPaths={showPaths}
        onTogglePaths={() => setShowPaths((v) => !v)}
        controlMode={controlMode}
        onToggleControlMode={() => setControlMode((v) => !v)}
        onClearControls={planner.clearControls}
        hasControls={hasControls}
        onPlayDemo={playDemo}
        demoPlaying={demoStep !== null}
      />

      <div className="workspace">
        <div className={`canvas-wrap ${controlMode ? 'control-mode' : ''}`}>
          <FloorPlan
            planner={planner}
            showPaths={showPaths}
            activeAlertId={activeAlertId}
            onActiveAlertChange={setActiveAlertId}
            onZoomChange={setZoom}
            controlMode={controlMode}
          />
          <div className="hint-chip">
            {controlMode ? (
              <>
                <b>封控模式</b>：点击出口开/关 · 空白处拖出封控区域 ·
                点击封控区域删除 · 展位已锁定
              </>
            ) : (
              <>
                双击空白添加展位 · 拖动移动 · 手柄缩放 · <b>R</b> 旋转 ·
                滚轮缩放 · 拖空白平移
              </>
            )}
          </div>
          {controlMode && (
            <button
              className="control-exit-chip"
              onClick={() => setControlMode(false)}
            >
              完成封控 ✕
            </button>
          )}
          <Legend />
          {demoStep !== null && (
            <DemoCard
              stepIndex={demoStep}
              titles={steps.map((s) => s.title)}
              detail={steps[demoStep].detail}
              onStop={stopDemo}
            />
          )}
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
        {hasControls && (
          <span className="stat control-stat">
            封控中：
            {planner.closedExits.length > 0 &&
              ` 关闭出口 ${planner.closedExits.length} 个`}
            {planner.zones.length > 0 && ` 封控区域 ${planner.zones.length} 块`}
          </span>
        )}
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
        <span className="swatch path" /> 普通展位疏散路径（至最近出口）
      </div>
      <div className="row">
        <span className="swatch path-a" /> 重点展位双路 · 路线 1
      </div>
      <div className="row">
        <span className="swatch path-b" /> 重点展位双路 · 路线 2
      </div>
      <div className="row">
        <span className="swatch control" /> 临时封控区域 / 出口关闭
      </div>
      <div className="row">
        <span className="swatch overlap" /> 重叠 / 越界 / 出口封堵
      </div>
      <div className="row">
        <span className="swatch clearance" /> 净空不足 1.5 m
      </div>
      <div className="row">
        <span className="swatch nopath" /> 接待点不可达 / 完全断路
      </div>
    </div>
  );
}

function DemoCard({
  stepIndex,
  titles,
  detail,
  onStop,
}: {
  stepIndex: number;
  titles: string[];
  detail: string;
  onStop: () => void;
}) {
  return (
    <div className="demo-card">
      <div className="demo-head">
        <b>▶ 重点展位双通道演练</b>
        <button onClick={onStop} title="停止演练">
          ✕
        </button>
      </div>
      <div className="demo-steps">
        {titles.map((t, i) => (
          <span
            key={t}
            className={`demo-pill ${
              i < stepIndex ? 'done' : i === stepIndex ? 'now' : ''
            }`}
          >
            {i < stepIndex ? '✓ ' : ''}
            {t}
          </span>
        ))}
      </div>
      <div className="demo-detail">{detail}</div>
    </div>
  );
}
