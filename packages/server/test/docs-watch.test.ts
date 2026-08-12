import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { featureDocsRel, sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { handlePtyExit, launchSession } from '../src/launcher/launcher'
import { getSessionRow, markSessionEnded } from '../src/launcher/sessions'
import type { PtyEntry } from '../src/pty/registry'
import { ptyRegistry } from '../src/pty/registry'
import { createFeatureBranch } from '../src/services/git'
import { getFeatureRow } from '../src/services/repo'
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
import { seedFeature, seedProject } from './helpers/fixtures'

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
    rmSync(docsDir, { recursive: true, force: true })
  })

  /** Every `docs.changed` event on the feature's timeline. */
  function docsEvents(): { message: string }[] {
    return listAfter(ctx, feature.id).filter((e) => e.type === 'docs.changed')
  }

  it('turns a doc write into one event that also publishes on the live bus', async () => {
    startDocsWatch(ctx, feature)

    writeFileSync(join(docsDir, 'spec.md'), '# spec\n', 'utf8')
    await sleep(SETTLE_MS)

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
    startDocsWatch(ctx, feature)

    // What an agent writing a spec actually looks like: several files, many
    // writes, all inside a few milliseconds.
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(docsDir, 'spec.md'), `# spec ${i}\n`, 'utf8')
      writeFileSync(join(docsDir, 'decisions.md'), `# decisions ${i}\n`, 'utf8')
    }
    await sleep(SETTLE_MS)

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
    startDocsWatch(ctx, feature)
    expect(docsWatchCount()).toBe(1)

    writeFileSync(join(docsDir, 'spec.md'), '# spec\n', 'utf8')
    await sleep(SETTLE_MS)

    expect(docsEvents()).toHaveLength(1)
  })

  it('swallows a missing docs directory instead of throwing at the session', async () => {
    rmSync(docsDir, { recursive: true, force: true })

    expect(() => startDocsWatch(ctx, feature)).not.toThrow()
    expect(docsWatchCount()).toBe(0)
    // And stopping something that never started is equally harmless — every
    // session-end path calls it unconditionally.
    expect(() => stopDocsWatch(feature.id)).not.toThrow()
  })

  it('ignores editor temp files beside the docs', async () => {
    startDocsWatch(ctx, feature)

    writeFileSync(join(docsDir, '.spec.md.swp'), 'vim', 'utf8')
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

  afterEach(() => {
    vi.restoreAllMocks()
    stopAllDocsWatch()
    restoreDataDir()
    for (const dir of cleanup) rmSync(dir, { recursive: true, force: true })
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
    await createFeatureBranch({ id: projectId, name: 't', repoPath, mainBranch: 'main' }, slug)
    cleanup.push(worktreeDir(projectId, slug))
    return feature
  }

  /** Let the terminal "spawn" without starting a real Claude Code process. */
  function stubPty(): void {
    vi.spyOn(ptyRegistry(), 'create').mockReturnValue({
      pty: { pid: 4512 },
    } as unknown as PtyEntry)
  }

  it('starts on spawn and stops when the PTY exits', async () => {
    const feature = await featureWithWorktree('pty-exit')
    stubPty()

    const { sessionId } = await launchSession(ctx, { featureId: feature.id, kind: 'ideation' })
    cleanup.push(sessionDir(sessionId))
    expect(docsWatchCount()).toBe(1)

    handlePtyExit(ctx, getFeatureRow(ctx, feature.id), getSessionRow(ctx, sessionId)!, {}, 0)
    expect(docsWatchCount()).toBe(0)
  })

  it('stops on the marked-ended path (Stop hook, boot reconciliation)', async () => {
    const feature = await featureWithWorktree('marked-ended')
    stubPty()

    const { sessionId } = await launchSession(ctx, { featureId: feature.id, kind: 'ideation' })
    cleanup.push(sessionDir(sessionId))
    expect(docsWatchCount()).toBe(1)

    markSessionEnded(ctx, sessionId)
    expect(docsWatchCount()).toBe(0)
  })
})
