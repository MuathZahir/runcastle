import type { AgentProcess } from '../threads/host'
import { type Engine, engineRun } from './sandbox'
import {
  type HandbackNote,
  type NewSandboxInput,
  type WorkerBrief,
  type WorkerSandbox,
  createWorkerSandbox,
  fetchWorkerBranch,
  removeSandbox,
  stopSandbox,
  takeHandbackNote,
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
  /** The worker's bare copy, container, clone and install; resolves to the sandbox it made. */
  create(input: NewSandboxInput): Promise<WorkerSandbox>
  /** Stop the container, keeping its filesystem (an idle stop). */
  stop(sb: WorkerSandbox): Promise<void>
  /** Remove the container, the worker branch on the host and its bare copy. */
  remove(sb: WorkerSandbox): Promise<void>
  /** The handback the worker wrote since the last one taken, if any. */
  takeHandback(sb: WorkerSandbox): Promise<HandbackNote | undefined>
  /** Bring the worker branch's commits into the host repo as `refs/heads/<branch>`. */
  fetchBranch(sb: WorkerSandbox): Promise<void>
  /** The agent process inside the sandbox, started (and the sandbox woken) if need be. */
  process(sb: WorkerSandbox, brief: WorkerBrief, token: string, model?: string): Promise<AgentProcess>
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
    create: (input) => createWorkerSandbox(input),
    stop: (sb) => stopSandbox(sb),
    remove: (sb) => removeSandbox(sb),
    takeHandback: (sb) => takeHandbackNote(sb),
    fetchBranch: (sb) => fetchWorkerBranch(sb),
    process: (sb, brief, token, model) => workerProcess(sb, brief, token, model),
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
