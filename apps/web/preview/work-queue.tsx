import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { trpc, trpcLinks } from '../src/trpc'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { IconButton } from '../src/ui'
import { Sidebar } from '../src/components/Sidebar'
import { SidebarBackdrop, SidebarBackdropDrawn } from '../src/components/SidebarParts'
import { WorkQueue } from '../src/components/WorkQueue'
import { DesktopRail, ProjectRailContext, type ProjectRailApi } from '../src/components/ProjectRail'
import { IconMore, IconPanelRight } from '../src/icons'
import { SidebarThreadsProvider, usePublishSidebarThreads } from '../src/lib/sidebar-threads'
import type { ProjectNavApi } from '../src/lib/use-project-nav'
import { applyStoredTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { fakeTrpcFetch } from '../../../.runcastle/preview/fake-api'
import { useDesignReport } from '../../../.runcastle/preview/design-report'
import { PROJECT_ID, project, withShell } from '../../../.runcastle/preview/shell-fakes'
import { DesignPanel, makeDeadEnd } from './design-panel-kit'
import { RAIL_TILES } from './epics-alive-data'
import { HERE, LIMIT, STATES, type Sample, type StateKey } from './work-queue-data'

/**
 * The machine's line of workers (docs/features/one-number-for-how-many-build-
 * at-once, decision 8): the real `Sidebar`, its queries answered at the network
 * edge from sample data, with the foot's `WorkQueue` handed in through the
 * sidebar's `queue` prop as the shell will hand it. A waiting worker's own row
 * reads its place from the `queuePlace` its listed row carries. Pick the state
 * with `?state=` or the "Design · states" card. Links and writes go nowhere.
 */

applyStoredTheme()
installSilentEventSource()
makeDeadEnd()

const noop = () => {}
const params = new URLSearchParams(location.search)
const pickState = (): StateKey => STATES.find((x) => x.key === params.get('state'))?.key ?? 'waiting'

/** A realistic sidebar: a little past the 248 default, as most people drag it. */
const SIDEBAR_W = 288

function fakesFor(s: Sample) {
  return withShell({
    feature: { list: () => s.features },
    thread: { list: () => s.chats as never },
    worker: {
      listLive: () => s.workers,
      list: (input) => s.workers.filter((w) => w.featureId === (input as { featureId: string }).featureId),
    },
  })
}

/** The open feature's page, as far as the sidebar sees it: its lead's chat published. */
function OpenFeaturePage({ s }: { s: Sample }) {
  usePublishSidebarThreads({ scope: { featureId: s.open.feature.id }, threads: [s.open.lead], current: s.open.lead.id, pick: noop, newThread: noop })
  return null
}

/**
 * The browser's remembered folds, as this state has them: Other features open,
 * and every feature with live workers showing them, so a waiting row is in view.
 */
function seedFolds(s: Sample): void {
  for (const key of Object.keys(localStorage)) if (key.startsWith('runcastle.sidebar.')) localStorage.removeItem(key)
  localStorage.setItem('runcastle.sidebar.epicOpen:other', '1')
  for (const id of new Set(s.workers.map((w) => w.featureId))) localStorage.setItem(`runcastle.sidebar.workersOpen:${id}`, '1')
}

/** A fake rail the real rail reads. */
function useRail(): ProjectRailApi {
  return useMemo(
    () => ({ tiles: RAIL_TILES, currentId: PROJECT_ID, enter: noop, goHome: noop, open: noop, reorder: noop }),
    [],
  )
}

const nav = { currentProject: { ...project, name: HERE.name } } as unknown as ProjectNavApi

function Panel() {
  return (
    <section className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-3 text-sm text-text-secondary">
        <span className="truncate">The page in front</span>
        <span className="ml-auto flex items-center gap-1">
          <IconButton size="md" label="More" icon={<IconMore />} />
          <IconButton size="md" label="Panel" icon={<IconPanelRight />} />
        </span>
      </div>
      <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-pretty text-text-tertiary">
        This page is about the sidebar’s foot.
      </div>
    </section>
  )
}

/** The "Line open" state: click the foot line once it renders, as a person would. */
function useOpenLine(on: boolean) {
  useEffect(() => {
    if (!on) return
    let tries = 0
    const timer = window.setInterval(() => {
      const line = document.querySelector<HTMLButtonElement>('[data-work-queue]')
      if (line || ++tries > 50) window.clearInterval(timer)
      if (line && line.getAttribute('data-state') !== 'open') line.click()
    }, 100)
    return () => window.clearInterval(timer)
  }, [on])
}

/** One state's whole frame: its own query cache and fakes, so switching states starts clean. */
function Frame({ s, openLine }: { s: Sample; openLine: boolean }) {
  const [queryClient] = useState(
    () => new QueryClient({ mutationCache: new MutationCache(), defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  )
  const [client] = useState(() => trpc.createClient({ links: trpcLinks('/api/trpc', fakeTrpcFetch('/api/trpc', fakesFor(s))) }))
  const rail = useRail()
  useOpenLine(openLine)
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ProjectRailContext.Provider value={rail}>
          <SidebarThreadsProvider>
            <OpenFeaturePage s={s} />
            <div className="flex h-dvh bg-canvas">
              <div className="relative isolate flex h-full shrink-0">
                <SidebarBackdrop />
                <DesktopRail />
                <SidebarBackdropDrawn.Provider value>
                  <div className="flex h-full shrink-0 flex-col" style={{ width: SIDEBAR_W }}>
                    <Sidebar
                      projectId={PROJECT_ID}
                      nav={nav}
                      view="feature"
                      selectedFeatureId={s.open.feature.id}
                      onSelect={noop}
                      onSelectProject={noop}
                      onNewChat={noop}
                      onDraft={noop}
                      onOpenSettings={noop}
                      onOpenWorkerChat={noop}
                      queue={
                        <WorkQueue
                          limit={LIMIT}
                          working={s.working}
                          waiting={s.waiting}
                          currentProjectId={HERE.id}
                          onOpen={noop}
                          onOpenSettings={noop}
                        />
                      }
                    />
                  </div>
                </SidebarBackdropDrawn.Provider>
              </div>
              <Panel />
            </div>
          </SidebarThreadsProvider>
        </ProjectRailContext.Provider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

function Page() {
  const [state, setState] = useState<StateKey>(pickState)
  useDesignReport(state)
  const sample = useMemo(() => {
    const s = STATES.find((x) => x.key === state)!.make()
    seedFolds(s)
    return s
  }, [state])
  const go = (next: StateKey) => {
    setState(next)
    history.replaceState(null, '', `?${new URLSearchParams({ state: next }).toString()}`)
  }
  return (
    <>
      <Frame key={state} s={sample} openLine={state === 'open'} />
      <DesignPanel states={STATES} state={state} onPick={go} />
    </>
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
