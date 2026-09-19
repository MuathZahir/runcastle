import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { launchSession } from '../src/launcher/launcher'
import { KICKOFF_LINES } from '../src/launcher/runtimes/claude'
import {
  createSessionRow,
  lapInFlight,
  lapKickoff,
  markSessionEnded,
  markSessionLive,
  planKickoff,
} from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
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
    const plan = planKickoff({ kind: 'chat', lap: 1, kickoffLine: 'Resolve the merge conflict.' })
    expect(plan).toEqual({ line: 'Resolve the merge conflict.', explicit: true })
  })

  it('reports which lap it is running from feature state, not the briefing string', () => {
    const plan = planKickoff({
      kind: 'chat',
      lap: 4,
      kickoffLine: lapKickoff(4),
      lapInFlight: true,
    })
    expect(plan.explicit).toBe(true)
    expect(plan.lap).toBe(4)
  })

  it('gives a lap-N grill the lap briefing instead of the generic ideate line', () => {
    const plan = planKickoff({ kind: 'chat', lap: 2, lapInFlight: true })
    expect(plan.line).toBe(lapKickoff(2))
    expect(plan.lap).toBe(2)
    expect(plan.explicit).toBe(true)
  })

  /**
   * THE STRANDING BUG. `lap` used to be derived by `line === lapKickoff(lap)` —
   * JS string equality, three call frames from the renderer that depends on it.
   * That works exactly once, on the launch that passes the line. A terminal
   * that died mid-lap left the feature at `planning`/lap N with no lap tickets
   * and no way back to the door that had briefed it, and Revisit — the only
   * door left — passes no `kickoffLine`, so the comparison failed and `lap`
   * came back undefined. Deriving it from state makes the SAME re-entry produce
   * the lap plan.
   */
  it('recovers a lap that died mid-flight, with no kickoffLine to compare against', () => {
    const plan = planKickoff({ kind: 'chat', lap: 4, lapInFlight: true })
    expect(plan.lap).toBe(4)
    expect(plan.line).toBe(lapKickoff(4))
    // and it launches FRESH — the dead lap's transcript argues with the briefing
    expect(plan.explicit).toBe(true)
  })

  it('leaves an ordinary launch alone — no line, no lap, resume as before', () => {
    expect(planKickoff({ kind: 'chat', lap: 1 })).toEqual({ explicit: false })
    // an ordinary revisit on a lap-3 feature is NOT running a lap
    expect(planKickoff({ kind: 'chat', lap: 3, lapInFlight: false })).toEqual({
      explicit: false,
    })
  })
})

/**
 * The state predicate itself. A lap is in flight when the feature is parked at
 * `ideation` on a lap past the first with no tickets emitted for that lap — the
 * exact shape Rethink creates and a lap session is the only thing that clears.
 */
describe('lapInFlight', () => {
  it('is true at planning on lap N with no lap-N tickets', () => {
    expect(lapInFlight({ lap: 2, phase: 'planning', ticketLaps: [1, 1] })).toBe(true)
  })

  it('is false once the lap has emitted its tickets', () => {
    expect(lapInFlight({ lap: 2, phase: 'planning', ticketLaps: [1, 2] })).toBe(false)
  })

  it('is false on lap 1 — there is no lap to be running', () => {
    expect(lapInFlight({ lap: 1, phase: 'planning', ticketLaps: [] })).toBe(false)
  })

  it('is false anywhere but planning — a lap-3 feature at review is not mid-lap', () => {
    for (const phase of ['building', 'review', 'shipped']) {
      expect(lapInFlight({ lap: 3, phase, ticketLaps: [1, 2] })).toBe(false)
    }
  })
})

describe('launchSession — an explicit briefing launches fresh', () => {
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
    input: { kind: 'chat' | 'ideation'; kickoffLine?: string },
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

  it('delivers a chat kickoff override into the resumed conversation', async () => {
    const { featureId } = await seedResumable('with-briefing', { phase: 'planning', lap: 2 })
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
    expect(command).not.toContain(KICKOFF_LINES.revisit)
    const events = listAfter(ctx, featureId, 0)
    expect(events.map((e) => e.type)).toContain('session.resumed')
  })

  it('renders the lap framing into the prompt of a lap launch, not the revisit ban', async () => {
    const { featureId } = await seedResumable('lap-prompt', { phase: 'planning', lap: 3 })
    const { prompt } = await launchAndRead(featureId, {
      kind: 'chat',
      kickoffLine: lapKickoff(3),
    })

    expect(prompt).toContain('This is lap 3')
    expect(prompt).toContain('ideation → spec → tickets')
    expect(prompt).toContain('test-notes.md')
    expect(prompt).not.toMatch(/Do NOT call `complete_phase`/i)
  })

  it('a lap-N grill opens on the lap briefing, not the generic ideate line', async () => {
    const { featureId } = await seedResumable('lap-grill', { phase: 'planning', lap: 2 })
    const { sessionId, command } = await launchAndRead(featureId, { kind: 'chat' })

    expect(command).toContain('--resume cc-prior')
    expect(command).toContain('Feature state:')
    expect(command).toContain('LAP 2 REVIEW ITERATION')
  })

  it('a lap-1 grill keeps the generic ideate line', () => {
    expect(planKickoff({ kind: 'chat', lap: 1 }).line).toBeUndefined()
    expect(KICKOFF_LINES.ideation).toContain('/runcastle:ideate')
  })

  /**
   * End-to-end re-entry: a feature parked mid-lap by a dead terminal, reopened
   * through Revisit with NO kickoffLine — the only door the UI leaves once
   * Rethink has refused. It used to resume the dead lap conversation and render
   * "Do NOT call `complete_phase` — a revisit never moves the pipeline" into a
   * transcript whose own earlier turn said to complete_phase through to tickets.
   */
  it('re-enters a stranded lap through plain Revisit and rebuilds the lap briefing', async () => {
    const { featureId } = await seedResumable('stranded-lap', { phase: 'planning', lap: 2 })
    const { sessionId, command, prompt } = await launchAndRead(featureId, { kind: 'chat' })

    expect(prompt).toContain('This is lap 2')
    expect(prompt).toMatch(/DO call `complete_phase`/)
    expect(prompt).not.toMatch(/Do NOT call `complete_phase`/i)
    expect(command).toContain('--resume cc-prior')
    expect(command).toContain('Feature state:')
    expect(command).toContain('LAP 2 REVIEW ITERATION')
  })
})
