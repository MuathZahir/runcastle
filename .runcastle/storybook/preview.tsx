import type { Decorator, Preview } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
// The app's CSS entry, in main.tsx's order: theme.css declares the tokens.
import '../../apps/web/src/theme.css'
import '../../apps/web/src/styles.css'
import { ToastProvider } from '../../apps/web/src/lib/toast'
import { trpc, trpcLinks } from '../../apps/web/src/trpc'
import { TooltipProvider } from '../../apps/web/src/ui/tooltip'
import { fakeTrpcFetch, type StoryApi } from './fake-api'

/** The client's same-origin endpoint (main.tsx); here it never reaches a server. */
const ENDPOINT = '/api/trpc'

/**
 * The live event stream at its edge, for the page stories that render `App`
 * (whose `useLiveSync` opens `/api/stream`): a stream that opens and never
 * sends, so nothing reaches a server. Not even the server's `ready` handshake:
 * the app answers that with a full resync (lib/live.ts), which would refetch
 * the review artifacts a story seeds into the cache over a real `fetch`. So the
 * app keeps reading the stream as connecting, and its polls tick against the
 * story's fakes, in the page.
 */
class SilentEventSource extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSED = 2
  readonly withCredentials = false
  readonly url: string
  readyState = SilentEventSource.CONNECTING
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    setTimeout(() => {
      if (this.readyState === SilentEventSource.CLOSED) return
      this.readyState = SilentEventSource.OPEN
      const open = new Event('open')
      this.onopen?.(open)
      this.dispatchEvent(open)
    })
  }

  close(): void {
    this.readyState = SilentEventSource.CLOSED
  }
}
// The stand-in's shape is EventSource's; the cast is only for its generic
// listener overloads, which EventTarget's plain ones already accept.
globalThis.EventSource = SilentEventSource as unknown as typeof EventSource

/**
 * The app's providers, as main.tsx stacks them, around every story — with a
 * story-local query client and a tRPC client whose network is the story's own
 * fakes. A page story renders `App` inside them (`app-at.tsx`); its live
 * stream is the silent one above.
 */
function Providers({ api, children }: { api: StoryApi; children: ReactNode }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      // Fixed data stays fixed: nothing refetches on its own, and a failed read
      // shows at once rather than after retries.
      defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
    })
    for (const [key, data] of api.cache ?? []) client.setQueryData(key, data)
    return client
  })
  const [trpcClient] = useState(() =>
    trpc.createClient({ links: trpcLinks(ENDPOINT, fakeTrpcFetch(ENDPOINT, api.trpc ?? {})) }),
  )
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </trpc.Provider>
  )
}

const withProviders: Decorator = (Story, context) => (
  <Providers api={(context.parameters.api as StoryApi | undefined) ?? {}}>
    <Story />
  </Providers>
)

/** `<html data-theme>`, the one attribute theme.css re-skins the app on. */
const withTheme: Decorator = (Story, context) => {
  document.documentElement.dataset.theme = context.globals.theme === 'light' ? 'light' : 'dark'
  return <Story />
}

const preview: Preview = {
  decorators: [withProviders, withTheme],
  globalTypes: {
    theme: {
      description: 'Colour theme',
      toolbar: { icon: 'mirror', items: ['dark', 'light'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'dark' },
  parameters: { layout: 'padded' },
}

export default preview
