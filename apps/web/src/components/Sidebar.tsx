import { useState } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from 'react'
import { trpc } from '../trpc'
import { cx, IconButton, Kbd, NavItem, SectionLabel, StatusDot, Tooltip } from '../ui'
import type { StatusTone } from '../ui'
import { useToast } from '../lib/toast'
import type { FeatureListItem, PrepView } from '../lib/api'
import {
  capLane,
  needsMe,
  ticketProgress,
  triage,
  triageOf,
} from '../lib/feature-ui'
import { prepRailRow, type WorkspaceView } from '../lib/project-workspace'
import { pathFor } from '../lib/routes'
import { isStale } from '../lib/prep-findings'
import { useLivePoll, useLiveStatus } from '../lib/live'
import { clampSidebarWidth } from '../lib/sidebar-width'
import { projectStats, runsElsewhere } from '../lib/projects'
import { modKey, shortcut } from '../lib/platform'
import { SANDBOX_MODE } from '../lib/env'
import { notifyButton, type NotifyState } from '../lib/notifications'
import { useDesktopNotifications } from '../lib/use-notifications'
import { useTheme } from '../lib/theme'
import type { DriveState } from '../lib/workspace'
import type { ProjectNavApi } from '../lib/use-project-nav'
import type { ProjectTalkApi } from '../lib/use-project-talk'
import {
  IconActivity,
  IconBell,
  IconBellOff,
  IconCube,
  IconDoc,
  IconHome,
  IconMessage,
  IconMoon,
  IconPencil,
  IconPlay,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShield,
  IconStop,
  IconSun,
  IconUndo,
} from '../icons'
import type { PhaseIconPhase } from '../icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { copyText } from './workspace/copy-text'
import { RailResizeHandle } from './RailResizeHandle'
import { FeatureActionsMenu, type FeatureAction } from './FeatureActionsMenu'
import { DeleteFeatureDialog } from './DeleteFeatureDialog'
import { ProjectSwitcher } from './ProjectSwitcher'
import { CollapseSidebarButton } from './Frame'

