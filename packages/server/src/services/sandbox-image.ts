import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SANDBOX_IMAGE, resolveSandboxImage, type RuncastleConfig } from '@runcastle/core'
import type { ExecFn } from '../doctor/doctor'
import type { AppCtx } from '../db/types'
import { emitProject } from './events'
import { isOverwritable, recordFinding } from './findings'
import type { Runtime } from './setup'

/**
 * The sandbox image runcastle builds, and what it is built from (feature
 * `project-owned-sandbox-image`, decisions 4–6). Two images exist:
 *
 * - the **stock** image, `sandcastle:runcastle`, built from the template
 *   runcastle ships and scaffolds into an app-global build context; and
 * - a **project** image, `sandcastle:runcastle-<projectId>`, built from a
 *   `.runcastle/sandbox/Dockerfile` the repo itself carries (`FROM` the stock
 *   one), which is how a repo whose toolchain is not JavaScript gets a JDK, a
 *   Go compiler or a Python into the container its burns run in.
 *
 * Runcastle invokes `<runtime> build` itself rather than shelling out to
 * `sandcastle build-image`: that CLI takes only `--image-name`, and every image
 * here must carry {@link DOCKERFILE_HASH_LABEL} — the sha256 of the Dockerfile
 * it was built from. The label is what makes staleness a *content* question. The
 * mtime-vs-`Created` comparison it replaces is wrong in both directions, because
 * BuildKit layer-cache reuse keeps the old `Created` on a freshly rebuilt image.
 *
 * This module is the one home for the label key and the hash, so the build path
 * here and the doctor's image probe agree by importing rather than by copying a
 * string.
 */

/** Image label carrying the sha256 of the Dockerfile an image was built from. */
export const DOCKERFILE_HASH_LABEL = 'runcastle.dockerfile-hash'

/** The `.runcastle/sandbox/` build context a project may carry, and its Dockerfile. */
export function projectSandboxDir(repoPath: string): string {
  return join(repoPath, '.runcastle', 'sandbox')
}

export function projectDockerfilePath(repoPath: string): string {
  return join(projectSandboxDir(repoPath), 'Dockerfile')
}

/** The image tag runcastle builds a project's own Dockerfile under. */
export function projectImageTag(projectId: string): string {
  return `${DEFAULT_SANDBOX_IMAGE}-${projectId}`
}

/** sha256 (hex) of Dockerfile bytes — the value {@link DOCKERFILE_HASH_LABEL} carries. */
export function hashDockerfileContents(contents: string | Buffer): string {
  return createHash('sha256').update(contents).digest('hex')
}

/** {@link hashDockerfileContents} of the file at `path`, or null if it is not readable. */
export function hashDockerfile(path: string): string | null {
  try {
    return hashDockerfileContents(readFileSync(path))
  } catch {
    return null
  }
}

/**
 * The hash label on a built image, or null when the image is absent or predates
 * the label (an unlabelled image reads as stale, which is the safe direction —
 * it was built by the retired shell-out, whose content we cannot vouch for).
 */
export async function builtDockerfileHash(
  exec: ExecFn,
  runtime: Runtime,
  tag: string,
): Promise<string | null> {
  const out = await exec(runtime, [
    'image',
    'inspect',
    '--format',
    `{{index .Config.Labels "${DOCKERFILE_HASH_LABEL}"}}`,
    tag,
  ])
  if (!(out.ok && out.code === 0)) return null
  const value = out.stdout.trim()
  // Both runtimes print a placeholder rather than nothing for a missing key.
  return value === '' || value === '<no value>' ? null : value
}

/** One `<runtime> build` invocation: what to build, from where, under which hash. */
export interface ImageBuildStep {
  tag: string
  /** Directory handed to the build as its context (holds the Dockerfile). */
  context: string
  /** sha256 of that Dockerfile, published as {@link DOCKERFILE_HASH_LABEL}. */
  dockerfileHash: string
  buildArgs: Record<string, string>
}

