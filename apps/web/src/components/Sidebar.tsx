import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { trpc } from '../trpc'
import { DimLine, PhaseDot } from '../ui'
import { useToast } from '../lib/toast'
import type { FeatureListItem, PrepView } from '../lib/api'
import {
  capLane,
  DRAFT_GLYPH,
  miniSegments,
  rowChip,
  ticketProgress,
  triage,
  type NeedsMeKind,
  type RowChipKind,
  type TriageKey,
} from '../lib/feature-ui'
import { prepRailRow } from '../lib/project-workspace'
import { pathFor } from '../lib/routes'
import { isStale } from '../lib/settings'
import { useLivePoll } from '../lib/live'
import { clampSidebarWidth } from '../lib/sidebar-width'
import type { ProjectTalkApi } from '../lib/use-project-talk'
import { IconBolt, IconCheck, IconPlus, LogoMark } from '../icons'
import { copyText } from './workspace/copy-text'
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
 * What every button here has to say for itself, because there is no preflight
 * (apps/web/STYLE.md) — an unstyled `<button>` is grey, bordered and
 * un-clickable-looking. Its *colour* is not here: `styles.css` still carries an
 * unlayered `button { color: inherit }`, which beats any `text-*` utility on the
 * button itself, so each button carries `group` and colours a span inside it.
 *
 * Nor are its border and background: two utilities for one property on one
 * element are a coin flip without `tailwind-merge` (which this app deliberately
 * does not have), so each button states those itself, exactly once.
 */
const BUTTON_RESET = 'cursor-pointer'

/** The rail's two quiet expanders — show-archived and the Shipped lane's — as one idiom. */
const EXPANDER_CLASS =
  `group ${BUTTON_RESET} mt-2 w-full rounded-md border-0 bg-transparent px-3 py-2 ` +
  'text-left text-sm transition-colors duration-(--dur-1) ease-app hover:bg-panel-3'
const EXPANDER_LABEL_CLASS = 'text-text-3 group-hover:text-text-2'

/** The 11px uppercase micro-label the head and every lane share. */
const CAPTION_CLASS = 'text-xs font-semibold tracking-[0.09em] uppercase'

/** Both doors are ghost: the rail holds no primary action (apps/web/STYLE.md). */
const DOOR_CLASS =
  `group ${BUTTON_RESET} inline-flex h-7 shrink-0 items-center rounded-md border ` +
  'border-hairline bg-transparent px-2.5 text-sm font-medium ' +
  'transition-colors duration-(--dur-1) ease-app hover:border-hairline-strong hover:bg-panel-3'
const DOOR_LABEL_CLASS = 'flex items-center gap-1.5 text-text-2 group-hover:text-text'

/**
 * The features rail (decision 10): a triage list, not a flat one. Features are
 * grouped by who's blocked — Needs you (amber) · Agent working (spinner) ·
 * In progress · Drafts · Shipped (dimmed ✓) — and each row is a roomy two-liner:
 * phase dot, title over up to two lines, one status chip, then the six-segment
 * pipeline map and ticket progress. The slug is not on the row any more; it is
 * in the URL and the feature header, and the kebab's Copy link hands over that
 * URL. Archived features hide behind the show-archived toggle (persisted), and
 * the Shipped lane — the only one that grows without bound — collapses to its
 * newest few behind its own expander (`capLane`). Polls `feature.list` at 1.5s.
 *
 * Above the lanes — outside them, always present — sits the pinned project row
 * (decision 20). The rail already is the project's list of things to work on, and
 * the project session is the one entry on it that is not a feature, so it belongs
 * here rather than in any triage lane.
 *
 * The rail's own width is the shell's to apply (it owns the grid); this renders
 * the drag handle and reports the new width up.
 */
