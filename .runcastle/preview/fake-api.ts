import type { QueryKey } from '@tanstack/react-query'
import type { RouterOutputs } from '../../apps/web/src/lib/api'

// Fake data for rendering the real app without a backend: tRPC answered at the
// `fetch` edge, the shell's session data (`shell-fakes.ts`), the app at an
// address (`app-at.tsx`) and a silent live stream (`event-source.ts`). These
// are design mode's starting point and are used by nothing else yet.

/**
 * A fake's answers to the queries it makes, typed from the router's own
 * outputs: a procedure whose result changes breaks the preview typecheck
 * instead of drifting. Keyed `router.procedure`, the shape nearly every
 * procedure has.
 */
export type TrpcFakes = {
  [R in keyof RouterOutputs]?: {
    [P in keyof RouterOutputs[R]]?: (input: unknown) => RouterOutputs[R][P]
  }
}

/** Where a preview's data comes from: tRPC answers, plus plain-HTTP reads seeded into the cache. */
export interface PreviewApi {
  trpc?: TrpcFakes
  /** Query keys the app fills over plain `fetch` (the review artifacts), seeded as-is. */
  cache?: ReadonlyArray<readonly [QueryKey, unknown]>
}

type Answer = { result: { data: unknown } } | { error: { message: string; code: number; data: { code: string; httpStatus: number; path: string } } }

function refuse(path: string, message: string): Answer {
  return { error: { message, code: -32004, data: { code: 'NOT_FOUND', httpStatus: 404, path } } }
}

/**
 * A mutation is refused unless the fakes answer it by name: a preview shows
 * states, and a write is answered only where a flow cannot move on without its
 * success (the first-run wizard's git identity, which gates every later step).
 */
function answer(fakes: TrpcFakes, path: string, input: unknown, isMutation: boolean): Answer {
  const dot = path.indexOf('.')
  const router = (fakes as Record<string, Record<string, ((input: unknown) => unknown) | undefined> | undefined>)[
    path.slice(0, dot)
  ]
  const handler = router?.[path.slice(dot + 1)]
  if (handler) return { result: { data: handler(input) } }
  return refuse(path, isMutation ? 'A preview shows states; it does not act.' : `Not faked in this preview: ${path}`)
}

/**
 * The network edge for tRPC: a `fetch` that answers the client's own wire
 * format (batched or not) from {@link TrpcFakes}, so the app's links, client and
 * hooks all run unchanged and nothing leaves the page. An unfaked query answers
 * NOT_FOUND, which the app shows the way it shows any failed read.
 */
export function fakeTrpcFetch(endpoint: string, fakes: TrpcFakes): typeof fetch {
  return (async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(request), 'http://preview.invalid')
    const paths = decodeURIComponent(url.pathname.slice(endpoint.length + 1)).split(',')
    const isMutation = init?.method === 'POST'
    const raw: unknown = isMutation
      ? JSON.parse(String(init?.body ?? 'null'))
      : JSON.parse(url.searchParams.get('input') ?? 'null')
    const batched = url.searchParams.get('batch') === '1'
    const answers = paths.map((path, i) =>
      answer(fakes, path, batched ? (raw as Record<string, unknown> | null)?.[i] : raw, isMutation),
    )
    return Response.json(batched ? answers : answers[0])
  }) as typeof fetch
}