/**
 * What the Build button should do for a project, decided from the resolved state
 * rather than from the resolved *tag* (decision 5): a Dockerfile in the repo
 * means the chain, and a hand-typed tag with nothing runcastle-managed behind it
 * means the button must not build at all. Building the stock template under
 * someone's custom tag is the clobber this replaces.
 */
export type ImageBuildPlan =
  | { kind: 'stock'; steps: ImageBuildStep[] }
  | { kind: 'chain'; steps: ImageBuildStep[]; projectTag: string }
  | { kind: 'refused'; imageName: string; reason: string }

/** The project fields a build plan reads. */
export type BuildableProject = { id: string; repoPath: string; sandboxImage?: string | null }

export interface PlanImageBuildInput {
  config: Pick<RuncastleConfig, 'sandboxImage'>
  /** The project whose card the button lives on; null in the first-run wizard. */
  project: BuildableProject | null
  /** The refreshed stock build context — the dir holding the stock Dockerfile. */
  stockContext: string
  /** Whether the stock image already carries the stock Dockerfile's hash. */
  stockFresh: boolean
  /** `AGENT_UID`/`AGENT_GID` for the stock build; see {@link stockBuildArgs}. */
  buildArgs: Record<string, string>
}

/**
 * The `AGENT_UID`/`AGENT_GID` build args the stock image needs, exactly as the
 * retired sandcastle shell-out passed them: the host's uid/gid, so bind-mounted
 * files share an owner with the in-container agent user (research #32). Absent
 * on Windows, where `process.getuid` does not exist, and deliberately absent for
 * podman, whose rootless mapping already lands the agent on the host user — the
 * sandcastle podman path passed none either.
 */
export function stockBuildArgs(
  runtime: Runtime,
  ids: { uid?: number | undefined; gid?: number | undefined } = {
    uid: process.getuid?.(),
    gid: process.getgid?.(),
  },
): Record<string, string> {
  if (runtime === 'podman') return {}
  return {
    ...(ids.uid === undefined ? {} : { AGENT_UID: String(ids.uid) }),
    ...(ids.gid === undefined ? {} : { AGENT_GID: String(ids.gid) }),
  }
}

/**
 * Decide the build. A project carrying `.runcastle/sandbox/Dockerfile` gets the
 * chain — the stock image first when it is missing or hash-stale, because the
 * project image is `FROM` it, then the project image itself. Otherwise the stock
 * image alone, unless the resolved image is a tag runcastle does not manage, in
 * which case there is nothing safe to build.
 *
 * The project image's own build args are empty on purpose: the ARGs live in the
 * stock Dockerfile, which the project image inherits already applied, and
 * passing unconsumed args would print a build warning for nothing.
 */
export function planImageBuild(input: PlanImageBuildInput): ImageBuildPlan {
  const { config, project, stockContext, stockFresh, buildArgs } = input
  const stockHash = hashDockerfile(join(stockContext, 'Dockerfile')) ?? ''
  const stockStep: ImageBuildStep = {
    tag: DEFAULT_SANDBOX_IMAGE,
    context: stockContext,
    dockerfileHash: stockHash,
    buildArgs,
  }

  const projectDockerfile = project ? projectDockerfilePath(project.repoPath) : null
  if (project && projectDockerfile && existsSync(projectDockerfile)) {
    const projectTag = projectImageTag(project.id)
    return {
      kind: 'chain',
      projectTag,
      steps: [
        ...(stockFresh ? [] : [stockStep]),
        {
          tag: projectTag,
          context: projectSandboxDir(project.repoPath),
          dockerfileHash: hashDockerfile(projectDockerfile) ?? '',
          buildArgs: {},
        },
      ],
    }
  }

  // A tag runcastle wrote itself stays buildable even with the Dockerfile now
  // gone: the build falls back to the stock image the project will resolve to
  // once the doctor clears the orphaned column.
  const imageName = resolveSandboxImage(config, project)
  const managed =
    imageName === DEFAULT_SANDBOX_IMAGE ||
    (project !== null && imageName === projectImageTag(project.id))
  if (!managed) {
    return {
      kind: 'refused',
      imageName,
      reason: `${imageName} is a custom image managed outside runcastle — clear the sandbox image setting to go back to ${DEFAULT_SANDBOX_IMAGE}, or commit a .runcastle/sandbox/Dockerfile for runcastle to build.`,
    }
  }
  return { kind: 'stock', steps: [stockStep] }
}

