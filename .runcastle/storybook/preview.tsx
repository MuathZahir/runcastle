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
 * The app's providers, as main.tsx stacks them, around every story — with a
 * story-local query client and a tRPC client whose network is the story's own
 * fakes. Never the app's live event stream: that is started by `App`, which no
 * story renders.
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