/** localStorage key for the sidebar's show-archived toggle (decision #8). */
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
 * The project sidebar (DESIGN.md §Frame) on the canvas:
 *
 * - head — the project switcher, a Create menu (New chat · Draft · Jot a note)
 *   and the collapse button; then the search launcher (⌘/Ctrl K);
 * - nav — the project's own places (its home, preparation while it is owed);
 * - the features, grouped by who is blocked — Needs you · Agent working · In
 *   progress · Drafts · Shipped (capped, "Show all") — as one-line rows: phase
 *   glyph, title, a live or needs-you dot, ticket progress. The row's menu is a
 *   hover "…" or a right-click;
 * - foot — live drives, runs elsewhere, re-prepare, then one row of status and
 *   chrome: server, sandbox, notifications, theme, settings.
 *
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
  const [showArchived, setShowArchived] = useState(readShowArchived)
  // The Shipped lane's expander (decisions §2). Not persisted: it is a glance at
  // a lane, not a standing choice about the rail.
  const [showAllShipped, setShowAllShipped] = useState(false)
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

  const projectName = nav.currentProject?.name ?? 'This project'
  const talkLive = talk.state !== 'none'

  return (
    <nav aria-label="Project" className="flex h-full min-h-0 flex-col p-2">
      <div className="flex h-9 shrink-0 items-center gap-0.5">
        <div className="flex min-w-0 flex-1">
          <ProjectSwitcher nav={nav} />
        </div>
        <CreateMenu onNewChat={onNewChat} onDraft={onDraft} onOpenNote={onOpenNote} />
        <CollapseSidebarButton />
      </div>

      <div className="shrink-0 pt-1 pb-2">
        <SearchLauncher onOpen={onOpenCmdk} />
      </div>

      <div className="flex shrink-0 flex-col gap-px">
        {/* The project's own door (decision 20): not a feature, never in a
            lane. It carries the open-note count (project-notes decisions #10)
            and a live dot while the project conversation is up. */}
        <NavItem
          icon={<IconHome />}
          label="Project"
          active={view === 'project'}
          onClick={onSelectProject}
          dot={talkLive ? 'live' : undefined}
          meta={
            openNotes > 0 ? (
              <span title={`${openNotes} note${openNotes === 1 ? '' : 's'} waiting to be triaged`}>
                {openNotes}
              </span>
            ) : undefined
          }
          title={
            openNotes > 0
              ? `${projectName} — ${openNotes} open note${openNotes === 1 ? '' : 's'}`
              : 'Talk to the project — intake, decomposition, and portfolio questions'
          }
        />
        {/* Preparation while it is owed is a place to go, so it sits with the
            nav; once done it drops to the foot as "Re-prepare". */}
        {prepRow?.variant === 'todo' && (
          <NavItem
            icon={<IconShield />}
            label={prepRow.label}
            meta={prepRow.badge ?? undefined}
            dot="warning"
            active={view === 'prepare'}
            onClick={onOpenPreparation}
            title={prepRow.title}
          />
        )}
      </div>

      <div className="-mx-2 mt-3 min-h-0 flex-1 overflow-y-auto px-2">
        {list.isLoading && (
          <div className="px-2.5 py-2 text-xs text-text-tertiary">Loading features…</div>
        )}
        {list.data && list.data.length === 0 && (
          <div className="px-2.5 py-2 text-xs text-pretty text-text-tertiary">
            No features yet. Start a chat to cut the first one.
          </div>
        )}
        {groups.map((g) => {
          const lane = capLane(g, showAllShipped)
          return (
            <section key={g.key} aria-label={g.label} className="mb-3 flex flex-col gap-px">
              {/* The lane's true total, capped or not — the count is what the
                  lane HOLDS, and the expander says what it is showing. */}
              <SectionLabel count={g.features.length} className="px-2.5">
                {g.label}
              </SectionLabel>
              {lane.visible.map((f) => (
                <FeatureRow
                  key={f.id}
                  f={f}
                  active={f.id === selectedFeatureId && view === 'feature'}
                  onSelect={onSelect}
                  actions={actionsFor(f)}
                />
              ))}
              {lane.expanderLabel && (
                <QuietRow onClick={() => setShowAllShipped((v) => !v)}>{lane.expanderLabel}</QuietRow>
              )}
            </section>
          )
        })}
        {archivedCount > 0 && (
          <QuietRow onClick={toggleArchived}>
            {showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
          </QuietRow>
        )}
      </div>

      <SidebarFoot {...props} prepRow={prepRow} />

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
 * Draft is where an idea is parked, and a note is a thing you noticed.
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
          hint="Features and quick changes alike — a conversation that cuts burn-ready tickets"
          onSelect={onNewChat}
        />
        <CreateItem
          icon={<IconDoc />}
          label="Draft an idea"
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

/**
 * The search launcher: looks like a search field, opens the command palette.
 * The hint is ⌘K on a Mac and Ctrl K everywhere else (findings F17.4).
 */
export function SearchLauncher({ onOpen }: { onOpen?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Search or jump to"
      className={cx(
        'flex h-(--control-h) w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-surface-inset pr-1.5 pl-2.5',
        'text-left text-sm text-text-tertiary transition-colors duration-(--dur-1) ease-app',
        'hover:border-border-strong hover:text-text-secondary',
      )}
    >
      <IconSearch size={14} className="shrink-0 text-icon" />
      <span className="min-w-0 flex-1 truncate">Search</span>
      <Kbd>{modKey()}</Kbd>
    </button>
  )
}

/** A quiet tertiary row — "Show all (N)", "Show archived (N)" — lined up under the labels. */
function QuietRow({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex h-7 w-full shrink-0 cursor-pointer items-center rounded-md border-0 bg-transparent pr-3 pl-8.5',
        'text-left text-xs text-text-tertiary transition-colors duration-(--dur-1) ease-app',
        'hover:bg-surface-hover hover:text-text-secondary',
      )}
    >
      {children}
    </button>
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

/** The glyph a row wears: its phase, or the draft ring for a parked idea. */
function rowPhase(f: FeatureListItem): PhaseIconPhase {
  if (f.status === 'draft') return 'draft'
  return f.phase
}

/**
 * The row's one trailing dot: an agent at work breathes; something waiting on
 * me is amber — red when it is a failure rather than a queue.
 */
function rowDot(f: FeatureListItem): StatusTone | undefined {
  const lane = triageOf(f)
  if (lane === 'agentWorking') return 'live'
  if (lane === 'needsYou') return needsMe(f)?.kind === 'attention' ? 'danger' : 'warning'
  return undefined
}

/** Why the dot is there, for the row's tooltip. */
function rowReason(f: FeatureListItem): string | null {
  const lane = triageOf(f)
  if (lane === 'agentWorking') return 'agent working'
  if (lane === 'needsYou') return needsMe(f)?.label ?? 'needs you'
  return null
}

/**
 * Open a row's "…" menu from a right-click. The menu is the row's own
 * `FeatureActionsMenu`, anchored on its (hover-revealed) trigger — a Radix
 * dropdown opens on the pointer-down, so that is what is sent to it.
 */
function openRowMenu(e: ReactMouseEvent<HTMLDivElement>): void {
  const trigger = e.currentTarget.querySelector<HTMLElement>('[aria-haspopup="menu"]')
  if (!trigger) return
  e.preventDefault()
  trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
}

/**
 * One feature, as a one-line sidebar row (DESIGN.md: no two-line rows, no
 * progress bars, no per-row check buttons, no "…" at rest). The phase glyph
 * says where it is; one dot says whether it is moving or waiting on you; the
 * meta is its ticket progress. Selected is `surface-selected`, nothing else.
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
  const reason = rowReason(f)
  return (
    <NavItem
      phase={rowPhase(f)}
      label={f.title}
      title={reason ? `${f.title} — ${reason}` : f.title}
      dot={rowDot(f)}
      // Shipped work is all landed by definition — its fraction would be noise.
      meta={f.status === 'shipped' ? undefined : (ticketProgress(f) ?? undefined)}
      active={active}
      onClick={() => onSelect(f.id)}
      actions={actions.length > 0 ? <FeatureActionsMenu actions={actions} /> : undefined}
      onContextMenu={actions.length > 0 ? openRowMenu : undefined}
    />
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
export type FrameHealth = 'ok' | 'reconnecting' | 'down'

const HEALTH: Record<FrameHealth, { tone: StatusTone; word: string }> = {
  ok: { tone: 'success', word: 'Server' },
  reconnecting: { tone: 'warning', word: 'Reconnecting' },
  down: { tone: 'danger', word: 'Server down' },
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
  /** Rows above the status line (drives, runs elsewhere, re-prepare). */
  rows?: ReactNode
}

const NOTIFY_LABEL: Record<NotifyState, string> = {
  on: 'Notifications on — turn off',
  off: 'Notifications off — turn on',
  blocked: 'Notifications blocked by the browser',
}

/**
 * The foot as markup, with every query already resolved to a value — the seam
 * the rendered-chrome tests observe it at (apps/web/STYLE.md, tier 1). Shared
 * by the project sidebar and the portfolio home's.
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
  const h = HEALTH[health]
  const healthTip =
    health === 'ok'
      ? `Server ok — live updates streaming from ${origin}/api`
      : health === 'reconnecting'
        ? 'Live updates paused — reconnecting, and polling meanwhile'
        : `The runcastle API at ${origin}/api is not answering`
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <div className="flex shrink-0 flex-col gap-px pt-2">
      {rows}
      <div className="flex h-8 items-center gap-3 pl-2.5 text-xs text-text-tertiary">
        <Tooltip label={healthTip}>
          <span tabIndex={0} className="inline-flex items-center gap-1.5 rounded-sm" data-health={health}>
            <StatusDot tone={h.tone} />
            {h.word}
          </span>
        </Tooltip>
        <Tooltip label={`Agent sessions run sandboxed via ${sandbox}`}>
          <span tabIndex={0} className="inline-flex items-center gap-1.5 rounded-sm">
            <IconCube size={14} className="text-icon" />
            {sandbox}
          </span>
        </Tooltip>
        <span className="flex-1" />
        <span className="flex items-center">
          {notify && (
            <IconButton
              size="sm"
              label={notify.state === 'blocked' ? notify.title : NOTIFY_LABEL[notify.state]}
              icon={notify.state === 'on' ? <IconBell /> : <IconBellOff />}
              active={notify.state === 'on'}
              onClick={notify.onToggle}
            />
          )}
          <IconButton
            size="sm"
            label={`Switch to ${next} theme`}
            icon={theme === 'dark' ? <IconSun /> : <IconMoon />}
            onClick={onToggleTheme}
          />
          {onOpenSettings && (
            <IconButton size="sm" label="Settings" icon={<IconSettings />} onClick={onOpenSettings} />
          )}
        </span>
      </div>
    </div>
  )
}

/**
 * The project sidebar's foot: what the status bar and the titlebar's pills used
 * to say. A live drive (the project's, or a feature's this shell started) stays
 * in view on every in-project screen; runs in OTHER projects are counted (this
 * project's are itemised by name in the Agent working lane — decision 7);
 * re-prepare stays findable once preparation is done.
 */
function SidebarFoot({
  projectId,
  nav,
  view,
  onSelect,
  onOpenSettings,
  onOpenPreparation,
  projectDriveBranch = null,
  onOpenProjectDrive,
  driving = null,
  onDriveChange,
  prepRow,
}: SidebarProps & { prepRow: ReturnType<typeof prepRailRow> }) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const poll = useLivePoll()
  const live = useLiveStatus()
  const theme = useTheme()
  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: poll })
  const healthy = !list.isError && list.data !== undefined
  const notify = useDesktopNotifications(projectId, list.data ?? [])
  const notifyState = notifyButton(notify)

  const projects = nav.projects ?? []
  const featureQueries = trpc.useQueries((t) =>
    projects.map((p) => t.feature.list({ projectId: p.id }, { refetchInterval: poll })),
  )
  const elsewhere = runsElsewhere(
    projects.map((p, i) => ({ projectId: p.id, ...projectStats(featureQueries[i]?.data ?? []) })),
    nav.currentProjectId,
  )

  const stopDrive = trpc.feature.testDrive.useMutation({
    onSuccess: () => {
      onDriveChange?.(null)
      if (driving) utils.feature.get.invalidate({ id: driving.featureId })
      utils.feature.list.invalidate()
    },
    onError: (e) => toast.push(e.message),
  })

  const rows = (
    <>
      {projectDriveBranch !== null && (
        <NavItem
          icon={<IconPlay />}
          label="Project drive"
          meta={<span className="font-mono">{projectDriveBranch}</span>}
          dot="live"
          onClick={onOpenProjectDrive}
          title={`A project drive is live on ${projectDriveBranch} — back to it`}
        />
      )}
      {driving && (
        <NavItem
          icon={<IconPlay />}
          label="Test drive"
          meta={<span className="font-mono">{driving.branch}</span>}
          dot="live"
          onClick={() => onSelect(driving.featureId)}
          title={`Driving ${driving.branch} — back to its feature`}
          actions={
            <IconButton
              size="sm"
              label="Stop the test drive"
              icon={<IconStop />}
              disabled={stopDrive.isPending}
              onClick={() => stopDrive.mutate({ featureId: driving.featureId, action: 'stop' })}
            />
          }
        />
      )}
      {elsewhere > 0 && (
        <NavItem
          icon={<IconActivity />}
          label={`${elsewhere} running elsewhere`}
          dot="live"
          onClick={nav.goHome}
          title="Runs in flight in other projects — open all projects"
        />
      )}
      {prepRow?.variant === 'done' && (
        <NavItem
          icon={<IconUndo />}
          label="Re-prepare project"
          meta={prepRow.badge ?? undefined}
          active={view === 'prepare'}
          onClick={onOpenPreparation}
          title={prepRow.title}
        />
      )}
    </>
  )

  return (
    <SidebarFootChrome
      health={!healthy ? 'down' : live === 'live' ? 'ok' : 'reconnecting'}
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

/** The collapsed rail's one-icon doors: search and create. */
export function SidebarRail({ onOpenCmdk, onNewChat }: { onOpenCmdk: () => void; onNewChat: () => void }) {
  return (
    <>
      <IconButton label="Search" kbd={modKey()} icon={<IconSearch />} tooltipSide="right" onClick={onOpenCmdk} />
      <IconButton label="New chat" icon={<IconPlus />} tooltipSide="right" onClick={onNewChat} />
    </>
  )
}
