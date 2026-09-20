import { useEffect, useState } from 'react';
import type { Alert, Booth, DualRouteResult, Orientation } from '../types';
import type { PlannerApi } from '../state/usePlanner';
import { alertsForBooth, exitName } from '../lib/validation';

const ORIENTATIONS: { value: Orientation; label: string }[] = [
  { value: 'north', label: '朝北' },
  { value: 'east', label: '朝东' },
  { value: 'south', label: '朝南' },
  { value: 'west', label: '朝西' },
];

const KIND_LABEL: Record<Alert['kind'], string> = {
  'exit-blocked': '封住出口',
  'exit-closed': '出口临时关闭',
  overlap: '与相邻展位重叠',
  'out-of-bounds': '超出展厅边界',
  clearance: '通道净空不足 1.5 m',
  'no-path': '接待点无法抵达出口',
  'single-route': '重点展位仅单路疏散',
};

const KIND_CLS: Record<Alert['kind'], string> = {
  'exit-blocked': 'kind-exit-blocked',
  'exit-closed': 'kind-exit-closed',
  overlap: 'kind-overlap',
  'out-of-bounds': 'kind-out-of-bounds',
  clearance: 'kind-clearance',
  'no-path': 'kind-no-path',
  'single-route': 'kind-single-route',
};

interface InspectorProps {
  planner: PlannerApi;
  onAlertClick: (a: Alert) => void;
}

export function Inspector({ planner, onAlertClick }: InspectorProps) {
  const booth = planner.booths.find((b) => b.id === planner.selectedId) ?? null;

  return (
    <div className="sidebar-section" style={{ flex: '1 1 50%' }}>
      <div className="section-head">
        展位属性
        {booth && <span className="count">{booth.label}</span>}
        {booth?.critical && <span className="count critical-tag">重点展位</span>}
      </div>
      <div className="inspector">
        {!booth ? (
          <div className="no-selection">
            未选中展位。
            <br />
            · 单击图上展位查看属性
            <br />
            · 双击空白处快速添加
            <br />
            · 拖动移动，8 个手柄缩放
            <br />
            · <b>R</b> 或蓝色旋钮旋转 90°
            <br />
            · 勾选“重点展位”启用双通道演练
          </div>
        ) : (
          <SelectedInspector
            key={booth.id}
            booth={booth}
            planner={planner}
            onAlertClick={onAlertClick}
          />
        )}
      </div>
    </div>
  );
}

/**
 * 文本/数值输入：编辑期间只维护本地草稿，失焦或回车时一次性提交一条历史，
 * 避免每敲一个字就产生一条撤销记录。
 */
function CommitInput({
  value,
  type = 'text',
  step,
  min,
  onCommit,
}: {
  value: string | number;
  type?: string;
  step?: number;
  min?: number;
  onCommit: (raw: string) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (draft !== String(value)) onCommit(draft);
    else setDraft(String(value));
  };
  return (
    <input
      type={type}
      step={step}
      min={min}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(String(value));
      }}
    />
  );
}

function DualRouteCard({ result }: { result: DualRouteResult }) {
  if (result.status === 'dual') {
    return (
      <div className="dual-card dual-ok">
        <div className="dual-title">✓ 双路可用</div>
        <div className="dual-desc">
          两条疏散路线除接待点外不共用通行网格：
          <br />
          路线 1 → {exitName(result.exitIds[0]!)}
          <br />
          路线 2 → {exitName(result.exitIds[1]!)}
        </div>
      </div>
    );
  }
  if (result.status === 'single') {
    return (
      <div className="dual-card dual-single">
        <div className="dual-title">⚠ 仅单路</div>
        <div className="dual-desc">
          只能找到一条通往
          {result.exitIds[0] ? ` ${exitName(result.exitIds[0])} ` : '开放出口'}
          的不相交路线。
          <br />
          {result.reason === 'exit-closed'
            ? '降级原因：出口被临时关闭或封堵。'
            : '降级原因：空间瓶颈，第二条通道走不通。'}
        </div>
      </div>
    );
  }
  return (
    <div className="dual-card dual-none">
      <div className="dual-title">✕ 完全不可达</div>
      <div className="dual-desc">
        {result.reason === 'exit-closed'
          ? '所有出口均已关闭或被封堵，无疏散能力。'
          : '接待点到任何开放出口都完全断路，请立即清理通道。'}
      </div>
    </div>
  );
}

