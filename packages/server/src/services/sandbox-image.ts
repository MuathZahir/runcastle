import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AGENT_RUNTIMES,
  type AgentRuntime,
  DEFAULT_SANDBOX_IMAGE,
  resolveSandboxImage,
  type RuncastleConfig,
} from '@runcastle/core'
import { type ExecFn, RUNTIME_SPECS } from '../doctor/doctor'
import type { HostAgentVersions } from './agent-cli-versions'
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

/**
 * Image labels carrying the agent CLI versions the stock build was asked to
 * install (feature `sandbox-agent-clis-track-the-host-version`, decision 3).
 * Stamped with the same values passed as build-args, empty when the host has no
 * such CLI; a project image inherits them from the stock one through `FROM`.
 */
export const CLAUDE_CODE_VERSION_LABEL = 'runcastle.claude-code-version'
export const CODEX_VERSION_LABEL = 'runcastle.codex-version'

/** Per runtime: the label an image records its CLI version under, and the stock Dockerfile ARG that pins it. */
const AGENT_CLI_PINS: Record<AgentRuntime, { label: string; buildArg: string }> = {
  'claude-code': { label: CLAUDE_CODE_VERSION_LABEL, buildArg: 'CLAUDE_CODE_VERSION' },
  codex: { label: CODEX_VERSION_LABEL, buildArg: 'CODEX_VERSION' },
}

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

/** What one `image inspect` says about an image: is it there, and what was it built from? */
export interface BuiltImage {
  /** The tag resolves to a local image. */
  present: boolean
  /**
   * Its {@link DOCKERFILE_HASH_LABEL}, or null when the image is absent or
   * predates the label (an unlabelled image reads as stale, which is the safe
   * direction — it was built by the retired shell-out, whose content we cannot
   * vouch for).
   */
  hash: string | null
  /**
   * The agent CLI versions its labels record, per runtime — null when the image
   * is absent, predates the labels, or was built with no host CLI to pin to.
   */
  versions: Record<AgentRuntime, string | null>
}

const NO_VERSIONS: Record<AgentRuntime, string | null> = { 'claude-code': null, codex: null }

/** Ask a local image whether it is there, which Dockerfile it was built from, and which CLIs it pins. */
export async function inspectBuiltImage(
  exec: ExecFn,
  runtime: Runtime,
  tag: string,
): Promise<BuiltImage> {
  const labels = [DOCKERFILE_HASH_LABEL, ...AGENT_RUNTIMES.map((r) => AGENT_CLI_PINS[r].label)]
  const out = await exec(runtime, [
    'image',
    'inspect',
    '--format',
    labels.map((label) => `{{index .Config.Labels "${label}"}}`).join('|'),
    tag,
  ])
  if (!(out.ok && out.code === 0)) return { present: false, hash: null, versions: NO_VERSIONS }
  // Both runtimes print a placeholder rather than nothing for a missing key.
  const [hash, ...versions] = out.stdout
    .trim()
    .split('|')
    .map((value) => (value === '' || value === '<no value>' ? null : value))
  return {
    present: true,
    hash: hash ?? null,
    versions: Object.fromEntries(
      AGENT_RUNTIMES.map((r, i) => [r, versions[i] ?? null]),
    ) as Record<AgentRuntime, string | null>,
  }
}

/** One reason an image is not fresh; see {@link imageFreshness}. */
export type FreshnessReason =
  | { kind: 'missing' }
  | { kind: 'hash' }
  | { kind: 'cli'; runtime: AgentRuntime; image: string | null; host: string }

export type ImageFreshness = { fresh: true } | { fresh: false; reasons: FreshnessReason[] }

export interface ImageFreshnessInput {
  image: BuiltImage
  /** The Dockerfile's hash, or null when it cannot be read. */
  expectedHash: string | null
  host: HostAgentVersions
}

