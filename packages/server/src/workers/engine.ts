import { LABEL_DATA_DIR } from '@runcastle/core'
import { dataDir } from '@runcastle/core/paths'
import { createSystemExec } from '../doctor/system-exec'
import { removeLeftoverBuilders, removeStaleSandboxImages, type StaleImagesResult } from '../services/sandbox-image-cleanup'
import type { AgentProcess } from '../threads/host'
import { inspectContainer, listContainers, listVolumes, removeContainer, removeVolume, stopContainers } from './containers'
import { type ContainerFacts, ForeignContainerError, type VolumeFacts, ownershipOf } from './ownership'
import { type PrepareInput, prepareSandbox } from './prepare'
import { type Engine, engineRun } from './sandbox'
import type { WorkerSetup } from './setup-copy'
import {
  type HandbackNote,
  type NewSandboxInput,
  type WorkerBrief,
  type WorkerProcessOptions,
  type WorkerSandbox,
  conversationInSandbox,
  conversationPathInSandbox,
  copiedSetupFingerprint,
  copyWorkerSetup,
  copyOutOfSandbox,
  createWorkerSandbox,
  ensureSandboxRunning,
  fetchWorkerBranch,
  refreshWorkerFeatureBranch,
  removeSandbox,
  stopSandbox,
  takeHandbackNote,
  devServerRecorded,
  workerProcess,
} from './worker'

/**
 * Everything the worker service asks of a container engine. The real one runs
 * docker or podman ({@link containerEngine}); tests hand the service a fake
 * ({@link setSandboxEngineForTests}), so a worker's whole lifecycle runs
 * without a container.
 */
export interface SandboxEngine {
  readonly name: Engine
  /** Whether the engine answers at all: a worker cannot start without it. */
  available(): Promise<boolean>
  /** Before a worker's sandbox is created: the project image built when missing or stale, the burn cache volume made. Throws what failed. */
  prepare(input: PrepareInput): Promise<void>
  /** The worker's bare copy, container, clone and install; resolves to the sandbox it made. */
  create(input: NewSandboxInput): Promise<WorkerSandbox>
  /** Stop the container, keeping its filesystem (an idle stop). */
  stop(sb: WorkerSandbox): Promise<void>
  /** Start a stopped container and its dev server, but not its agent (a preview opened, decision 15); true when it was stopped. */
  wake(sb: WorkerSandbox): Promise<boolean>
  /** Whether the agent's own record of `conversationId` is inside the sandbox: the reload guard looks there, not on the host. */
  conversationOnDisk(sb: WorkerSandbox, conversationId: string): Promise<boolean>
  /** Where inside the sandbox the agent keeps its own record of `conversationId` (Claude's session file, Codex's rollout), waking it if need be; undefined when there is none. */
  conversationPath(sb: WorkerSandbox, conversationId: string): Promise<string | undefined>
  /** One container's labels, mounts and state; undefined when the engine holds none of that name. */
  inspect(container: string): Promise<ContainerFacts | undefined>
  /** Every container the engine holds, whoever made it, stopped ones too (the sweep sorts them by {@link ownershipOf}). */
  listContainers(): Promise<ContainerFacts[]>
  /** Every volume the engine holds. */
  listVolumes(): Promise<VolumeFacts[]>
  /** Remove a container by name (the sweep's, for one no worker row reaches); one already gone is no error. */
  removeContainer(container: string): Promise<void>
  /** Stop containers by name at once, giving each `seconds` (the shutdown's and the sweep's). */
  stopContainers(containers: string[], seconds?: number): Promise<void>
  removeVolume(volume: string): Promise<void>
  /**
   * Remove runcastle's sandbox images nothing needs (replaced ones, and those of
   * projects not in `liveProjectIds`) and this install's leftover buildx
   * builders (decision 8). Never throws.
   */
  removeStaleImages(input: { dataDir: string; liveProjectIds: readonly string[] }): Promise<StaleImagesResult>
  /** Remove the container, the worker branch on the host and its bare copy. */
  remove(sb: WorkerSandbox): Promise<void>
  /** The handback the worker wrote since the last one taken, if any. */
  takeHandback(sb: WorkerSandbox): Promise<HandbackNote | undefined>
  /** Whether the worker has started its dev server (so its preview can answer). */
  devServerStarted(sb: WorkerSandbox): Promise<boolean>
  /** Bring the worker branch's commits into the host repo as `refs/heads/<branch>`. */
  fetchBranch(sb: WorkerSandbox): Promise<void>
  /** Bring the feature branch's current tip into the worker's bare copy, so `git fetch origin` in the sandbox sees it (a conflict to merge). */
  refreshFeatureBranch(sb: WorkerSandbox): Promise<void>
  /** Put the human's setup for its runtime into the sandbox (decisions 8, 12), waking it if need be, in place of an earlier copy, and record its fingerprint there. */
  copySetup(sb: WorkerSandbox, setup: WorkerSetup, fingerprint: string, opts?: { guard?: boolean }): Promise<void>
  /** The fingerprint of the setup last copied into the sandbox (waking it if need be); undefined when none finished. */
  setupFingerprint(sb: WorkerSandbox): Promise<string | undefined>
  /** Copy one file out of the sandbox to the host (a file the worker shows). */
  copyOut(sb: WorkerSandbox, containerPath: string, hostPath: string): Promise<void>
  /** The agent process inside the sandbox, started (and the sandbox woken) if need be, with its tool relay. */
  process(sb: WorkerSandbox, brief: WorkerBrief, opts: WorkerProcessOptions): Promise<AgentProcess>
}

