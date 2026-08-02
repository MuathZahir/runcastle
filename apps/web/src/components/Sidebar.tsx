import { useState } from 'react'
import { trpc } from '../trpc'
import { DimLine } from '../ui'
import { useToast } from '../lib/toast'
import type { FeatureListItem, PrepView } from '../lib/api'
import { miniSegments, rowChip, ticketProgress, triage } from '../lib/feature-ui'
import { prepRailRow } from '../lib/project-workspace'
import { isStale } from '../lib/settings'
import { useLivePoll } from '../lib/live'
import type { ProjectTalkApi } from '../lib/use-project-talk'
import { IconBolt, IconCheck, IconPlus, LogoMark } from '../icons'
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
 *
 * Above the lanes — outside them, always present — sits the pinned project row
 * (decision 20). The rail already is the project's list of things to work on, and
 * the project session is the one entry on it that is not a feature, so it belongs
 * here rather than in any triage lane.
 */
export function Sidebar({
  projectId,
  selectedFeatureId,
  projectSelected,
  talk,
  onSelect,
  onSelectProject,
  onNewFeature,
  onQuickChange,
  onOpenPreparation,
}: {
  projectId: string
  selectedFeatureId: string | null
  projectSelected: boolean
  talk: ProjectTalkApi
  onSelect: (featureId: string) => void
  onSelectProject: () => void
  onNewFeature: () => void
  onQuickChange: () => void
  onOpenPreparation: () => void
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [showArchived, setShowArchived] = useState(readShowArchived)
  // The feature awaiting delete confirmation (decision #8), or null.
  const [pendingDelete, setPendingDelete] = useState<FeatureListItem | null>(null)

  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  // Same query key the preparation workspace polls — one fetch, two readers.
  // The row waits for the answer rather than guessing: its two variants say
  // opposite things, so a guess is a sentence that flips on first paint.
  const prep = trpc.project.prep.useQuery({ projectId }) as { data?: PrepView }
  const prepRow = prepRailRow(
    prep.data && {
      prepared: prep.data.prepared,
      pendingCount: prep.data.pendingKeys.length,
      staleCount: prep.data.findings.filter(isStale).length,
    },
  )
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
        {/* Two doors, side by side (decision 21): a grill for work that needs
            shaping, and a quick change for work that doesn't. */}
        <button
          className="new-btn is-quick"
          onClick={onQuickChange}
          title="Quick change — one sentence, one ticket, no grill session"
        >
          <IconBolt size={11} />
          Quick
        </button>
        <button className="new-btn" onClick={onNewFeature}>
          <IconPlus size={11} />
          New
        </button>
      </div>

      <ProjectRow
        projectId={projectId}
        active={projectSelected}
        state={talk.state}
        onSelect={onSelectProject}
      />

      <div className="sidebar-list">
        {list.isLoading && (
          <div style={{ padding: '10px 8px' }}>
            <DimLine>loading features…</DimLine>
          </div>
        )}
        {list.data && list.data.length === 0 && (
          <div className="sidebar-empty">
            No features yet.
            <br />
            Create one to start the pipeline.
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

      {/* Preparation's permanent address (SPEC §14). With features on screen the
          whole-body version would be in the way, so it shrinks to the rail's
          foot — and it stays there once prepared, because a finished preparation
          still has to be findable to be re-run or read. */}
      {prepRow && (
        <button
          className={`prep-nudge is-${prepRow.variant}`}
          onClick={onOpenPreparation}
          title={prepRow.title}
          // The badge is a fragment ("8 to establish"); a screen reader should
          // get the sentence that explains it, not the fragment.
          aria-label={`${prepRow.label} — ${prepRow.title}`}
        >
          <span className="prep-nudge-dot" aria-hidden="true" />
          <span className="prep-nudge-text">{prepRow.label}</span>
          {prepRow.badge && <span className="prep-nudge-count">{prepRow.badge}</span>}
        </button>
      )}

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

/**
 * The pinned project row. It is not a feature and must never join a triage lane:
 * the lanes group by who is blocked, and this row is a door, not a piece of work.
 * It shows the project's own identity plus a live indicator while the intake
 * conversation is launching or up — the same "something is happening here" signal
 * a feature row gives for a run, driven by the same 1.5s poll.
 */
function ProjectRow({
  projectId,
  active,
  state,
  onSelect,
}: {
  projectId: string
  active: boolean
  state: ProjectTalkApi['state']
  onSelect: () => void
}) {
  // Same query key the nav polls — no extra fetch, just the project's name.
  const projects = trpc.project.list.useQuery()
  const project = projects.data?.find((p) => p.id === projectId)

  return (
    <div className="project-pin">
      <button
        className={`project-row${active ? ' is-active' : ''}`}
        onClick={onSelect}
        title="Talk to the project — intake, decomposition, and portfolio questions"
      >
        <span className="project-row-mark">
          <LogoMark size={13} variant="outline" />
        </span>
        <span className="project-row-name">{project?.name ?? 'This project'}</span>
        {state === 'none' ? (
          <span className="project-row-kick">Project</span>
        ) : (
          <span className="project-row-live">
            <span className="spin-ring" />
            {state === 'launching' ? 'opening' : 'live'}
          </span>
        )}
      </button>
    </div>
  )
}

/**
 * One feature, as a two-line card (decisions §1). Line 1 is what the feature IS
 * — its phase dot, its title, and the one status chip that says who it is
 * waiting on. Line 2 is where it stands: the mono slug, its ticket progress when
 * it has tickets, and the six-segment pipeline map at the end.
 *
 * The chip slot holds exactly one thing and `rowChip` picks it; this renders
 * that decision without making one of its own.
 */
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
  const chip = rowChip(f)
  const progress = ticketProgress(f)
  const segs = miniSegments(f)
  const dimmed = f.status === 'shipped' || f.status === 'archived'
  const cls = `feature-row${active ? ' is-active' : ''}${dimmed ? ' is-dim' : ''}`

  return (
    <div className={cls}>
      <button className="feature-row-main" onClick={() => onSelect(f.id)} title={`${f.title} — ${f.slug}`}>
        <span className="feature-line">
          <span className={`feature-dot phase-bg-${f.phase}`} />
          <span className="feature-title">{f.title}</span>
          <span className={`feature-chip is-${chip.kind}`} title={chip.title}>
            {chip.kind === 'needsMe' && <span className={`needs-dot needs-${chip.needs}`} />}
            {chip.kind === 'working' && <span className="spin-ring" />}
            {chip.kind === 'shipped' && <IconCheck size={10} />}
            {chip.text}
          </span>
        </span>
        <span className="feature-line is-meta">
          <span className="feature-slug">{f.slug}</span>
          {progress && <span className="feature-progress">{progress}</span>}
          <span className="mini-map">
            {segs.map((s, i) => (
              <span key={i} className={`mini-seg is-${s.state}`} />
            ))}
          </span>
        </span>
      </button>
      <FeatureActionsMenu actions={actions} />
    </div>
  )
}