function SelectedInspector({
  booth,
  planner,
  onAlertClick,
}: {
  booth: Booth;
  planner: PlannerApi;
  onAlertClick: (a: Alert) => void;
}) {
  const myAlerts = alertsForBooth(planner.analysis, booth.id);
  const isPartition = booth.kind === 'partition';
  const dual = planner.analysis.dual[booth.id];

  return (
    <>
      <h4>检查状态</h4>
      {myAlerts.length === 0 ? (
        isPartition ? (
          <div className="insp-empty">✓ 围挡位置正常（围挡是通道障碍，无接待点）</div>
        ) : booth.critical ? (
          <div className="insp-empty">✓ 无其他告警，双通道状态见下方卡片</div>
        ) : (
          <div className="insp-empty">✓ 该展位无问题，疏散路径可达出口</div>
        )
      ) : (
        myAlerts.map((a) => (
          <button
            key={a.id}
            className={`insp-alert ${KIND_CLS[a.kind]}`}
            style={{
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer',
              font: 'inherit',
            }}
            onClick={() => onAlertClick(a)}
          >
            <b>{KIND_LABEL[a.kind]}</b>
            <br />
            {a.message}
          </button>
        ))
      )}

      {!isPartition && (
        <>
          <h4>疏散演练等级</h4>
          <label className="critical-switch">
            <input
              type="checkbox"
              checked={booth.critical === true}
              onChange={() => planner.toggleCritical(booth.id)}
            />
            <span>
              <b>重点展位</b>
              <small>需要两条通往不同出口、不共用通行网格的疏散路线</small>
            </span>
          </label>
          {booth.critical && dual && (
            <div style={{ marginTop: 8 }}>
              <DualRouteCard result={dual} />
            </div>
          )}
        </>
      )}

      <h4>基本信息</h4>
      <div className="field">
        <label>编号</label>
        <CommitInput
          value={booth.label}
          onCommit={(raw) => planner.updateBoothField(booth.id, 'label', raw)}
        />
      </div>

      <h4>位置（米，左上原点）</h4>
      <div className="field-row">
        <div className="field">
          <label>X</label>
          <CommitInput
            type="number"
            step={0.5}
            value={booth.x}
            onCommit={(raw) => planner.updateBoothField(booth.id, 'x', raw)}
          />
        </div>
        <div className="field">
          <label>Y</label>
          <CommitInput
            type="number"
            step={0.5}
            value={booth.y}
            onCommit={(raw) => planner.updateBoothField(booth.id, 'y', raw)}
          />
        </div>
      </div>

      <h4>尺寸（米）</h4>
      <div className="field-row">
        <div className="field">
          <label>宽</label>
          <CommitInput
            type="number"
            min={0.5}
            step={0.5}
            value={booth.w}
            onCommit={(raw) => planner.updateBoothField(booth.id, 'w', raw)}
          />
        </div>
        <div className="field">
          <label>高</label>
          <CommitInput
            type="number"
            min={0.5}
            step={0.5}
            value={booth.h}
            onCommit={(raw) => planner.updateBoothField(booth.id, 'h', raw)}
          />
        </div>
      </div>

      <h4>正面朝向（接待点方向）</h4>
      <div className="orient-btns">
        {ORIENTATIONS.map((o) => (
          <button
            key={o.value}
            className={booth.orientation === o.value ? 'on' : ''}
            onClick={() => planner.setOrientation(booth.id, o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>

      <h4>操作</h4>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="tb" onClick={() => planner.rotateBooth(booth.id)}>
          ⟳ 旋转 90°
        </button>
        <button
          className="tb danger-text"
          onClick={() => planner.deleteBooth(booth.id)}
        >
          删除展位
        </button>
      </div>
    </>
  );
}
