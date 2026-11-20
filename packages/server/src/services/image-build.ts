import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SANDBOX_IMAGE, type RuncastleConfig } from '@runcastle/core'
import { dataDir } from '@runcastle/core/paths'
import type { ExecFn } from '../doctor/doctor'
import { burnerDockerfilePath } from '../launcher/asset-paths'
import { stopProcessTree } from '../pty/kill-tree'
import { containHostProcess } from '../util/contain-host'
import { failureCause } from '../util/failure-line'
import { resolveSpawnTarget } from '../util/resolve-executable'
import { resolveBurnUser } from '../workers/burn-user'
import { resolveHostAgentVersions } from './agent-cli-versions'
import {
  type BuildableProject,
  buildCacheKept,
  buildStepArgs,
  createBuilderArgs,
  hashDockerfile,
  type ImageBuildMode,
  type ImageBuildPlan,
  type ImageBuildStep,
  imageFreshness,
  inspectBuiltImage,
  newBuilderName,
  NO_BUILDX_CACHE_KEPT,
  ownBuilder,
  planImageBuild,
  removeBuilderArgs,
  stockBuildArgs,
} from './sandbox-image'
import { prepareSandboxBuildContext, resolveRuntime, type Runtime } from './setup'

/**
 * Building the sandbox image without a human at a terminal (feature
 * `burns-build-their-own-image`). A plan is data, so there is one way to arrive
 * at it, {@link prepareImageBuild}, and two ways to run it: the Build button's
 * terminal (`imageBuildTerminal`) and {@link runImageBuild} here, which burns and
 * `runcastle build-image` use. Tags, labels and args are never decided twice.
 */

export interface PreparedImageBuild {
  runtime: Runtime
  plan: ImageBuildPlan
  /** How the build runs: runcastle's own buildx builder, Docker's own, or Podman. */
  mode: ImageBuildMode
  /** Things a person should hear about a build that goes ahead anyway. */
  notices: string[]
}

/**
 * How builds run on this machine (decision 8). Docker with buildx gets a fresh
 * builder of runcastle's own, named after this install so a later sweep can
 * tell its leftovers apart; Docker without buildx falls back to its own builder
 * and keeps the cache, which the result says.
 */
export async function resolveImageBuildMode(
  exec: ExecFn,
  runtime: Runtime,
  dir: string = dataDir(),
): Promise<ImageBuildMode> {
  if (runtime === 'podman') return { kind: 'podman' }
  const buildx = await exec(runtime, ['buildx', 'version'])
  if (buildx.ok && buildx.code === 0) return { kind: 'buildx', builder: newBuilderName(dir) }
  return { kind: 'plain', cacheKept: NO_BUILDX_CACHE_KEPT }
}

export interface PrepareImageBuildInput {
  exec: ExecFn
  config: Pick<RuncastleConfig, 'sandbox' | 'sandboxImage'>
  /** The project to build for; null for the machine-wide stock image. */
  project: BuildableProject | null
}

/**
 * Refresh the stock build context, ask the built stock image whether it is still
 * current (the verdict the doctor shares), and plan the build from the project's
 * own state. A host CLI whose version cannot be read does not refuse the build:
 * it goes ahead unpinned for that runtime, and `notices` says why.
 */
export async function prepareImageBuild(input: PrepareImageBuildInput): Promise<PreparedImageBuild> {
  const { exec, config, project } = input
  const runtime = await resolveRuntime(exec, config.sandbox === 'podman' ? 'podman' : 'docker')
  const stockContext = prepareSandboxBuildContext()
  const host = await resolveHostAgentVersions(exec)
  const stockFresh = imageFreshness({
    image: await inspectBuiltImage(exec, runtime, DEFAULT_SANDBOX_IMAGE),
    expectedHash: hashDockerfile(join(stockContext, 'Dockerfile')),
    host: host.versions,
    burnUser: resolveBurnUser(runtime),
  }).fresh
  const plan = planImageBuild({
    config,
    project,
    stockContext,
    stockDockerfile: burnerDockerfilePath(),
    stockFresh,
    buildArgs: stockBuildArgs(runtime),
    hostVersions: host.versions,
  })
  const mode = await resolveImageBuildMode(exec, runtime)
  return { runtime, plan, mode, notices: Object.values(host.problems) }
}

// ---------------------------------------------------------------------------
// One build at a time
// ---------------------------------------------------------------------------

let slotHeld = false
const slotQueue: (() => void)[] = []

/** The slot's release, safe to call twice: the second call would free someone else's turn. */
function slotRelease(): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    const next = slotQueue.shift()
    if (next) next()
    else slotHeld = false
  }
}

