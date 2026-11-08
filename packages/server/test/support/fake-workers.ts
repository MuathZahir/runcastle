import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { PromptDisplay } from '@runcastle/core'
import type { AgentTransport } from '../../src/threads/host'
import type { AgentHost } from '../../src/threads/types'
import type { SandboxEngine } from '../../src/workers/engine'
import type { PrepareInput } from '../../src/workers/prepare'
import type { WorkerSetup } from '../../src/workers/setup-copy'
import { type HandbackNote, type NewSandboxInput, type WorkerLaunch, type WorkerProcessOptions, type WorkerSandbox, permissionHooks, workerLaunch } from '../../src/workers/worker'
import { tmpRepo } from '../helpers/fixtures'

/**
 * The fakes interactive workers are tested with (docs/features/interactive-workers):
 * an agent host that only records, and a sandbox engine with no container.
 * The git underneath stays real.
 */

export interface Sent {
  threadId: string
  text: string
  display?: PromptDisplay
}

/** An agent host that only records what was said to which thread. */
export function fakeHost(): { host: AgentHost; sent: Sent[]; stopped: string[] } {
  const sent: Sent[] = []
  const stopped: string[] = []
  const host = {
    prompt: async (threadId: string, input: { text: string }, opts: { display?: PromptDisplay }) => {
      sent.push({ threadId, text: input.text, ...(opts.display ? { display: opts.display } : {}) })
      return { promptId: `p${sent.length}` }
    },
    stop: async (threadId: string) => {
      stopped.push(threadId)
    },
    isRunning: () => false,
  }
  return { host: host as unknown as AgentHost, sent, stopped }
}

export type FakeEngine = SandboxEngine & {
  up: boolean
  handbacks: Map<string, HandbackNote>
  /** Worker ids whose agent has started a dev server, as the in-sandbox tool records it. */
  devServers: Set<string>
  removed: string[]
  stopped: string[]
  /** The containers the engine holds, by name: true while one runs. */
  held: Map<string, boolean>
  woken: string[]
  fetched: string[]
  /** Containers whose bare copy was given the feature branch's current tip. */
  refreshed: string[]
  /** Conversation ids the sandbox holds a record of, for the reload guard. */
  conversations: Set<string>
  /** Each copy of the human's setup the engine was asked to make, oldest first. */
  setups: { container: string; setup: WorkerSetup; guard: boolean }[]
  /** What each start asked the engine to prepare (the image build, the cache volume), oldest first. */
  prepares: PrepareInput[]
  /** When set, the next `prepare` throws it: an image that would not build. */
  prepareFailure?: string
  /** What each sandbox was created with, oldest first. */
  created: NewSandboxInput[]
  /** The engine's calls in order, by name (`prepare`, `create`, `copyOut`, `remove`). */
  order: string[]
  /** Where the agent's record of a conversation id sits inside the fake sandbox; none by default. */
  conversationPaths: Map<string, string>
  /** The fingerprint each sandbox holds of its last setup copy, by container. */
  fingerprints: Map<string, string>
  /** The files inside the fake sandbox, by container path, for `copyOut`. */
  sandboxFiles: Map<string, string | Buffer>
  /** What each agent process was started with. */
  processes: WorkerProcessOptions[]
  /** How the real engine would have started each one: its exec argv and session (`workerLaunch`). */
  launches: WorkerLaunch[]
  /** Where the agent's process comes from; none by default. */
  transport?: AgentTransport
}

