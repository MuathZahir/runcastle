import { StrictMode, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { cx, IconButton, NavItem } from '../src/ui'
import { CreateMenu } from '../src/components/Sidebar'
import { ProjectSwitcher } from '../src/components/ProjectSwitcher'
import { CollapseSidebarButton } from '../src/components/Frame'
import {
  DriveCard,
  OrchestratorCard,
  PrepRow,
  Shelf,
  SidebarFeatureRow,
  SidebarBackdrop,
  SidebarStatusLine,
  WorkingShelf,
} from '../src/components/SidebarParts'
import { IconArchive, IconGitMerge, IconList, IconSearch } from '../src/icons'
import { sidebarLanes } from '../src/lib/feature-ui'
import type { FeatureListItem } from '../src/lib/api'
import type { FeatureAction } from '../src/components/FeatureActionsMenu'
import type { ProjectNavApi } from '../src/lib/use-project-nav'
import { shortcut } from '../src/lib/platform'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { PROJECT_ID, project } from '../../../.runcastle/preview/shell-fakes'
import { busyFeatures, quietFeatures, SELECTED_TITLE } from './sidebar-data'

/**
 * The project sidebar's design (docs/features/sidebar-refresh-less-clutter-
 * more-character), composed from the real pieces in SidebarParts over sample
 * features, the way `Sidebar` composes them. A dead end on purpose: links and
 * navigation do nothing here.
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
const rowActions: FeatureAction[] = [{ key: 'copy-link', label: 'Copy link', onSelect: noop }]

type Sample = 'busy' | 'quiet' | 'unprepared'

function Design({ features, sample }: { features: FeatureListItem[]; sample: Sample }) {
  const theme = useTheme()
  const [selectedId, setSelectedId] = useState(() => features.find((f) => f.title === SELECTED_TITLE)?.id ?? null)
  const busy = sample !== 'quiet'
  const { inbox, lanes } = sidebarLanes(features)
  const pick = (key: string) => lanes.find((g) => g.key === key)?.features ?? []
  const stopped = pick('inProgress')
  const archived = features.filter((f) => f.status === 'archived')
  const row = (f: FeatureListItem, nested = false) => (
    <SidebarFeatureRow
      key={f.id}
      f={f}
      active={f.id === selectedId}
      onSelect={setSelectedId}
      actions={rowActions}
      nested={nested}
    />
  )
  const nothing = inbox.length + stopped.length + pick('agentWorking').length === 0
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
          status={busy ? 'Waiting for you · 2 notes' : 'Plan, cut and ask'}
          state={busy ? 'waiting' : 'idle'}
          active={false}
          onOpen={noop}
          actions={[{ key: 'reprepare', label: 'Re-prepare the project', onSelect: noop }]}
        />
      </div>
      <div className="-mx-2 mt-4 flex min-h-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto px-2 pt-px pb-2 [scrollbar-color:var(--color-border)_transparent] [scrollbar-width:thin]">
        {nothing && sample !== 'unprepared' && <NavItem tone="quiet" label="Nothing in motion" />}
        {(sample === 'unprepared' || inbox.length + stopped.length > 0) && (
          <section aria-label="Needs you" className="flex flex-col gap-1">
            {sample === 'unprepared' && (
              <PrepRow
                label="Prepare this project"
                badge="8 to establish"
                title="8 repo facts nobody has established yet"
                active={false}
                onClick={noop}
              />
            )}
            {inbox.map((f) => row(f))}
            {stopped.map((f) => row(f))}
          </section>
        )}
        <WorkingShelf features={pick('agentWorking')} renderRow={row} />
        <div className="flex flex-col divide-y divide-border-subtle">
          <Shelf icon={<IconList />} label="Backlog" features={pick('drafts')} renderRow={(f) => row(f)} />
          <Shelf icon={<IconGitMerge />} label="Shipped" features={pick('shipped')} renderRow={(f) => row(f)} cap={5} />
          <Shelf icon={<IconArchive />} label="Archived" features={archived} renderRow={(f) => row(f)} />
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 pt-2">
        {busy && (
          <DriveCard
            label="Test drive"
            detail="Scenario fixtures for drives"
            title="Driving feature/scenario-fixtures-for-drives — back to its feature"
            onOpen={noop}
            onStop={noop}
          />
        )}
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

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full w-[264px] shrink-0 flex-col">
      <div className="h-10 shrink-0 px-3 pt-3 text-sm font-semibold text-text">{title}</div>
      <div className="min-h-0 flex-1 border-t border-r border-border-subtle bg-canvas">{children}</div>
    </div>
  )
}

const SAMPLES: { key: Sample; label: string; features: FeatureListItem[] }[] = [
  { key: 'busy', label: 'Busy project', features: busyFeatures },
  { key: 'quiet', label: 'Quiet day', features: quietFeatures },
  { key: 'unprepared', label: 'Not prepared', features: busyFeatures },
]

function Page() {
  const [sample, setSample] = useState<Sample>('busy')
  const theme = useTheme()
  const current = SAMPLES.find((s) => s.key === sample) ?? SAMPLES[0]
  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border-subtle px-3 text-xs text-text-tertiary">
        <span>Sample</span>
        {SAMPLES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSample(s.key)}
            className={cx(
              'h-6 cursor-pointer rounded-md px-2',
              s.key === sample ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover/50 hover:text-text-secondary',
            )}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={theme.toggle}
          className="h-6 cursor-pointer rounded-md px-2 hover:bg-surface-hover/50 hover:text-text-secondary"
        >
          {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
        <span className="ml-auto">Hover the Orchestrator · click a shelf · hover a row for its menu</span>
      </div>
      <div key={sample} className="flex min-h-0 flex-1 px-4">
        <Column title="Project sidebar">
          <Design features={current.features} sample={sample} />
        </Column>
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
