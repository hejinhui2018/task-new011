import type { Alert, RouteReason } from '../types';

const KIND_META: Record<
  Alert['kind'],
  { char: string; title: string; cls: string }
> = {
  'exit-blocked': { char: '封', title: '出口被堵', cls: 'kind-exit-blocked' },
  'exit-closed': { char: '关', title: '出口临时关闭', cls: 'kind-exit-closed' },
  overlap: { char: '重', title: '展位重叠', cls: 'kind-overlap' },
  'out-of-bounds': { char: '界', title: '超出展厅', cls: 'kind-out-of-bounds' },
  clearance: { char: '距', title: '通道过窄', cls: 'kind-clearance' },
  'no-path': { char: '断', title: '疏散不可达', cls: 'kind-no-path' },
  'single-route': { char: '单', title: '重点展位仅单路', cls: 'kind-single-route' },
};

// 严重度排序：出口封堵/关闭 > 重叠/越界 > 完全不可达 > 仅单路 > 净空
const ORDER: Alert['kind'][] = [
  'exit-blocked',
  'exit-closed',
  'overlap',
  'out-of-bounds',
  'no-path',
  'single-route',
  'clearance',
];

/** 双路告警原因的中文标签（选中告警时可看到是出口关闭、空间瓶颈还是完全断路）。 */
export const REASON_TEXT: Record<RouteReason, string> = {
  'exit-closed': '原因：出口关闭/被封堵',
  bottleneck: '原因：空间瓶颈（两条疏散线被迫共用通道）',
  disconnected: '原因：完全断路（接待点到不了任何开放出口）',
};

interface AlertPanelProps {
  alerts: Alert[];
  activeAlertId: string | null;
  onSelect: (a: Alert) => void;
}

export function AlertPanel({ alerts, activeAlertId, onSelect }: AlertPanelProps) {
  const sorted = [...alerts].sort(
    (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind),
  );

  return (
    <div className="sidebar-section" style={{ flex: '1 1 50%' }}>
      <div className="section-head">
        实时检查
        <span className={`count ${alerts.length ? 'bad' : 'zero'}`}>
          {alerts.length} 条
        </span>
      </div>
      <div className="alert-list">
        {sorted.length === 0 ? (
          <div className="empty-alerts">
            ✓ 全部检查通过
            <br />
            无越界、重叠、净空或疏散问题
          </div>
        ) : (
          sorted.map((a) => {
            const meta = KIND_META[a.kind];
            return (
              <button
                key={a.id}
                className={`alert-card ${meta.cls} ${
                  activeAlertId === a.id ? 'active' : ''
                }`}
                onClick={() => onSelect(a)}
              >
                <span className={`icon ${meta.cls}`}>{meta.char}</span>
                <span className="body">
                  <span className="title">{meta.title}</span>
                  <span className="msg" style={{ display: 'block' }}>
                    {a.message}
                  </span>
                  {a.reason && (
                    <span className="reason-tag">{REASON_TEXT[a.reason]}</span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