/**
 * The server's one image build slot, or null while a build holds it. The Build
 * button takes this form: a human clicking it should hear at once that a round is
 * already building, not sit behind a spinner.
 *
 * One queue, not one per image: the stock image is shared by every project and a
 * project image is built on it, so builds of different images still overlap.
 */
export function tryImageBuildSlot(): (() => void) | null {
  if (slotHeld) return null
  slotHeld = true
  return slotRelease()
}

/** Wait for the build slot. A stop while waiting rejects with the signal's reason. */
export async function waitForImageBuildSlot(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted()
  const free = tryImageBuildSlot()
  if (free) return free
  return new Promise((resolve, reject) => {
    const take = () => {
      signal?.removeEventListener('abort', abandon)
      resolve(slotRelease())
    }
    const abandon = () => {
      slotQueue.splice(slotQueue.indexOf(take), 1)
      reject(signal?.reason)
    }
    slotQueue.push(take)
    signal?.addEventListener('abort', abandon, { once: true })
  })
}

// ---------------------------------------------------------------------------
// Running a plan with no terminal
// ---------------------------------------------------------------------------

/**
 * How long a build may print nothing before it counts as wedged. It watches
 * silence rather than total time, so a long but healthy project image is never
 * cut off, while an engine that has stopped answering still ends the wait.
 */
export const IMAGE_BUILD_QUIET_MS = 10 * 60_000

/** How many of the last output lines are kept for the cause and the timeline. */
const TAIL_LINES = 200

export interface BuildStepOutcome {
  /** The exit code; null when the process never exited on its own. */
  code: number | null
  /** Why it was ended early. */
  stopped?: 'quiet' | 'aborted'
  /** The binary could not be run at all. */
  spawnError?: string
}

export interface BuildStepCall {
  command: string
  args: string[]
  cwd: string
  quietMs: number
  signal?: AbortSignal | undefined
  onLine: (line: string) => void
}

export type BuildStepRunner = (call: BuildStepCall) => Promise<BuildStepOutcome>

/** Hand on whole lines from a stream of chunks, treating `\r` as a line end too. */
function lineSplitter(onLine: (line: string) => void): { push(chunk: string): void; flush(): void } {
  let partial = ''
  return {
    push(chunk) {
      const lines = (partial + chunk).split(/\r\n|\r|\n/)
      partial = lines.pop() ?? ''
      lines.forEach(onLine)
    },
    flush() {
      if (partial) onLine(partial)
      partial = ''
    },
  }
}

