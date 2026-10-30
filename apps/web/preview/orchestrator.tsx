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
import { busyFeatures } from './sidebar-data'
import { busyChats, busyNotes, chatLog } from './orchestrator-data'

/**
 * The Orchestrator as a chat (docs/features/the-orchestrator-s-page): the real
 * sidebar beside the real page, on sample data. It opens on the latest chat;
 * the sidebar's "All 18 conversations" opens the Conversations page. A dead end
 * on purpose: links do nothing, and every write is refused.
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
/** The sample in the query, so the design panel can open one directly. */
const asked = new URLSearchParams(location.search).get('sample')

type Project = RouterOutputs['project']['list'][number]
const prepared = { ...project, devCommand: 'bun run dev', driveSetupCommand: 'bun run drive:setup' } as Project
const openNotes = busyNotes.filter((n) => n.status === 'open').length

const IDLE = { items: [], state: 'idle', plan: [], tasks: [], commands: [], process: 'stopped', cursor: -1 }
const MODELS = { runtime: 'claude-code', models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }], current: 'claude-opus-5-5' }
const chatFakes = (log: unknown[]) =>
  ({ view: () => IDLE, events: () => ({ events: log }), models: () => MODELS }) as unknown as NonNullable<TrpcFakes['thread']>

const busy = (): TrpcFakes =>
  withShell({
    project: { list: () => [prepared] },
    feature: { list: () => busyFeatures, driveInfo: () => null },
    thread: { ...chatFakes(chatLog), list: () => busyChats },
    projectNotes: { openCount: () => openNotes, list: () => busyNotes },
  })

const SAMPLES: { key: string; label: string; path: string; fakes: () => TrpcFakes }[] = [
  { key: 'latest', label: 'Opens the latest chat', path: `/p/${PROJECT_ID}/chat`, fakes: busy },
  { key: 'conversations', label: 'Conversations', path: `/p/${PROJECT_ID}/conversations`, fakes: busy },
  {
    key: 'new',
    label: 'No chats yet',
    path: `/p/${PROJECT_ID}/chat`,
    fakes: () =>
      withShell({
        feature: { list: () => [], driveInfo: () => null },
        thread: { ...chatFakes([]), list: () => [] },
      }),
  },
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
  // `AppAt` points the address at the app's own path as it mounts. Once the app
  // has read it, put this page's address back, so a reload comes back here.
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
      {/* The app sizes itself to the window; here it shares it with the bar. */}
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
