import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { trpc } from '../trpc'
import { cx, IconButton, Kbd, NavItem, Skeleton, SkeletonBar } from '../ui'
import type { StatusTone } from '../ui'
import { useToast } from '../lib/toast'
import type { FeatureListItem, PrepView } from '../lib/api'
import { sidebarLanes } from '../lib/feature-ui'
import { prepRailRow, type ProjectSessionState, type WorkspaceView } from '../lib/project-workspace'
import { pathFor } from '../lib/routes'
import { isStale } from '../lib/prep-findings'
import { useLivePoll, useLiveStatus } from '../lib/live'
import { clampSidebarWidth } from '../lib/sidebar-width'
import { shortcut } from '../lib/platform'
import { SANDBOX_MODE } from '../lib/env'
import { notifyButton, type NotifyState } from '../lib/notifications'
import { useDesktopNotifications } from '../lib/use-notifications'
import { useTheme } from '../lib/theme'
import type { DriveState } from '../lib/workspace'
import type { ProjectNavApi } from '../lib/use-project-nav'
import type { ProjectTalkApi } from '../lib/use-project-talk'
import {
  IconArchive,
  IconClock,
  IconDoc,
  IconGitMerge,
  IconList,
  IconMessage,
  IconPencil,
  IconSearch,
} from '../icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { copyText } from './workspace/copy-text'
import { RailResizeHandle } from './RailResizeHandle'
import type { FeatureAction } from './FeatureActionsMenu'
import { DeleteFeatureDialog } from './DeleteFeatureDialog'
import { ProjectSwitcher } from './ProjectSwitcher'
import { CollapseSidebarButton } from './Frame'
import {
  DriveCard,
  OrchestratorCard,
  PrepRow,
  Shelf,
  SidebarFeatureRow,
  SidebarGrain,
  SidebarStatusLine,
  WorkingShelf,
} from './SidebarParts'

/**
 * localStorage key for whether the Archived shelf starts open — the old
 * show-archived toggle (decision #8), kept so the choice carries over.
 */
const SHOW_ARCHIVED_KEY = 'runcastle.sidebar.showArchived'

function readShowArchived(): boolean {
  try {
    return localStorage.getItem(SHOW_ARCHIVED_KEY) === '1'
  } catch {
    return false
  }
}

export interface SidebarProps {
  projectId: string
  nav: ProjectNavApi
  /** Which surface owns the panel — decides which nav row is current. */
  view: WorkspaceView
  selectedFeatureId: string | null
  talk: ProjectTalkApi
  onSelect: (featureId: string | null) => void
  /** The project home (its conversations, notes and drive). */
  onSelectProject: () => void
  /** New — open the project home on a fresh conversation. */
  onNewChat: () => void
  /** Draft — open the overlay that parks an idea without cutting anything. */
  onDraft: () => void
  onOpenPreparation: () => void
  /** Open note capture — the discoverable half of ⌘/Ctrl+J. */
  onOpenNote?: () => void
  onOpenCmdk?: () => void
  onOpenSettings?: () => void
  /** The branch this project's live project drive is driving, or null. */
  projectDriveBranch?: string | null
  onOpenProjectDrive?: () => void
  /** The feature test drive this shell started, or null. */
  driving?: DriveState | null
  onDriveChange?: (d: DriveState | null) => void
}

/**
 * Settled shelves (Shipped, Archived) read most recently moved first, so the
 * ages their rows show run in order — the server's list order is not that.
 */
function byLastMoved(features: FeatureListItem[]): FeatureListItem[] {
  return [...features].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}

/** The Orchestrator card's second line while the project chat is not waiting on you. */
const TALK_WORDS: Record<ProjectSessionState, string> = {
  live: 'Chat open',
  launching: 'Starting chat…',
  none: 'Plan, cut and ask',
}

/**
 * The project sidebar (DESIGN.md §Frame, "The project sidebar") on the canvas,
 * composed from the pieces in `SidebarParts` the way /preview/sidebar.html does:
 *
 * - head — the project switcher, Search (⌘/Ctrl K), a Create menu (New chat ·
 *   Add to backlog · Jot a note) and the collapse button, over the film grain;
 * - the Orchestrator card — the project's own door, its chat;
 * - what needs you, unheaded: preparation while it is owed, the features
 *   waiting on you, then the ones in progress (nothing running, nothing asked);
 * - the Working shelf, its rows in the bay;
 * - the shelves: Up next (open), then folded Backlog, Shipped (five, then
 *   "Show N more"), Archived;
 * - foot — live drives as cards, then the icon-only status line.
 *
 * Every feature row is two lines; its menu is a hover "…" or a right-click.
 * The slug is not on the row: it is in the URL and the feature page, and the
 * row menu's Copy link hands over that URL. Polls `feature.list` at 1.5s.
 */
