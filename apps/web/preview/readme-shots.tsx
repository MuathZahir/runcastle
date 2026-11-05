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
import { GlossaryProvider } from '../src/components/GlossaryDialog'
import { applyStoredTheme } from '../src/lib/theme'
import type { RouterOutputs } from '../src/lib/api'
import { AppAt } from '../../../.runcastle/preview/app-at'
import { fakeTrpcFetch, type TrpcFakes } from '../../../.runcastle/preview/fake-api'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { PROJECT_ID, project, withShell } from '../../../.runcastle/preview/shell-fakes'
import {
  DRIVE_NOTE,
  DRIVE_STARTED_AT,
  FEATURE_CHATS,
  OPEN_NOTES,
  ORCH_CHATS,
  ORCH_LOG,
  PROJECT_NAME,
  REPO_PATH,
  RT,
  TAGS,
  TAGS_LOG,
  TAGS_PACKAGE,
  features,
  rtFull,
  rtLog,
  rtRounds,
  tagsFull,
  tagsRounds,
  type RtStage,
} from './readme-shots-data'

/**
 * The README's pictures (site/assets/screens/*.png): the whole app on the
 * shiplog sample data, one state per `?shot=` — tickets, build, review,
 * project-chat, drive, note, project. States behind a click (the drive, the
 * Notes panel, the Ctrl+J note) are reached by clicking in the capture
 * script, as a person would. The drive's app is readme-shiplog.html, served
 * on its own port (http://localhost:4600). A dead end on purpose: links do
 * nothing, and every write is refused.
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

const SHIPLOG_URL = 'http://localhost:4600/'

type Project = RouterOutputs['project']['list'][number]
const demo = {
  ...project,
  name: PROJECT_NAME,
  repoPath: REPO_PATH,
  devCommand: 'bun run dev',
  driveSetupCommand: 'bun run db:reset',
} as Project

const IDLE = { items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }
const MODELS = { runtime: 'claude-code', models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }], current: 'claude-opus-5-5' }

const shot = new URLSearchParams(location.search).get('shot') ?? 'tickets'

const projectDrive = {
  projectDrive: true,
  projectId: PROJECT_ID,
  purpose: 'test-drive',
  holderLabel: 'a test drive of main',
  branch: 'main',
  commit: '950d42c',
  devPaneId: 'pane_dev',
  devUrl: SHIPLOG_URL,
  devReady: true,
  devConfigured: true,
  state: 'serving',
  startedAt: DRIVE_STARTED_AT,
}

interface Shot {
  path: string
  /** The panel view to land on, for a feature page. */
  view?: { featureId: string; view: string }
  fakes: TrpcFakes
}

function featureFakes(stage: RtStage, open: 'rt' | 'tags'): TrpcFakes {
  const full = open === 'rt' ? rtFull(stage) : tagsFull()
  const rounds = open === 'rt' ? rtRounds(stage) : tagsRounds
  const logs: Record<string, unknown[]> = { rt_main: rtLog(stage), tags_main: TAGS_LOG, c1: ORCH_LOG }
  return withShell({
    project: { list: () => [demo] },
    feature: {
      list: () => features(stage),
      get: () => full,
      rounds: () => rounds as never,
      readyDeclarations: () => [] as never,
      driveInfo: () => null,
      driveScenarios: () => ({ scenarios: [], runnerConfigured: false }) as never,
      sessions: () => [] as never,
      mergeDelta: () => ({ commits: open === 'rt' ? 6 : 11, files: open === 'rt' ? 19 : 14 }) as never,
      commitCount: () => ({ count: open === 'rt' ? 6 : 11 }) as never,
    },
    docs: { read: () => ({ content: '' }) },
    run: {
      get: () => full.runs[0] as never,
      listByFeature: () => full.runs as never,
    },
    findings: {
      listByFeature: () =>
        ({ findings: [], openDefects: [], carriedFindings: [], summary: { found: 0, fixed: 0, open: 0, observations: 0 } }) as never,
    },
    notes: { list: () => [] as never, delivery: () => null as never },
    design: { status: () => ({ running: false }) as never },
    settings: { get: () => ({ fields: [] }) as never },
    thread: {
      list: (input) => {
        const i = input as { featureId?: string; projectId?: string }
        return (i.featureId ? (FEATURE_CHATS[i.featureId] ?? []) : ORCH_CHATS) as never
      },
      view: () => IDLE as never,
      events: (input) => ({ events: logs[(input as { threadId: string }).threadId] ?? [] }) as never,
      models: () => MODELS as never,
    },
    events: { list: () => [] as never },
    projectNotes: { openCount: () => 3, list: () => OPEN_NOTES },
  } as TrpcFakes)
}

