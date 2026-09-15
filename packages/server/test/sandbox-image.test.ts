import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SANDBOX_IMAGE, resolveSandboxImage, type RuncastleConfig } from '@runcastle/core'
import type { ExecFn, ExecOutcome } from '../src/doctor/doctor'
import {
  DOCKERFILE_HASH_LABEL,
  hashDockerfile,
  hashDockerfileContents,
  imageBuildTerminal,
  inspectBuiltImage,
  imageBuildTarget,
  legacyGlobalImage,
  legacyGlobalImageReason,
  planImageBuild,
  projectImageTag,
  stockBuildArgs,
  type ImageBuildPlan,
} from '../src/services/sandbox-image'

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

describe('inspectBuiltImage', () => {
  const inspecting = (out: Partial<ExecOutcome>): ExecFn =>
    async (): Promise<ExecOutcome> => ({ ok: true, code: 0, stdout: '', stderr: '', ...out })

  it('reads the hash label off a built image', async () => {
    expect(await inspectBuiltImage(inspecting({ stdout: 'abc123\n' }), 'docker', 'img')).toEqual({
      present: true,
      hash: 'abc123',
    })
  })

  it('reports an image that is not there as absent', async () => {
    const missing = inspecting({ ok: false, code: 1, stderr: 'No such image' })
    expect(await inspectBuiltImage(missing, 'docker', 'img')).toEqual({
      present: false,
      hash: null,
    })
  })

  // An image built before the label existed reads as stale, which is the safe
  // direction: nothing vouches for what is inside it. Present-but-unlabelled is
  // its own answer, because the doctor tells that apart from "not built yet".
  it('reports an image with no such label as present without a hash', async () => {
    expect(await inspectBuiltImage(inspecting({ stdout: '<no value>\n' }), 'podman', 'img')).toEqual(
      { present: true, hash: null },
    )
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

describe('imageBuildTarget', () => {
  it('names the packaged Dockerfile and stock tag when the project has no Dockerfile', () => {
    const dockerfile = '/opt/runcastle/assets/sandbox/Dockerfile'
    expect(
      imageBuildTarget({
        config: config(),
        project: { id: 'proj_web', repoPath: tmp('bare'), sandboxImageOverwritable: true },
        stockDockerfile: dockerfile,
      }),
    ).toEqual({ kind: 'stock', dockerfile, tag: DEFAULT_SANDBOX_IMAGE })
  })

  it('names the repo Dockerfile and project tag when the project ships one', () => {
    const repo = repoWithDockerfile()
    expect(
      imageBuildTarget({
        config: config(),
        project: { id: 'proj_java', repoPath: repo, sandboxImageOverwritable: true },
        stockDockerfile: '/opt/runcastle/assets/sandbox/Dockerfile',
      }),
    ).toEqual({
      kind: 'project',
      dockerfile: join(repo, '.runcastle', 'sandbox', 'Dockerfile'),
      tag: 'sandcastle:runcastle-proj_java',
    })
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
      project: { id: 'proj_java', repoPath: repo, sandboxImageOverwritable: true },
      stockContext: context,
      stockFresh: false,
      buildArgs: {},
    })
    expect(plan.kind).toBe('chain')
    const spec = imageBuildTerminal('docker', buildable(plan), 'linux')
    // One watchable terminal, both builds: the human clicked once and sees the
    // whole chain in the row they clicked.
    expect(spec.cmd).toBe('/bin/sh')
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
      project: { id: 'proj_java', repoPath: repo, sandboxImageOverwritable: true },
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
      project: { id: 'proj_java', repoPath: repo, sandboxImageOverwritable: true },
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
      project: {
        id: 'proj_1',
        repoPath: tmp('bare'),
        sandboxImage: 'acme/custom:v1',
        sandboxImageOverwritable: false,
      },
      stockContext: stockContext(),
      stockFresh: false,
      buildArgs: {},
    })
    expect(plan.kind).toBe('refused')
  })

  // The other half of the clobber fix: a hand-typed tag is never overwritten, so
  // building the project image would leave the card reporting — and the button
  // building — an image every burn ignores in favour of the typed one.
  it('refuses when a hand-typed tag outranks the project’s own Dockerfile', () => {
    const plan = planImageBuild({
      config: config(),
      project: {
        id: 'proj_java',
        repoPath: repoWithDockerfile(),
        sandboxImage: 'acme/custom:v1',
        sandboxImageOverwritable: false,
      },
      stockContext: stockContext(),
      stockFresh: false,
      buildArgs: {},
    })
    expect(plan).toMatchObject({ kind: 'refused', imageName: 'acme/custom:v1' })
    // The Dockerfile is written already — clearing the setting is the whole fix.
    expect(plan.kind === 'refused' && plan.reason).toContain('already ships')
  })

  // Decision 9: a blank column is unset everywhere. Burn resolution already
  // trims it, so a card that read the same whitespace as a hand-typed tag would
  // disarm the button over a value no burn can see.
  it('builds the chain for a blank stored image, as burn resolution reads it', () => {
    const repo = repoWithDockerfile()
    const plan = planImageBuild({
      config: config(),
      project: {
        id: 'proj_java',
        repoPath: repo,
        sandboxImage: '  ',
        sandboxImageOverwritable: false,
      },
      stockContext: stockContext(),
      stockFresh: true,
      buildArgs: {},
    })
    expect(plan).toMatchObject({ kind: 'chain', projectTag: projectImageTag('proj_java') })
    // The seam agrees with the resolver every burn goes through.
    expect(resolveSandboxImage(config(), { sandboxImage: '  ' })).toBe(DEFAULT_SANDBOX_IMAGE)
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
        sandboxImageOverwritable: true,
      },
      stockContext: stockContext(),
      stockFresh: false,
      buildArgs: {},
    })
    expect(plan.kind).toBe('stock')
  })
})

