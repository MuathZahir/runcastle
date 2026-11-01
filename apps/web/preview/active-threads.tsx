import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { cx, IconButton } from '../src/ui'
import { PageTopbar } from '../src/ui/page'
import { CreateMenu } from '../src/components/Sidebar'
import { ProjectSwitcher } from '../src/components/ProjectSwitcher'
import { CollapseSidebarButton } from '../src/components/Frame'
import {
  FeatureProgressIcon,
  HoldMark,
  HoldTip,
  OrchestratorCard,
  Shelf,
  SidebarBackdrop,
  SidebarFeatureRow,
  SidebarStatusLine,
  SidebarThreadList,
  WorkingShelf,
} from '../src/components/SidebarParts'
import { IconArchive, IconDoc, IconGitMerge, IconList, IconMore, IconOrchestrator, IconPanelRight, IconPencil, IconSearch } from '../src/icons'
import { sidebarLanes } from '../src/lib/feature-ui'
import { sidebarThreadOrder } from '../src/lib/sidebar-threads'
import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import type { FeatureAction } from '../src/components/FeatureActionsMenu'
import type { ProjectNavApi } from '../src/lib/use-project-nav'
import { shortcut } from '../src/lib/platform'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { PROJECT_ID, project } from '../../../.runcastle/preview/shell-fakes'
import { allThreads, DESIGN, heldFeatures, holdsOf, isActive, MOBILE, NOTES, OLD } from './active-threads-data'

/**
 * The sidebar shows only active threads: the Orchestrator's list as the rule
 * leaves it, each holding thread wearing its mark, composed from the real pieces
 * in SidebarParts over sample threads and features. The page states are at
 * ?state=active | old | quiet | none | today. Hover a row with a mark for its
 * features; its "…" or a right-click lists them above Rename. A dead end
 * otherwise: links and navigation do nothing.
 */

applyStoredTheme()
installSilentEventSource()
document.addEventListener(
  'click',
  (e) => {
    if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault()
  },
  true,
)

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

const noop = () => {}

/** A state of the Orchestrator's list. */
interface State {
  key: string
  label: string
  /** The thread in front; null is the Conversations page. */
  current: string | null
  /** The threads the state reads. */
  threads: ThreadEntry[]
  features: FeatureListItem[]
  /** Today's list: five rows and no marks. */
  today?: boolean
  /** Read this far ahead, so nobody wrote in the last 24 hours. */
  later?: boolean
}

const quiet = heldFeatures.map((f) => ({ ...f, heldBy: undefined }))
const allIdle = allThreads.map((t) => ({ ...t, state: 'idle' as const, updatedAt: t.updatedAt - 2 * 86_400_000 }))
const onlyNotes = allIdle.map((t) => (t.id === NOTES ? { ...t, updatedAt: Date.now() - 20 * 60_000 } : t))

const STATES: State[] = [
  { key: 'active', label: 'Active', current: NOTES, threads: allThreads, features: heldFeatures },
  { key: 'old', label: 'Old thread open', current: OLD, threads: allThreads, features: heldFeatures },
  { key: 'quiet', label: 'Holding, idle', current: DESIGN, threads: allIdle, features: heldFeatures, later: true },
  { key: 'none', label: 'Nothing active', current: null, threads: allIdle, features: quiet, later: true },
  { key: 'one', label: 'One thread', current: NOTES, threads: onlyNotes, features: quiet, later: true },
  { key: 'today', label: 'Today', current: MOBILE, threads: allThreads, features: heldFeatures, today: true },
]

// ---------------------------------------------------------------------------
// The sidebar
// ---------------------------------------------------------------------------

