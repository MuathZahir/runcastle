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
import { applyStoredTheme } from '../src/lib/theme'
import { AppAt } from '../../../.runcastle/preview/app-at'
import { fakeTrpcFetch } from '../../../.runcastle/preview/fake-api'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { PROJECT_ID, withShell } from '../../../.runcastle/preview/shell-fakes'
import { busyFeatures } from './sidebar-data'

/**
 * The whole app — the real sidebar beside the real project page — on sample
 * data, to judge the shared look across the frame (docs/features/
 * the-whole-app-matches-the-sidebar). A dead end on purpose: links and
 * navigation do nothing here, and every write is refused.
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

const now = Date.now()
const fakes = withShell({
  feature: { list: () => busyFeatures, driveInfo: () => null },
  thread: {
    list: () => [
      { id: 'c1', title: 'Cut the UI work into seven features', role: 'project', state: 'waiting', updatedAt: now - 600_000, runtime: 'claude-code' },
      { id: 'c2', title: 'Why did the burn of #14 stall overnight?', role: 'project', state: 'idle', updatedAt: now - 80_000_000, runtime: 'claude-code' },
      { id: 'c3', title: 'Plan the changelog release flow', role: 'project', state: 'idle', updatedAt: now - 2 * 86_400_000, runtime: 'claude-code' },
      { id: 'c4', title: 'Triage the notes from Tuesday’s drive', role: 'project', state: 'idle', updatedAt: now - 6 * 86_400_000, runtime: 'codex' },
    ],
  },
  projectNotes: { openCount: () => 2, list: () => [] },
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
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ToastProvider>
            <AppAt path={`/p/${PROJECT_ID}/chat`} />
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

/**
 * `AppAt` points the address at the app's own path so the app lands there as
 * it mounts. Once it has read it, put this page's address back, so a reload
 * (or the design panel reopening) comes back to this preview, not to a path
 * only the real server answers.
 */
const previewAddress = location.pathname + location.search
setTimeout(() => window.history.replaceState(null, '', previewAddress), 1000)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
