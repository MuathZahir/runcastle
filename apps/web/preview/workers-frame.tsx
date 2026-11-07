import { useState } from 'react'
import type { ReactNode } from 'react'
import { cx, IconButton } from '../src/ui'
import { CreateMenu } from '../src/components/Sidebar'
import { ProjectSwitcher } from '../src/components/ProjectSwitcher'
import { CollapseSidebarButton } from '../src/components/Frame'
import {
  OrchestratorCard,
  Shelf,
  SidebarBackdrop,
  SidebarFeatureRow,
  SidebarStatusLine,
  WorkingShelf,
} from '../src/components/SidebarParts'
import { ChatThread } from '../src/components/chat/thread/ChatThread'
import { Composer } from '../src/components/chat/thread/Composer'
import { AssignmentCard } from '../src/components/workers/WorkerParts'
import { IconArchive, IconBranch, IconDoc, IconGitMerge, IconList, IconMessage, IconPencil, IconSearch, IconTrash } from '../src/icons'
import { sidebarLanes } from '../src/lib/feature-ui'
import { useTheme } from '../src/lib/theme'
import type { FeatureListItem } from '../src/lib/api'
import type { ThreadItem } from '../src/lib/chat-thread'
import type { WorkerAssignment, WorkerEntry } from '../src/lib/workers'
import type { FeatureAction } from '../src/components/FeatureActionsMenu'
import type { ProjectNavApi } from '../src/lib/use-project-nav'
import { shortcut } from '../src/lib/platform'
import { PROJECT_ID, project } from '../../../.runcastle/preview/shell-fakes'
import { featuresWith, HEADER, LEAD, lead, OPEN_TITLE } from './workers-sidebar-data'
import { MOMENTS } from './workers-chat-data'

/**
 * The shared frame for the second pass on workers (workers-rail.html and
 * workers-sidebar-sharp.html): the project sidebar at its real width and the
 * chat of the thread in front, over the same sample as workers-sidebar.html,
 * so the two placements can be compared side by side at 1440×900.
 */

export const noop = () => {}

const nav = {
  projects: [project],
  loading: false,
  doctorError: null,
  recheckDoctor: () => {},
  view: 'project',
  currentProjectId: PROJECT_ID,
  currentProject: project,
  goHome: () => {},
  enterProject: () => {},
  showOpen: () => {},
  cancelOpen: () => {},
} as unknown as ProjectNavApi

export const rowActions: FeatureAction[] = [{ key: 'copy-link', label: 'Copy link', onSelect: noop }]

export const leadActions: FeatureAction[] = [
  { key: 'rename', label: 'Rename…', icon: <IconPencil />, onSelect: noop },
  { key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: noop },
]

/** A worker row's "…": open, rename, its branch, export; drop while it is not settled. */
export function workerActions(w: WorkerEntry): FeatureAction[] {
  if (w.oldSideChat) return [{ key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: noop }]
  const settled = w.status === 'landed' || w.status === 'dropped'
  return [
    { key: 'open', label: 'Open its chat', icon: <IconMessage />, onSelect: noop },
    { key: 'rename', label: 'Rename…', icon: <IconPencil />, onSelect: noop },
    ...(settled ? [] : [{ key: 'copy-branch', label: 'Copy branch name', icon: <IconBranch />, onSelect: noop }]),
    { key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: noop },
    ...(settled ? [] : [{ key: 'drop', label: 'Drop worker', icon: <IconTrash />, danger: true, onSelect: noop }]),
  ]
}

/** How many workers wait on the human: the open feature's need in the sample. */
export const needing = (ws: readonly WorkerEntry[]) => ws.filter((w) => w.status === 'needs-you' || w.status === 'failed').length

export { HEADER, LEAD, lead, OPEN_TITLE }

/**
 * The project sidebar. `threads` draws the open feature's nested list (the
 * left-sidebar placement); without it the open feature is one row, its amber
 * dot lit while a worker needs the human (the rail placement).
 */
