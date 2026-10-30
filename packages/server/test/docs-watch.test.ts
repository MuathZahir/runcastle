import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { featureDocsRel, sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { launchSession } from '../src/launcher/launcher'
import { claudeRuntime } from '../src/launcher/runtimes/claude'
import { markSessionEnded } from '../src/launcher/sessions'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import type { AgentHost } from '../src/threads/types'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'
import { createFeatureBranch } from '../src/services/git'
import { type LiveSignal, subscribeLive } from '../src/services/bus'
import {
  DOCS_WATCH_DEBOUNCE_MS,
  docsWatchCount,
  startDocsWatch,
  stopAllDocsWatch,
  stopDocsWatch,
} from '../src/services/docs-watch'
import { listAfter } from '../src/services/events'
import { featureDocsDir } from '../src/services/feature-docs'
import { projectForFeature } from '../src/services/repo'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * The docs watcher seam: start/stop per feature, observable purely through the
 * `docs.changed` events it emits. Doc writes were the pipe's biggest deaf spot —
 * the agent wrote a spec and the UI heard nothing — so what is asserted here is
 * that a write enters the event system exactly once.
 */

/** Long enough for the fs event plus the trailing debounce to land. */
const SETTLE_MS = DOCS_WATCH_DEBOUNCE_MS + 400

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Start the watcher and give the OS a beat to arm it. On macOS the first
 * FSEvents stream in a process starts asynchronously, and a write landing in
 * that window is never reported — a race only a test can lose, since a real
 * session's first doc write comes seconds after the watcher starts.
 */
async function startArmed(ctx: AppCtx, feature: Feature): Promise<void> {
  startDocsWatch(ctx, feature)
  await sleep(150)
}

describe('docs watcher', () => {
  let ctx: AppCtx
  let feature: Feature
  let docsDir: string
  let signals: LiveSignal[]
  let unsubscribe: () => void

  beforeEach(async () => {
    ctx = await makeTestCtx()
    feature = seedFeature(ctx, seedProject(ctx).id)
    // No talk worktree exists in a test, so the docs dir resolves to the
    // project's checkout — a fresh temp dir per test.
    docsDir = featureDocsDir(projectForFeature(ctx, feature), feature)
    mkdirSync(docsDir, { recursive: true })
    signals = []
    unsubscribe = subscribeLive((s) => signals.push(s))
  })

  afterEach(() => {
    unsubscribe()
    stopAllDocsWatch()
    rmTemp(docsDir)
  })

  /** Every `docs.changed` event on the feature's timeline. */
  function docsEvents(): { message: string }[] {
    return listAfter(ctx, feature.id).filter((e) => e.type === 'docs.changed')
  }

  /** The first event, however busy the machine, then time for a stray second to land. */
  async function firstEventThenSettle(): Promise<void> {
    await vi.waitFor(() => expect(docsEvents().length).toBeGreaterThan(0))
    await sleep(SETTLE_MS)
  }

  it('turns a doc write into one event that also publishes on the live bus', async () => {
    await startArmed(ctx, feature)

    writeFileSync(join(docsDir, 'spec.md'), '# spec\n', 'utf8')
    await firstEventThenSettle()

    const events = docsEvents()
    expect(events).toHaveLength(1)
    expect(events[0].message).toContain('spec.md')
    // The event must reach browsers, not just the table — that is the whole
    // point of routing through the emit choke point.
    expect(signals).toContainEqual(
      expect.objectContaining({ kind: 'event', featureId: feature.id }),
    )
  })

  it('debounces a write burst into a single event naming each file', async () => {
    await startArmed(ctx, feature)

    // What an agent writing a spec actually looks like: several files, many
    // writes, all inside a few milliseconds.
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(docsDir, 'spec.md'), `# spec ${i}\n`, 'utf8')
      writeFileSync(join(docsDir, 'decisions.md'), `# decisions ${i}\n`, 'utf8')
    }
    await firstEventThenSettle()

    const events = docsEvents()
    expect(events).toHaveLength(1)
    expect(events[0].message).toContain('spec.md')
    expect(events[0].message).toContain('decisions.md')
  })

  it('emits nothing after stop, and releases the watcher handle', async () => {
    startDocsWatch(ctx, feature)
    expect(docsWatchCount()).toBe(1)

    stopDocsWatch(feature.id)
    expect(docsWatchCount()).toBe(0)

    writeFileSync(join(docsDir, 'spec.md'), '# written after stop\n', 'utf8')
    await sleep(SETTLE_MS)

    expect(docsEvents()).toHaveLength(0)
  })

  it('is idempotent on a double start — one watcher, one event per write', async () => {
    startDocsWatch(ctx, feature)
    await startArmed(ctx, feature)
    expect(docsWatchCount()).toBe(1)

    writeFileSync(join(docsDir, 'spec.md'), '# spec\n', 'utf8')
    await firstEventThenSettle()

    expect(docsEvents()).toHaveLength(1)
  })

  it('swallows a missing docs directory instead of throwing at the session', async () => {
    rmTemp(docsDir)

    expect(() => startDocsWatch(ctx, feature)).not.toThrow()
    expect(docsWatchCount()).toBe(0)
    // And stopping something that never started is equally harmless — every
    // session-end path calls it unconditionally.
    expect(() => stopDocsWatch(feature.id)).not.toThrow()
  })

  it('ignores editor temp files beside the docs', async () => {
    await startArmed(ctx, feature)

    writeFileSync(join(docsDir, '.spec.md.swp'), 'vim', 'utf8')
    await sleep(SETTLE_MS)

    expect(docsEvents()).toHaveLength(0)
  })

  it('names the plan preview, the one non-Markdown doc the page shows', async () => {
    await startArmed(ctx, feature)

    writeFileSync(join(docsDir, 'preview.html'), '<!doctype html>', 'utf8')
    await firstEventThenSettle()

    const events = listAfter(ctx, feature.id).filter((e) => e.type === 'docs.changed')
    expect(events).toHaveLength(1)
    expect(events[0].data).toEqual({ files: ['preview.html'] })
  })

  it('still ignores every other non-Markdown file', async () => {
    await startArmed(ctx, feature)

    writeFileSync(join(docsDir, 'notes.txt'), 'scratch', 'utf8')
    await sleep(SETTLE_MS)

    expect(docsEvents()).toHaveLength(0)
  })
})

