interface ToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAddBooth: () => void;
  onReset: (target: 'empty' | 'blocked-exit' | 'dual-route') => void;
  showPaths: boolean;
  onTogglePaths: () => void;
  lockdownMode: boolean;
  onToggleLockdownMode: () => void;
  onClearLockdown: () => void;
  lockdownActive: boolean;
  onAutoDemo: () => void;
  demoRunning: boolean;
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
  lockdownMode,
  onToggleLockdownMode,
  onClearLockdown,
  lockdownActive,
  onAutoDemo,
  demoRunning,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="logo">展</span>
        <span>展位排布工作台</span>
        <small>20 × 14 m 展厅 · 0.5 m 网格</small>
      </div>

      <div className="tb-group">
        <button
          className="tb primary"
          onClick={onAddBooth}
          disabled={lockdownMode}
          title={lockdownMode ? '先退出临时封控模式再添加展位' : '添加一个普通展位'}
        >
          ＋ 添加展位
        </button>
        <button
          className={`tb ${lockdownMode ? 'lockdown-on' : ''}`}
          onClick={onToggleLockdownMode}
          title="进入/退出临时封控模式：可关闭出口、在网格上拖出封控区域"
        >
          {lockdownMode ? '🚧 退出封控模式' : '🚧 临时封控'}
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
          className="tb"
          onClick={onTogglePaths}
          title="显示/隐藏疏散路径"
        >
          {showPaths ? '🚧 隐藏路径' : '🚶 显示路径'}
        </button>
        <button
          className="tb"
          onClick={onClearLockdown}
          disabled={!lockdownActive}
          title="清除全部临时封控（开放出口、删除封控区域）"
        >
          清除封控
        </button>
        <button
          className="tb"
          onClick={() => onReset('dual-route')}
          title="载入重点展位双通道演练示例"
        >
          载入“双通道”示例
        </button>
        <button
          className="tb"
          onClick={() => onReset('blocked-exit')}
          title="载入内置的出口被堵示例方案"
        >
          载入“出口被堵”示例
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

      <div className="tb-group">
        <button
          className={`tb demo-btn ${demoRunning ? 'running' : ''}`}
          onClick={onAutoDemo}
          disabled={demoRunning}
          title="90 秒内自动演练：单路 → 双路 → 关闭出口后降级 → 撤销恢复"
        >
          {demoRunning ? '演练进行中…' : '▶ 90 秒双通道演练'}
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
