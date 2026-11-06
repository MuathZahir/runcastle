import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { trpc, trpcLinks } from '../src/trpc'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { applyStoredTheme, useTheme } from '../src/lib/theme'
import { cx } from '../src/ui'
import type { RouterOutputs } from '../src/lib/api'
import { AppAt } from '../../../.runcastle/preview/app-at'
import { fakeTrpcFetch, type TrpcFakes } from '../../../.runcastle/preview/fake-api'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { PROJECT_ID, project, withShell } from '../../../.runcastle/preview/shell-fakes'

/**
 * "Start the project" (docs/features/the-orchestrator-prepares-the-project,
 * decision 1): a brand-new project, no chats and no features, opens on one
 * button. Two samples: a repo with code, which the Orchestrator reads and
 * prepares first, and a born-empty repo, which it skips straight to the
 * question. A dead end on purpose: links do nothing, and every write is refused.
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

const PREVIEW_ADDRESS = location.pathname + location.search
const asked = new URLSearchParams(location.search).get('sample')

type Project = RouterOutputs['project']['list'][number]
const tinyNotes = { ...project, name: 'tiny-notes', repoPath: '/home/you/code/tiny-notes' } as Project

const IDLE = { items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }
const MODELS = { runtime: 'claude-code', models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }], current: 'claude-opus-5-5' }

/** A new project: nothing on it yet, every prepared setting still open. */
const fresh = (empty: boolean): TrpcFakes =>
  withShell({
    project: {
      list: () => [tinyNotes],
      prep: () => ({ pendingKeys: [], findings: [], prepared: true, empty, preparedAt: null, dryRun: null }),
    },
    feature: { list: () => [], driveInfo: () => null },
    thread: {
      view: () => IDLE,
      events: () => ({ events: [] }),
      models: () => MODELS,
      list: () => [],
    } as unknown as NonNullable<TrpcFakes['thread']>,
  })

const SAMPLES: { key: string; label: string; path: string; fakes: () => TrpcFakes }[] = [
  { key: 'code', label: 'Repo with code', path: `/p/${PROJECT_ID}/chat`, fakes: () => fresh(false) },
  { key: 'empty', label: 'Empty repo', path: `/p/${PROJECT_ID}/chat`, fakes: () => fresh(true) },
]

function Preview({ fakes, path }: { fakes: TrpcFakes; path: string }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache(),
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  )
  const [client] = useState(() => trpc.createClient({ links: trpcLinks('/api/trpc', fakeTrpcFetch('/api/trpc', fakes)) }))
  useEffect(() => {
    const restore = setTimeout(() => window.history.replaceState(null, '', PREVIEW_ADDRESS), 1000)
    return () => clearTimeout(restore)
  }, [])
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ToastProvider>
            <AppAt path={path} />
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

function Page() {
  const [sample, setSample] = useState(asked ?? SAMPLES[0].key)
  const theme = useTheme()
  const current = SAMPLES.find((s) => s.key === sample) ?? SAMPLES[0]
  return (
    <div className="flex h-screen flex-col bg-canvas">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border-subtle px-3 text-xs text-text-tertiary">
        <span>Sample</span>
        {SAMPLES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSample(s.key)}
            className={cx(
              'h-6 cursor-pointer rounded-md px-2',
              s.key === sample ? 'card text-text' : 'hover:bg-surface-hover hover:text-text-secondary',
            )}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={theme.toggle}
          className="h-6 cursor-pointer rounded-md px-2 hover:bg-surface-hover hover:text-text-secondary"
        >
          {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
        </button>
      </div>
      <style>{'[data-preview-app] > div { height: 100% !important }'}</style>
      <div data-preview-app="" className="relative min-h-0 flex-1">
        <Preview key={current.key} fakes={current.fakes()} path={current.path} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <Page />
    </TooltipProvider>
  </StrictMode>,
)
