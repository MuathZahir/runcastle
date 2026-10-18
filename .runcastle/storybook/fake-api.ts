import type { QueryKey } from '@tanstack/react-query'
import type { RouterOutputs } from '../../apps/web/src/lib/api'

/**
 * A story's answers to the queries it makes, typed from the router's own
 * outputs: a procedure whose result changes breaks the stories typecheck
 * instead of drifting. Keyed `router.procedure`, the shape nearly every
 * procedure has.
 */
export type TrpcFakes = {
  [R in keyof RouterOutputs]?: {
    [P in keyof RouterOutputs[R]]?: (input: unknown) => RouterOutputs[R][P]
  }
}

/** What a story's data comes from: tRPC answers, plus plain-HTTP reads seeded into the cache. */
export interface StoryApi {
  trpc?: TrpcFakes
  /** Query keys the app fills over plain `fetch` (the review artifacts), seeded as-is. */
  cache?: ReadonlyArray<readonly [QueryKey, unknown]>
}

/** A story's `parameters`, typed — Storybook's own are `Record<string, any>`. */
export function withApi(api: StoryApi): { api: StoryApi } {
  return { api }
}

type Answer = { result: { data: unknown } } | { error: { message: string; code: number; data: { code: string; httpStatus: number; path: string } } }

function refuse(path: string, message: string): Answer {
  return { error: { message, code: -32004, data: { code: 'NOT_FOUND', httpStatus: 404, path } } }
}

function answer(fakes: TrpcFakes, path: string, input: unknown, isMutation: boolean): Answer {
  if (isMutation) return refuse(path, 'Stories show states; they do not act.')
  const dot = path.indexOf('.')
  const router = (fakes as Record<string, Record<string, ((input: unknown) => unknown) | undefined> | undefined>)[
    path.slice(0, dot)
  ]
  const handler = router?.[path.slice(dot + 1)]
  return handler ? { result: { data: handler(input) } } : refuse(path, `Not faked in this story: ${path}`)
}

/**
 * The network edge for tRPC: a `fetch` that answers the client's own wire
 * format (batched or not) from {@link TrpcFakes}, so the app's links, client and
 * hooks all run unchanged and nothing leaves the page. An unfaked query answers
 * NOT_FOUND, which the app shows the way it shows any failed read.
 */
export function fakeTrpcFetch(endpoint: string, fakes: TrpcFakes): typeof fetch {
  return (async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(request), 'http://stories.invalid')
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