export function FrameSidebar({
  workers,
  threads,
  onNewWorker,
  features: given,
  onSelectFeature,
  page,
  motion,
}: {
  workers: readonly WorkerEntry[]
  threads?: ReactNode
  /** The open feature's "+", in the left-sidebar placement only. */
  onNewWorker?: () => void
  /** The project's features, when the page adjusts the sample. */
  features?: FeatureListItem[]
  /** A feature row's click (the drill-in placement goes down a level on it). */
  onSelectFeature?: (id: string) => void
  /** The drill-in placement: the feature's own page in place of the Orchestrator card and the lanes. */
  page?: ReactNode
  /** Which way the body last moved: down into a feature, up to the list. Slides it in from that side. */
  motion?: 'down' | 'up' | null
}) {
  const theme = useTheme()
  const features = given ?? featuresWith(needing(workers))
  const open = features.find((f) => f.title === OPEN_TITLE)!
  const { inbox, lanes } = sidebarLanes(features)
  const pick = (key: string) => lanes.find((g) => g.key === key)?.features ?? []
  const archived = features.filter((f) => f.status === 'archived')
  const [folded, setFolded] = useState(false)

  const row = (f: FeatureListItem, nested = false) => {
    const isOpen = f.id === open.id
    return (
      <SidebarFeatureRow
        key={f.id}
        f={f}
        active={isOpen}
        onSelect={onSelectFeature ?? noop}
        actions={rowActions}
        nested={nested}
        {...(isOpen && onNewWorker ? { onNewThread: onNewWorker } : {})}
        {...(isOpen && threads ? { threads, folded, onToggleThreads: () => setFolded((v) => !v) } : {})}
        needsYou={isOpen && needing(workers) > 0}
      />
    )
  }

  return (
    <nav aria-label="Project" className="relative isolate flex h-full min-h-0 flex-col p-2">
      <SidebarBackdrop />
      <div className="flex h-10 shrink-0 items-center gap-0.5">
        <div className="flex min-w-0 flex-1">
          <ProjectSwitcher nav={nav} />
        </div>
        <IconButton label="Search or jump to" kbd={shortcut('K')} size="sm" icon={<IconSearch />} tooltipSide="bottom" />
        <CreateMenu onNewChat={noop} onDraft={noop} onOpenNote={noop} />
        <CollapseSidebarButton />
      </div>
      {page ? (
        <div key="page" className={cx('mt-3 flex min-h-0 flex-1 flex-col', motion === 'down' && 'animate-slide-in-right')}>
          {page}
        </div>
      ) : (
      <div key="list" className={cx('flex min-h-0 flex-1 flex-col', motion === 'up' && 'animate-slide-in-left')}>
      <div className="mt-3">
        <OrchestratorCard status="Plan, cut and ask · 2 notes" state="idle" active={false} onOpen={noop} actions={[]} />
      </div>
      <div className="-mx-2 mt-4 flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-2 pt-px pb-2 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin]">
        <section aria-label="Needs you" className="flex flex-col gap-1">
          {inbox.map((f) => row(f))}
          {pick('inProgress').map((f) => row(f))}
        </section>
        <WorkingShelf features={pick('agentWorking')} renderRow={row} />
        <div className="flex flex-col divide-y divide-border-subtle">
          <Shelf icon={<IconList />} label="Backlog" features={pick('drafts')} renderRow={(f) => row(f)} />
          <Shelf icon={<IconGitMerge />} label="Shipped" features={pick('shipped')} renderRow={(f) => row(f)} cap={5} />
          <Shelf icon={<IconArchive />} label="Archived" features={archived} renderRow={(f) => row(f)} />
        </div>
      </div>
      </div>
      )}
      <div className="flex shrink-0 flex-col gap-2 pt-2">
        <SidebarStatusLine
          healthTone="success"
          healthTip="Server ok — live updates streaming"
          sandbox="docker"
          notify={{ state: 'on', title: '', onToggle: noop }}
          theme={theme.resolved}
          onToggleTheme={theme.toggle}
          onOpenSettings={noop}
        />
      </div>
    </nav>
  )
}

