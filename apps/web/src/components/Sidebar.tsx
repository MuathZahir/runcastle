import { useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { trpc } from '../trpc'
import { cx, IconButton, Kbd, Skeleton, SkeletonBar } from '../ui'
import type { StatusTone } from '../ui'
import { useToast } from '../lib/toast'
import type { FeatureListItem } from '../lib/api'
import { needsMe, sidebarLanes } from '../lib/feature-ui'
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
import type { ThreadEntry } from '../lib/chat-thread'
import { threadIsActive, useSidebarThreads } from '../lib/sidebar-threads'
import { featureWorkerEntries, takesNewWorkers, workerEntry, type WorkerEntry } from '../lib/workers'
import { epicNameOf, epicsFrom, shelfFeatureWords } from '../lib/feature-ui/epics'
import { hasDraft, useThreadActions } from '../lib/use-thread'
import { UNSTARTED_CHAT, standIn, withStandIns } from '../lib/chat-sessions'
import {
  IconArchive,
  IconBranch,
  IconDoc,
  IconGitMerge,
  IconList,
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
import { useOpenGlossary } from './GlossaryDialog'
import { CollapseSidebarButton } from './Frame'
import { ComputerUnreachable, PhoneListHead } from './phone/PhoneListHead'
import { PhoneNotificationsRow } from './phone/PhoneNotificationsRow'
import {
  DriveCard,
  FeatureDriveSlot,
  featureStateWords,
  Shelf,
  SidebarFeatureRow,
  SidebarBackdrop,
  SidebarHead,
  SidebarStatusLine,
  SidebarThreadRow,
  SidebarWorkerItem,
  type FeatureWorkers,
} from './SidebarParts'
import { SidebarEpics } from './SidebarEpics'
import { EpicLookPopover } from './EpicLookPopover'
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
  /** The project's chats: its latest. */
  onSelectProject: () => void
  /** New epic, the list's dotted slot: the project's chats on an empty epic, saved on its first message. */
  onNewChat: () => void
  /** An epic's row: open that chat, from whatever page is open. */
  onOpenChat?: (threadId: string) => void
  /** "All N epics": the page every epic lives on. */
  onOpenConversations?: () => void
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
  /** An agent's drive card: that worker's chat on its feature's page (triage-batch decision 15). */
  onOpenWorkerChat?: (featureId: string, workerId: string) => void
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

/** The project's live workers, by the feature that owns each. */
function groupByFeature<W extends { featureId: string | null }>(workers: readonly W[]): Map<string, W[]> {
  const out = new Map<string, W[]>()
  for (const w of workers) if (w.featureId) out.set(w.featureId, [...(out.get(w.featureId) ?? []), w])
  return out
}

/**
 * The project sidebar (DESIGN.md §Frame, "The project sidebar") on the canvas,
 * composed from the pieces in `SidebarParts`:
 *
 * - head — the current project’s name (the project rail, left of it, switches), Search (⌘/Ctrl K), a Create menu (Add
 *   to backlog · Jot a note) and the collapse button, over the halftone;
 * - the epics (docs/features/orchestrator-chats-become-epics): the dotted New
 *   epic slot (epics-that-look-alive decision 5), then each listed
 *   orchestrator chat with the features it cut that are in motion or up next
 *   nested under it, then "Other features", then "All N epics" — on every
 *   page and on the phone;
 * - the shelves: folded Backlog, Shipped (five, then "Show N more"), Archived,
 *   each row naming its epic quietly;
 * - foot — live drives as cards, then the icon-only status line.
 *
 * Every feature row is two lines; its menu is a hover "…" or a right-click.
 * The slug is not on the row: it is in the URL and the feature page, and the
 * row menu's Copy link hands over that URL. Polls `feature.list` and
 * `thread.list` at 1.5s.
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
    onOpenChat,
    onOpenConversations,
    onDraft,
    onOpenNote,
    onOpenCmdk,
    onOpenWorkerChat,
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

  const poll = useLivePoll()
  const list = trpc.feature.list.useQuery({ projectId }, { refetchInterval: poll })
  // The project's chats, fetched here so the epics never depend on which page
  // published threads (orchestrator-chats-become-epics decision 18). Same query
  // key the chat page polls.
  const threadList = trpc.thread.list.useQuery({ projectId }, { refetchInterval: poll }).data
  const features = list.data ?? []
  const { lanes } = sidebarLanes(features)
  const lane = (key: string) => lanes.find((g) => g.key === key)?.features ?? []
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

  // What the open page publishes (threads-in-the-sidebar): the open feature's
  // lead chat for its row's menu, and on the chats page the chat in front, its
  // stand-ins and the project's own workers. The epics themselves come from
  // the chat list fetched above.
  const published = useSidebarThreads()
  const threadActions = useThreadActions()
  const [renaming, setRenaming] = useState<{ threadId: string; title: string } | null>(null)
  // The epic whose colour-and-icon picker is open (epics-that-look-alive decision 3).
  const [lookOf, setLookOf] = useState<ThreadEntry | null>(null)
  // A chat nobody has started has no thread yet: nothing to rename or export.
  const threadActionsFor = (t: ThreadEntry): FeatureAction[] => t.id === UNSTARTED_CHAT ? [] : [
    { key: 'rename', label: 'Rename…', onSelect: () => setRenaming({ threadId: t.id, title: t.title }) },
    ...(t.role === 'project' ? [{ key: 'look', label: 'Colour and icon…', onSelect: () => setLookOf(t) }] : []),
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

  // The epics (orchestrator-chats-become-epics decisions 4–8, 16): the chat
  // list, with the chats page's stand-ins (a chat in front the list has not
  // caught up with), grouped with the features each cut.
  const chats = withStandIns(threadList ?? [], projectThreads?.threads.filter((t) => t.role === 'project') ?? [])
  const currentChat = projectThreads?.current ?? null
  const now = Date.now()
  // A chat nobody has sent anything in is no epic yet (epics-that-look-alive
  // decision 5): the dotted slot shows it open, and its card comes with its first message.
  const { epics, other } = epicsFrom(chats, features, (t) =>
    t.id !== UNSTARTED_CHAT && threadIsActive(t, { current: currentChat, features, now, drafted: hasDraft }),
  )
  // The slot opens an empty epic on the chats page, or takes the shell there from any other.
  const newEpic = projectThreads ? projectThreads.newThread : onNewChat
  const allEpics = chats.filter((t) => t.role === 'project' && t.id !== UNSTARTED_CHAT).length
  // On the chats page its own pick, which leaves the Epics page for the chat; elsewhere the shell's door.
  const openEpic = (id: string) => (projectThreads ? projectThreads.pick(id) : onOpenChat?.(id))
  const allConversations = projectThreads?.allConversations ?? onOpenConversations
  const epicName = (f: FeatureListItem) => epicNameOf(f, chats)

  // The open feature's lead chat, renamed or exported from its row's "…": the
  // row is the lead's door (clicking-a-feature-opens-its-lead), and its
  // workers sit under it (workers-nest-under-their-feature decision 1).
  const leadChatActions = (): FeatureAction[] => {
    const lead = featureThreads?.threads.find((t) => t.role === 'main')
    const actions = lead ? threadActionsFor(lead) : []
    return actions.map((a, i) => ({
      ...a,
      label: a.key === 'rename' ? 'Rename the lead’s chat…' : a.key === 'export' ? 'Export the lead’s chat' : a.label,
      ...(i === actions.length - 1 ? { ruleAfter: true } : {}),
    }))
  }

  // The phone's list (phone decision 1): only shown with nothing open, so no
  // row is current, and a row is the whole door — no hover menu, no threads,
  // no nested workers (workers-nest-under-their-feature decision 8).
  const currentFeature = !phone && view === 'feature' ? selectedFeatureId : null
  const isOpen = (f: FeatureListItem) => f.id === currentFeature
  // A feature row opens its lead (decisions 1, 7); the open one's brings its
  // lead back to the front. A row that needs you opens the exact chat its
  // question waits in, a worker's included (needs-you-is-the-agent-s-call decision 12).
  const selectFeature = (id: string) => {
    const need = needsMe(features.find((f) => f.id === id) ?? { status: 'draft', need: null })
    if (need && id === currentFeature && featureThreads?.threads.some((t) => t.id === need.threadId)) {
      featureThreads.pick(need.threadId)
      return
    }
    if (need && onOpenWorkerChat) {
      onOpenWorkerChat(id, need.threadId)
      return
    }
    const main = id === currentFeature && featureThreads?.threads.find((t) => t.role === 'main')
    if (main) featureThreads?.pick(main.id)
    if (!main || main.id === UNSTARTED_CHAT) onSelect(id)
  }
  const featureActions = (f: FeatureListItem): FeatureAction[] =>
    phone ? [] : isOpen(f) ? [...leadChatActions(), ...actionsFor(f)] : actionsFor(f)

  // Every feature's workers under its row (workers-nest-under-their-feature
  // decisions 1–4): the live ones of every feature from one project-wide read;
  // the open feature's from what its page reads (`worker.list`, the same query
  // key, so no second fetch) with its old side and drive chats, so its finished
  // ones fold into "N done". The phone's list nests nothing (decision 8).
  const liveWorkers = trpc.worker.listLive.useQuery({ projectId }, { refetchInterval: poll, enabled: !phone }).data
  const openWorkers = trpc.worker.list.useQuery(
    { featureId: currentFeature ?? '' },
    { refetchInterval: poll, enabled: !phone && currentFeature !== null },
  ).data
  const liveByFeature = groupByFeature(liveWorkers ?? [])
  const workerRowsOf = (f: FeatureListItem) =>
    isOpen(f) && openWorkers ? openWorkers : (liveByFeature.get(f.id) ?? [])
  const startWorker = trpc.worker.startUnassigned.useMutation({
    onSuccess: ({ workerId }, { featureId }) => {
      void utils.worker.listLive.invalidate()
      onOpenWorkerChat?.(featureId, workerId)
    },
    onError: (e) => toast.push(e.message),
  })
  const workerActionsFor = (f: FeatureListItem) => (w: WorkerEntry): FeatureAction[] => {
    // An old chat is always one of the open feature's threads; a worker's row can come before its thread.
    const thread = (isOpen(f) ? featureThreads?.threads.find((t) => t.id === w.id) : undefined) ?? standIn(w.id, w.label, 'worker')
    const branch = workerRowsOf(f).find((r) => r.id === w.id)?.branch
    const settled = w.status === 'landed' || w.status === 'dropped'
    return [
      ...threadActionsFor(thread),
      ...(branch && !settled ? [{ key: 'copy-branch', label: 'Copy branch name', icon: <IconBranch />, onSelect: () => copyText(branch, toast) }] : []),
    ]
  }
  const workersFor = (f: FeatureListItem): FeatureWorkers | undefined => {
    if (phone) return undefined
    const open = isOpen(f) ? featureThreads : null
    const rows = workerRowsOf(f)
    const entries = open ? featureWorkerEntries(rows, open.threads) : rows.map(workerEntry)
    if (entries.length === 0) return undefined
    return {
      entries,
      withDone: !!open,
      current: open?.current ?? null,
      // The open feature brings the chat to its front; any other opens on that worker's chat.
      onOpen: (id) => (open ? open.pick(id) : onOpenWorkerChat ? onOpenWorkerChat(f.id, id) : onSelect(f.id)),
      actionsFor: workerActionsFor(f),
    }
  }
  // "+" New worker (decision 5), on a feature in progress only: on the open one
  // its page starts it; any other is opened, then the worker starts there.
  const newWorkerFor = (f: FeatureListItem): (() => void) | undefined => {
    if (phone || !takesNewWorkers(f)) return undefined
    if (isOpen(f) && featureThreads) return featureThreads.newThread
    return () => {
      onSelect(f.id)
      startWorker.mutate({ featureId: f.id })
    }
  }
  // A shelf row: its epic named quietly in its second line (decision 21).
  const shelfRow = (f: FeatureListItem) => {
    const workers = workersFor(f)
    const onNewThread = newWorkerFor(f)
    return (
      <SidebarFeatureRow
        key={f.id}
        f={f}
        active={isOpen(f)}
        onSelect={selectFeature}
        actions={featureActions(f)}
        words={(g) => shelfFeatureWords(g, featureStateWords(g, !!g.autopilot), epicName(g))}
        {...(workers ? { workers } : {})}
        {...(onNewThread ? { onNewThread } : {})}
      />
    )
  }
  // The project's own workers (a project drive's Scenarios worker) and an open
  // errand's scenario chat: not epics, listed above them while the chats page
  // publishes them (drive-chats-become-workers decision 2).
  const errand = projectThreads?.errand
  const errandChat = errand ? (threadList ?? []).find((t) => t.id === errand.threadId) : undefined
  const projectWork =
    projectThreads && !phone && ((projectThreads.workers?.length ?? 0) > 0 || errandChat) ? (
      <section aria-label="Project workers" className="flex flex-col gap-px">
        {projectThreads.workers?.map((w) => (
          <SidebarWorkerItem
            key={w.id}
            worker={w}
            active={w.id === projectThreads.current}
            onSelect={projectThreads.pick}
            actions={threadActionsFor(standIn(w.id, w.label, 'worker'))}
          />
        ))}
        {errandChat && (
          <SidebarThreadRow
            thread={errandChat}
            active={errandChat.id === projectThreads.current}
            onOpen={projectThreads.pick}
            actions={threadActionsFor(errandChat)}
          />
        )}
      </section>
    ) : null

  return (
    <nav aria-label="Project" className="relative isolate flex h-full min-h-0 flex-col p-2">
      <SidebarBackdrop />
      {phone ? (
        <>
          <PhoneListHead nav={nav} {...(onOpenNote ? { onOpenNote } : {})} />
          <ComputerUnreachable failed={list.isError} readAt={list.dataUpdatedAt} />
        </>
      ) : (
        // The project rail switches; the head names where you are.
        <SidebarHead name={nav.currentProject?.name}>
          <IconButton
            label="Search or jump to"
            kbd={shortcut('K')}
            size="sm"
            icon={<IconSearch />}
            tooltipSide="bottom"
            onClick={onOpenCmdk}
          />
          <CreateMenu onDraft={onDraft} onOpenNote={onOpenNote} />
          <CollapseSidebarButton />
        </SidebarHead>
      )}

        <div className="-mx-2 mt-3 flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-2 pt-px pb-2 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin]">
          {projectWork}
          {list.isLoading ? (
            <FeatureRowsSkeleton />
          ) : (
            <SidebarEpics
              epics={epics}
              other={other}
              total={allEpics}
              currentChat={phone ? null : currentChat}
              currentFeature={currentFeature}
              onOpenEpic={openEpic}
              onSelectFeature={selectFeature}
              onAllEpics={allConversations ?? onSelectProject}
              featureActions={featureActions}
              workersFor={workersFor}
              newWorkerFor={newWorkerFor}
              {...(phone ? {} : { epicActions: threadActionsFor })}
              onNewEpic={newEpic}
              newEpicOpen={!phone && !!projectThreads?.newEpicOpen}
            />
          )}
          {list.data && list.data.length === 0 && epics.length === 0 && (
            <div className="px-2.5 py-2 text-xs text-pretty text-text-tertiary">
              No features yet. Start an epic to cut the first one.
            </div>
          )}
          <div className="flex flex-col divide-y divide-border-subtle">
            <Shelf icon={<IconList />} label="Backlog" features={lane('drafts')} renderRow={shelfRow} />
            <Shelf
              icon={<IconGitMerge />}
              label="Shipped"
              features={byLastMoved(lane('shipped'))}
              renderRow={shelfRow}
              cap={5}
            />
            <Shelf
              icon={<IconArchive />}
              label="Archived"
              features={byLastMoved(archived)}
              renderRow={shelfRow}
              open={archivedOpen}
              onOpenChange={onArchivedOpenChange}
            />
          </div>
        </div>

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
      {lookOf && <EpicLookPopover key={lookOf.id} chat={lookOf} onClose={() => setLookOf(null)} />}
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
 * The Create menu beside the project’s name — the doors onto new work that is
 * not an epic (decisions.md #12): the backlog is where an idea is parked, and a
 * note is a thing you noticed. A new epic starts from the epic list's dotted
 * slot, its one way in (epics-that-look-alive decision 5).
 */
export function CreateMenu({
  onDraft,
  onOpenNote,
}: {
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
  onOpenWorkerChat,
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
        <FeatureDriveSlot
          driving={driving}
          {...(drivenTitle ? { featureTitle: drivenTitle } : {})}
          onOpenDrive={(featureId) => (onOpenFeatureDrive ?? onSelect)(featureId)}
          onOpenWorker={(featureId, workerId) =>
            onOpenWorkerChat ? onOpenWorkerChat(featureId, workerId) : onSelect(featureId)
          }
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

