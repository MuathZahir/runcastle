import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { httpBatchLink } from '@trpc/client'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { unhandledMutationError } from './lib/mutation-errors'
import { pushToast, ToastProvider } from './lib/toast'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
import { trpc } from './trpc'

function Root() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // The safety net under every mutation: a call site that forgets its own
        // `onError` would otherwise fail in total silence — the button just
        // stops working. Handled mutations opt out (see `unhandledMutationError`)
        // so nothing gets reported twice.
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            const message = unhandledMutationError(error, mutation)
            if (message) pushToast(message)
          },
        }),
        defaultOptions: {
          queries: {
            retry: false,
            // Refetch when the tab comes back. This was `false`, which is what
            // made a backgrounded tab look frozen: TanStack Query skips
            // `refetchInterval` ticks while the document is hidden AND browsers
            // throttle those timers to ~1/min, and the interval is not
            // rescheduled on return — so with no focus refetch the UI could sit
            // stale for a minute until someone reloaded the page. The SSE feed
            // (lib/live.ts) is the primary path now; this is its safety net for
            // when the stream is down. Queries that are genuinely expensive
            // (`setup.doctor`) opt out locally.
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
        },
      }),
  )
  const [trpcClient] = useState(() =>
    trpc.createClient({
      // Same-origin URL — Vite proxies `/api` to the server on 4512.
      links: [httpBatchLink({ url: '/api/trpc' })],
    }),
  )

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root not found')
createRoot(rootEl).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