/** The real {@link BuildStepRunner}: the same spawn rules as `createSystemExec`, but streaming and bounded by silence. */
export const spawnBuildStep: BuildStepRunner = ({ command, args, cwd, quietMs, signal, onLine }) =>
  new Promise<BuildStepOutcome>((resolve) => {
    const { file, args: spawnArgs } = resolveSpawnTarget(command, args)
    // Its own process group off Windows, so a stop reaches what the build started.
    const child = spawn(file, spawnArgs, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    const containment = child.pid === undefined ? null : containHostProcess(child.pid)
    let stopped: BuildStepOutcome['stopped']
    let quietTimer: ReturnType<typeof setTimeout> | undefined
    let settled = false

    const settle = (outcome: BuildStepOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(quietTimer)
      signal?.removeEventListener('abort', abort)
      void containment?.kill()
      resolve(outcome)
    }
    const stop = (why: NonNullable<BuildStepOutcome['stopped']>) => {
      stopped = why
      if (containment) void containment.kill()
      else if (child.pid !== undefined) void stopProcessTree(child.pid, { group: process.platform !== 'win32', label: `${command} (image build)` })
      // Not waiting for `close`: a shim's grandchild can hold the pipes open past the kill.
      settle({ code: null, stopped: why })
    }
    const abort = () => stop('aborted')
    const heardFrom = () => {
      clearTimeout(quietTimer)
      quietTimer = setTimeout(() => stop('quiet'), quietMs)
    }

    const out = lineSplitter(onLine)
    const err = lineSplitter(onLine)
    child.stdout.on('data', (chunk: Buffer) => {
      heardFrom()
      out.push(chunk.toString())
    })
    child.stderr.on('data', (chunk: Buffer) => {
      heardFrom()
      err.push(chunk.toString())
    })
    child.on('error', (error) => settle({ code: null, spawnError: String(error) }))
    child.on('close', (code) => {
      out.flush()
      err.flush()
      settle({ code: code ?? 0, ...(stopped ? { stopped } : {}) })
    })
    heardFrom()
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })

export type ImageBuildResult =
  | {
      ok: true
      /** Why this build left build cache behind; null when it left none (decision 8). */
      cacheKept: string | null
    }
  | {
      ok: false
      /** A stop asked for it, as opposed to the build failing. */
      aborted: boolean
      /** The one line that says why. */
      cause: string
      /** The last lines of output. */
      tail: string[]
    }

export interface RunImageBuildOptions {
  runtime: Runtime
  /** From {@link prepareImageBuild}; omitted, the engine's plain `build` (Podman's without layers). */
  mode?: ImageBuildMode | undefined
  /** Every line of output is appended here; omitted, nothing is written. */
  logPath?: string | undefined
  signal?: AbortSignal | undefined
  onLine?: ((line: string) => void) | undefined
  /** How to run one step; the real process unless a test injects its own. */
  runStep?: BuildStepRunner | undefined
  quietMs?: number | undefined
}

/** A log file that can never fail the build it is recording. */
function openBuildLog(path: string | undefined): { write(line: string): void; close(): void } {
  let fd: number | undefined
  try {
    if (path) {
      mkdirSync(dirname(path), { recursive: true })
      fd = openSync(path, 'a')
    }
  } catch {
    fd = undefined
  }
  return {
    write(line) {
      if (fd === undefined) return
      try {
        writeSync(fd, `${line}\n`)
      } catch {
        // Out of disk is the likeliest cause, and the build will say so itself.
      }
    },
    close() {
      if (fd !== undefined) closeSync(fd)
    },
  }
}

function stepFailure(outcome: BuildStepOutcome, step: ImageBuildStep, tail: string[], quietMs: number): string {
  if (outcome.spawnError) return `the build could not start: ${outcome.spawnError}`
  if (outcome.stopped === 'quiet') {
    return `the build of ${step.tag} printed nothing for ${Math.round(quietMs / 60_000)} minutes and was stopped`
  }
  return failureCause(tail) ?? `the build of ${step.tag} exited with code ${outcome.code ?? 'unknown'}`
}

/** Run a plan's steps in order, stopping at the first that does not succeed. */
export async function runImageBuild(
  plan: Extract<ImageBuildPlan, { steps: ImageBuildStep[] }>,
  options: RunImageBuildOptions,
): Promise<ImageBuildResult> {
  const { runtime, logPath, signal, onLine } = options
  const runStep = options.runStep ?? spawnBuildStep
  const quietMs = options.quietMs ?? IMAGE_BUILD_QUIET_MS
  const log = openBuildLog(logPath)
  const tail: string[] = []
  const record = (line: string) => {
    tail.push(line)
    if (tail.length > TAIL_LINES) tail.shift()
    log.write(line)
    onLine?.(line)
  }
  const run = (args: string[], cwd: string, stepSignal: AbortSignal | undefined) => {
    record(`$ ${runtime} ${args.join(' ')}`)
    return runStep({ command: runtime, args, cwd, quietMs, signal: stepSignal, onLine: record })
  }
  let mode: ImageBuildMode =
    options.mode ?? (runtime === 'podman' ? { kind: 'podman' } : { kind: 'plain', cacheKept: '' })
  const first = plan.steps[0]
  let builder = ownBuilder(plan, mode)
  try {
    if (builder && first) {
      const created = await run(createBuilderArgs(builder), first.context, signal)
      if (created.stopped === 'aborted') {
        return { ok: false, aborted: true, cause: 'the image build was stopped', tail }
      }
      if (created.code !== 0) {
        // No builder of our own after all: build plainly and say the cache stays.
        // Said in the log, kept out of the tail a failure's cause is read from.
        const note = "runcastle: could not create its own builder; building with Docker's own builder"
        log.write(note)
        onLine?.(note)
        tail.length = 0
        builder = null
        mode = { kind: 'plain', cacheKept: NO_BUILDX_CACHE_KEPT }
      }
    }
    for (const step of plan.steps) {
      const outcome = await run(buildStepArgs(step, mode), step.context, signal)
      if (outcome.stopped === 'aborted') {
        return { ok: false, aborted: true, cause: 'the image build was stopped', tail }
      }
      if (outcome.code !== 0) {
        return { ok: false, aborted: false, cause: stepFailure(outcome, step, tail, quietMs), tail }
      }
    }
    return { ok: true, cacheKept: buildCacheKept(plan, mode) || null }
  } finally {
    // The builder goes whatever happened, and takes its cache with it. Not
    // under the stop signal: a stopped build must still clean up.
    if (builder && first) await run(removeBuilderArgs(builder), first.context, undefined)
    log.close()
  }
}