/**
 * Is a managed image current with both what it was built from and what the host
 * runs (decision 9)? The one verdict the doctor's image rows and the Build
 * button's plan share, so Rebuild rebuilds exactly when the doctor says stale.
 *
 * - An absent image is only `missing` — there is nothing else to judge.
 * - A hash we cannot read is no evidence of drift, so it is never a reason.
 * - A runtime with no host version is never drift (decision 4: not checked).
 * - Otherwise the image's version label must equal the host's, and a missing
 *   label counts as drift: runcastle cannot vouch for what an unlabelled image
 *   installed, the same precedent as an unlabelled hash.
 */
export function imageFreshness(input: ImageFreshnessInput): ImageFreshness {
  const { image, expectedHash, host } = input
  if (!image.present) return { fresh: false, reasons: [{ kind: 'missing' }] }
  const reasons: FreshnessReason[] = []
  if (expectedHash !== null && image.hash !== expectedHash) reasons.push({ kind: 'hash' })
  for (const runtime of AGENT_RUNTIMES) {
    const want = host[runtime]
    const have = image.versions[runtime]
    if (want !== null && have !== want) reasons.push({ kind: 'cli', runtime, image: have, host: want })
  }
  return reasons.length === 0 ? { fresh: true } : { fresh: false, reasons }
}

/** One {@link FreshnessReason} as a human reads it on a doctor row. */
export function describeFreshnessReason(tag: string, reason: FreshnessReason): string {
  switch (reason.kind) {
    case 'missing':
      return `${tag} is not built`
    case 'hash':
      return `${tag} no longer matches the Dockerfile it was built from`
    case 'cli': {
      const { label } = RUNTIME_SPECS[reason.runtime]
      const inImage = reason.image === null ? `no ${label} version recorded` : `${label} ${reason.image} in image`
      return `${tag}: ${inImage}, ${reason.host} on host`
    }
  }
}

