import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SANDBOX_IMAGE, type RuncastleConfig } from '@runcastle/core'
import type { ExecFn, ExecOutcome } from '../src/doctor/doctor'
import { projects } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { listFindings, recordFinding } from '../src/services/findings'
import { requireProjectById } from '../src/services/repo'
import {
  DOCKERFILE_HASH_LABEL,
  adoptProjectImage,
  builtDockerfileHash,
  hashDockerfile,
  hashDockerfileContents,
  imageBuildTerminal,
  planImageBuild,
  projectImageTag,
  stockBuildArgs,
  type ImageBuildPlan,
} from '../src/services/sandbox-image'
import { makeTestCtx } from './helpers/db'

/** A plan the terminal can actually run — refusal is not one of them. */
function buildable(plan: ImageBuildPlan): Exclude<ImageBuildPlan, { kind: 'refused' }> {
  if (plan.kind === 'refused') throw new Error(`expected a buildable plan, got: ${plan.reason}`)
  return plan
}

/**
 * The Build button's command assembly (feature `project-owned-sandbox-image`,
 * decisions 4–6). Everything here is observed at the seam the terminal is handed
 * — the (cmd, args, cwd) — so the whole build path is exercised without a
 * container runtime ever running.
 */

const STOCK_DOCKERFILE = 'FROM node:22-bookworm\nARG AGENT_UID=1000\n'
const PROJECT_DOCKERFILE = `FROM ${DEFAULT_SANDBOX_IMAGE}\nRUN apt-get install -y maven\n`

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `runcastle-${prefix}-`))
}

/** A stock build context holding the template Dockerfile, as the scaffold leaves it. */
function stockContext(): string {
  const dir = tmp('stock')
  writeFileSync(join(dir, 'Dockerfile'), STOCK_DOCKERFILE)
  return dir
}

/** A repo whose `.runcastle/sandbox/` carries a Dockerfile of its own. */
function repoWithDockerfile(prefix = 'repo'): string {
  const repo = tmp(prefix)
  mkdirSync(join(repo, '.runcastle', 'sandbox'), { recursive: true })
  writeFileSync(join(repo, '.runcastle', 'sandbox', 'Dockerfile'), PROJECT_DOCKERFILE)
  return repo
}

const config = (sandboxImage?: string): Pick<RuncastleConfig, 'sandboxImage'> =>
  sandboxImage === undefined ? {} : { sandboxImage }

describe('hashDockerfile', () => {
  it('hashes content, so a rebuild of unchanged bytes keeps the same label', () => {
    const dir = stockContext()
    expect(hashDockerfile(join(dir, 'Dockerfile'))).toBe(hashDockerfileContents(STOCK_DOCKERFILE))
    expect(hashDockerfile(join(dir, 'Dockerfile'))).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when the Dockerfile does', () => {
    const before = hashDockerfileContents(STOCK_DOCKERFILE)
    expect(hashDockerfileContents(`${STOCK_DOCKERFILE}RUN apt-get install -y maven\n`)).not.toBe(before)
  })

  it('reports null for a Dockerfile that is not there', () => {
    expect(hashDockerfile(join(tmp('empty'), 'Dockerfile'))).toBeNull()
  })
})

describe('builtDockerfileHash', () => {
  const inspecting = (out: Partial<ExecOutcome>): ExecFn =>
    async (): Promise<ExecOutcome> => ({ ok: true, code: 0, stdout: '', stderr: '', ...out })

  it('reads the hash label off a built image', async () => {
    expect(await builtDockerfileHash(inspecting({ stdout: 'abc123\n' }), 'docker', 'img')).toBe('abc123')
  })

  it('reports null for an image that is not there', async () => {
    const missing = inspecting({ ok: false, code: 1, stderr: 'No such image' })
    expect(await builtDockerfileHash(missing, 'docker', 'img')).toBeNull()
  })

  // An image built before the label existed reads as stale, which is the safe
  // direction: nothing vouches for what is inside it.
  it('reports null for an image with no such label', async () => {
    expect(await builtDockerfileHash(inspecting({ stdout: '<no value>\n' }), 'podman', 'img')).toBeNull()
  })
})

describe('stockBuildArgs', () => {
  it('passes the host uid/gid to a docker build, as the retired shell-out did', () => {
    expect(stockBuildArgs('docker', { uid: 501, gid: 20 })).toEqual({
      AGENT_UID: '501',
      AGENT_GID: '20',
    })
  })

  it('passes none for podman, whose rootless mapping already lands on the host user', () => {
    expect(stockBuildArgs('podman', { uid: 501, gid: 20 })).toEqual({})
  })

  it('passes none where there is no uid to read (Windows)', () => {
    expect(stockBuildArgs('docker', { uid: undefined, gid: undefined })).toEqual({})
  })
})

