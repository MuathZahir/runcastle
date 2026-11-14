import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useMemo, useState } from 'react'
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
import { DesktopRail, ProjectRailContext, type ProjectRailApi } from '../src/components/ProjectRail'
import { IconMore, IconPanelRight } from '../src/icons'
import { SidebarThreadsProvider, usePublishSidebarThreads } from '../src/lib/sidebar-threads'
import type { ProjectNavApi } from '../src/lib/use-project-nav'
import { applyStoredTheme } from '../src/lib/theme'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { fakeTrpcFetch } from '../../../.runcastle/preview/fake-api'
import { useDesignReport } from '../../../.runcastle/preview/design-report'
import { PROJECT_ID, project, withShell } from '../../../.runcastle/preview/shell-fakes'
import { DesignPanel, makeDeadEnd } from './autopilot-design-panel'
import { RAIL_TILES } from './autopilot-sidebar-data'
import { STATES, type Sample, type StateKey } from './workers-nested-data'

/**
 * Workers nest under their feature (docs/features/workers-nest-under-their-
 * feature): the real `Sidebar`, its queries answered at the network edge from
 * sample data, in each state the design is judged in. The open feature's
 * threads are published as its page publishes them. Pick the state with
 * `?state=` or the "Design · states" card. Links and writes go nowhere.
 */

applyStoredTheme()
installSilentEventSource()
makeDeadEnd()

const noop = () => {}
const params = new URLSearchParams(location.search)
const pickState = (): StateKey => STATES.find((x) => x.key === params.get('state'))?.key ?? 'open'

/** A realistic sidebar: a little past the 248 default, as most people drag it. */
const SIDEBAR_W = 288

const FOLD_PREFIX = 'runcastle.sidebar.workersFolded:'

/** The browser's remembered folds, as this state has them. */
function seedFolds(folded: readonly string[]): void {
  for (const key of Object.keys(localStorage)) if (key.startsWith(FOLD_PREFIX)) localStorage.removeItem(key)
  for (const id of folded) localStorage.setItem(FOLD_PREFIX + id, '1')
}

/**
 * The "Hover +" state holds one row in its hover, as the pointer would: its
 * ground, its "+" and "…", the marks under them hidden. Drawn by this page
 * alone; the app's rows reveal the same on a real hover.
 */
const hoverStyle = (title: string) => {
  const row = `.group\\/nav:has(> button[title="${title}"])`
  return `${row}{background:var(--color-surface-hover)}${row} [data-row-actions]{opacity:1}${row} .group-hover\\/nav\\:opacity-0{opacity:0}`
}

function fakesFor(s: Sample) {
  return withShell({
    feature: { list: () => s.features },
    thread: { list: () => s.chats as never },
    worker: {
      listLive: () => s.workers.filter((w) => !['handed-back', 'landed', 'dropped'].includes(w.status)),
      list: (input) => s.workers.filter((w) => w.featureId === (input as { featureId: string }).featureId),
    },
  })
}

/** The open feature's page, as far as the sidebar sees it: its threads published. */
function OpenFeaturePage({ s, current, pick }: { s: Sample; current: string | null; pick: (id: string) => void }) {
  usePublishSidebarThreads(
    s.open
      ? {
          scope: { featureId: s.open.feature.id },
          threads: [s.open.lead, ...s.open.oldChats],
          current,
          pick,
          newThread: noop,
        }
      : null,
  )
  return null
}

/** A fake rail the real rail reads. */
function useRail(): ProjectRailApi {
  return useMemo(
    () => ({ tiles: RAIL_TILES, currentId: 'proj_1', enter: noop, goHome: noop, open: noop, reorder: noop }),
    [],
  )
}

const nav = { currentProject: { ...project, name: 'shopfront' } } as unknown as ProjectNavApi

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
        This page is about the sidebar.
      </div>
    </section>
  )
}

/** One state's whole frame: its own query cache and fakes, so switching states starts clean. */
function Frame({ s }: { s: Sample }) {
  const [queryClient] = useState(
    () => new QueryClient({ mutationCache: new MutationCache(), defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }),
  )
  const [client] = useState(() => trpc.createClient({ links: trpcLinks('/api/trpc', fakeTrpcFetch('/api/trpc', fakesFor(s))) }))
  const [current, setCurrent] = useState(s.open?.current ?? null)
  const rail = useRail()
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ProjectRailContext.Provider value={rail}>
          <SidebarThreadsProvider>
            <OpenFeaturePage s={s} current={current} pick={setCurrent} />
            {s.hover && <style>{hoverStyle(s.hover)}</style>}
            <div className="flex h-dvh bg-canvas">
              <div className="relative isolate flex h-full shrink-0">
                <SidebarBackdrop />
                <DesktopRail />
                <SidebarBackdropDrawn.Provider value>
                  <div className="flex h-full shrink-0 flex-col" style={{ width: SIDEBAR_W }}>
                    <Sidebar
                      projectId={PROJECT_ID}
                      nav={nav}
                      view={s.open ? 'feature' : 'project'}
                      selectedFeatureId={s.open?.feature.id ?? null}
                      onSelect={noop}
                      onSelectProject={noop}
                      onNewChat={noop}
                      onDraft={noop}
                      onOpenWorkerChat={(_f, w) => setCurrent(w)}
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
    seedFolds(s.folded)
    return s
  }, [state])
  const go = (next: StateKey) => {
    setState(next)
    history.replaceState(null, '', `?${new URLSearchParams({ state: next }).toString()}`)
  }
  return (
    <>
      <Frame key={state} s={sample} />
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