const LEAD_ITEMS: ThreadItem[] = [
  { kind: 'user', id: 'lu1', text: 'The plan looks right. Go.' },
  {
    kind: 'agent',
    id: 'la1',
    model: 'Opus 5.5',
    text:
      'Started four workers:\n\n' +
      '- **Header** and **Thread list**, with you: each makes a first pass, then waits for you.\n' +
      '- **Worker list data** and **Amber dot rule**, on their own: they hand back when their tests pass.\n\n' +
      'I’ll land each handback as it comes.',
  },
]

const LEAD_ONLY_ITEMS: ThreadItem[] = [
  { kind: 'user', id: 'lu1', text: 'Can you tighten the shelf spacing a little? 4px less between shelves.' },
  { kind: 'agent', id: 'la1', model: 'Opus 5.5', text: 'Done — the shelves sit 16px apart now, in `SidebarParts.tsx`. A few lines, so I did it here rather than start a worker.' },
]

/** The with-you moment's picture, for the panel's design preview. */
export const PREVIEW_SRC = (() => {
  const shown = MOMENTS[0]!.items.find((i): i is Extract<ThreadItem, { kind: 'shown' }> => i.kind === 'shown')
  return shown?.files[0]?.src ?? ''
})()

/** What the chat shows for the thread in front: the Header worker's real moment, the lead's turns, or a fresh worker. */
function chatFor(id: string, workers: readonly WorkerEntry[]): { items: ThreadItem[]; assignment?: WorkerAssignment; working: boolean } {
  if (id === LEAD) return { items: workers.length > 0 ? LEAD_ITEMS : LEAD_ONLY_ITEMS, working: false }
  if (id === HEADER) return { items: MOMENTS[0]!.items, assignment: MOMENTS[0]!.assignment, working: false }
  const w = workers.find((x) => x.id === id)
  if (!w) return { items: [], working: false }
  return {
    items: [],
    assignment: { label: w.label, purpose: w.purpose, kind: w.kind ?? null, model: 'Sonnet 5.5', startedBy: w.startedBy },
    working: w.status === 'working',
  }
}

/** The chat column of the thread in front. */
export function FrameChat({ current, workers }: { current: string; workers: readonly WorkerEntry[] }) {
  const [draft, setDraft] = useState('')
  const c = chatFor(current, workers)
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <ChatThread
        key={current}
        items={c.items}
        state={c.working ? 'working' : 'idle'}
        emptyHint="This sample shows the Header worker's chat in full; the other workers' chats are left empty."
        {...(c.assignment ? { head: <AssignmentCard assignment={c.assignment} defaultOpen={c.items.length <= 5} /> } : {})}
        footer={
          <Composer
            value={draft}
            onChange={setDraft}
            state={c.working ? 'working' : 'idle'}
            onSend={() => setDraft('')}
            placeholder={current === LEAD ? 'Message the lead' : 'Message the worker'}
          />
        }
      />
    </div>
  )
}

/** The samples bar over a page: its states and the theme switch. */
export function SampleBar<K extends string>({
  states,
  value,
  onPick,
  hint,
}: {
  states: { key: K; label: string }[]
  value: K
  onPick: (k: K) => void
  hint?: string
}) {
  const theme = useTheme()
  const chip = (on: boolean) =>
    cx('h-6 shrink-0 cursor-pointer rounded-md px-2', on ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover/50 hover:text-text-secondary')
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border-subtle px-3 text-xs whitespace-nowrap text-text-tertiary">
      <span className="mr-2">Sample</span>
      {states.map((s) => (
        <button key={s.key} type="button" onClick={() => onPick(s.key)} className={chip(s.key === value)}>
          {s.label}
        </button>
      ))}
      <button type="button" onClick={theme.toggle} className={chip(false)}>
        {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
      </button>
      {hint && <span className="ml-auto truncate">{hint}</span>}
    </div>
  )
}