/** A sandbox engine with no container: handbacks are put in by the test, a removal deletes the host branch as the real one does. */
export function fakeEngine(): FakeEngine {
  const engine: FakeEngine = {
    name: 'docker',
    up: true,
    handbacks: new Map(),
    devServers: new Set(),
    removed: [],
    stopped: [],
    held: new Map(),
    woken: [],
    fetched: [],
    refreshed: [],
    conversations: new Set(),
    setups: [],
    prepares: [],
    created: [],
    order: [],
    conversationPaths: new Map(),
    fingerprints: new Map(),
    sandboxFiles: new Map(),
    processes: [],
    launches: [],
    async available() {
      return engine.up
    },
    prepare: async (input) => {
      engine.order.push('prepare')
      engine.prepares.push(input)
      if (engine.prepareFailure) throw new Error(engine.prepareFailure)
    },
    // The worker branch stands in the host repo as a fetch would leave it.
    create: async (input) => {
      engine.order.push('create')
      engine.created.push(input)
      git(input.repoPath, 'branch', input.branch, input.featureBranch)
      engine.held.set(input.container, true)
      return {
        id: input.id,
        engine: input.engine,
        runtime: input.runtime,
        container: input.container,
        repoPath: input.repoPath,
        featureBranch: input.featureBranch,
        branch: input.branch,
        port: 41001,
        previewUrl: 'http://localhost:41001/',
      }
    },
    stop: async (sb) => {
      engine.stopped.push(sb.container)
      if (engine.held.has(sb.container)) engine.held.set(sb.container, false)
    },
    wake: async (sb) => {
      engine.woken.push(sb.container)
      if (engine.held.has(sb.container)) engine.held.set(sb.container, true)
      return true
    },
    containers: async () => new Map(engine.held),
    // Like the real one, removing what is already gone is no error.
    remove: async (sb: WorkerSandbox) => {
      engine.order.push('remove')
      engine.removed.push(sb.container)
      engine.held.delete(sb.container)
      if (git(sb.repoPath, 'branch', '--list', sb.branch)) git(sb.repoPath, 'branch', '-D', sb.branch)
    },
    takeHandback: async (sb) => {
      const note = engine.handbacks.get(sb.id)
      engine.handbacks.delete(sb.id)
      return note
    },
    devServerStarted: async (sb) => engine.devServers.has(sb.id),
    fetchBranch: async (sb) => {
      engine.fetched.push(sb.branch)
    },
    refreshFeatureBranch: async (sb) => {
      engine.refreshed.push(sb.container)
    },
    conversationPath: async (_sb, conversationId) => engine.conversationPaths.get(conversationId),
    conversationOnDisk: async (_sb, conversationId) => engine.conversations.has(conversationId),
    copySetup: async (sb, setup, fingerprint, opts) => {
      engine.setups.push({ container: sb.container, setup, guard: opts?.guard === true })
      engine.fingerprints.set(sb.container, fingerprint)
    },
    setupFingerprint: async (sb) => engine.fingerprints.get(sb.container),
    // The sandbox's files are the test's: `sandboxFiles` maps a container path to its body.
    copyOut: async (_sb, containerPath, hostPath) => {
      engine.order.push('copyOut')
      const body = engine.sandboxFiles.get(containerPath)
      if (body === undefined) throw new Error(`no file ${containerPath} in the fake sandbox`)
      mkdirSync(dirname(hostPath), { recursive: true })
      writeFileSync(hostPath, body)
    },
    process: async (sb, brief, opts) => {
      engine.processes.push(opts)
      const launch = workerLaunch(sb, brief, opts)
      engine.launches.push(launch)
      if (!engine.transport) throw new Error('no agent in these tests')
      // Starting the agent wakes its sandbox first, as the real engine does.
      engine.woken.push(sb.container)
      if (engine.held.has(sb.container)) engine.held.set(sb.container, true)
      // The session opens as the real engine's does: in the sandbox, in its runtime's automatic mode.
      return {
        ...(await engine.transport({} as never, {} as never)),
        session: launch.session,
        ...permissionHooks(opts.onMode, sb.runtime),
      }
    },
  }
  return engine
}

export function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}

/** A repo with `main` and `feature/<slug>`, nothing checked out on the feature branch. */
export function initRepo(slug: string): string {
  const repo = tmpRepo()
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 't@t.t')
  git(repo, 'config', 'user.name', 't')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'initial commit')
  git(repo, 'branch', `feature/${slug}`)
  return repo
}

/** Commit `file` on `branch` (as the worker would, its commits then fetched to the host). */
export function commitOn(repo: string, branch: string, file: string, body: string, subject: string): void {
  git(repo, 'checkout', '-q', '-B', branch, branch)
  writeFileSync(join(repo, file), body)
  git(repo, 'add', file)
  git(repo, 'commit', '-q', '-m', subject)
  git(repo, 'checkout', '-q', 'main')
}
