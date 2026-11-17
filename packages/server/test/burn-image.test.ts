import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_SANDBOX_IMAGE,
  type Project,
  type RuncastleConfig,
  type Ticket,
  type WorkflowCtx,
} from '@runcastle/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecFn, ExecOutcome } from '../src/doctor/doctor'
import { type BuildStepCall, tryImageBuildSlot } from '../src/services/image-build'
import {
  hashDockerfile,
  projectDockerfilePath,
  projectImageTag,
} from '../src/services/sandbox-image'
import { burnImageNeed, ensureBurnImage } from '../src/workers/burn-image'

const burnUser = { uid: 1000, gid: 1000, gidSource: 'default' as const }
const projectTag = projectImageTag('proj_1')
const config: Pick<RuncastleConfig, 'sandbox' | 'sandboxImage'> = { sandbox: 'docker' }

const answered = (stdout = ''): ExecOutcome => ({ ok: true, code: 0, stdout, stderr: '' })
const noSuchImage: ExecOutcome = { ok: true, code: 1, stdout: '', stderr: 'Error: No such object: x' }

/** The `image inspect` output for a present image: hash, two versions, user. */
const inspected = (hash: string | null, user = '1000:1000') => answered([hash ?? '<no value>', '', '', user].join('|'))

/** The tag a build step builds. */
const tagOf = (call: BuildStepCall | undefined) => call?.args[call.args.indexOf('-t') + 1]

/**
 * An engine holding the images in `images`; a build of a tag puts it there.
 * `answer` overrides any other command (buildx, the stale-image listing, rmi).
 */
function fakeEngine(
  images: Record<string, ExecOutcome>,
  answer: (args: string[]) => ExecOutcome | undefined = () => undefined,
) {
  const commands: string[][] = []
  const exec: ExecFn = async (_command, args) => {
    commands.push(args)
    const over = answer(args)
    if (over) return over
    if (args[0] === 'image' && args[1] === 'inspect') return images[args.at(-1) as string] ?? noSuchImage
    return answered()
  }
  const builds: BuildStepCall[] = []
  /** `buildx create` / `buildx rm` around the builds: runcastle's own builder. */
  const builder: string[][] = []
  const runStep = async (call: BuildStepCall) => {
    const t = call.args.indexOf('-t')
    if (t < 0) {
      builder.push(call.args)
      return { code: 0 }
    }
    builds.push(call)
    const tag = call.args[t + 1] as string
    const hash = /runcastle\.dockerfile-hash=(\S*)/.exec(call.args.join(' '))?.[1] ?? null
    images[tag] = inspected(hash)
    return { code: 0 }
  }
  return { exec, runStep, builds, builder, commands }
}

describe('burnImageNeed', () => {
  const present = { present: true, hash: 'h', versions: { 'claude-code': null, codex: null }, user: '1000:1000' }
  const stock = { kind: 'stock', dockerfile: '/d', tag: DEFAULT_SANDBOX_IMAGE } as const
  const own = { kind: 'project', dockerfile: '/d', tag: projectTag } as const
  const input = { stored: projectTag, overwritable: true, projectHash: 'h', burnUser }

  it('builds an image that is not there', () => {
    expect(burnImageNeed({ ...input, target: stock, image: { ...present, present: false } })).toBe('missing')
  })

  it('leaves a current image alone', () => {
    expect(burnImageNeed({ ...input, target: stock, image: present })).toBeNull()
    expect(burnImageNeed({ ...input, target: own, image: present })).toBeNull()
  })

  it('builds a project image the project has not adopted, unless a human owns the column', () => {
    expect(burnImageNeed({ ...input, target: own, image: present, stored: null })).toBe('unadopted')
    expect(burnImageNeed({ ...input, target: own, image: present, stored: null, overwritable: false })).toBeNull()
  })

  it('builds an image built for another UID, and does not judge a named user', () => {
    expect(burnImageNeed({ ...input, target: stock, image: { ...present, user: '1001:1001' } })).toBe('wrong-uid')
    expect(burnImageNeed({ ...input, target: stock, image: { ...present, user: 'agent' } })).toBeNull()
  })

  it('builds a project image whose Dockerfile changed, but never a stock image for that', () => {
    expect(burnImageNeed({ ...input, target: own, image: { ...present, hash: 'old' } })).toBe('dockerfile-changed')
    expect(burnImageNeed({ ...input, target: stock, image: { ...present, hash: 'old' }, projectHash: null })).toBeNull()
  })

  it('does not call an unreadable Dockerfile a change', () => {
    expect(burnImageNeed({ ...input, target: own, image: { ...present, hash: 'old' }, projectHash: null })).toBeNull()
  })
})

