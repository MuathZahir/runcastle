import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  lapKickoff,
  markSessionEnded,
  markSessionLive,
  planKickoff,
} from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { addNote, carryNotes } from '../src/services/test-notes'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * A launch that carries an explicit briefing must open a FRESH conversation
 * (F2). `--resume` puts Claude Code's "start from a summary?" chooser on screen
 * at exactly the moment the kickoff is typed blind into the PTY, so the briefing
 * answers the dialog instead of arriving — and a restored transcript would argue
 * with it even when it survives.
 *
 * Observed at the two seams the launch actually crosses: the plan (pure), and a
 * `spawn:false` launch, which renders the real `claude` argv into its
 * `session.launched` event and writes the real prompt artifact to disk.
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

describe('planKickoff', () => {
  it('treats a caller-supplied briefing as the opening move (fresh, no resume)', () => {
    const plan = planKickoff({ kind: 'chat', kickoffLine: 'Resolve the merge conflict.' })
    expect(plan).toEqual({ line: 'Resolve the merge conflict.', explicit: true })
  })

  it('leaves an ordinary launch alone — no line, resume as before', () => {
    expect(planKickoff({ kind: 'chat' })).toEqual({ explicit: false })
  })
})

describe('the lap briefing', () => {
  it('plans the lap at review: no complete_phase, and hands back to Burn', () => {
    const line = lapKickoff(2)
    expect(line).toContain('LAP 2')
    expect(line).toMatch(/Do NOT call complete_phase/)
    expect(line).not.toMatch(/ideation → spec → tickets/)
    expect(line).toMatch(/review the cards and click Burn/)
  })
})

describe('launchSession — lap briefings', () => {
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

  /** A feature with a real branch + worktree, and one ended resumable session. */
  async function seedResumable(
    slug: string,
    overrides: Parameters<typeof seedFeature>[2] = {},
  ): Promise<{ featureId: string }> {
    const project = seedProject(ctx, repoPath)
    const feature = seedFeature(ctx, project.id, { slug, ...overrides })
    await createFeatureBranch(project, slug, 'main')
    cleanup.push(worktreeDir(project.id, slug))
    const prior = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'chat',
      worktreePath: 'w',
    })
    markSessionLive(ctx, prior.id, { ccSessionId: 'cc-prior' })
    markSessionEnded(ctx, prior.id)
    return { featureId: feature.id }
  }

  /** The `claude` argv a `spawn:false` launch rendered, and its prompt artifact. */
  async function launchAndRead(
    featureId: string,
    input: { kind: 'chat'; kickoffLine?: string; purpose?: SessionPurpose },
  ): Promise<{ sessionId: string; command: string; prompt: string }> {
    const { sessionId } = await launchSession(ctx, { featureId, ...input }, { spawn: false })
    cleanup.push(sessionDir(sessionId))
    const launched = listAfter(ctx, featureId, 0).find((e) => e.type === 'session.launched')
    return {
      sessionId,
      command: String((launched?.data as { command?: string })?.command ?? ''),
      prompt: readFileSync(join(sessionDir(sessionId), 'system-prompt.md'), 'utf8'),
    }
  }

  /**
   * THE START-LAP REPRO. A lap-1 feature at review, every ticket done, nothing
   * open, a spec with `## Later laps`: the human clicks "Start lap 2" and the
   * chat used to resume with the generic revisit line and "Feature state:
   * review; lap 1" — no lap framing at all, because `lapInFlight` wants phase
   * `planning` and the counter only moves at Burn. The agent then told the human
   * to start the next lap from the review page, the door they had just used.
   */
  describe('the review page’s Start lap door', () => {
    it('opens the chat on a lap-2 briefing with its agenda, empty-handed', async () => {
      const { featureId } = await seedResumable('start-lap-empty', { phase: 'review', lap: 1 })
      const { command, prompt } = await launchAndRead(featureId, {
        kind: 'chat',
        purpose: 'start-lap',
      })

      // the injected prompt plans the same lap, never the fix-ticket interview
      expect(prompt).toContain('## This is lap 2')
      expect(prompt).toMatch(/Do NOT call `complete_phase`/)
      expect(prompt).not.toContain('## Review iteration')

      expect(command).toContain('--resume cc-prior')
      expect(command).toContain('PLAN LAP 2 FROM REVIEW')
      expect(command).toContain('This conversation plans lap 2')
      expect(command).toContain('"## Carried, still open"')
      expect(command).toContain('openDefects')
      expect(command).toContain('"## Later laps"')
      expect(command).toContain('"## Lap 2"')
      expect(command).toContain('Do NOT call complete_phase')
      expect(command).toContain('review the cards and click Burn')
      // the fresh state header still follows the briefing (decision 13)
      expect(command).toContain('Feature state: review; lap 1')
    })

    it('names what the triage carried when the carry road opens the lap', async () => {
      const { featureId } = await seedResumable('start-lap-carry', { phase: 'review', lap: 3 })
      const note = addNote(ctx, featureId, 'the empty state is confusing')
      carryNotes(ctx, featureId, [note.id], 4)

      const { command } = await launchAndRead(featureId, { kind: 'chat', purpose: 'start-lap' })

      expect(command).toContain('PLAN LAP 4 FROM REVIEW')
      expect(command).toContain('1 note carried from earlier laps — address them.')
    })

    it('leaves the plain Chat toggle on a review feature without lap framing', async () => {
      const { featureId } = await seedResumable('start-lap-plain', { phase: 'review', lap: 1 })
      const { command } = await launchAndRead(featureId, { kind: 'chat' })

      expect(command).toContain('Feature state: review; lap 1')
      expect(command).not.toContain('FROM REVIEW')
    })
  })

  it('delivers a chat kickoff override into the resumed conversation', async () => {
    const { featureId } = await seedResumable('with-briefing', { phase: 'review', lap: 1 })
    const { command } = await launchAndRead(featureId, {
      kind: 'chat',
      kickoffLine: lapKickoff(2),
    })

    expect(command).toContain('--resume cc-prior')
    expect(command).toContain(lapKickoff(2))
    expect(command).toContain('Feature state:')
    const events = listAfter(ctx, featureId, 0)
    expect(events.map((e) => e.type)).toContain('session.resumed')
    expect(events.map((e) => e.type)).not.toContain('session.resume_skipped')
  })

  it('still resumes the last conversation for a launch with no briefing (unchanged)', async () => {
    const { featureId } = await seedResumable('no-briefing', { phase: 'building' })
    const { command } = await launchAndRead(featureId, { kind: 'chat' })

    expect(command).toContain('--resume cc-prior')
    // it carries the fresh state header (decision 13) and no lap briefing
    expect(command).toContain('Feature state: building')
    expect(command).not.toContain('FROM REVIEW')
    const events = listAfter(ctx, featureId, 0)
    expect(events.map((e) => e.type)).toContain('session.resumed')
  })

  it('a chat with no briefing keeps its own opening line', () => {
    expect(planKickoff({ kind: 'chat' }).line).toBeUndefined()
    // no lap briefing, so the table's state-unknown default stands: the chat's
    // own opening skill, not a lap framing
    expect(KICKOFF_LINES.chat).toContain('/runcastle:revisit')
    expect(KICKOFF_LINES.chat).not.toContain('FROM REVIEW')
  })
})
