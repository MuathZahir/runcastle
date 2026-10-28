import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionPurpose } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { launchSession } from '../src/launcher/launcher'
import { KICKOFF_LINES } from '../src/launcher/runtimes/claude'
import {
  createSessionRow,
  markSessionEnded,
  markSessionLive,
  planKickoff,
} from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { briefOf, kickoffOf, promptsOf } from './support/thread-launch'

/**
 * A chat launch rides the feature's one conversation (`one-chat-per-feature`
 * decision 13): an explicit briefing is said into the resumed thread, ahead of
 * the feature's fresh state, and a plain open of a conversation under way says
 * nothing at all — the thread just opens.
 *
 * Observed at the seams the launch crosses: the plan (pure), and a
 * `spawn:false` launch, which logs its briefing as the thread's prompt; the
 * brief is what the thread's process would be started with.
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

describe('planKickoff', () => {
  it('treats a caller-supplied briefing as one the launch must say', () => {
    const plan = planKickoff({ kind: 'chat', kickoffLine: 'Resolve the merge conflict.' })
    expect(plan).toEqual({ line: 'Resolve the merge conflict.', explicit: true })
  })

  it('leaves an ordinary launch alone — no line of its own', () => {
    expect(planKickoff({ kind: 'chat' })).toEqual({ explicit: false })
  })
})

describe('launchSession — briefings', () => {
  let ctx: AppCtx
  let repoPath: string
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-lapkickoff-'))
    cleanup.push(repoPath)
    git(repoPath, 'init', '-b', 'main')
    git(repoPath, 'config', 'user.email', 'test@runcastle.dev')
    git(repoPath, 'config', 'user.name', 'Runcastle Test')
    git(repoPath, 'commit', '--allow-empty', '-m', 'initial commit')
  })

  afterEach(() => {
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  /** A feature with a real branch + worktree, and its main chat's conversation on record. */
  async function seedResumable(
    slug: string,
    overrides: Parameters<typeof seedFeature>[2] = {},
  ): Promise<{ featureId: string; priorId: string }> {
    const project = seedProject(ctx, repoPath)
    const feature = seedFeature(ctx, project.id, { slug, ...overrides })
    await createFeatureBranch(project, slug, 'main')
    cleanup.push(worktreeDir(project.id, slug))
    const prior = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'chat',
      worktreePath: worktreeDir(project.id, slug),
    })
    markSessionLive(ctx, prior.id, { ccSessionId: 'cc-prior' })
    markSessionEnded(ctx, prior.id)
    return { featureId: feature.id, priorId: prior.id }
  }

  /** What a `spawn:false` launch said into its thread, and the brief its process would start with. */
  async function launchAndRead(
    featureId: string,
    input: { kind: 'chat'; kickoffLine?: string; purpose?: SessionPurpose },
  ): Promise<{ sessionId: string; said: string; prompt: string }> {
    const { sessionId } = await launchSession(ctx, { featureId, ...input }, { spawn: false })
    cleanup.push(sessionDir(sessionId))
    return { sessionId, said: kickoffOf(sessionId), prompt: await briefOf(ctx, sessionId) }
  }

  /**
   * Start lap retired with laps (`the-feature-lead-runs-rounds`): the lead runs
   * rounds, so a launch that still arrives with the historical `start-lap`
   * purpose opens the chat as any plain open does — as the feature's lead.
   */
  it('opens a start-lap launch at review as a plain chat: the lead, no lap framing', async () => {
    const { featureId, priorId } = await seedResumable('start-lap-retired', {})
    const plain = await launchAndRead(featureId, { kind: 'chat', purpose: 'start-lap' })

    expect(plain.sessionId).toBe(priorId)
    // A plain open of a conversation under way says nothing.
    expect(plain.said).toBe('')
    expect(plain.prompt).toContain("You are this feature's **lead**")
    expect(plain.prompt).not.toContain('This is lap')
  })

  it('delivers a chat kickoff override into the resumed conversation', async () => {
    const briefing = 'Resolve the merge conflict on the feature branch.'
    const { featureId, priorId } = await seedResumable('with-briefing', {})
    const { sessionId, said } = await launchAndRead(featureId, {
      kind: 'chat',
      kickoffLine: briefing,
    })

    expect(sessionId).toBe(priorId)
    expect(said.startsWith(`[runcastle] ${briefing}`)).toBe(true)
    expect(said).toContain('Feature status:')
    const events = listAfter(ctx, featureId, 0)
    expect(events.map((e) => e.type)).toContain('session.resumed')
    expect(events.map((e) => e.type)).not.toContain('session.resume_skipped')
  })

  it('still reopens the last conversation for a launch with no briefing, saying nothing', async () => {
    const { featureId, priorId } = await seedResumable('no-briefing', {})
    const { sessionId } = await launchSession(ctx, { featureId, kind: 'chat' }, { spawn: false })

    expect(sessionId).toBe(priorId)
    // a plain open says nothing: the conversation comes back as it was left
    // (`opening-a-feature-shows-its-chat-as-you-left-it` decision 1)
    expect(promptsOf(sessionId)).toEqual([])
    const events = listAfter(ctx, featureId, 0)
    expect(events.map((e) => e.type)).toContain('session.resumed')
  })

  it('a chat with no briefing keeps its own opening line', () => {
    expect(planKickoff({ kind: 'chat' }).line).toBeUndefined()
    // no lap briefing, so the table's state-unknown default stands: the chat's
    // one opening skill, not a lap framing
    expect(KICKOFF_LINES.chat).toContain('/runcastle:feature')
    expect(KICKOFF_LINES.chat).not.toContain('FROM REVIEW')
  })
})