export function Sidebar(props: SidebarProps) {
  const {
    projectId,
    nav,
    view,
    selectedFeatureId,
    talk,
    onSelect,
    onSelectProject,
    onNewChat,
    onDraft,
    onOpenPreparation,
    onOpenNote,
    onOpenCmdk,
  } = props
  const utils = trpc.useUtils()
  const toast = useToast()
  const [archivedOpen, setArchivedOpen] = useState(readShowArchived)
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
  // No interval of its own: every write to the pile emits a project event, and
  // the stream invalidates this key with the rest (lib/live.ts).
  const openNotes = trpc.projectNotes.openCount.useQuery({ projectId }).data ?? 0
  const features = list.data ?? []
  const { inbox, lanes } = sidebarLanes(features)
  const lane = (key: string) => lanes.find((g) => g.key === key)?.features ?? []
  const inProgress = lane('inProgress')
  const working = lane('agentWorking')
  // The Archived shelf counts its features while folded, so they are read
  // whether or not it is open — `sidebarLanes` leaves them out.
  const archived = features.filter((f) => f.status === 'archived')

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
      // If the deleted feature was open, clear its persisted selection before
      // opening the project home. Keeping either reference strands this render
      // (or the next reload) on a feature that no longer exists.
      if (vars.featureId === selectedFeatureId) {
        onSelect(null)
        onSelectProject()
      }
      setPendingDelete(null)
    },
    onError: (e) => toast.push(e.message),
  })

  const onArchivedOpenChange = (open: boolean) => {
    setArchivedOpen(open)
    try {
      localStorage.setItem(SHOW_ARCHIVED_KEY, open ? '1' : '0')
    } catch {
      // localStorage unavailable (private mode) — the shelf still opens in-session
    }
  }

  const actionsFor = (f: FeatureListItem): FeatureAction[] => {
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
    // A draft is never offered Archive (decision 8): the server refuses it, and
    // a draft IS the shelf — Delete below covers the ideas that die on it.
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

  const row = (f: FeatureListItem, nested = false) => (
    <SidebarFeatureRow
      key={f.id}
      f={f}
      active={f.id === selectedFeatureId && view === 'feature'}
      onSelect={onSelect}
      actions={actionsFor(f)}
      nested={nested}
    />
  )

  const projectName = nav.currentProject?.name ?? 'This project'
  // The project chat stopped for an answer: the same turn state a feature's
  // live session carries (decisions §3).
  const talkWaiting = talk.state === 'live' && !!talk.session?.awaitingInput
  const notesWords = openNotes > 0 ? ` · ${openNotes} note${openNotes === 1 ? '' : 's'}` : ''
  const orchestratorActions: FeatureAction[] =
    prepRow?.variant === 'done'
      ? [
          {
            key: 'reprepare',
            label: prepRow.badge ? `Re-prepare the project (${prepRow.badge})` : 'Re-prepare the project',
            hint: prepRow.title,
            onSelect: onOpenPreparation,
          },
        ]
      : []

  const owesPrep = prepRow?.variant === 'todo'
  const nothingInMotion = features.length > 0 && !owesPrep && inbox.length + inProgress.length + working.length === 0

  return (
    <nav aria-label="Project" className="relative isolate flex h-full min-h-0 flex-col p-2">
      <SidebarGrain />
      <div className="flex h-10 shrink-0 items-center gap-0.5">
        <div className="flex min-w-0 flex-1">
          <ProjectSwitcher nav={nav} />
        </div>
        <IconButton
          label="Search or jump to"
          kbd={shortcut('K')}
          size="sm"
          icon={<IconSearch />}
          tooltipSide="bottom"
          onClick={onOpenCmdk}
        />
        <CreateMenu onNewChat={onNewChat} onDraft={onDraft} onOpenNote={onOpenNote} />
        <CollapseSidebarButton />
      </div>

      <div className="mt-3">
        {/* The project's own door (decision 20): not a feature, never in a
            lane. It says what the chat holds — the open notes (project-notes
            decisions #10) — and waits amber while the chat waits on you. */}
        <OrchestratorCard
          status={`${talkWaiting ? 'Waiting on you' : TALK_WORDS[talk.state]}${notesWords}`}
          waiting={talkWaiting}
          active={view === 'project'}
          onOpen={onSelectProject}
          actions={orchestratorActions}
          title={
            openNotes > 0
              ? `${projectName} — ${openNotes} open note${openNotes === 1 ? '' : 's'}`
              : 'Talk to the project — intake, decomposition, and portfolio questions'
          }
        />
      </div>

      <div className="-mx-2 mt-4 flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-2 pt-px pb-2 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin]">
        {list.isLoading && <FeatureRowsSkeleton />}
        {nothingInMotion && <NavItem tone="quiet" label="Nothing in motion" />}
        {(owesPrep || inbox.length + inProgress.length > 0) && (
          <section aria-label="Needs you" className="flex flex-col gap-1">
            {/* Preparation while it is owed is the first thing asked of you;
                once done it moves into the Orchestrator's menu. */}
            {owesPrep && (
              <PrepRow
                label={prepRow.label}
                badge={prepRow.badge}
                title={prepRow.title}
                active={view === 'prepare'}
                onClick={onOpenPreparation}
              />
            )}
            {inbox.map((f) => row(f))}
            {inProgress.map((f) => row(f))}
          </section>
        )}
        {/* Below what is asked of you: on a new project "Prepare this project"
            comes first, then this. */}
        {list.data && list.data.length === 0 && (
          <div className="px-2.5 py-2 text-xs text-pretty text-text-tertiary">
            No features yet. Start a chat to cut the first one.
          </div>
        )}
        <WorkingShelf features={working} renderRow={row} />
        <div className="flex flex-col divide-y divide-border-subtle">
          {/* After live work, before the backlog (waiting-is-not-backlog
              decision 16); open, because what is in it is wanted. */}
          <Shelf
            icon={<IconClock />}
            label="Up next"
            features={lane('upNext')}
            renderRow={(f) => row(f)}
            defaultOpen
          />
          <Shelf icon={<IconList />} label="Backlog" features={lane('drafts')} renderRow={(f) => row(f)} />
          <Shelf
            icon={<IconGitMerge />}
            label="Shipped"
            features={byLastMoved(lane('shipped'))}
            renderRow={(f) => row(f)}
            cap={5}
          />
          <Shelf
            icon={<IconArchive />}
            label="Archived"
            features={byLastMoved(archived)}
            renderRow={(f) => row(f)}
            open={archivedOpen}
            onOpenChange={onArchivedOpenChange}
          />
        </div>
      </div>

      <SidebarFoot {...props} />

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
 * The Create menu beside the switcher — the three doors onto new work, split
 * by whether it starts now (decisions.md #12): New chat is where work is born,
 * the backlog is where an idea is parked, and a note is a thing you noticed.
 */
export function CreateMenu({
  onNewChat,
  onDraft,
  onOpenNote,
}: {
  onNewChat: () => void
  onDraft: () => void
  onOpenNote?: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Create" size="sm" icon={<IconPencil />} tooltipSide="bottom" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <CreateItem
          icon={<IconMessage />}
          label="New chat"
          hint="A conversation with the feature's agent — it plans the work, builds it and runs rounds when you say yes"
          onSelect={onNewChat}
        />
        <CreateItem
          icon={<IconDoc />}
          label="Add to backlog"
          hint="Write an idea down now, work it out later"
          onSelect={onDraft}
        />
        {onOpenNote && (
          <CreateItem
            icon={<IconPencil />}
            label="Jot a note"
            hint="What you just noticed — triage it later"
            kbd={shortcut('J')}
            onSelect={onOpenNote}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CreateItem({
  icon,
  label,
  hint,
  kbd,
  onSelect,
}: {
  icon: ReactNode
  label: string
  hint: string
  kbd?: string
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem className="items-start py-1.5 [&>svg]:mt-0.5" icon={icon} onSelect={onSelect}>
      <span className="min-w-0 flex-1">
        <span className="block">{label}</span>
        <span className="block text-xs text-pretty text-text-tertiary">{hint}</span>
      </span>
      {kbd && <Kbd className="mt-0.5">{kbd}</Kbd>}
    </DropdownMenuItem>
  )
}

/** The features rail's drag handle — its own clamp and label on the shared handle. */
export function SidebarResizeHandle({
  width,
  onResize,
}: {
  width: number
  onResize: (px: number) => void
}) {
  return (
    <RailResizeHandle
      width={width}
      side="left"
      label="Resize the sidebar"
      clamp={clampSidebarWidth}
      onResize={onResize}
    />
  )
}

/** Label widths for the placeholder feature rows. */
const SKELETON_ROW_WIDTHS = ['w-32', 'w-24', 'w-36', 'w-28'] as const

/**
 * The feature list while its first read is in flight: a few rows on
 * {@link SidebarFeatureRow}'s metrics — the ~52px two-line row, the title over
 * a shorter state line — so the real list lands where the bars were.
 */
export function FeatureRowsSkeleton() {
  return (
    <Skeleton label="Loading features…">
      <div className="flex flex-col gap-1">
        {SKELETON_ROW_WIDTHS.map((width, i) => (
          <div
            key={i}
            className="flex h-13 flex-col justify-center gap-2 rounded-lg px-2.5"
            data-skeleton="feature-row"
          >
            <SkeletonBar className={cx('h-2.5', width)} />
            <SkeletonBar className="h-2 w-16" />
          </div>
        ))}
      </div>
    </Skeleton>
  )
}

// ---------------------------------------------------------------------------
// Foot
// ---------------------------------------------------------------------------

/** Where this page's tRPC calls go — the links are same-origin `/api/trpc`. */
function apiOrigin(): string {
  return typeof window === 'undefined' ? 'this machine' : window.location.origin
}

/** The frame's one health reading: the server, and the stream from it. */
export type FrameHealth = 'connecting' | 'ok' | 'reconnecting' | 'down'

const HEALTH_TONE: Record<FrameHealth, StatusTone> = {
  // Before the first answer nothing is known — never "down" on a cold load.
  connecting: 'neutral',
  ok: 'success',
  reconnecting: 'warning',
  down: 'danger',
}

export interface SidebarFootState {
  health: FrameHealth
  /** The origin the API calls go to, for the health tooltip. */
  origin: string
  sandbox: string
  /** `null` when the browser has no Notification API to toggle. */
  notify: { state: NotifyState; title: string; onToggle: () => void } | null
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenSettings?: () => void
  /** Rows above the status line (live drives). */
  rows?: ReactNode
}

/**
 * The foot as markup, with every query already resolved to a value — the seam
 * the rendered-chrome tests observe it at (apps/web/STYLE.md, tier 1). Shared
 * by the project sidebar and the portfolio home's: the rows it is handed, then
 * the icon-only status line, the health in words in its tooltip.
 */
export function SidebarFootChrome({
  health,
  origin,
  sandbox,
  notify,
  theme,
  onToggleTheme,
  onOpenSettings,
  rows,
}: SidebarFootState) {
  const healthTip =
    health === 'ok'
      ? `Server ok — live updates streaming from ${origin}/api`
      : health === 'connecting'
        ? `Connecting to the runcastle API at ${origin}/api`
      : health === 'reconnecting'
        ? 'Live updates paused — reconnecting, and polling meanwhile'
        : `The runcastle API at ${origin}/api is not answering`
  return (
    <div className="flex shrink-0 flex-col gap-2 pt-2">
      {rows}
      <SidebarStatusLine
        healthTone={HEALTH_TONE[health]}
        healthTip={healthTip}
        sandbox={sandbox}
        notify={notify}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onOpenSettings={onOpenSettings}
      />
    </div>
  )
}

/**
 * The project sidebar's foot: what the status bar and the titlebar's pills used
 * to say. A live drive (the project's, or a feature's this shell started) stays
 * in view on every in-project screen, as a card naming what it drives.
 */
function SidebarFoot({
  projectId,
  onSelect,
  onOpenSettings,
  projectDriveBranch = null,
  onOpenProjectDrive,
  driving = null,
  onDriveChange,
}: SidebarProps) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const live = useLiveStatus()
  const theme = useTheme()
  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const healthy = !list.isError && list.data !== undefined
  const notify = useDesktopNotifications(projectId, list.data ?? [])
  const notifyState = notifyButton(notify)

  const stopDrive = trpc.feature.testDrive.useMutation({
    onSuccess: () => {
      onDriveChange?.(null)
      if (driving) utils.feature.get.invalidate({ id: driving.featureId })
      utils.feature.list.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })

  const drivenTitle = driving ? list.data?.find((f) => f.id === driving.featureId)?.title : undefined

  const rows = (
    <>
      {projectDriveBranch !== null && (
        <DriveCard
          label="Project drive"
          detail={<span className="font-mono">{projectDriveBranch}</span>}
          title={`A project drive is live on ${projectDriveBranch} — back to it`}
          onOpen={onOpenProjectDrive}
        />
      )}
      {driving && (
        <DriveCard
          label="Test drive"
          detail={drivenTitle ?? <span className="font-mono">{driving.branch}</span>}
          title={`Driving ${driving.branch} — back to its feature`}
          onOpen={() => onSelect(driving.featureId)}
          onStop={() => stopDrive.mutate({ featureId: driving.featureId, action: 'stop' })}
          stopping={stopDrive.isPending}
        />
      )}
    </>
  )

  return (
    <SidebarFootChrome
      health={
        list.isError ? 'down' : !healthy ? 'connecting' : live === 'live' ? 'ok' : live === 'connecting' ? 'connecting' : 'reconnecting'
      }
      origin={apiOrigin()}
      sandbox={SANDBOX_MODE}
      notify={notify.supported ? { ...notifyState, onToggle: notify.toggle } : null}
      theme={theme.resolved}
      onToggleTheme={theme.toggle}
      onOpenSettings={onOpenSettings}
      rows={rows}
    />
  )
}

