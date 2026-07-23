import { useState } from 'react'
import { trpc } from '../trpc'
import { DimLine } from '../ui'
import { useToast } from '../lib/toast'
import type { FeatureListItem } from '../lib/api'
import { miniSegments, needsMe, phaseGlyph, triage } from '../lib/feature-ui'
import { FeatureActionsMenu, type FeatureAction } from './FeatureActionsMenu'
import { DeleteFeatureDialog } from './DeleteFeatureDialog'

/** localStorage key for the sidebar's show-archived toggle (decision #8). */
const SHOW_ARCHIVED_KEY = 'runcastle.sidebar.showArchived'

function readShowArchived(): boolean {
  try {
    return localStorage.getItem(SHOW_ARCHIVED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The features rail (app-redesign): a triage list, not a flat one. Features are
 * grouped by who's blocked — Needs you (amber) · Agent working (spinner) ·
 * In progress · Shipped (dimmed ✓). Each row carries a phase glyph, its mono
 * slug, a compact six-segment pipeline map, and a kebab actions menu (Archive /
 * Unarchive). Archived features are hidden behind the show-archived toggle
 * (persisted in localStorage). Polls `feature.list` at 1.5s.
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
  const utils = trpc.useUtils()
  const toast = useToast()
  const [showArchived, setShowArchived] = useState(readShowArchived)
  // The feature awaiting delete confirmation (decision #8), or null.
  const [pendingDelete, setPendingDelete] = useState<FeatureListItem | null>(null)

  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: 1500 })
  const groups = triage(list.data ?? [], { showArchived })
  const archivedCount = (list.data ?? []).filter((f) => f.status === 'archived').length

  const invalidate = () => void utils.feature.list.invalidate()
  const archive = trpc.feature.archive.useMutation({
    onSuccess: invalidate,
    onError: (e) => toast.push(e.message),
  })
  const unarchive = trpc.feature.unarchive.useMutation({
    onSuccess: invalidate,
    onError: (e) => toast.push(e.message),
  })
  const del = trpc.feature.delete.useMutation({
    onSuccess: (_res, vars) => {
      invalidate()
      // If the deleted feature was open, jump to another one so the workspace
      // never dead-ends on a now-missing feature (delete is irreversible).
      if (vars.featureId === selectedFeatureId) {
        const next = (list.data ?? []).find((f) => f.id !== vars.featureId)
        if (next) onSelect(next.id)
      }
      setPendingDelete(null)
    },
    onError: (e) => toast.push(e.message),
  })

  const toggleArchived = () => {
    setShowArchived((v) => {
      const next = !v
      try {
        localStorage.setItem(SHOW_ARCHIVED_KEY, next ? '1' : '0')
      } catch {
        // localStorage unavailable (private mode) — the toggle still works in-session
      }
      return next
    })
  }

  const actionsFor = (f: FeatureListItem): FeatureAction[] => {
    const actions: FeatureAction[] =
      f.status === 'archived'
        ? [{ key: 'unarchive', label: 'Unarchive', onSelect: () => unarchive.mutate({ featureId: f.id }) }]
        : [{ key: 'archive', label: 'Archive', onSelect: () => archive.mutate({ featureId: f.id }) }]
    // Delete is non-shipped only (shipped features are merged — archive covers
    // them; the server refuses them too). Opens a destructive confirm dialog.
    if (f.status !== 'shipped') {
      actions.push({ key: 'delete', label: 'Delete…', danger: true, onSelect: () => setPendingDelete(f) })
    }
    return actions
  }

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
                actions={actionsFor(f)}
              />
            ))}
          </div>
        ))}
        {archivedCount > 0 && (
          <button className="show-archived-toggle" onClick={toggleArchived}>
            {showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
          </button>
        )}
      </div>

      <div className="sidebar-foot">
        Every feature moves through the same six-phase pipeline. Amber means it's
        waiting on you.
      </div>

      {pendingDelete && (
        <DeleteFeatureDialog
          title={pendingDelete.title}
          slug={pendingDelete.slug}
          busy={del.isPending}
          onConfirm={() => del.mutate({ featureId: pendingDelete.id })}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </nav>
  )
}

function FeatureRow({
  f,
  active,
  onSelect,
  actions,
}: {
  f: FeatureListItem
  active: boolean
  onSelect: (id: string) => void
  actions: FeatureAction[]
}) {
  const nm = needsMe(f)
  const segs = miniSegments(f)
  const dimmed = f.status === 'shipped' || f.status === 'archived'
  const cls = `feature-row${active ? ' is-active' : ''}${dimmed ? ' is-dim' : ''}`

  return (
    <div className={cls}>
      <button className="feature-row-main" onClick={() => onSelect(f.id)} title={f.title}>
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
      <FeatureActionsMenu actions={actions} />
    </div>
  )
}
