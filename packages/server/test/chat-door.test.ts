import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Phase } from '@runcastle/core'
import { featureDocsRel, sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { launchSession } from '../src/launcher/launcher'
import {
  activeSessionsForFeature,
  createSessionRow,
  markSessionLive,
} from '../src/launcher/sessions'
import type { PtyEntry } from '../src/pty/registry'
import { ptyRegistry } from '../src/pty/registry'
import { stopAllDocsWatch } from '../src/services/docs-watch'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { listSessionsByFeature } from '../src/services/repo'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * The Chat door on a chat that is already up (`one-chat-per-feature`
 * decision 12). The door is constant in all four states and never disabled, so
 * the one thing it must never do is throw: clicking it a second time answers
 * with the conversation that is already live rather than with the one-terminal
 * refusal. The guard itself survives — nothing spawns a second time, and a live
 * session of any other kind still refuses.
 */
describe('the Chat door on a live chat', () => {
  let ctx: AppCtx
  let projectId: string
  let repoPath: string
  let restoreDataDir: () => void
  const cleanup: string[] = []

  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'runcastle-chat-door-home-'))
    cleanup.push(home)
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-chat-door-repo-'))
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
    for (const dir of cleanup) rmTemp(dir)
    cleanup.length = 0
  })

  /** A feature on a real branch, in whichever state the door is clicked from. */
  async function featureIn(phase: Phase, slug: string, lap = 1): Promise<Feature> {
    const feature = seedFeature(ctx, projectId, { slug, phase, lap })
    const docsDir = join(repoPath, ...featureDocsRel(slug).split('/'))
    mkdirSync(docsDir, { recursive: true })
    writeFileSync(join(docsDir, 'brief.md'), '# brief.md\n', 'utf8')
    const git = simpleGit(repoPath)
    await git.add('.')
    await git.commit(`scaffold docs for ${slug}`)
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return feature
  }

  /** Open the chat without a terminal and mark it live, as a real spawn would. */
  async function openChat(feature: Feature): Promise<string> {
    const { sessionId } = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'chat' },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))
    markSessionLive(ctx, sessionId, { ccSessionId: `cc-${sessionId}` })
    return sessionId
  }

  /** Stand a terminal up for a live session and record what is typed into it. */
  function terminalFor(sessionId: string): string[] {
    const typed: string[] = []
    const entry = {
      sessionId,
      exited: false,
      pty: { write: (data: string) => typed.push(data) },
    } as unknown as PtyEntry
    vi.spyOn(ptyRegistry(), 'get').mockImplementation((id) =>
      id === sessionId ? entry : undefined,
    )
    return typed
  }

  function kickoffs(featureId: string): { data: Record<string, unknown> | null }[] {
    return listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.kickoff')
  }

  it('answers with the live conversation instead of refusing a second one', async () => {
    const feature = await featureIn('planning', 'live-chat')
    const first = await openChat(feature)

    const again = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'chat' },
      { spawn: false },
    )

    expect(again.sessionId).toBe(first)
    expect(listSessionsByFeature(ctx, feature.id).map((s) => s.id)).toEqual([first])
  })

  it('answers the same way from review, where no terminal renders', async () => {
    const feature = await featureIn('review', 'review-chat')
    const first = await openChat(feature)

    const again = await launchSession(
      ctx,
      { featureId: feature.id, kind: 'chat' },
      { spawn: false },
    )

    expect(again.sessionId).toBe(first)
    expect(activeSessionsForFeature(ctx, feature.id).map((s) => s.id)).toEqual([first])
  })

  it('still refuses when a session of another kind holds the terminal', async () => {
    const feature = await featureIn('planning', 'converge-chat')
    const converge = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'converge',
      worktreePath: worktreeDir(projectId, feature.slug),
    })
    markSessionLive(ctx, converge.id, { ccSessionId: 'cc-converge' })

    await expect(
      launchSession(ctx, { featureId: feature.id, kind: 'chat' }, { spawn: false }),
    ).rejects.toThrow(/already live/i)
  })

  /**
   * Decision 13: a purpose-specific briefing rides the conversation it is
   * headed for. Answering with the live chat used to answer with ONLY the live
   * chat — resolve-conflict, stop-drive-and-iterate and a lap in flight all
   * foregrounded the terminal and dropped the reason the human opened it.
   */
  it('delivers a purpose-specific briefing into the live conversation', async () => {
    const feature = await featureIn('review', 'briefed-chat')
    const first = await openChat(feature)
    const typed = terminalFor(first)

    vi.useFakeTimers()
    let again: { sessionId: string }
    try {
      again = await launchSession(
        ctx,
        { featureId: feature.id, kind: 'chat', kickoffLine: 'OVERRIDE' },
        { spawn: false },
      )
      vi.runAllTimers()
    } finally {
      vi.useRealTimers()
    }

    expect(again.sessionId).toBe(first)
    expect(typed).toEqual(['OVERRIDE', '\r'])
    expect(kickoffs(feature.id).at(-1)?.data).toMatchObject({
      sessionId: first,
      kind: 'chat',
      line: 'OVERRIDE',
      mechanism: 'pty',
    })
  })

  it('reports a purpose-specific briefing that has no live terminal', async () => {
    const feature = await featureIn('review', 'missing-terminal-chat')
    await openChat(feature)
    const kickoffsBefore = kickoffs(feature.id)

    await expect(
      launchSession(
        ctx,
        { featureId: feature.id, kind: 'chat', kickoffLine: 'OVERRIDE' },
        { spawn: false },
      ),
    ).rejects.toThrow(/terminal.*not available/i)

    expect(kickoffs(feature.id)).toEqual(kickoffsBefore)
  })

  it('delivers the briefing a lap in flight writes for itself', async () => {
    const feature = await featureIn('planning', 'lap-chat', 2)
    const first = await openChat(feature)
    const typed = terminalFor(first)

    const again = await launchSession(ctx, { featureId: feature.id, kind: 'chat' }, { spawn: false })

    expect(again.sessionId).toBe(first)
    expect(typed[0]).toContain('LAP 2 REVIEW ITERATION')
  })

  it('types nothing into a conversation the door merely returns to', async () => {
    const feature = await featureIn('shipped', 'quiet-chat')
    const first = await openChat(feature)
    const typed = terminalFor(first)

    const again = await launchSession(ctx, { featureId: feature.id, kind: 'chat' }, { spawn: false })

    expect(again.sessionId).toBe(first)
    expect(typed).toEqual([])
    expect(kickoffs(feature.id)).toEqual([])
  })
})
