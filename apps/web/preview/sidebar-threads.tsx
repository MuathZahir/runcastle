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
  OrchestratorCard,
  Shelf,
  SidebarFeatureRow,
  SidebarBackdrop,
  SidebarStatusLine,
  SidebarThreadList,
  WorkingShelf,
} from '../src/components/SidebarParts'
import { IconArchive, IconDoc, IconGitMerge, IconList, IconMore, IconOrchestrator, IconPanelRight, IconPencil, IconSearch, IconX } from '../src/icons'
import { sidebarLanes } from '../src/lib/feature-ui'
import type { FeatureListItem } from '../src/lib/api'
import type { ThreadEntry } from '../src/lib/chat-thread'
import type { FeatureAction } from '../src/components/FeatureActionsMenu'
import type { ProjectNavApi } from '../src/lib/use-project-nav'
import { shortcut } from '../src/lib/platform'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { PROJECT_ID, project } from '../../../.runcastle/preview/shell-fakes'
import { busyFeatures as sampleFeatures } from './sidebar-data'
import { featureThreads, orchestratorThreads } from './sidebar-threads-data'

/**
 * Threads in the sidebar (docs/features/threads-in-the-sidebar): the open
 * feature, or the open Orchestrator, shows its threads under its row; the
 * chat header names the thread in front as plain text. Composed from the real
 * pieces in SidebarParts over sample features and threads. Click rows and
 * threads to move around; a dead end otherwise, links and navigation do nothing.
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

/** The busy sample, with Sidebar refresh waiting on you: its main chat's lead has replied. */
const busyFeatures: FeatureListItem[] = sampleFeatures.map((f) =>
  f.title === 'Sidebar refresh' ? { ...f, liveSession: null, waitingReason: 'waiting for you' } : f,
)
const rowActions: FeatureAction[] = [{ key: 'copy-link', label: 'Copy link', onSelect: noop }]

/** The thread row's menu: what the header switcher's menu held for the thread in front. */
function threadActions(t: ThreadEntry): FeatureAction[] {
  return [
    { key: 'rename', label: 'Rename…', icon: <IconPencil />, onSelect: noop },
    { key: 'export', label: 'Export as Markdown', icon: <IconDoc />, onSelect: noop },
    ...(t.role === 'scenario' ? [{ key: 'close', label: 'Close the scenario chat', icon: <IconX />, onSelect: noop }] : []),
  ]
}

/** What is open: a feature with a thread in front, or the Orchestrator (null: Conversations). */
type Open = { kind: 'feature'; featureId: string; thread: string } | { kind: 'orchestrator'; thread: string | null }

// ---------------------------------------------------------------------------
// The sidebar
// ---------------------------------------------------------------------------