describe('ensureBurnImage', () => {
  let repoPath: string
  let dataDir: string
  const saved = process.env.RUNCASTLE_DATA_DIR

  beforeEach(() => {
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-burn-image-'))
    dataDir = mkdtempSync(join(tmpdir(), 'runcastle-burn-image-data-'))
    process.env.RUNCASTLE_DATA_DIR = dataDir
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.RUNCASTLE_DATA_DIR
    else process.env.RUNCASTLE_DATA_DIR = saved
    rmSync(repoPath, { recursive: true, force: true })
    rmSync(dataDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function shipDockerfile(contents = 'FROM sandcastle:runcastle\n') {
    mkdirSync(join(repoPath, '.runcastle', 'sandbox'), { recursive: true })
    writeFileSync(projectDockerfilePath(repoPath), contents)
    return hashDockerfile(projectDockerfilePath(repoPath))
  }

  function makeCtx(over: Partial<Project> = {}, overwritable = true) {
    const events: { type: string; message: string; data?: unknown }[] = []
    const adopted: string[] = []
    const stop = new AbortController()
    const ctx = {
      runId: 'run_1',
      project: { id: 'proj_1', repoPath, sandboxImage: null, ...over } as Project,
      signal: stop.signal,
      emitEvent: (e: { type: string; message: string; data?: unknown }) => events.push(e),
      projectImage: {
        overwritable: () => overwritable,
        adopt: (tag: string) => {
          adopted.push(tag)
          ctx.project = { ...ctx.project, sandboxImage: tag }
        },
        release: () => {
          ctx.project = { ...ctx.project, sandboxImage: null }
        },
      },
    } as unknown as WorkflowCtx
    return { ctx, events, adopted, stop }
  }

  const types = (events: { type: string }[]) => events.map((e) => e.type)

  it('builds nothing when the image is there', async () => {
    const { ctx, events } = makeCtx()
    const engine = fakeEngine({ [DEFAULT_SANDBOX_IMAGE]: inspected('h') })

    expect(await ensureBurnImage(ctx, { config, ...engine, burnUser })).toEqual({ status: 'ready' })

    expect(engine.builds).toEqual([])
    expect(events).toEqual([])
  })

  it('builds a missing stock image and records it', async () => {
    const { ctx, events } = makeCtx()
    const engine = fakeEngine({})

    expect(await ensureBurnImage(ctx, { config, ...engine, burnUser })).toEqual({ status: 'ready' })

    expect(engine.builds.map(tagOf)).toEqual([DEFAULT_SANDBOX_IMAGE])
    expect(types(events).at(0)).toBe('burn.image_build_started')
    expect(types(events).at(-1)).toBe('burn.image_built')
    expect(events[0]).toMatchObject({ data: { image: DEFAULT_SANDBOX_IMAGE, need: 'missing' } })
    expect(events[0]?.message).toContain(join(dataDir, 'logs', 'image-build-run_1.log'))
  })

  // Decision 8: the stock image builds in a builder of runcastle's own, which
  // goes after the build and takes its cache with it.
  it('builds the stock image in its own buildx builder and removes the builder after', async () => {
    const { ctx, events } = makeCtx()
    const engine = fakeEngine({})

    await ensureBurnImage(ctx, { config, ...engine, burnUser })

    const [create, remove] = engine.builder
    expect(create?.slice(0, 3)).toEqual(['buildx', 'create', '--name'])
    expect(create).toContain('docker-container')
    const name = create?.[3] as string
    expect(name).toMatch(/^runcastle-build-[0-9a-f]{8}-[0-9a-f]{8}$/)
    expect(remove).toEqual(['buildx', 'rm', name])
    expect(engine.builds[0]?.args.slice(0, 5)).toEqual(['buildx', 'build', '--builder', name, '--load'])
    expect(engine.builds[0]?.args.join(' ')).toContain(`runcastle.data-dir=${dataDir}`)
    expect(types(events)).not.toContain('cleanup.kept')
  })

  it('removes the builder even when the build fails', async () => {
    const { ctx } = makeCtx()
    const engine = fakeEngine({})
    const builder: string[][] = []
    const runStep = async (call: BuildStepCall) => {
      if (!call.args.includes('-t')) builder.push(call.args)
      return { code: call.args.includes('-t') ? 1 : 0 }
    }

    const outcome = await ensureBurnImage(ctx, { config, exec: engine.exec, runStep, burnUser })

    expect(outcome.status).toBe('failed')
    expect(builder.map((args) => args.slice(0, 2))).toEqual([
      ['buildx', 'create'],
      ['buildx', 'rm'],
    ])
  })

  it('falls back to a plain build without buildx, and says the cache was kept', async () => {
    const { ctx, events } = makeCtx()
    const engine = fakeEngine({}, (args) =>
      args[0] === 'buildx' ? { ok: true, code: 1, stdout: '', stderr: "'buildx' is not a docker command" } : undefined,
    )

    await ensureBurnImage(ctx, { config, ...engine, burnUser })

    expect(engine.builder).toEqual([])
    expect(engine.builds[0]?.args.slice(0, 2)).toEqual(['build', '-t'])
    expect(events.find((e) => e.type === 'cleanup.kept')?.message).toContain('buildx is not available')
  })

  // A project image is FROM the local stock image, which the own builder
  // cannot read: it builds plainly, and the timeline hears the cache stayed.
  it('builds a project image with the engine’s own builder and says its cache was kept', async () => {
    shipDockerfile()
    const { ctx, events } = makeCtx({ sandboxImage: projectTag })
    const engine = fakeEngine({ [DEFAULT_SANDBOX_IMAGE]: inspected('h'), [projectTag]: inspected('old') })

    await ensureBurnImage(ctx, { config, ...engine, burnUser })

    expect(engine.builds.at(-1)?.args.slice(0, 3)).toEqual(['build', '-t', projectTag])
    expect(engine.builds.at(-1)?.args.join(' ')).toContain('runcastle.project=proj_1')
    expect(events.find((e) => e.type === 'cleanup.kept')?.message).toContain('FROM the local stock image')
  })

  it('removes the image a rebuild replaced', async () => {
    const { ctx, events } = makeCtx()
    const old = 'sha256:old'
    const engine = fakeEngine({}, (args) => {
      if (args[0] === 'images') return answered(`${old}\n`)
      if (args[0] === 'image' && args[1] === 'inspect' && args.includes(old)) {
        return answered(
          `${old}\t3000000000\t[]\t${JSON.stringify({ 'runcastle.dockerfile-hash': 'x', 'runcastle.owner': 'runcastle' })}\n`,
        )
      }
      return undefined
    })

    await ensureBurnImage(ctx, { config, ...engine, burnUser })

    expect(engine.commands).toContainEqual(['rmi', old])
    expect(events.find((e) => e.type === 'burn.image_built')?.data).toMatchObject({
      removedImages: [old],
      freedBytes: 3_000_000_000,
    })
  })

  it('leaves a custom image to today’s path, however missing it is', async () => {
    const { ctx, events } = makeCtx({ sandboxImage: 'ghcr.io/acme/box:1' }, false)
    const engine = fakeEngine({})

    expect(await ensureBurnImage(ctx, { config, ...engine, burnUser })).toEqual({ status: 'ready' })

    expect(engine.builds).toEqual([])
    expect(events).toEqual([])
  })

  it('leaves a machine-wide custom image alone too', async () => {
    const { ctx } = makeCtx()
    const engine = fakeEngine({})
    await ensureBurnImage(ctx, { config: { ...config, sandboxImage: 'acme:box' }, ...engine, burnUser })
    expect(engine.builds).toEqual([])
  })

  it('builds a never-built project Dockerfile on top of the stock image, and adopts it', async () => {
    shipDockerfile()
    const { ctx, adopted } = makeCtx()
    const engine = fakeEngine({})

    expect(await ensureBurnImage(ctx, { config, ...engine, burnUser })).toEqual({ status: 'ready' })

    expect(engine.builds.map(tagOf)).toEqual([DEFAULT_SANDBOX_IMAGE, projectTag])
    expect(adopted).toEqual([projectTag])
    expect(ctx.project.sandboxImage).toBe(projectTag)
  })

  it('rebuilds a project image whose Dockerfile changed', async () => {
    shipDockerfile()
    const { ctx, events } = makeCtx({ sandboxImage: projectTag })
    const engine = fakeEngine({ [projectTag]: inspected('old') })

    await ensureBurnImage(ctx, { config, ...engine, burnUser })

    expect(tagOf(engine.builds.at(-1))).toBe(projectTag)
    expect(events[0]).toMatchObject({ data: { need: 'dockerfile-changed' } })
  })

  it('rebuilds an image built for another user', async () => {
    const { ctx, events } = makeCtx()
    const engine = fakeEngine({ [DEFAULT_SANDBOX_IMAGE]: inspected('h', '1001:1001') })

    await ensureBurnImage(ctx, { config, ...engine, burnUser })

    expect(engine.builds).toHaveLength(1)
    expect(events[0]).toMatchObject({ data: { need: 'wrong-uid' } })
  })

  it('gives back a stored image whose Dockerfile has gone, then checks the stock image', async () => {
    const { ctx } = makeCtx({ sandboxImage: projectTag })
    const engine = fakeEngine({ [DEFAULT_SANDBOX_IMAGE]: inspected('h') })

    await ensureBurnImage(ctx, { config, ...engine, burnUser })

    expect(ctx.project.sandboxImage).toBeNull()
    expect(engine.builds).toEqual([])
  })

  it('gives back an older runcastle’s tag named after the project, which the build target refuses', async () => {
    const { ctx } = makeCtx({ sandboxImage: `${DEFAULT_SANDBOX_IMAGE}-demo` })
    const engine = fakeEngine({})

    await ensureBurnImage(ctx, { config, ...engine, burnUser })

    expect(ctx.project.sandboxImage).toBeNull()
    expect(engine.builds.map(tagOf)).toEqual([DEFAULT_SANDBOX_IMAGE])
  })

  it('leaves a column a human typed, even with no Dockerfile behind it', async () => {
    const { ctx } = makeCtx({ sandboxImage: projectTag }, false)
    const engine = fakeEngine({})

    await ensureBurnImage(ctx, { config, ...engine, burnUser })

    expect(ctx.project.sandboxImage).toBe(projectTag)
    expect(engine.builds).toEqual([])
  })

  it('does not take a failed inspect for a missing image', async () => {
    const { ctx, events } = makeCtx()
    const engine = fakeEngine({
      [DEFAULT_SANDBOX_IMAGE]: { ok: true, code: null, stdout: '', stderr: 'timed out after 60s', timedOut: true },
    })

    expect(await ensureBurnImage(ctx, { config, ...engine, burnUser })).toEqual({ status: 'ready' })

    expect(engine.builds).toEqual([])
    expect(events).toEqual([])
  })

  it('ends the run on a failed build with the cause first and no adoption', async () => {
    shipDockerfile()
    const { ctx, events, adopted } = makeCtx()
    const engine = fakeEngine({ [DEFAULT_SANDBOX_IMAGE]: inspected('h') })
    const runStep = async (call: BuildStepCall) => {
      engine.builds.push(call)
      call.onLine('E: Unable to locate package mvn')
      call.onLine('ERROR: failed to solve: exit code: 100')
      return { code: 1 }
    }

    const outcome = await ensureBurnImage(ctx, { config, exec: engine.exec, runStep, burnUser })

    expect(outcome.status).toBe('failed')
    const summary = (outcome as { summary: string }).summary
    expect(summary.startsWith('ERROR: failed to solve: exit code: 100 — the sandbox image')).toBe(true)
    expect(summary).toContain('did not build')
    expect(summary).toContain('image-build-run_1.log')
    expect(adopted).toEqual([])
    expect(ctx.project.sandboxImage).toBeNull()
    const failed = events.find((e) => e.type === 'burn.image_build_failed')
    expect(failed?.data).toMatchObject({ warning: true })
    expect((failed?.data as { tail: string[] }).tail.at(-1)).toContain('failed to solve')
    expect(types(events)).not.toContain('burn.image_built')
  })

  it('rejects when stopped mid-build, so the run reads cancelled', async () => {
    const { ctx, stop } = makeCtx()
    const engine = fakeEngine({})
    const runStep = async () => {
      stop.abort(new Error('stopped'))
      return { code: null, stopped: 'aborted' as const }
    }

    await expect(ensureBurnImage(ctx, { config, exec: engine.exec, runStep, burnUser })).rejects.toThrow('stopped')

    const free = tryImageBuildSlot()
    expect(free).not.toBeNull()
    free?.()
  })

  it('waits for a build already running, and builds nothing if that produced the image', async () => {
    const release = tryImageBuildSlot()
    const { ctx, events } = makeCtx()
    const images: Record<string, ExecOutcome> = {}
    const engine = fakeEngine(images)

    const running = ensureBurnImage(ctx, { config, ...engine, burnUser })
    await vi.waitFor(() => expect(types(events)).toEqual(['burn.image_build_started']))
    images[DEFAULT_SANDBOX_IMAGE] = inspected('h')
    release?.()

    expect(await running).toEqual({ status: 'ready' })
    expect(engine.builds).toEqual([])
    expect(types(events)).toEqual(['burn.image_build_started', 'burn.image_built'])
  })

  it('builds once when two burns find the image missing together', async () => {
    const one = makeCtx()
    const two = makeCtx()
    const engine = fakeEngine({})

    await Promise.all([
      ensureBurnImage(one.ctx, { config, ...engine, burnUser }),
      ensureBurnImage(two.ctx, { config, ...engine, burnUser }),
    ])

    expect(engine.builds).toHaveLength(1)
  })

  it('lets a failed build free the slot for whoever is next', async () => {
    const { ctx } = makeCtx()
    const engine = fakeEngine({})
    await ensureBurnImage(ctx, {
      config,
      exec: engine.exec,
      runStep: async () => ({ code: 1 }),
      burnUser,
    })
    const free = tryImageBuildSlot()
    expect(free).not.toBeNull()
    free?.()
  })
})
