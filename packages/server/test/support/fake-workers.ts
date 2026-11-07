import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PromptDisplay } from '@runcastle/core'
import type { AgentTransport } from '../../src/threads/host'
import type { AgentHost } from '../../src/threads/types'
import type { SandboxEngine } from '../../src/workers/engine'
import type { HandbackNote, WorkerSandbox } from '../../src/workers/worker'
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
  removed: string[]
  stopped: string[]
  woken: string[]
  fetched: string[]
  /** Conversation ids the sandbox holds a record of, for the reload guard. */
  conversations: Set<string>
  /** Where the agent's process comes from; none by default. */
  transport?: AgentTransport
}

/** A sandbox engine with no container: handbacks are put in by the test, a removal deletes the host branch as the real one does. */
export function fakeEngine(): FakeEngine {
  const engine: FakeEngine = {
    name: 'docker',
    up: true,
    handbacks: new Map(),
    removed: [],
    stopped: [],
    woken: [],
    fetched: [],
    conversations: new Set(),
    async available() {
      return engine.up
    },
    // The worker branch stands in the host repo as a fetch would leave it.
    create: async (input) => {
      git(input.repoPath, 'branch', input.branch, input.featureBranch)
      return {
        id: input.id,
        engine: input.engine,
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
    },
    wake: async (sb) => {
      engine.woken.push(sb.container)
      return true
    },
    // Like the real one, removing what is already gone is no error.
    remove: async (sb: WorkerSandbox) => {
      engine.removed.push(sb.container)
      if (git(sb.repoPath, 'branch', '--list', sb.branch)) git(sb.repoPath, 'branch', '-D', sb.branch)
    },
    takeHandback: async (sb) => {
      const note = engine.handbacks.get(sb.id)
      engine.handbacks.delete(sb.id)
      return note
    },
    fetchBranch: async (sb) => {
      engine.fetched.push(sb.branch)
    },
    conversationOnDisk: async (_sb, conversationId) => engine.conversations.has(conversationId),
    process: async (sb, _brief, _token, _model) => {
      if (!engine.transport) throw new Error('no agent in these tests')
      // Starting the agent wakes its sandbox first, as the real engine does.
      engine.woken.push(sb.container)
      return engine.transport({} as never, {} as never)
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
