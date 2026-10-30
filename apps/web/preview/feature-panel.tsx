import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { trpc, trpcLinks } from '../src/trpc'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { AppAt } from '../../../.runcastle/preview/app-at'
import { fakeTrpcFetch } from '../../../.runcastle/preview/fake-api'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { PROJECT_ID, withShell } from '../../../.runcastle/preview/shell-fakes'
import { listItem } from '../test/fixtures'
import { DOCS, FEATURE_ID, SLUG, STEPS, TITLE, fullAt, roundsAt, type Step } from './feature-panel-data'

/**
 * The feature page's right panel at each step a feature passes through — plan,
 * docs, tickets, the running round, review, shipped — in the real app on
 * sample data (docs/features/the-feature-s-right-panel-step-by-step). Pick the
 * step with `?step=`, or from the bar at the bottom. A dead end on purpose:
 * links and navigation do nothing here, and every write is refused.
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

const params = new URLSearchParams(location.search)
const stepKey = (params.get('step') ?? 'plan') as Step
const step = STEPS.find((s) => s.key === stepKey) ?? STEPS[0]!
const full = fullAt(step.key)

/**
 * A bare feature address is Work, but the app lands on what the browser
 * remembers for the feature (the chat alone on a fresh one). `AppAt` clears
 * storage as it mounts, so the remembered view is written straight after.
 */
const clearStorage = localStorage.clear.bind(localStorage)
localStorage.clear = () => {
  clearStorage()
  localStorage.setItem(`runcastle.feature.tab:${FEATURE_ID}`, step.view)
}

const fakes = withShell({
  feature: {
    list: () => [
      listItem({
        id: FEATURE_ID,
        slug: SLUG,
        status: full.feature.status,
        ticketCounts: {
          total: full.tickets.length,
          pending: full.tickets.filter((t) => t.status === 'pending').length,
          burning: full.tickets.filter((t) => t.status === 'burning').length,
          done: full.tickets.filter((t) => t.status === 'done').length,
          failed: 0,
          cancelled: 0,
        },
        activeRun: step.key === 'round',
        lastActivityAt: Date.now() - 4 * 60_000,
      }),
    ].map((row) => ({ ...row, title: TITLE })),
    get: () => full,
    rounds: () => roundsAt(step.key) as never,
    readyDeclarations: () =>
      (step.key === 'ready'
        ? [{ id: 'rd_1', featureId: FEATURE_ID, runId: 'run_1', scenario: 'Every screen beside the sidebar', createdAt: Date.now() - 3 * 60_000 }]
        : []) as never,
    driveInfo: () => null,
    driveScenarios: () => [] as never,
    sessions: () => [] as never,
    mergeDelta: () => ({ commits: 8, files: 27 }) as never,
    commitCount: () => ({ count: 8 }) as never,
  },
  docs: { read: (input) => ({ content: DOCS[(input as { relPath: string }).relPath] ?? '' }) },
  run: {
    get: () => full.runs[0] as never,
    listByFeature: () => full.runs as never,
  },
  findings: {
    listByFeature: () =>
      ({
        findings: [],
        openDefects: [],
        carriedFindings: [],
        summary: { found: 0, fixed: 0, open: 0, observations: 0 },
      }) as never,
  },
  notes: { list: () => [] as never, delivery: () => null as never },
  design: { status: () => ({ running: false }) as never },
  settings: { get: () => ({ fields: [] }) as never },
  thread: { list: () => [] as never },
  events: { list: () => [] as never },
})

function Root() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache(),
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  )
  const [client] = useState(() => trpc.createClient({ links: trpcLinks('/api/trpc', fakeTrpcFetch('/api/trpc', fakes)) }))
  const path = `/p/${PROJECT_ID}/f/${SLUG}${step.view === 'work' ? '' : `/${step.view}`}`
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ToastProvider>
            <AppAt path={path} />
            <StepBar />
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

/**
 * The Tweaks menu's one open choice (decision 3): the panel's view tabs with
 * their words, or icons only with the open tab's word. Icons only is drawn by
 * this page alone — a style it injects — so deleting the menu leaves nothing
 * behind in the app.
 */
const ICONS_ONLY_STYLE =
  '[role=tablist][aria-label="Panel views"] [role=tab][aria-selected=false] > span:last-child{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}'

type TabWords = 'words' | 'icons'

/** The preview's own controls: which step the panel stands at, the theme, and the Tweaks. Not part of the app. */
function StepBar() {
  const theme = useTheme()
  const [open, setOpen] = useState(true)
  const [words, setWords] = useState<TabWords>(() => (params.get('tabs') === 'icons' ? 'icons' : 'words'))
  const pill = (on: boolean) =>
    on
      ? 'h-6 cursor-pointer rounded-md bg-surface-selected px-2 text-text'
      : 'h-6 cursor-pointer rounded-md px-2 hover:bg-surface-hover hover:text-text-secondary'
  const go = (key: string, tabs: TabWords) => {
    location.search = `?step=${key}${tabs === 'icons' ? '&tabs=icons' : ''}`
  }
  return (
    <div
      style={{ position: 'fixed', left: 12, bottom: 44, width: 232, zIndex: 1000 }}
      className="flex flex-col gap-1 rounded-lg bg-surface-raised p-1 text-xs text-text-tertiary shadow-popover"
    >
      {words === 'icons' && <style>{ICONS_ONLY_STYLE}</style>}
      <div className="flex flex-wrap items-center gap-1">
        <span className="px-2">Step</span>
        {STEPS.map((s) => (
          <button key={s.key} type="button" onClick={() => go(s.key, words)} className={pill(s.key === step.key)}>
            {s.label}
          </button>
        ))}
        <button type="button" onClick={theme.toggle} className={pill(false)}>
          {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
      <div className="border-t border-border-subtle pt-1">
        <button type="button" onClick={() => setOpen(!open)} className={pill(false)}>
          Tweaks {open ? '–' : '+'}
        </button>
        {open && (
          <div className="flex flex-col gap-1 px-2 pt-1 pb-1">
            <div className="flex items-center gap-1">
              <span className="mr-1 whitespace-nowrap">View tabs</span>
              <button type="button" onClick={() => setWords('words')} className={pill(words === 'words')}>
                Icon and word
              </button>
              <button type="button" onClick={() => setWords('icons')} className={pill(words === 'icons')}>
                Icons only
              </button>
            </div>
            <p className="m-0 font-mono">tabs {words === 'words' ? 'icon and word' : 'icons only'}</p>
          </div>
        )}
      </div>
    </div>
  )
}

/** A state behind a click: open the doc the step names, as the human would, once the list is up. */
if (step.doc) {
  const name = step.doc
  const tryOpen = (left: number) => {
    const row = [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith(name))
    if (row) row.click()
    else if (left > 0) setTimeout(() => tryOpen(left - 1), 200)
  }
  setTimeout(() => tryOpen(25), 500)
}

/** Put this page's address back once the app has read its own, so a reload comes back here. */
const previewAddress = location.pathname + location.search
setTimeout(() => window.history.replaceState(null, '', previewAddress), 1000)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