function DesignSidebar({ state, current, onPick }: { state: State; current: string | null; onPick: (id: string | null) => void }) {
  const theme = useTheme()
  const { features } = state
  const { inbox, lanes } = sidebarLanes(features)
  const pick = (key: string) => lanes.find((g) => g.key === key)?.features ?? []
  const archived = features.filter((f) => f.status === 'archived')
  const [folded, setFolded] = useState(false)

  const rowActions: FeatureAction[] = [{ key: 'copy-link', label: 'Copy link', onSelect: noop }]
  const row = (f: FeatureListItem, nested = false) => (
    <SidebarFeatureRow key={f.id} f={f} active={false} onSelect={noop} actions={rowActions} nested={nested} />
  )

  /** The row's menu: the held features, each opening its page, above Rename and Export. */
  const threadActions = (t: ThreadEntry): FeatureAction[] => {
    const held = state.today ? [] : holdsOf(t.id, features)
    return [
      ...held.map((f, i) => ({
        key: `open-${f.id}`,
        label: f.title,
        icon: <FeatureProgressIcon f={f} size={14} label="" />,
        ruleAfter: i === held.length - 1,
        onSelect: noop,
      })),
      { key: 'rename', label: 'Rename…', icon: <IconPencil />, onSelect: noop },
      { key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: noop },
    ]
  }

  const held = (t: ThreadEntry) => (state.today ? [] : holdsOf(t.id, features))
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
      <div className="mt-3">
        <OrchestratorCard
          status={state.threads.some((t) => t.state === 'waiting') ? 'Waiting for you · 2 notes' : 'Plan, cut and ask · 2 notes'}
          state={state.threads.some((t) => t.state === 'waiting') ? 'waiting' : 'idle'}
          active
          onOpen={noop}
          actions={[{ key: 'reprepare', label: 'Re-prepare the project', onSelect: noop }]}
          onNewThread={noop}
          folded={folded}
          onToggleThreads={() => setFolded((v) => !v)}
          threads={
            <SidebarThreadList
              label="Conversations"
              threads={sidebarThreadOrder(state.threads)}
              current={current}
              onOpen={onPick}
              actionsFor={threadActions}
              more={() => onPick(null)}
              {...(state.today
                ? {}
                : {
                    keep: (t: ThreadEntry) => isActive(t, current, features, state.later ? Date.now() + 2 * 86_400_000 : undefined),
                    markFor: (t: ThreadEntry) => (held(t).length > 0 ? <HoldMark features={held(t)} /> : null),
                    tipFor: (t: ThreadEntry) => (held(t).length > 0 ? <HoldTip features={held(t)} /> : undefined),
                  })}
            />
          }
        />
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

function Panel({ state, current }: { state: State; current: string | null }) {
  const title = current ? state.threads.find((t) => t.id === current)?.title : null
  return (
    <section className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <PageTopbar
        crumbs={[{ label: 'Orchestrator', icon: <IconOrchestrator size={14} /> }, { label: title ?? 'Conversations' }]}
        trail
        actions={
          <>
            <IconButton size="md" label="More" icon={<IconMore />} />
            <IconButton size="md" label="Panel" icon={<IconPanelRight />} />
          </>
        }
      />
      <div className="flex flex-1 items-center justify-center text-sm text-text-tertiary">
        {title ? 'The chat column for the thread named above' : 'The Conversations page: every conversation'}
      </div>
    </section>
  )
}

function Page() {
  const asked = new URLSearchParams(location.search).get('state')
  const [key, setKey] = useState(STATES.find((s) => s.key === asked)?.key ?? STATES[0]!.key)
  const state = STATES.find((s) => s.key === key)!
  const [current, setCurrent] = useState<string | null>(state.current)
  const theme = useTheme()
  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border-subtle px-3 text-xs text-text-tertiary">
        <span>Sample</span>
        {STATES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setKey(s.key)
              setCurrent(s.current)
            }}
            className={cx('h-6 cursor-pointer rounded-md px-2', s.key === key ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover/50 hover:text-text-secondary')}
          >
            {s.label}
          </button>
        ))}
        <button type="button" onClick={theme.toggle} className="h-6 cursor-pointer rounded-md px-2 hover:bg-surface-hover/50 hover:text-text-secondary">
          {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex h-full w-[264px] shrink-0 flex-col">
          <DesignSidebar state={state} current={current} onPick={setCurrent} />
        </div>
        <Panel state={state} current={current} />
      </div>
    </div>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root not found')
createRoot(rootEl).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <Page />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
)
