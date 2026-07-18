import { trpc } from '../trpc'
import { DimLine } from '../ui'
import type { FeatureListItem } from '../lib/api'
import { miniSegments, needsMe, phaseGlyph, triage } from '../lib/feature-ui'

/**
 * The features rail (app-redesign): a triage list, not a flat one. Features are
 * grouped by who's blocked — Needs you (amber) · Agent working (spinner) ·
 * In progress · Shipped (dimmed ✓). Each row carries a phase glyph, its mono
 * slug, and a compact six-segment pipeline map so lifecycle is legible at a
 * glance. Polls `feature.list` at 1.5s.
 */
export function Sidebar({
  projectId,
  selectedFeatureId,
  onSelect,
  onNewFeature,
}: {
  projectId: string
  selectedFeatureId: string | null
  onSelect: (featureId: string) => void
  onNewFeature: () => void
}) {
  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: 1500 })
  const groups = triage(list.data ?? [])

  return (
    <nav className="sidebar">
      <div className="sidebar-head">
        <span className="pane-title">Features</span>
        <button className="new-btn" onClick={onNewFeature}>
          + New
        </button>
      </div>

      <div className="sidebar-list">
        {list.isLoading && (
          <div style={{ padding: '10px 8px' }}>
            <DimLine>loading features…</DimLine>
          </div>
        )}
        {list.data && list.data.length === 0 && (
          <div style={{ padding: '10px 8px' }}>
            <DimLine>no features yet — + New to begin</DimLine>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.key} className={`triage-group triage-${g.key}`}>
            <div className="triage-label">
              <span className="triage-name">{g.label}</span>
              <span className="triage-count">{g.features.length}</span>
            </div>
            {g.features.map((f) => (
              <FeatureRow
                key={f.id}
                f={f}
                active={f.id === selectedFeatureId}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        Every feature moves through the same six-phase pipeline. Amber means it's
        waiting on you.
      </div>
    </nav>
  )
}

function FeatureRow({
  f,
  active,
  onSelect,
}: {
  f: FeatureListItem
  active: boolean
  onSelect: (id: string) => void
}) {
  const nm = needsMe(f)
  const segs = miniSegments(f)
  const cls = `feature-row${active ? ' is-active' : ''}${f.status === 'shipped' ? ' is-shipped' : ''}`

  return (
    <button className={cls} onClick={() => onSelect(f.id)} title={f.title}>
      <span className={`feature-glyph phase-fg-${f.phase}`}>{phaseGlyph(f.phase)}</span>
      <span className="feature-slug mono">{f.slug}</span>
      <span className="feature-flag">
        {f.activeRun ? (
          <span className="spin-ring" title="agent working" />
        ) : f.status === 'shipped' ? (
          <span className="mini-check">✓</span>
        ) : (
          <>
            {nm && <span className={`needs-dot needs-${nm.kind}`} title={nm.label} />}
            <span className="mini-map">
              {segs.map((s, i) => (
                <span key={i} className={`mini-seg is-${s.state}`} />
              ))}
            </span>
          </>
        )}
      </span>
    </button>
  )
}