/** The argv (after the runtime binary) for one build step. */
function buildStepArgs(step: ImageBuildStep): string[] {
  return [
    'build',
    '-t',
    step.tag,
    '--label',
    `${DOCKERFILE_HASH_LABEL}=${step.dockerfileHash}`,
    ...Object.entries(step.buildArgs).flatMap(([key, value]) => ['--build-arg', `${key}=${value}`]),
    step.context,
  ]
}

/**
 * Quote one argv entry for the shell that chains a multi-step build — but only
 * when it needs it. The line is shown to a human watching the build, so a tag
 * and a label stay readable and only a path with a space in it (`C:\Users\Ada
 * Lovelace\…`) picks up quotes.
 */
function shellQuote(arg: string, platform: NodeJS.Platform): string {
  if (/^[\w@%+=:,./\\-]+$/.test(arg)) return arg
  if (platform === 'win32') return `"${arg}"`
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/** The command an embedded terminal runs for a build, and where it runs it. */
export interface ImageBuildTerminal {
  cmd: string
  args: string[]
  cwd: string
}

/**
 * The (cmd, args, cwd) for a plan. One step spawns the runtime directly, so it
 * keeps the PATH resolution every other terminal flow gets. Two steps go through
 * a shell `&&` chain — the terminal hosts one process, and the point of chaining
 * rather than sequencing two terminals is that the human watches the whole build
 * in the row they clicked. The shell choice mirrors `devSpawnTarget`: on Windows
 * `cmd.exe /d /s /c`, which is what can run a `docker.cmd` shim at all.
 */
export function imageBuildTerminal(
  runtime: Runtime,
  plan: Extract<ImageBuildPlan, { steps: ImageBuildStep[] }>,
  platform: NodeJS.Platform = process.platform,
): ImageBuildTerminal {
  const steps = plan.steps
  const last = steps[steps.length - 1]
  if (!last) throw new Error('image build plan has no steps')
  // The context of the image this build is FOR — the stock one when that is all
  // there is, the project's `.runcastle/sandbox/` when the chain ends there.
  const cwd = last.context
  if (steps.length === 1) return { cmd: runtime, args: buildStepArgs(last), cwd }

  const line = steps
    .map((step) => [runtime, ...buildStepArgs(step)].map((a) => shellQuote(a, platform)).join(' '))
    .join(' && ')
  return platform === 'win32'
    ? { cmd: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', line], cwd }
    : { cmd: '/bin/sh', args: ['-c', line], cwd }
}

/**
 * Adopt a freshly built project image as the project's `sandboxImage`. Written
 * on a successful build and never at detect time (decision 6): the five image
 * consumers must never resolve to a tag no image answers to. A tag the human
 * typed is left exactly as it is — the build did not clobber their image, and it
 * does not clobber their setting either. Returns whether the column was written.
 */
export function adoptProjectImage(ctx: AppCtx, projectId: string, tag: string): boolean {
  if (!isOverwritable(ctx, projectId, 'sandboxImage')) return false
  recordFinding(ctx, projectId, {
    key: 'sandboxImage',
    value: tag,
    source: 'build',
    evidence: `Built from .runcastle/sandbox/Dockerfile as ${tag}.`,
  })
  emitProject(ctx, projectId, {
    type: 'settings.updated',
    message: `sandboxImage set to ${tag} by the image build`,
    data: { key: 'sandboxImage', scope: 'project', value: tag },
  })
  return true
}