/** The docker or podman engine. */
export function containerEngine(name: Engine): SandboxEngine {
  return {
    name,
    available: () =>
      engineRun(name, ['info', '--format', '{{.ServerVersion}}']).then(
        () => true,
        () => false,
      ),
    prepare: (input) => prepareSandbox(name, input),
    create: (input) => createWorkerSandbox(input),
    stop: (sb) => stopSandbox(sb),
    wake: async (sb) => (await ensureSandboxRunning(sb)) > 0,
    conversationOnDisk: (sb, conversationId) => conversationInSandbox(sb, conversationId),
    conversationPath: (sb, conversationId) => conversationPathInSandbox(sb, conversationId),
    inspect: (container) => inspectContainer(name, container),
    listContainers: () => listContainers(name),
    listVolumes: () => listVolumes(name),
    removeContainer: (container) => removeContainer(name, container),
    stopContainers: (containers, seconds) => stopContainers(name, containers, seconds),
    removeVolume: (volume) => removeVolume(name, volume),
    removeStaleImages: async ({ dataDir: dir, liveProjectIds }) => {
      const exec = createSystemExec()
      if (name === 'docker') await removeLeftoverBuilders({ exec, dataDir: dir })
      return removeStaleSandboxImages({ engine: name, exec, dataDir: dir, liveProjectIds })
    },
    remove: (sb) => removeSandbox(sb),
    takeHandback: (sb) => takeHandbackNote(sb),
    devServerStarted: (sb) => devServerRecorded(sb),
    fetchBranch: (sb) => fetchWorkerBranch(sb),
    refreshFeatureBranch: (sb) => refreshWorkerFeatureBranch(sb),
    copySetup: (sb, setup, fingerprint, opts) => copyWorkerSetup(sb, setup, fingerprint, opts),
    setupFingerprint: (sb) => copiedSetupFingerprint(sb),
    copyOut: (sb, containerPath, hostPath) => copyOutOfSandbox(sb, containerPath, hostPath),
    process: (sb, brief, opts) => workerProcess(sb, brief, opts),
  }
}

let testEngine: SandboxEngine | undefined

/** Put a fake engine behind every worker (`undefined` restores the real one). */
export function setSandboxEngineForTests(engine: SandboxEngine | undefined): void {
  testEngine = engine
}

/** The engine workers run on, from `config.sandbox`, behind the ownership check. */
export function sandboxEngine(sandbox: string | undefined): SandboxEngine {
  return ownedOnly(testEngine ?? containerEngineOnce(sandbox === 'podman' ? 'podman' : 'docker'))
}

const guarded = new WeakMap<SandboxEngine, SandboxEngine>()
const realEngines = new Map<Engine, SandboxEngine>()

/** The real engine, one per name, so its ownership checks are remembered. */
function containerEngineOnce(name: Engine): SandboxEngine {
  let e = realEngines.get(name)
  if (!e) realEngines.set(name, (e = containerEngine(name)))
  return e
}

/**
 * `base` refusing to stop, remove or exec into a container this install does
 * not own (runcastle-cleans-up-after-itself decision 5): a test drive's
 * runcastle runs on a copy of the real database, whose worker rows name the
 * real install's containers. A container is checked once, then remembered
 * until it is removed; one the engine does not hold passes (there is nothing
 * of another install's to harm, and its origin and branch are this one's).
 */
export function ownedOnly(base: SandboxEngine): SandboxEngine {
  const known = guarded.get(base)
  if (known) return known
  const verified = new Set<string>()
  const check = async (container: string): Promise<void> => {
    if (verified.has(container)) return
    const facts = await base.inspect(container)
    if (!facts) return
    if (ownershipOf(facts, dataDir()) !== 'own') throw new ForeignContainerError(container, facts.labels[LABEL_DATA_DIR])
    verified.add(container)
  }
  const on =
    <A extends unknown[], R>(fn: (sb: WorkerSandbox, ...rest: A) => Promise<R>) =>
    async (sb: WorkerSandbox, ...rest: A): Promise<R> => {
      await check(sb.container)
      return fn(sb, ...rest)
    }
  const engine: SandboxEngine = {

    name: base.name,
    available: () => base.available(),
    prepare: (input) => base.prepare(input),
    create: (input) => base.create(input),
    stop: on((sb) => base.stop(sb)),
    wake: on((sb) => base.wake(sb)),
    conversationOnDisk: on((sb, id: string) => base.conversationOnDisk(sb, id)),
    conversationPath: on((sb, id: string) => base.conversationPath(sb, id)),
    inspect: (container) => base.inspect(container),
    listContainers: () => base.listContainers(),
    listVolumes: () => base.listVolumes(),
    removeContainer: (container) => base.removeContainer(container),
    stopContainers: (containers, seconds) => base.stopContainers(containers, seconds),
    removeVolume: (volume) => base.removeVolume(volume),
    removeStaleImages: (input) => base.removeStaleImages(input),
    remove: on(async (sb) => {
      await base.remove(sb)
      verified.delete(sb.container)
    }),
    takeHandback: on((sb) => base.takeHandback(sb)),
    devServerStarted: on((sb) => base.devServerStarted(sb)),
    fetchBranch: (sb) => base.fetchBranch(sb),
    refreshFeatureBranch: (sb) => base.refreshFeatureBranch(sb),
    copySetup: on((sb, setup: WorkerSetup, fingerprint: string, opts?: { guard?: boolean }) => base.copySetup(sb, setup, fingerprint, opts)),
    setupFingerprint: on((sb) => base.setupFingerprint(sb)),
    copyOut: on((sb, containerPath: string, hostPath: string) => base.copyOut(sb, containerPath, hostPath)),
    process: on((sb, brief: WorkerBrief, opts: WorkerProcessOptions) => base.process(sb, brief, opts)),
  }
  guarded.set(base, engine)
  return engine
}