function DesignSidebar({ open, onOpen }: { open: Open; onOpen: (o: Open) => void }) {
  const theme = useTheme()
  const features = busyFeatures
  const { inbox, lanes } = sidebarLanes(features)
  const pick = (key: string) => lanes.find((g) => g.key === key)?.features ?? []
  const archived = features.filter((f) => f.status === 'archived')
  const threadsOf = (f: FeatureListItem) => featureThreads[f.title] ?? [{ id: `${f.id}_main`, title: f.title, role: 'main' as const, state: 'idle' as const, updatedAt: f.lastActivityAt, runtime: 'claude-code' as const }]
  const mainOf = (f: FeatureListItem) => threadsOf(f)[0].id
  // What the human folded (decision 10): feature ids, and 'orchestrator'. The app keeps it per browser.
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const toggleFold = (key: string) =>
    setFolded((s) => {
      const next = new Set(s)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const row = (f: FeatureListItem, nested = false) => {
    const isOpen = open.kind === 'feature' && open.featureId === f.id
    const threads = threadsOf(f)
    // Decision 2: only a second thread brings the list.
    const list =
      isOpen && threads.length > 1 ? (
        <SidebarThreadList
          key={f.id}
          threads={threads}
          current={open.thread}
          onOpen={(id) => onOpen({ kind: 'feature', featureId: f.id, thread: id })}
          actionsFor={threadActions}
        />
      ) : undefined
    return (
      <SidebarFeatureRow
        key={f.id}
        f={f}
        active={isOpen}
        onSelect={() => onOpen({ kind: 'feature', featureId: f.id, thread: mainOf(f) })}
        actions={rowActions}
        nested={nested}
        onNewThread={isOpen ? noop : undefined}
        threads={list}
        folded={folded.has(f.id)}
        onToggleThreads={() => toggleFold(f.id)}
      />
    )
  }

  const orchestratorOpen = open.kind === 'orchestrator'
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
          status="Working · 2 notes"
          state="working"
          active={orchestratorOpen}
          onOpen={() => onOpen({ kind: 'orchestrator', thread: null })}
          actions={[{ key: 'reprepare', label: 'Re-prepare the project', onSelect: noop }]}
          onNewThread={orchestratorOpen ? noop : undefined}
          folded={folded.has('orchestrator')}
          onToggleThreads={() => toggleFold('orchestrator')}
          threads={
            orchestratorOpen ? (
              <SidebarThreadList
                label="Conversations"
                threads={orchestratorThreads}
                current={open.thread}
                onOpen={(id) => onOpen({ kind: 'orchestrator', thread: id })}
                actionsFor={threadActions}
                more={() => onOpen({ kind: 'orchestrator', thread: null })}
              />
            ) : undefined
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

// ---------------------------------------------------------------------------
// The content panel's header: the thread named, no switcher
// ---------------------------------------------------------------------------

function threadTitle(open: Open): string | null {
  if (open.kind === 'orchestrator') return open.thread ? (orchestratorThreads.find((t) => t.id === open.thread)?.title ?? null) : null
  const f = busyFeatures.find((x) => x.id === open.featureId)
  const list = f ? (featureThreads[f.title] ?? []) : []
  return list.find((t) => t.id === open.thread)?.title ?? f?.title ?? null
}

function Panel({ open }: { open: Open }) {
  const f = open.kind === 'feature' ? busyFeatures.find((x) => x.id === open.featureId) : undefined
  const thread = threadTitle(open)
  const crumbs =
    open.kind === 'orchestrator'
      ? [{ label: 'Orchestrator', icon: <IconOrchestrator size={14} /> }, ...(thread ? [{ label: thread }] : [])]
      : [{ label: f?.title ?? '', icon: f ? <FeatureProgressIcon f={f} size={14} label="" /> : undefined }, ...(thread ? [{ label: thread }] : [])]
  return (
    <section className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <PageTopbar
        crumbs={crumbs}
        actions={
          <>
            <IconButton size="md" label="More" icon={<IconMore />} />
            <IconButton size="md" label="Panel" icon={<IconPanelRight />} />
          </>
        }
      />
      <div className="flex flex-1 items-center justify-center text-sm text-text-tertiary">
        {open.kind === 'orchestrator' && !open.thread
          ? 'The Conversations page: every conversation'
          : 'The chat column for the thread named above'}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const feature = (title: string) => busyFeatures.find((f) => f.title === title)?.id ?? ''

const SAMPLES: { key: string; label: string; open: () => Open }[] = [
  {
    key: 'feature',
    label: 'Feature with threads',
    open: () => ({ kind: 'feature', featureId: feature('Sidebar refresh'), thread: featureThreads['Sidebar refresh'][1].id }),
  },
  {
    key: 'working',
    label: 'Working feature',
    open: () => ({ kind: 'feature', featureId: feature('Prepare reruns stale checks'), thread: featureThreads['Prepare reruns stale checks'][0].id }),
  },
  {
    key: 'single',
    label: 'Feature, one chat',
    open: () => ({ kind: 'feature', featureId: feature('Scenario fixtures for drives'), thread: featureThreads['Scenario fixtures for drives'][0].id }),
  },
  {
    key: 'orchestrator',
    label: 'Orchestrator',
    open: () => ({ kind: 'orchestrator', thread: orchestratorThreads[1].id }),
  },
]

function Page() {
  const [sample, setSample] = useState(SAMPLES[0].key)
  const [open, setOpen] = useState<Open>(SAMPLES[0].open)
  const theme = useTheme()
  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border-subtle px-3 text-xs text-text-tertiary">
        <span>Sample</span>
        {SAMPLES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setSample(s.key)
              setOpen(s.open())
            }}
            className={cx(
              'h-6 cursor-pointer rounded-md px-2',
              s.key === sample ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover/50 hover:text-text-secondary',
            )}
          >
            {s.label}
          </button>
        ))}
        <button type="button" onClick={theme.toggle} className="h-6 cursor-pointer rounded-md px-2 hover:bg-surface-hover/50 hover:text-text-secondary">
          {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
        <span className="ml-auto">Click a feature, a thread or the Orchestrator · hover a row for "+" and "…"</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex h-full w-[264px] shrink-0 flex-col">
          <DesignSidebar open={open} onOpen={setOpen} />
        </div>
        <Panel open={open} />
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
