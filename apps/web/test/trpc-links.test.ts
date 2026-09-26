import { createTRPCClient } from '@trpc/client'
import { initTRPC } from '@trpc/server'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { describe, expect, it } from 'vitest'
import { appRouter } from '../../../packages/server/src/trpc/router'
import { trpcLinks, UNBATCHED_PATHS } from '../src/trpc'

// A stand-in server with the real paths: `feature.get` answers at once, the
// doctor answers only when the test lets it. The router's shape is what the
// links split on, so nothing of the real services is needed.
function standInServer() {
  let releaseDoctor = () => {}
  const doctorGate = new Promise<void>((resolve) => {
    releaseDoctor = resolve
  })
  const t = initTRPC.create()
  const router = t.router({
    feature: t.router({
      get: t.procedure.query(() => ({ id: 'feat_1' })),
      list: t.procedure.query(() => []),
    }),
    setup: t.router({
      doctor: t.procedure.query(async () => {
        await doctorGate
        return { results: [] }
      }),
    }),
  })
  const requests: string[] = []
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(String(input), init)
    requests.push(new URL(req.url).pathname)
    return fetchRequestHandler({ endpoint: '/api/trpc', req, router, createContext: () => ({}) })
  }) as typeof fetch
  // The links are typed against the real AppRouter; the stand-in shares the
  // paths it exercises, which is all this test relies on.
  const client = createTRPCClient<typeof router>({
    links: trpcLinks('http://localhost/api/trpc', fetchImpl) as never,
  })
  return { client, requests, releaseDoctor }
}

describe('tRPC links', () => {
  it('answers the feature page without waiting on a slow query fired beside it', async () => {
    const { client, requests, releaseDoctor } = standInServer()
    let doctorDone = false
    const doctor = client.setup.doctor.query().then(() => {
      doctorDone = true
    })
    const [feature] = await Promise.all([client.feature.get.query(), client.feature.list.query()])

    expect(feature).toEqual({ id: 'feat_1' })
    expect(doctorDone).toBe(false)
    releaseDoctor()
    await doctor
    // The fast reads still share one batched request; the doctor went alone.
    expect(requests.sort()).toEqual(['/api/trpc/feature.get,feature.list', '/api/trpc/setup.doctor'])
  })

  it('names only procedures the server actually has', () => {
    const procedures = Object.keys(appRouter._def.procedures)
    for (const path of UNBATCHED_PATHS) expect(procedures).toContain(path)
  })
})