/**
 * The watcher's lifetime is a session's lifetime — it must exist for exactly as
 * long as something is working in the worktree. A leaked watcher is not just
 * waste: on Windows it holds a lock on the directory the post-merge worktree
 * removal has to delete.
 */
describe('docs watcher lifecycle — bound to the session', () => {
  let ctx: AppCtx
  let projectId: string
  let repoPath: string
  let restoreDataDir: () => void
  let host: AgentHost | undefined
  const cleanup: string[] = []

  beforeEach(async () => {
    // Worktrees are built under the data dir; pin it into a temp home so this
    // never reaches into a developer's real install.
    const home = mkdtempSync(join(tmpdir(), 'runcastle-docs-home-'))
    cleanup.push(home)
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-docs-watch-'))
    cleanup.push(repoPath)
    const git = simpleGit(repoPath)
    await git.init(['-b', 'main'])
    await git.addConfig('user.email', 'test@runcastle.dev')
    await git.addConfig('user.name', 'Runcastle Test')
    await git.addConfig('core.autocrlf', 'false')
    await git.raw(['commit', '--allow-empty', '-m', 'initial commit'])
    projectId = seedProject(ctx, repoPath).id
  })

  afterEach(async () => {
    await host?.stopAll('shutdown')
    host = undefined
    setAgentHostForTests(undefined)
    vi.restoreAllMocks()
    stopAllDocsWatch()
    restoreDataDir()
    for (const dir of cleanup) rmTemp(dir)
    cleanup.length = 0
  })

  /**
   * A feature whose docs are committed on its branch — so the talk worktree's
   * checkout contains the directory the watcher attaches to, exactly as a
   * scaffolded feature's does.
   */
  async function featureWithWorktree(slug: string): Promise<Feature> {
    const feature = seedFeature(ctx, projectId, { slug })
    const docsSegments = featureDocsRel(slug).split('/')
    mkdirSync(join(repoPath, ...docsSegments), { recursive: true })
    writeFileSync(join(repoPath, ...docsSegments, 'brief.md'), '# brief\n', 'utf8')
    const git = simpleGit(repoPath)
    await git.add('.')
    await git.commit(`scaffold docs for ${slug}`)
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return feature
  }

  /**
   * A fake agent behind the host, past the readiness gate, with the
   * lifecycle that starts the watcher when a thread's process runs. Stubbing
   * readiness keeps this file about the watcher's lifetime rather than about
   * what happens to be on the machine's PATH.
   */
  function fakeHost(): AgentHost {
    vi.spyOn(claudeRuntime, 'checkReady').mockReturnValue({ ok: true })
    host = createAgentHost({ ctx, transport: createFakeAcp().transport, launch: FAKE_LAUNCH, lifecycle: threadLifecycle(ctx) })
    setAgentHostForTests(host)
    return host
  }

  it('starts when the chat’s process runs and stops when it stops', async () => {
    const feature = await featureWithWorktree('process-stop')
    fakeHost()

    const { sessionId } = await launchSession(ctx, { featureId: feature.id, kind: 'chat' })
    cleanup.push(sessionDir(sessionId))
    await vi.waitFor(() => expect(docsWatchCount()).toBe(1))

    await host?.stop(sessionId, 'idle')
    expect(docsWatchCount()).toBe(0)
  })

  it('stops on the marked-ended path (SessionEnd hook, boot reconciliation)', async () => {
    const feature = await featureWithWorktree('marked-ended')
    fakeHost()

    const { sessionId } = await launchSession(ctx, { featureId: feature.id, kind: 'chat' })
    cleanup.push(sessionDir(sessionId))
    await vi.waitFor(() => expect(docsWatchCount()).toBe(1))

    markSessionEnded(ctx, sessionId)
    expect(docsWatchCount()).toBe(0)
  })
})
