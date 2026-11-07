import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { trpc } from '../trpc'
import { cx, IconButton, Kbd, NavItem, Skeleton, SkeletonBar } from '../ui'
import type { StatusTone } from '../ui'
import { useToast } from '../lib/toast'
import type { FeatureListItem } from '../lib/api'
import { sidebarLanes } from '../lib/feature-ui'
import type { WorkspaceView } from '../lib/project-workspace'
import { pathFor } from '../lib/routes'
import { useLivePoll, useLiveStatus } from '../lib/live'
import { clampSidebarWidth } from '../lib/sidebar-width'
import { shortcut } from '../lib/platform'
import { SANDBOX_MODE } from '../lib/env'
import { notifyButton, type NotifyState } from '../lib/notifications'
import { useDesktopNotifications } from '../lib/use-notifications'
import { useTheme } from '../lib/theme'
import { useIsPhone } from '../lib/use-phone'
import type { DriveState } from '../lib/workspace'
import type { ProjectNavApi } from '../lib/use-project-nav'
import type { ThreadEntry, ThreadState } from '../lib/chat-thread'
import { foldKey, heldFeatures, sidebarThreadOrder, threadIsActive, useFoldedThreads, useSidebarThreads } from '../lib/sidebar-threads'
import { FeatureSidebar } from './workers/FeatureSidebar'
import { useThreadActions } from '../lib/use-thread'
import { UNSTARTED_CHAT } from '../lib/chat-sessions'
import {
  IconArchive,
  IconClock,
  IconDoc,
  IconGitMerge,
  IconList,
  IconMessage,
  IconPencil,
  IconSearch,
  IconX,
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
import { useOpenGlossary } from './GlossaryDialog'
import { CollapseSidebarButton } from './Frame'
import { ComputerUnreachable, PhoneListHead } from './phone/PhoneListHead'
import { PhoneNotificationsRow } from './phone/PhoneNotificationsRow'
import {
  DriveCard,
  FeatureProgressIcon,
  HoldMark,
  HoldTip,
  OrchestratorCard,
  Shelf,
  SidebarFeatureRow,
  SidebarBackdrop,
  SidebarStatusLine,
  SidebarThreadList,
  WorkingShelf,
} from './SidebarParts'
import { RenameThreadDialog } from './chat/thread/RenameThreadDialog'

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
  onSelect: (featureId: string | null) => void
  /** The Orchestrator: the project's latest chat. */
  onSelectProject: () => void
  /** New — open the Orchestrator on a fresh conversation. */
  onNewChat: () => void
  /** Draft — open the overlay that parks an idea without cutting anything. */
  onDraft: () => void
  /** Open note capture — the discoverable half of ⌘/Ctrl+J. */
  onOpenNote?: () => void
  onOpenCmdk?: () => void
  onOpenSettings?: () => void
  /** Settings → General at "On your phone": the help menu's phone entry. */
  onOpenPhoneSetup?: () => void
  /** The branch this project's live project drive is driving, or null. */
  projectDriveBranch?: string | null
  onOpenProjectDrive?: () => void
  /** The feature drive's card: back to that drive's page. */
  onOpenFeatureDrive?: (featureId: string) => void
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

/** The Orchestrator card's second line: its chats' state, in the words every thread list uses. */
const CHATS_WORDS: Record<ThreadState, string> = {
  waiting: 'Waiting for you',
  working: 'Working',
  idle: 'Plan, cut and ask',
}

/**
 * The project's chats as one state (decision 14): waiting if any waits on you,
 * else working if any works, else idle. An empty new thread is idle — nothing
 * starts until something is sent.
 */
function chatsState(threads: readonly { state: ThreadState }[]): ThreadState {
  if (threads.some((t) => t.state === 'waiting')) return 'waiting'
  return threads.some((t) => t.state === 'working') ? 'working' : 'idle'
}

/**
 * The Orchestrator card's hover text: what the project chat is, and the warning
 * the retired Orchestrator setting used to carry (`one-orchestrator-no-mode`
 * decision 1).
 */
export const ORCHESTRATOR_TITLE =
  "Your project's orchestrator: it plans, starts, messages and merges features when you ask, and edits this repo and runs commands without asking."

/**
 * The project sidebar (DESIGN.md §Frame, "The project sidebar") on the canvas,
 * composed from the pieces in `SidebarParts` the way /preview/sidebar.html does:
 *
 * - head — the project switcher, Search (⌘/Ctrl K), a Create menu (New chat ·
 *   Add to backlog · Jot a note) and the collapse button, over the halftone;
 * - the Orchestrator card — the project's own door, its chat;
 * - what needs you, unheaded: the features waiting on you, then the ones in
 *   progress (nothing running, nothing asked);
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
    onSelect,
    onSelectProject,
    onNewChat,
    onDraft,
    onOpenNote,
    onOpenCmdk,
  } = props
  const utils = trpc.useUtils()
  const toast = useToast()
  // On a phone this is the list (phone decision 1): no search, no foot, no hover controls.
  const phone = useIsPhone()
  const [archivedOpen, setArchivedOpen] = useState(readShowArchived)
  const [pendingDelete, setPendingDelete] = useState<{
    feature: FeatureListItem
    returnFocusRef: RefObject<HTMLButtonElement | null>
  } | null>(null)

  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  // No interval of its own: every write to the pile emits a project event, and
  // the stream invalidates this key with the rest (lib/live.ts).
  const openNotes = trpc.projectNotes.openCount.useQuery({ projectId }).data ?? 0
  // Same query key the Orchestrator's chat list polls.
  const chats = chatsState(trpc.thread.list.useQuery({ projectId }, { refetchInterval: useLivePoll() }).data ?? [])
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

  // The open page's threads (threads-in-the-sidebar): the open feature's under
  // its row, the Orchestrator's in its card. Nothing else ever lists threads.
  const published = useSidebarThreads()
  const fold = useFoldedThreads()
  const threadActions = useThreadActions()
  const [renaming, setRenaming] = useState<{ threadId: string; title: string } | null>(null)
  // A chat nobody has started has no thread yet: nothing to rename or export.
  const threadActionsFor = (t: ThreadEntry): FeatureAction[] => t.id === UNSTARTED_CHAT ? [] : [
    { key: 'rename', label: 'Rename…', onSelect: () => setRenaming({ threadId: t.id, title: t.title }) },
    { key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: () => threadActions.exportMarkdown(t.id, t.title) },
    ...(published?.errand?.threadId === t.id
      ? [{ key: 'close-errand', label: 'Close the scenario chat', icon: <IconX />, onSelect: published.errand.close }]
      : []),
  ]
  const featureThreads =
    view === 'feature' && published && 'featureId' in published.scope && published.scope.featureId === selectedFeatureId
      ? published
      : null
  const projectThreads = view === 'project' && published && 'projectId' in published.scope ? published : null
  // The Orchestrator's rows: its features, each opening its page, over Rename and Export.
  const orchestratorThreadActions = (t: ThreadEntry): FeatureAction[] => {
    const held = heldFeatures(t.id, features)
    return [
      ...held.map((f, i) => ({
        key: `open-${f.id}`,
        label: f.title,
        icon: <FeatureProgressIcon f={f} size={14} label="" />,
        ruleAfter: i === held.length - 1,
        onSelect: () => onSelect(f.id),
      })),
      ...threadActionsFor(t),
    ]
  }

  // The drill-in (interactive-workers decision 24): the open feature's own page
  // replaces the features list, until its back chevron goes up a level. Up
  // holds only while the same thread stays in front, so opening the feature or
  // any of its threads again (a row, the palette, a push tap, the address)
  // comes back down. Going either way changes only the sidebar.
  const [upFrom, setUpFrom] = useState<{ featureId: string; current: string | null } | null>(null)
  const [motion, setMotion] = useState<'down' | 'up' | null>(null)
  const openFeature = featureThreads ? features.find((f) => f.id === selectedFeatureId) : undefined
  const wentUp = upFrom !== null && upFrom.featureId === selectedFeatureId && upFrom.current === featureThreads?.current
  const drilled = !phone && featureThreads && openFeature && !wentUp ? { feature: openFeature, threads: featureThreads } : null
  const goUp = () => {
    setUpFrom({ featureId: selectedFeatureId ?? '', current: featureThreads?.current ?? null })
    setMotion('up')
  }

  const row = (f: FeatureListItem, nested = false) => {
    // The phone's list (phone decision 1): only shown with nothing open, so no
    // row is current, and a row is the whole door — no hover menu, no threads.
    if (phone) return <SidebarFeatureRow key={f.id} f={f} active={false} onSelect={onSelect} actions={[]} nested={nested} />
    const open = f.id === selectedFeatureId && view === 'feature'
    return (
      <SidebarFeatureRow
        key={f.id}
        f={f}
        active={open}
        // A feature row goes down to its page; the open one's also brings its lead to the front.
        onSelect={(id) => {
          setUpFrom(null)
          setMotion('down')
          const main = open && featureThreads?.threads.find((t) => t.role === 'main')
          if (main) featureThreads?.pick(main.id)
          if (!main || main.id === UNSTARTED_CHAT) onSelect(id)
        }}
        actions={actionsFor(f)}
        nested={nested}
      />
    )
  }
  const orchestratorFold = projectThreads ? foldKey(projectThreads.scope) : ''

  const notesWords = openNotes > 0 ? ` · ${openNotes} note${openNotes === 1 ? '' : 's'}` : ''
  const nothingInMotion = features.length > 0 && inbox.length + inProgress.length + working.length === 0

  return (
    <nav aria-label="Project" className="relative isolate flex h-full min-h-0 flex-col p-2">
      <SidebarBackdrop />
      {phone ? (
        <>
          <PhoneListHead nav={nav} onNewChat={onNewChat} {...(onOpenNote ? { onOpenNote } : {})} />
          <ComputerUnreachable failed={list.isError} readAt={list.dataUpdatedAt} />
        </>
      ) : (
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
      )}

      {drilled ? (
        <div key="page" className={cx('mt-3 flex min-h-0 flex-1 flex-col', motion === 'down' && 'animate-slide-in-right')}>
          <FeatureSidebar feature={drilled.feature} threads={drilled.threads} onBack={goUp} threadActionsFor={threadActionsFor} />
        </div>
      ) : (
      <div key="list" className={cx('flex min-h-0 flex-1 flex-col', motion === 'up' && 'animate-slide-in-left')}>
      <div className={phone ? 'mt-2' : 'mt-3'}>
        {/* The project's own door (decision 20): not a feature, never in a
            lane. It says what the chat holds — the open notes (project-notes
            decisions #10) — and waits amber while the chat waits on you. */}
        <OrchestratorCard
          status={`${CHATS_WORDS[chats]}${notesWords}`}
          state={chats}
          active={view === 'project' && !phone}
          onOpen={onSelectProject}
          actions={[]}
          title={ORCHESTRATOR_TITLE}
          {...(projectThreads && !phone
            ? {
                onNewThread: projectThreads.newThread,
                threads: (
                  <SidebarThreadList
                    label="Chats"
                    threads={sidebarThreadOrder(projectThreads.threads)}
                    current={projectThreads.current}
                    onOpen={projectThreads.pick}
                    actionsFor={orchestratorThreadActions}
                    keep={(t) =>
                      // An open errand's chat keeps its row, which is how it is closed.
                      t.id === projectThreads.errand?.threadId ||
                      threadIsActive(t, { current: projectThreads.current, features, now: Date.now() })
                    }
                    markFor={(t) => {
                      const held = heldFeatures(t.id, features)
                      return held.length > 0 ? <HoldMark features={held} /> : null
                    }}
                    tipFor={(t) => {
                      const held = heldFeatures(t.id, features)
                      return held.length > 0 ? <HoldTip features={held} /> : undefined
                    }}
                    {...(projectThreads.allConversations ? { more: projectThreads.allConversations } : {})}
                  />
                ),
                folded: fold.folded(orchestratorFold),
                onToggleThreads: () => fold.toggle(orchestratorFold),
              }
            : {})}
        />
      </div>

      <div className="-mx-2 mt-4 flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-2 pt-px pb-2 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin]">
        {list.isLoading && <FeatureRowsSkeleton />}
        {nothingInMotion && <NavItem tone="quiet" label="Nothing in motion" />}
        {inbox.length + inProgress.length > 0 && (
          <section aria-label="Needs you" className="flex flex-col gap-1">
            {inbox.map((f) => row(f))}
            {inProgress.map((f) => row(f))}
          </section>
        )}
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
      </div>
      )}

      {phone ? <PhoneNotificationsRow projectId={projectId} /> : <SidebarFoot {...props} />}

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
      {renaming && (
        <RenameThreadDialog
          title={renaming.title}
          onClose={() => setRenaming(null)}
          onSave={(title) => {
            threadActions.rename(renaming.threadId, title)
            setRenaming(null)
          }}
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
          hint="A new chat with the orchestrator — talk an idea through before it becomes a feature"
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
  /** The help menu's Glossary; no help menu without it. */
  onOpenGlossary?: () => void
  /** The help menu's way onto a phone; absent on a phone. */
  onOpenPhoneSetup?: () => void
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
  onOpenGlossary,
  onOpenPhoneSetup,
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
        onOpenGlossary={onOpenGlossary}
        onOpenPhoneSetup={onOpenPhoneSetup}
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
  onOpenPhoneSetup,
  projectDriveBranch = null,
  onOpenProjectDrive,
  onOpenFeatureDrive,
  driving = null,
  onDriveChange,
}: SidebarProps) {
  const toast = useToast()
  const openGlossary = useOpenGlossary()
  const utils = trpc.useUtils()
  const live = useLiveStatus()
  const theme = useTheme()
  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: useLivePoll() })
  const healthy = !list.isError && list.data !== undefined
  const notify = useDesktopNotifications()
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
          label="Test drive · main"
          detail={<span className="font-mono">{projectDriveBranch}</span>}
          title={`A test drive is live on ${projectDriveBranch} — back to it`}
          onOpen={onOpenProjectDrive}
        />
      )}
      {driving && (
        <DriveCard
          label={driving.cutOff ? 'Test drive (cut off by a restart)' : 'Test drive'}
          detail={drivenTitle ?? <span className="font-mono">{driving.branch}</span>}
          title={
            driving.cutOff
              ? `A restart cut off the drive of ${driving.branch} — stop it to return the checkout`
              : `Driving ${driving.branch} — back to the drive`
          }
          onOpen={() => (onOpenFeatureDrive ?? onSelect)(driving.featureId)}
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
      onOpenGlossary={openGlossary ? () => openGlossary() : undefined}
      onOpenPhoneSetup={onOpenPhoneSetup}
      rows={rows}
    />
  )
}