/** One `<runtime> build` invocation: what to build, from where, under which hash. */
export interface ImageBuildStep {
  tag: string
  /** Directory handed to the build as its context (holds the Dockerfile). */
  context: string
  /** sha256 of that Dockerfile, published as {@link DOCKERFILE_HASH_LABEL}. */
  dockerfileHash: string
  buildArgs: Record<string, string>
  /** Labels stamped next to {@link DOCKERFILE_HASH_LABEL} — the stock step's CLI versions. */
  labels: Record<string, string>
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

/**
 * Why a hand-typed tag is nobody's to rebuild, and the way out of it — the build
 * route refuses with this and the doctor's image row says it (decision 5). When
 * the repo already carries a Dockerfile, clearing the setting is the whole fix,
 * so this stops telling the reader to write the file they have written.
 */
export function unmanagedImageReason(imageName: string, projectDockerfilePresent = false): string {
  const route = projectDockerfilePresent
    ? 'clear the sandbox image setting to let runcastle build the .runcastle/sandbox/Dockerfile this repo already ships'
    : `clear the sandbox image setting to go back to ${DEFAULT_SANDBOX_IMAGE}, or commit a .runcastle/sandbox/Dockerfile for runcastle to build`
  return `${imageName} is a custom image managed outside runcastle — ${route}.`
}

/**
 * A global `sandboxImage` that is residue from an older runcastle, or null.
 *
 * This is {@link unmanagedImage}'s question asked one layer down, of the
 * machine-wide config file rather than of a project column — and with "this
 * project" widened to *every* project, because a global value belongs to none of
 * them. Older versions wrote a project's built image into
 * `~/.runcastle/config.json` under a tag named after the PROJECT
 * (`sandcastle:runcastle-demo`); current builds write the project column only,
 * under {@link projectImageTag}. So a global value wearing the managed
 * `sandcastle:runcastle-` prefix while naming no project runcastle knows about
 * is a tag runcastle wrote and then stopped maintaining — and every project
 * without a column of its own inherits it.
 *
 * Reported, never deleted: the same string could have been typed deliberately,
 * and a value this app removes behind a human's back is worse than one it names.
 */
export function legacyGlobalImage(
  imageName: string | null | undefined,
  knownProjectIds: readonly string[],
): string | null {
  const image = imageName?.trim() ?? ''
  if (image === '' || image === DEFAULT_SANDBOX_IMAGE) return null
  if (!image.startsWith(`${DEFAULT_SANDBOX_IMAGE}-`)) return null
  if (knownProjectIds.some((id) => image === projectImageTag(id))) return null
  return image
}

/**
 * Why a legacy global image is nobody's choice, and the way out of it — the
 * boot warning and the doctor's image row say this instead of
 * {@link unmanagedImageReason}, whose "custom image" framing credits the value
 * to a human who never typed it. The remedy is the global clear
 * (`updateSettings` with a null value and no `projectId`), so the wording names
 * the machine-wide setting rather than the one on the project page.
 */
export function legacyGlobalImageReason(imageName: string): string {
  return (
    `${imageName} is left over from an older runcastle, which wrote a project's built image into ` +
    `the machine-wide config — every project without an image of its own inherits it, and its ` +
    `burns fail in a container built for someone else's repo. Clear the machine-wide sandbox ` +
    `image setting to go back to ${DEFAULT_SANDBOX_IMAGE}.`
  )
}

/** A project's stored `sandboxImage` column and whether runcastle may rewrite it. */
export interface StoredProjectImage {
  /** Project id — what {@link projectImageTag} names this project's image after. */
  id: string
  /** The `sandboxImage` project column as stored, or null when unset. */
  stored: string | null
  /** Runcastle may rewrite that column — false once a human typed the value. */
  overwritable: boolean
}

/**
 * The tag a human typed with nothing runcastle-managed behind it — neither the
 * stock image nor this project's own — or null when the column is unset, machine
 * written, or names an image runcastle builds.
 *
 * This is the one question the build route and the doctor's image row have to
 * answer the same way (decision 5), because a human-typed value is never
 * overwritten (`adoptProjectImage`, in `project-image.ts`). A project carrying
 * BOTH a hand-typed tag and `.runcastle/sandbox/Dockerfile` would otherwise let
 * the card build and report `sandcastle:runcastle-<projectId>` while every burn
 * kept resolving to the typed tag — a row and a button describing an image no
 * burn runs in.
 *
 * The stored value is trimmed here, and a blank one is unset (decision 9): that
 * is what {@link resolveSandboxImage} already makes of it, so a whitespace
 * column that burns read as "no image typed" must not disarm the card as a
 * custom one — the very card-vs-burn divergence this seam exists to prevent.
 */
export function unmanagedImage(project: StoredProjectImage): string | null {
  const { id, overwritable } = project
  const stored = project.stored?.trim() ?? ''
  if (stored === '' || overwritable) return null
  if (stored === DEFAULT_SANDBOX_IMAGE || stored === projectImageTag(id)) return null
  return stored
}

/** The project fields a build plan reads. */
export type BuildableProject = {
  id: string
  repoPath: string
  sandboxImage?: string | null
  /** False once a human typed `sandboxImage`; see {@link unmanagedImage}. */
  sandboxImageOverwritable: boolean
}

export interface PlanImageBuildInput {
  config: Pick<RuncastleConfig, 'sandboxImage'>
  /** The project whose card the button lives on; null in the first-run wizard. */
  project: BuildableProject | null
  /** The refreshed stock build context — the dir holding the stock Dockerfile. */
  stockContext: string
  /** Packaged Dockerfile copied into {@link stockContext}; used in user-facing build descriptions. */
  stockDockerfile?: string
  /** The stock image's {@link imageFreshness} verdict: its hash and CLI versions are current. */
  stockFresh: boolean
  /** `AGENT_UID`/`AGENT_GID` for the stock build; see {@link stockBuildArgs}. */
  buildArgs: Record<string, string>
  /** The host's agent CLI versions the stock build pins to and stamps as labels. */
  hostVersions: HostAgentVersions
}

export type ImageBuildTarget =
  | { kind: 'stock' | 'project'; dockerfile: string; tag: string }
  | { kind: 'refused'; imageName: string; reason: string }

export interface ImageBuildTargetInput {
  config: Pick<RuncastleConfig, 'sandboxImage'>
  project: BuildableProject | null
  /** The packaged stock template, before it is copied into the transient build context. */
  stockDockerfile: string
}

/**
 * The final image a click is for. Both the command planner and the settings UI
 * call this resolver, so the Dockerfile/tag named before the click cannot
 * diverge from the build that follows it.
 */
export function imageBuildTarget(input: ImageBuildTargetInput): ImageBuildTarget {
  const { config, project, stockDockerfile } = input
  const projectDockerfile = shippedDockerfile(project)
  const handTyped = project
    ? unmanagedImage({
        id: project.id,
        stored: project.sandboxImage ?? null,
        overwritable: project.sandboxImageOverwritable,
      })
    : null
  if (handTyped !== null) {
    return {
      kind: 'refused',
      imageName: handTyped,
      reason: unmanagedImageReason(handTyped, projectDockerfile !== null),
    }
  }
  if (project && projectDockerfile) {
    return { kind: 'project', dockerfile: projectDockerfile, tag: projectImageTag(project.id) }
  }

  const imageName = resolveSandboxImage(config, project)
  const managed =
    imageName === DEFAULT_SANDBOX_IMAGE ||
    (project !== null && imageName === projectImageTag(project.id))
  if (!managed) return { kind: 'refused', imageName, reason: unmanagedImageReason(imageName) }
  return { kind: 'stock', dockerfile: stockDockerfile, tag: DEFAULT_SANDBOX_IMAGE }
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

/** The `.runcastle/sandbox/Dockerfile` a project actually ships, or null. */
function shippedDockerfile(project: BuildableProject | null): string | null {
  if (!project) return null
  const path = projectDockerfilePath(project.repoPath)
  return existsSync(path) ? path : null
}

/**
 * Decide the build. A project carrying `.runcastle/sandbox/Dockerfile` gets the
 * chain — the stock image first when it is not fresh ({@link imageFreshness}), because the
 * project image is `FROM` it, then the project image itself. Otherwise the stock
 * image alone, unless the resolved image is a tag runcastle does not manage, in
 * which case there is nothing safe to build.
 *
 * A hand-typed `sandboxImage` outranks the Dockerfile ({@link unmanagedImage}):
 * the build could produce the project image but never adopt it, so the button
 * disarms rather than building a tag no burn would resolve to.
 *
 * The stock step pins each agent CLI to the host's version (decision 2) and
 * stamps the same value as a label (decision 3) — empty for a runtime the host
 * lacks, which installs latest and records nothing to drift from (decision 4).
 *
 * The project image's own build args and version labels are empty on purpose:
 * the ARGs live in the stock Dockerfile, which the project image inherits
 * already applied, and passing unconsumed args would print a build warning for
 * nothing. Its version labels come down from the stock image through `FROM`.
 */
export function planImageBuild(input: PlanImageBuildInput): ImageBuildPlan {
  const { config, project, stockContext, stockFresh, buildArgs, hostVersions } = input
  const stockHash = hashDockerfile(join(stockContext, 'Dockerfile')) ?? ''
  const pins = AGENT_RUNTIMES.map((r) => ({ ...AGENT_CLI_PINS[r], version: hostVersions[r] ?? '' }))
  const stockStep: ImageBuildStep = {
    tag: DEFAULT_SANDBOX_IMAGE,
    context: stockContext,
    dockerfileHash: stockHash,
    buildArgs: { ...buildArgs, ...Object.fromEntries(pins.map((p) => [p.buildArg, p.version])) },
    labels: Object.fromEntries(pins.map((p) => [p.label, p.version])),
  }

  const target = imageBuildTarget({
    config,
    project,
    stockDockerfile: input.stockDockerfile ?? join(stockContext, 'Dockerfile'),
  })
  if (target.kind === 'refused') return target

  if (target.kind === 'project' && project) {
    const projectTag = target.tag
    return {
      kind: 'chain',
      projectTag,
      steps: [
        ...(stockFresh ? [] : [stockStep]),
        {
          tag: projectTag,
          context: projectSandboxDir(project.repoPath),
          dockerfileHash: hashDockerfile(target.dockerfile) ?? '',
          buildArgs: {},
          labels: {},
        },
      ],
    }
  }

  // A tag runcastle wrote itself stays buildable even with the Dockerfile now
  // gone: the build falls back to the stock image the project will resolve to
  // once the doctor clears the orphaned column.
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
    ...Object.entries(step.labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]),
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
