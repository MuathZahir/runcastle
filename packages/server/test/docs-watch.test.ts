import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
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
