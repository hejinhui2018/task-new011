interface ToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAddBooth: () => void;
  onReset: (target: 'empty' | 'blocked-exit' | 'dual-route') => void;
  showPaths: boolean;
  onTogglePaths: () => void;
  /** 临时封控模式开关 */
  controlMode: boolean;
  onToggleControlMode: () => void;
  onClearControls: () => void;
  hasControls: boolean;
  /** 播放 90 秒双通道演练 */
  onPlayDemo: () => void;
  demoPlaying: boolean;
}

export function Toolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAddBooth,
  onReset,
  showPaths,
  onTogglePaths,
  controlMode,
  onToggleControlMode,
  onClearControls,
  hasControls,
  onPlayDemo,
  demoPlaying,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="logo">展</span>
        <span>VenueFlow 展位排布工作台</span>
        <small>20 × 14 m 展厅 · 0.5 m 网格</small>
      </div>

      <div className="tb-group">
        <button className="tb primary" onClick={onAddBooth} disabled={controlMode}>
          ＋ 添加展位
        </button>
      </div>

      <div className="tb-group">
        <button className="tb" onClick={onUndo} disabled={!canUndo} title="撤销 (Ctrl+Z)">
          ↶ 撤销 <span className="k">Ctrl+Z</span>
        </button>
        <button className="tb" onClick={onRedo} disabled={!canRedo} title="重做 (Ctrl+Y)">
          ↷ 重做 <span className="k">Ctrl+Y</span>
        </button>
      </div>

      <div className="tb-group">
        <button
          className={controlMode ? 'tb control-on' : 'tb'}
          onClick={onToggleControlMode}
          title="进入/退出临时封控模式：点击出口关闭，在空白处拖出封控区域，点击封控区域删除"
        >
          {controlMode ? '🚧 退出封控' : '🚧 临时封控'}
        </button>
        <button
          className="tb"
          onClick={onClearControls}
          disabled={!hasControls}
          title="撤销全部出口关闭与封控区域"
        >
          清除封控
        </button>
        <button
          className="tb"
          onClick={onTogglePaths}
          title="显示/隐藏疏散路径"
        >
          {showPaths ? '隐藏路径' : '显示路径'}
        </button>
      </div>

      <div className="tb-group">
        <button
          className="tb demo-btn"
          onClick={onPlayDemo}
          disabled={demoPlaying}
          title="播放约 40 秒的双通道演练：单路 → 双路 → 关闭出口降级 → 撤销恢复"
        >
          ▶ 双通道演练
        </button>
        <button
          className="tb"
          onClick={() => onReset('dual-route')}
          title="载入重点展位双通道示例方案"
        >
          双通道示例
        </button>
        <button
          className="tb"
          onClick={() => onReset('blocked-exit')}
          title="载入内置的出口被堵示例方案"
        >
          “出口被堵”示例
        </button>
        <button
          className="tb danger-text"
          onClick={() => {
            if (window.confirm('确定清空全部展位？此操作可用撤销恢复。')) {
              onReset('empty');
            }
          }}
        >
          方案重置
        </button>
      </div>

      <div className="tb-spacer" />
      <div className="tb-group">
        <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
          数据保存在本机浏览器
        </span>
      </div>
    </header>
  );
}
