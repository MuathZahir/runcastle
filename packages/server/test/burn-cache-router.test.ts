import { RuncastleConfig } from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listByProject } from '../src/services/events'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { getBurnSlotAllocator } from '../src/workflows/burn-cache'
import { makeTestCtx } from './helpers/db'
import { seedProject } from './helpers/fixtures'

/**
 * The operator surface for the persistent burn cache (decision 6): the AFK card
 * asks `system.burnCache.status` how big the project's volume is and
 * `system.burnCache.clear` to drop it.
 *
 * `node:child_process` is mocked rather than the exec helper, because the
 * commands the router issues to the engine ARE the contract — "issues no
 * `volume rm` while a slot is held" is not observable anywhere else — and the
 * router deliberately reaches for the same real `createSystemExec` the doctor
 * uses. The spawn boundary is the only thing standing in for a machine that has
 * no Docker on it.
 */

/** Every spawn the router made, as `[binary, ...args]`. */
const spawnCalls: string[][] = []

/**
 * The same calls with the binary reduced to its plain name: a machine that
 * really has Docker resolves `docker` to an absolute path (`docker.exe` on
 * Windows), and the assertions are about the command, not where it lives.
 */
function engineCalls(): string[][] {
  return spawnCalls.map(([file, ...args]) => [
    (file?.split(/[\\/]/).pop() ?? '').replace(/\.[^.]+$/, ''),
    ...args,
  ])
}

/** What the mocked spawn should answer with; a test overrides it. */
let reply: (args: string[]) => { code: number; stdout: string } = () => ({ code: 0, stdout: '' })

vi.mock('node:child_process', async (importOriginal) => {
  const { EventEmitter } = await import('node:events')
  const spawn = (file: string, args: string[]) => {
    spawnCalls.push([file, ...args])
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    })
    const answer = reply(args)
    queueMicrotask(() => {
      if (answer.stdout) child.stdout.emit('data', Buffer.from(answer.stdout))
      child.emit('close', answer.code)
    })
    return child
  }
  return { ...(await importOriginal<object>()), spawn }
})

const PROJECT_SIZE_BYTES = 2_400_000_000

/** A `system df -v` report in which this project's volume is 2.4 GB. */
const dfReport = (volumeName: string) =>
  JSON.stringify({
    Volumes: [
      { Name: 'some-other-volume', Size: '10MB' },
      { Name: volumeName, Size: '2.4GB' },
    ],
  })

let ctx: AppCtx
let projectId: string
let volumeName: string

const callerFor = (config: RuncastleConfig) => createCallerFactory(appRouter)({ ...ctx, config })
const caller = () => callerFor(ctx.config)

beforeEach(async () => {
  ctx = await makeTestCtx()
  projectId = seedProject(ctx).id
  volumeName = `runcastle-${projectId}`
  spawnCalls.length = 0
  reply = (args) => ({
    code: 0,
    stdout: args[0] === 'system' ? dfReport(volumeName) : '',
  })
})

afterEach(() => {
  const allocator = getBurnSlotAllocator(ctx.config.burnConcurrency)
  for (const slot of allocator.held()) allocator.release(slot)
})

describe('system.burnCache.status', () => {
  it('reports the volume and the size the engine gives for it', async () => {
    const status = await caller().system.burnCache.status({ projectId })

    expect(status).toEqual({
      mode: 'volume',
      engine: 'docker',
      volumeName,
      sizeBytes: PROJECT_SIZE_BYTES,
    })
    expect(engineCalls()).toEqual([['docker', 'system', 'df', '-v', '--format', 'json']])
  })

  // A volume that was never created is not an error to report — it is a cache
  // with nothing in it yet, and the card says so rather than showing a zero.
  it('reports a null size when the volume does not exist yet', async () => {
    reply = () => ({ code: 0, stdout: JSON.stringify({ Volumes: [] }) })

    const status = await caller().system.burnCache.status({ projectId })

    expect(status.sizeBytes).toBeNull()
  })

  it('reports mode off and asks the engine nothing when the sandbox has no volumes', async () => {
    const config = RuncastleConfig.parse({ sandbox: 'noSandbox' })

    const status = await callerFor(config).system.burnCache.status({ projectId })

    expect(status).toEqual({ mode: 'off', engine: null, volumeName, sizeBytes: null })
    expect(spawnCalls).toEqual([])
  })

  it('reports mode off when the operator turned the cache off on a docker sandbox', async () => {
    const config = RuncastleConfig.parse({ sandbox: 'docker', burnCache: 'off' })

    const status = await callerFor(config).system.burnCache.status({ projectId })

    expect(status).toMatchObject({ mode: 'off', engine: 'docker', sizeBytes: null })
    expect(spawnCalls).toEqual([])
  })

  it('asks podman when that is the configured sandbox', async () => {
    const config = RuncastleConfig.parse({ sandbox: 'podman' })

    const status = await callerFor(config).system.burnCache.status({ projectId })

    expect(status.engine).toBe('podman')
    expect(engineCalls()[0]?.[0]).toBe('podman')
  })
})

describe('system.burnCache.clear', () => {
  it('removes the volume and puts it on the project timeline', async () => {
    const result = await caller().system.burnCache.clear({ projectId })

    expect(result).toEqual({ volumeName })
    expect(engineCalls()).toEqual([['docker', 'volume', 'rm', volumeName]])
    expect(listByProject(ctx, projectId).map((e) => e.type)).toContain('burn-cache.cleared')
  })

  // The checkouts on the volume are the running burns' working trees: pulling
  // it out from under them leaves an agent writing into a deleted mount.
  it('refuses while a burn holds a slot, names the slots, and issues no removal', async () => {
    const allocator = getBurnSlotAllocator(ctx.config.burnConcurrency)
    allocator.claim()
    allocator.claim()

    await expect(caller().system.burnCache.clear({ projectId })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('slots 1, 2'),
    })
    expect(spawnCalls).toEqual([])
    expect(listByProject(ctx, projectId).map((e) => e.type)).not.toContain('burn-cache.cleared')
  })

  it('rejects without an engine to run when the sandbox has no volumes', async () => {
    const config = RuncastleConfig.parse({ sandbox: 'noSandbox' })

    await expect(callerFor(config).system.burnCache.clear({ projectId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(spawnCalls).toEqual([])
  })

  // The engine failing (no such volume, daemon down) must surface as the engine's
  // own words, not as a silent success the card would render as "cleared".
  it('surfaces the engine stderr when the removal fails', async () => {
    reply = () => ({ code: 1, stdout: '' })

    await expect(caller().system.burnCache.clear({ projectId })).rejects.toThrow(/volume rm/)
    expect(listByProject(ctx, projectId).map((e) => e.type)).not.toContain('burn-cache.cleared')
  })
})