/**
 * A machine-wide image an older runcastle left behind. It wears the tag prefix
 * runcastle manages but names no project this install has, which is the whole of
 * the classification — and every project without an image of its own inherits
 * it, so the burns that fail are in repos nobody touched.
 */
describe('legacyGlobalImage', () => {
  const KNOWN = ['proj_01', 'proj_02']

  it('names a managed-prefix tag belonging to no known project', () => {
    expect(legacyGlobalImage('sandcastle:runcastle-demo', KNOWN)).toBe('sandcastle:runcastle-demo')
    expect(legacyGlobalImage('sandcastle:runcastle-bl', KNOWN)).toBe('sandcastle:runcastle-bl')
  })

  it('leaves the stock image, an unset value and a foreign tag alone', () => {
    expect(legacyGlobalImage(DEFAULT_SANDBOX_IMAGE, KNOWN)).toBeNull()
    expect(legacyGlobalImage('  ', KNOWN)).toBeNull()
    expect(legacyGlobalImage(undefined, KNOWN)).toBeNull()
    expect(legacyGlobalImage(null, KNOWN)).toBeNull()
    // Someone's own registry image is custom, not residue.
    expect(legacyGlobalImage('my-team/sandbox:latest', KNOWN)).toBeNull()
  })

  it('leaves a tag that is some live project’s own image alone', () => {
    expect(legacyGlobalImage(projectImageTag('proj_02'), KNOWN)).toBeNull()
  })

  it('reads the value the way a burn does, trimming it first', () => {
    expect(legacyGlobalImage('  sandcastle:runcastle-demo  ', KNOWN)).toBe(
      'sandcastle:runcastle-demo',
    )
  })

  it('prescribes the machine-wide clear, which is the one remedy that works', () => {
    const reason = legacyGlobalImageReason('sandcastle:runcastle-demo')
    expect(reason).toContain('sandcastle:runcastle-demo')
    expect(reason).toContain('Clear the machine-wide sandbox image setting')
    expect(reason).toContain(DEFAULT_SANDBOX_IMAGE)
  })
})
