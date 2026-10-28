import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TRPCClientError, type TRPCLink } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import type { ReactNode } from 'react'
import type { AppRouter } from '@runcastle/server'
import { trpc } from '../src/trpc'

/**
 * The app's real tRPC hooks over a fake server: a link that answers each call
 * from `handlers` by its dotted path, and refuses an unanswered one the way a
 * `NotImplementedError` socket does. The client, the query cache and every
 * hook run unchanged, so a test sees what the browser would — which reads a
 * live signal triggers, and with which cursor.
 */
// `any`, quarantined: each handler takes its own procedure's input.
export type FakeHandlers = Record<string, (input: any) => unknown>

export interface FakeCall {
  path: string
  input: unknown
}

export function fakeTrpc(handlers: FakeHandlers) {
  const calls: FakeCall[] = []
  const link: TRPCLink<AppRouter> =
    () =>
    ({ op }) =>
      observable((observer) => {
        calls.push({ path: op.path, input: op.input })
        const handler = handlers[op.path]
        Promise.resolve()
          .then(() => {
            if (!handler) throw new Error(`Not implemented: ${op.path}`)
            return handler(op.input)
          })
          .then(
            (data) => {
              observer.next({ result: { type: 'data', data } })
              observer.complete()
            },
            (e: unknown) => observer.error(TRPCClientError.from(e instanceof Error ? e : new Error(String(e)))),
          )
        return () => undefined
      })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const client = trpc.createClient({ links: [link] })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <trpc.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </trpc.Provider>
    )
  }
  /** The calls made to `path`, their inputs in order. */
  const inputs = (path: string): unknown[] => calls.filter((c) => c.path === path).map((c) => c.input)
  return { calls, inputs, Wrapper, queryClient }
}