export function Sidebar({
  projectId,
  selectedFeatureId,
  projectSelected,
  width,
  talk,
  onSelect,
  onSelectProject,
  onNewChat,
  onQuickChange,
  onOpenPreparation,
  onResize,
}: {
  projectId: string
  selectedFeatureId: string | null
  projectSelected: boolean
  /** The rail's current width in px — the drag's starting point. */
  width: number
  talk: ProjectTalkApi
  onSelect: (featureId: string) => void
  onSelectProject: () => void
  /** New — open the project workspace on a fresh conversation. */
  onNewChat: () => void
  /** Quick — open the two-mode overlay (a change to burn, or a draft to park). */
  onQuickChange: () => void
  onOpenPreparation: () => void
  /** A drag produced a new width; the shell clamps, applies and persists it. */
  onResize: (px: number) => void
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [showArchived, setShowArchived] = useState(readShowArchived)
  // The Shipped lane's expander (decisions §2). Unlike show-archived this is not
  // persisted: it is a glance at a lane, not a standing choice about the rail.
  const [showAllShipped, setShowAllShipped] = useState(false)
  // The feature awaiting delete confirmation (decision #8), or null.
  const [pendingDelete, setPendingDelete] = useState<{
    feature: FeatureListItem
    returnFocusRef: RefObject<HTMLButtonElement | null>
  } | null>(null)

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
    // The row no longer wears its slug, so the address it used to hint at is
    // handed over here instead (decision 10) — the same URL the rail navigates
    // to, absolute so it survives a paste into anything.
    const actions: FeatureAction[] = [
      {
        key: 'copy-link',
        label: 'Copy link',
        onSelect: () =>
          copyText(
            window.location.origin + pathFor({ kind: 'feature', projectId, featureSlug: f.slug }),
            toast,
          ),
      },
    ]
    // A draft is never offered Archive (decision 8): it is refused server-side —
    // unarchiving derives status from phase and would resurrect it as
    // active-without-a-branch — so the menu never offers a dead item. A draft IS
    // the shelf, and Delete below covers the ideas that die on it.
    if (f.status === 'archived') {
      actions.push({
        key: 'unarchive',
        label: 'Unarchive',
        onSelect: () => unarchive.mutate({ featureId: f.id }),
      })
    } else if (f.status !== 'draft') {
      actions.push({
        key: 'archive',
        label: 'Archive',
        onSelect: () => archive.mutate({ featureId: f.id }),
      })
    }
    // Delete is non-shipped only (shipped features are merged — archive covers
    // them; the server refuses them too). Opens a destructive confirm dialog.
    if (f.status !== 'shipped') {
      actions.push({
        key: 'delete',
        label: 'Delete…',
        danger: true,
        onSelect: (returnFocusRef) => setPendingDelete({ feature: f, returnFocusRef }),
      })
    }
    return actions
  }

  return (
    <nav className="relative flex min-h-0 flex-col border-r border-hairline bg-panel-2">
      <SidebarResizeHandle width={width} onResize={onResize} />

      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <span className={`${CAPTION_CLASS} flex-1 text-text-3`}>Features</span>
        {/* Two doors, side by side, split by how much thinking you want
            (decisions.md #12): New talks it through, Quick types it in. */}
        <button
          className={DOOR_CLASS}
          onClick={onQuickChange}
          title="Quick — a change to burn now, or a draft to park. No conversation."
        >
          <span className={DOOR_LABEL_CLASS}>
            <IconBolt size={11} />
            Quick
          </span>
        </button>
        <button
          className={DOOR_CLASS}
          onClick={onNewChat}
          title="New — open a fresh conversation with the project, which turns intent into features"
        >
          <span className={DOOR_LABEL_CLASS}>
            <IconPlus size={11} />
            New
          </span>
        </button>
      </div>

      <ProjectRow
        projectId={projectId}
        active={projectSelected}
        state={talk.state}
        onSelect={onSelectProject}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
        {list.isLoading && (
          <div className="px-2 py-3">
            <DimLine>loading features…</DimLine>
          </div>
        )}
        {list.data && list.data.length === 0 && (
          <div className="px-3 py-4 text-sm leading-relaxed text-text-3">
            No features yet.
            <br />
            Create one to start the pipeline.
          </div>
        )}
        {groups.map((g) => {
          const lane = capLane(g, showAllShipped)
          return (
            <div key={g.key} className="mt-4 first:mt-2">
              <div className="flex items-baseline gap-2 px-2 pb-2">
                <span className={`${CAPTION_CLASS} ${LANE_FG[g.key]}`}>{g.label}</span>
                {/* The lane's true total, capped or not — the count is what the
                    lane HOLDS, and the expander says what it is showing. */}
                <span className="font-mono text-xs text-text-4">{g.features.length}</span>
              </div>
              {lane.visible.map((f) => (
                <FeatureRow
                  key={f.id}
                  f={f}
                  active={f.id === selectedFeatureId}
                  onSelect={onSelect}
                  actions={actionsFor(f)}
                />
              ))}
              {lane.expanderLabel && (
                <button className={EXPANDER_CLASS} onClick={() => setShowAllShipped((v) => !v)}>
                  <span className={EXPANDER_LABEL_CLASS}>{lane.expanderLabel}</span>
                </button>
              )}
            </div>
          )
        })}
        {archivedCount > 0 && (
          <button className={EXPANDER_CLASS} onClick={toggleArchived}>
            <span className={EXPANDER_LABEL_CLASS}>
              {showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
            </span>
          </button>
        )}
      </div>

      {/* Preparation's permanent address (SPEC §14). With features on screen the
          whole-body version would be in the way, so it shrinks to the rail's
          foot — and it stays there once prepared, because a finished preparation
          still has to be findable to be re-run or read. */}
      {prepRow && (
        <button
          className={
            `group ${BUTTON_RESET} flex w-full shrink-0 items-center gap-2 border-0 ` +
            'border-t border-hairline bg-transparent px-4 py-3 text-left text-sm ' +
            'transition-colors duration-(--dur-1) ease-app hover:bg-panel-3'
          }
          onClick={onOpenPreparation}
          title={prepRow.title}
          // The badge is a fragment ("8 to establish"); a screen reader should
          // get the sentence that explains it, not the fragment.
          aria-label={`${prepRow.label} — ${prepRow.title}`}
        >
          {/* Done asks for nothing: a hollow dot reads as a marker, not a nudge. */}
          <span
            className={`size-[7px] shrink-0 rounded-full ${
              prepRow.variant === 'done' ? 'inset-ring-1 inset-ring-text-4' : 'bg-drive'
            }`}
            aria-hidden="true"
          />
          <span
            className={`min-w-0 flex-1 group-hover:text-text ${
              prepRow.variant === 'done' ? 'text-text-4' : 'text-text-3'
            }`}
          >
            {prepRow.label}
          </span>
          {prepRow.badge && (
            <span className="shrink-0 text-xs whitespace-nowrap text-text-4">{prepRow.badge}</span>
          )}
        </button>
      )}

      {pendingDelete && (
        <DeleteFeatureDialog
          title={pendingDelete.feature.title}
          slug={pendingDelete.feature.slug}
          busy={del.isPending}
          onConfirm={() => del.mutate({ featureId: pendingDelete.feature.id })}
          onCancel={() => setPendingDelete(null)}
          returnFocusRef={pendingDelete.returnFocusRef}
        />
      )}
    </nav>
  )
}

/**
 * The rail's drag handle (decision 10). Straddles the rail's right edge so the
 * cursor finds it a pixel or two either side of the hairline.
 *
 * The drag is measured as a delta from where it started rather than from the
 * pointer's absolute position, so it never jumps when the grab lands off-centre.
 * Mouse only this lap. Text selection is suspended while dragging — without it,
 * sweeping across the rail selects every title on the way past.
 */
export function SidebarResizeHandle({
  width,
  onResize,
}: {
  width: number
  onResize: (px: number) => void
}) {
  const [dragging, setDragging] = useState(false)
  // The grab point and the width it started from; read by the move listener.
  const origin = useRef({ x: 0, width })

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) =>
      onResize(clampSidebarWidth(origin.current.width + e.clientX - origin.current.x))
    const onUp = () => setDragging(false)
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.body.style.userSelect = previousUserSelect
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragging, onResize])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the features rail"
      title="Drag to resize"
      className={`absolute top-0 -right-[3px] z-10 h-full w-1.5 cursor-col-resize hover:bg-accent-line ${
        dragging ? 'bg-accent-line' : ''
      }`}
      onMouseDown={(e) => {
        e.preventDefault()
        origin.current = { x: e.clientX, width }
        setDragging(true)
      }}
    />
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
    <div className="shrink-0 border-b border-hairline-soft px-3 pb-3">
      <button
        className={`${BUTTON_RESET} flex w-full items-center gap-2 rounded-md border-0 px-3 py-3 text-left transition-colors duration-(--dur-1) ease-app ${
          active ? 'bg-accent-soft' : 'bg-transparent hover:bg-panel-3'
        }`}
        onClick={onSelect}
        title="Talk to the project — intake, decomposition, and portfolio questions"
      >
        <span className={`flex shrink-0 items-center ${active ? '' : 'opacity-85'}`}>
          <LogoMark size={14} variant="outline" />
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-base font-medium ${active ? 'text-text' : 'text-text-2'}`}
        >
          {project?.name ?? 'This project'}
        </span>
        {state === 'none' ? (
          <span className="shrink-0 text-xs tracking-[0.07em] text-text-3 uppercase">Project</span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-accent-hi">
            <span className="spin-ring" />
            {state === 'launching' ? 'opening' : 'live'}
          </span>
        )}
      </button>
    </div>
  )
}

/** A lane's label colour — the lane's own meaning, said once. */
const LANE_FG: Record<TriageKey, string> = {
  needsYou: 'text-needs',
  agentWorking: 'text-ph-implementation',
  inProgress: 'text-text-3',
  drafts: 'text-text-4',
  shipped: 'text-ph-shipped',
  archived: 'text-text-4',
}

/** The status chip's colour, by what `rowChip` chose to say. */
const CHIP_FG: Record<RowChipKind, string> = {
  needsMe: 'border-needs/35 text-needs',
  working: 'border-accent-line text-accent-hi',
  shipped: 'border-ok/30 text-ok',
  draft: 'border-hairline text-text-4',
  age: 'border-hairline text-text-3',
}

/** The needs-me dot: attention is the one flavour that is a failure, not a queue. */
const NEEDS_DOT_BG: Record<NeedsMeKind, string> = {
  attention: 'bg-danger',
  grill: 'bg-needs',
  burn: 'bg-needs',
  ship: 'bg-needs',
}

/** A pipeline segment's fill, by how far the feature has got past it. */
const MINI_SEG_CLASS = {
  done: 'bg-text-4',
  current: 'bg-accent',
  upcoming: 'border border-hairline-soft bg-panel-3',
} as const

/**
 * One feature, as a roomy two-line row (decision 10). Line 1 is what the feature
 * IS — its phase dot, its title over up to two lines, and the one status chip
 * that says who it is waiting on. Line 2 is where it stands: the six-segment
 * pipeline map and, when the feature has tickets, their progress.
 *
 * The slug is deliberately absent. It used to open line 2 and it is what made
 * five "Flow redesign: …" features indistinguishable — the address bar names it
 * now, the feature header prints it, and the kebab's Copy link hands it over.
 *
 * The chip slot holds exactly one thing and `rowChip` picks it; this renders
 * that decision without making one of its own.
 */
export function FeatureRow({
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
  const draft = f.status === 'draft'
  // Parked ideas dim with shipped history rather than sitting at the brightness
  // of work in motion (decision 9).
  const dimmed = draft || f.status === 'shipped' || f.status === 'archived'

  return (
    <div
      className={`relative mb-0.5 flex items-center rounded-md transition-colors duration-(--dur-1) ease-app ${
        active ? 'bg-accent-soft shadow-[inset_2px_0_0_var(--color-accent)]' : 'hover:bg-panel-3'
      } ${dimmed ? 'opacity-70 hover:opacity-100' : ''}`}
    >
      <button
        className={`${BUTTON_RESET} flex min-w-0 flex-1 items-start gap-2 border-0 bg-transparent px-3 py-3 text-left`}
        onClick={() => onSelect(f.id)}
        title={f.title}
      >
        {/* A draft has no pipeline position, so it wears the parked glyph
            instead of a phase dot — its phase is `ideation` like every new
            feature, and that colour would claim it had started. */}
        {draft ? (
          <span className="mt-1 w-2 shrink-0 text-xs leading-none text-text-4" aria-hidden="true">
            {DRAFT_GLYPH}
          </span>
        ) : (
          <PhaseDot phase={f.phase} className="mt-1.5" />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="flex items-start gap-2">
            <span
              className={`line-clamp-2 min-w-0 flex-1 text-base leading-snug ${
                active ? 'font-medium text-text' : dimmed ? 'text-text-3' : 'font-medium text-text-2'
              }`}
            >
              {f.title}
            </span>
            <span
              className={`mt-px inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-2 py-0.5 text-xs whitespace-nowrap ${CHIP_FG[chip.kind]}`}
              title={chip.title}
            >
              {chip.kind === 'needsMe' && chip.needs && (
                <span className={`size-[7px] rounded-full ${NEEDS_DOT_BG[chip.needs]}`} />
              )}
              {chip.kind === 'working' && <span className="spin-ring" />}
              {chip.kind === 'shipped' && <IconCheck size={10} />}
              {chip.text}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-flex gap-[3px]">
              {segs.map((s, i) => (
                <span
                  key={i}
                  className={`h-1 w-2.5 rounded-[2px] ${MINI_SEG_CLASS[s.state]}`}
                />
              ))}
            </span>
            {progress && <span className="font-mono text-xs text-text-3">{progress}</span>}
          </span>
        </span>
      </button>
      <FeatureActionsMenu actions={actions} />
    </div>
  )
}
