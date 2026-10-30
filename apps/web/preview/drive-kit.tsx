import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { trpc, trpcLinks } from '../src/trpc'
import { useTheme } from '../src/lib/theme'
import { cx } from '../src/ui'
import { fakeTrpcFetch, type TrpcFakes } from '../../../.runcastle/preview/fake-api'

/**
 * What the two drive previews share: one tRPC client per moment over faked
 * answers, and the moment bar across the top (test-drive-looks-the-part).
 */

/** One client per moment: the drive's answers differ, and nothing should leak between them. */
export function Api({ fakes, children }: { fakes: TrpcFakes; children: ReactNode }) {
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
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  )
}

/** The moment named in the address (`?moment=`), else the first. */
export function useMoment<T extends { key: string }>(moments: readonly T[]): [T, (key: string) => void] {
  const [key, setKey] = useState(() => new URLSearchParams(location.search).get('moment') ?? moments[0]!.key)
  return [moments.find((m) => m.key === key) ?? moments[0]!, setKey]
}

/** Clicks a control once the page has settled, for a moment that shows something opened. */
export function useClickAfterLoad(selector: string | undefined) {
  useEffect(() => {
    if (!selector) return
    const timer = setTimeout(() => document.querySelector<HTMLElement>(selector)?.click(), 900)
    return () => clearTimeout(timer)
  }, [selector])
}

export function MomentBar<T extends { key: string; label: string }>({
  moments,
  current,
  onPick,
}: {
  moments: readonly T[]
  current: string
  onPick: (key: string) => void
}) {
  const theme = useTheme()
  const chip = (on: boolean) =>
    cx('h-6 shrink-0 cursor-pointer rounded-md px-2', on ? 'bg-surface-selected text-text' : 'hover:bg-surface-hover hover:text-text-secondary')
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border-subtle px-3 py-2 text-xs text-text-tertiary">
      <span className="mr-2 shrink-0">Moment</span>
      {moments.map((m) => (
        <button key={m.key} type="button" onClick={() => onPick(m.key)} className={chip(m.key === current)}>
          {m.label}
        </button>
      ))}
      <button type="button" onClick={theme.toggle} className={cx(chip(false), 'ml-auto')}>
        {theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'}
      </button>
    </div>
  )
}
