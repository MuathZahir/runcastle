import type { AgentProcess } from '../threads/host'
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
  workerContainers,
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
  /** Every worker container the engine holds, stopped ones too, by name: true when it runs. */
  containers(): Promise<Map<string, boolean>>
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
    containers: () => workerContainers(name),
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

/** The engine workers run on, from `config.sandbox`. */
export function sandboxEngine(sandbox: string | undefined): SandboxEngine {
  return testEngine ?? containerEngine(sandbox === 'podman' ? 'podman' : 'docker')
}
