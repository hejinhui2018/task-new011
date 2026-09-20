import type { Alert, AlertCause } from '../types';

const KIND_META: Record<
  Alert['kind'],
  { char: string; title: string; cls: string }
> = {
  'exit-blocked': { char: '封', title: '出口被堵', cls: 'kind-exit-blocked' },
  'exit-closed': { char: '关', title: '出口临时关闭', cls: 'kind-exit-closed' },
  overlap: { char: '重', title: '展位重叠', cls: 'kind-overlap' },
  'out-of-bounds': { char: '界', title: '超出展厅', cls: 'kind-out-of-bounds' },
  clearance: { char: '距', title: '通道过窄', cls: 'kind-clearance' },
  'single-route': { char: '单', title: '仅单通道', cls: 'kind-single-route' },
  'no-path': { char: '堵', title: '疏散不可达', cls: 'kind-no-path' },
};

// 严重度排序：出口封堵/关闭 > 完全断路 > 单通道 > 重叠/越界 > 净空
const ORDER: Alert['kind'][] = [
  'exit-blocked',
  'exit-closed',
  'no-path',
  'single-route',
  'overlap',
  'out-of-bounds',
  'clearance',
];

const CAUSE_TEXT: Record<AlertCause, string> = {
  'exit-closed': '出口关闭',
  bottleneck: '空间瓶颈',
  cutoff: '完全断路',
};

export function causeLabel(a: Alert): string | null {
  if (a.kind === 'single-route' || a.kind === 'no-path') {
    return a.cause ? CAUSE_TEXT[a.cause] : null;
  }
  return null;
}

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
            const cause = causeLabel(a);
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
                  <span className="title">
                    {meta.title}
                    {cause && (
                      <span className={`cause-tag cause-${a.cause}`}>
                        {cause}
                      </span>
                    )}
                  </span>
                  <span className="msg" style={{ display: 'block' }}>
                    {a.message}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