describe('the build the terminal runs', () => {
  it('builds the stock image directly, with its hash label and uid build-args', () => {
    const context = stockContext()
    const plan = planImageBuild({
      config: config(),
      project: null,
      stockContext: context,
      stockFresh: false,
      buildArgs: { AGENT_UID: '1000', AGENT_GID: '1000' },
    })
    expect(plan.kind).toBe('stock')
    expect(imageBuildTerminal('docker', buildable(plan), 'linux')).toEqual({
      cmd: 'docker',
      args: [
        'build',
        '-t',
        DEFAULT_SANDBOX_IMAGE,
        '--label',
        `${DOCKERFILE_HASH_LABEL}=${hashDockerfileContents(STOCK_DOCKERFILE)}`,
        '--build-arg',
        'AGENT_UID=1000',
        '--build-arg',
        'AGENT_GID=1000',
        context,
      ],
      cwd: context,
    })
  })

  it('chains the stock image then the project one when the base is stale', () => {
    const context = stockContext()
    const repo = repoWithDockerfile()
    const plan = planImageBuild({
      config: config(),
      project: { id: 'proj_java', repoPath: repo },
      stockContext: context,
      stockFresh: false,
      buildArgs: {},
    })
    expect(plan.kind).toBe('chain')
    const spec = imageBuildTerminal('docker', buildable(plan), 'linux')
    // One watchable terminal, both builds: the human clicked once and sees the
    // whole chain in the row they clicked.
    expect(spec.cmd).toBe('sh')
    expect(spec.args[0]).toBe('-c')
    const line = spec.args[1] as string
    expect(line).toContain(`docker build -t ${DEFAULT_SANDBOX_IMAGE} `)
    expect(line).toContain('&& docker build -t sandcastle:runcastle-proj_java ')
    // Each image carries the hash of the Dockerfile it was built from.
    expect(line).toContain(`${DOCKERFILE_HASH_LABEL}=${hashDockerfileContents(STOCK_DOCKERFILE)}`)
    expect(line).toContain(`${DOCKERFILE_HASH_LABEL}=${hashDockerfileContents(PROJECT_DOCKERFILE)}`)
    // Stock first — the project image is FROM it.
    expect(line.indexOf(context)).toBeLessThan(line.indexOf('proj_java'))
    expect(spec.cwd).toBe(join(repo, '.runcastle', 'sandbox'))
  })

  it('builds only the project image when the stock base is already current', () => {
    const repo = repoWithDockerfile()
    const plan = planImageBuild({
      config: config(),
      project: { id: 'proj_java', repoPath: repo },
      stockContext: stockContext(),
      stockFresh: true,
      buildArgs: {},
    })
    expect(imageBuildTerminal('podman', buildable(plan), 'linux')).toEqual({
      cmd: 'podman',
      args: [
        'build',
        '-t',
        'sandcastle:runcastle-proj_java',
        '--label',
        `${DOCKERFILE_HASH_LABEL}=${hashDockerfileContents(PROJECT_DOCKERFILE)}`,
        join(repo, '.runcastle', 'sandbox'),
      ],
      cwd: join(repo, '.runcastle', 'sandbox'),
    })
  })

  it('quotes a context path with spaces, and hosts the chain in each platform shell', () => {
    // `C:\Users\Ada Lovelace\repo` is an ordinary place for a repo to live, and
    // an unquoted space in the chained line would split it into two arguments.
    const repo = repoWithDockerfile('with space')
    const plan = planImageBuild({
      config: config(),
      project: { id: 'proj_java', repoPath: repo },
      stockContext: stockContext(),
      stockFresh: false,
      buildArgs: {},
    })
    const context = join(repo, '.runcastle', 'sandbox')
    expect(imageBuildTerminal('docker', buildable(plan), 'linux').args[1]).toContain(`'${context}'`)
    const win = imageBuildTerminal('docker', buildable(plan), 'win32')
    expect(win.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(win.args[3]).toContain(`"${context}"`)
  })

  // The clobber this feature exists to stop: the old flow built the stock
  // template under whatever tag `sandboxImage` named.
  it('refuses to build under a tag runcastle does not manage', () => {
    const plan = planImageBuild({
      config: config('acme/custom-image:v3'),
      project: null,
      stockContext: stockContext(),
      stockFresh: false,
      buildArgs: {},
    })
    expect(plan).toMatchObject({ kind: 'refused', imageName: 'acme/custom-image:v3' })
    expect(plan.kind === 'refused' && plan.reason).toContain('.runcastle/sandbox/Dockerfile')
  })

  it('refuses for a project whose own hand-typed tag has no Dockerfile behind it', () => {
    const plan = planImageBuild({
      config: config(),
      project: { id: 'proj_1', repoPath: tmp('bare'), sandboxImage: 'acme/custom:v1' },
      stockContext: stockContext(),
      stockFresh: false,
      buildArgs: {},
    })
    expect(plan.kind).toBe('refused')
  })

  // A project image whose Dockerfile was deleted still resolves to the tag
  // runcastle wrote; that is runcastle's own value, so the button stays armed
  // and rebuilds the stock image the project falls back to.
  it('builds stock for a project image tag whose Dockerfile is gone', () => {
    const plan = planImageBuild({
      config: config(),
      project: {
        id: 'proj_java',
        repoPath: tmp('bare'),
        sandboxImage: projectImageTag('proj_java'),
      },
      stockContext: stockContext(),
      stockFresh: false,
      buildArgs: {},
    })
    expect(plan.kind).toBe('stock')
  })
})

describe('adoptProjectImage', () => {
  let ctx: AppCtx

  beforeEach(async () => {
    ctx = await makeTestCtx()
    ctx.db.insert(projects).values({ id: 'proj_1', name: 'acme', repoPath: '/repo' }).run()
  })

  const stored = async () => {
    const project = requireProjectById(ctx, 'proj_1')
    const finding = (await listFindings(ctx, project)).find((f) => f.key === 'sandboxImage')
    return { image: project.sandboxImage, source: finding?.source }
  }

  it('writes the project column with machine provenance on a successful build', async () => {
    expect(adoptProjectImage(ctx, 'proj_1', 'sandcastle:runcastle-proj_1')).toBe(true)
    expect(await stored()).toEqual({ image: 'sandcastle:runcastle-proj_1', source: 'build' })
  })

  it('never overwrites a tag the human typed', async () => {
    recordFinding(ctx, 'proj_1', {
      key: 'sandboxImage',
      value: 'acme/custom:v1',
      source: 'human',
    })
    expect(adoptProjectImage(ctx, 'proj_1', 'sandcastle:runcastle-proj_1')).toBe(false)
    expect(await stored()).toEqual({ image: 'acme/custom:v1', source: 'human' })
  })
})