function orchestratorFakes(withDrive: boolean): TrpcFakes {
  const notes = withDrive ? [DRIVE_NOTE, ...OPEN_NOTES] : OPEN_NOTES
  return withShell({
    project: { list: () => [demo] },
    feature: {
      list: () => features('building'),
      driveInfo: () => (withDrive ? projectDrive : null) as never,
      driveScenarios: () => ({ scenarios: [], runnerConfigured: false }) as never,
    },
    thread: {
      list: () => ORCH_CHATS as never,
      view: () => IDLE as never,
      events: (input) => ({ events: (input as { threadId: string }).threadId === 'c1' ? ORCH_LOG : [] }) as never,
      models: () => MODELS as never,
    },
    projectNotes: {
      openCount: () => notes.filter((n) => n.status === 'open').length,
      list: () => notes,
    },
    notes: { list: () => [] as never, delivery: () => ({ waitingSince: null, lastFailure: null }) as never },
  } as TrpcFakes)
}

const SHOTS: Record<string, () => Shot> = {
  tickets: () => ({ path: `/p/${PROJECT_ID}/f/${RT.slug}`, view: { featureId: RT.id, view: 'work' }, fakes: featureFakes('planning', 'rt') }),
  build: () => ({ path: `/p/${PROJECT_ID}/f/${RT.slug}`, view: { featureId: RT.id, view: 'work' }, fakes: featureFakes('building', 'rt') }),
  review: () => ({ path: `/p/${PROJECT_ID}/f/${TAGS.slug}`, view: { featureId: TAGS.id, view: 'work' }, fakes: featureFakes('building', 'tags') }),
  note: () => ({ path: `/p/${PROJECT_ID}/f/${RT.slug}`, view: { featureId: RT.id, view: 'work' }, fakes: featureFakes('building', 'rt') }),
  'project-chat': () => ({ path: `/p/${PROJECT_ID}/chat?thread=c1`, fakes: orchestratorFakes(false) }),
  project: () => ({ path: `/p/${PROJECT_ID}/chat?thread=c1`, fakes: orchestratorFakes(false) }),
  drive: () => ({ path: `/p/${PROJECT_ID}/chat?thread=c1`, fakes: orchestratorFakes(true) }),
}

const current = (SHOTS[shot] ?? SHOTS.tickets!)()

// The review package and its walkthrough are read over plain fetch.
const realFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.includes('/package.json')) return Promise.resolve(Response.json(TAGS_PACKAGE))
  if (url.includes('/api/reviews/')) return Promise.resolve(Response.json([]))
  return realFetch(input, init)
}

/** `AppAt` clears storage as it mounts; the feature's panel view is written straight after. */
/** The sidebar a little wider than its default, so the project's name is not cut. */
const clearStorage = localStorage.clear.bind(localStorage)
localStorage.clear = () => {
  clearStorage()
  localStorage.setItem('runcastle.sidebar.w', '272')
  if (current.view) localStorage.setItem(`runcastle.feature.tab:${current.view.featureId}`, current.view.view)
}

function Root() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache(),
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  )
  const [client] = useState(() => trpc.createClient({ links: trpcLinks('/api/trpc', fakeTrpcFetch('/api/trpc', current.fakes)) }))
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ToastProvider>
            {/* As main.tsx has it: the Glossary is what puts Help in the sidebar's bottom row. */}
            <GlossaryProvider>
              <AppAt path={current.path} />
            </GlossaryProvider>
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

/** Put this page's address back once the app has read its own, so a reload comes back here. */
const previewAddress = location.pathname + location.search
setTimeout(() => window.history.replaceState(null, '', previewAddress), 1000)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
