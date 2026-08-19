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
  kickoffDeliveryFor,
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
    const plan = planKickoff({ kind: 'revisit', lap: 1, kickoffLine: 'Resolve the merge conflict.' })
    expect(plan).toEqual({ line: 'Resolve the merge conflict.', explicit: true })
  })

  it('recognises the lap briefing and reports which lap it is running', () => {
    const plan = planKickoff({ kind: 'revisit', lap: 4, kickoffLine: lapKickoff(4) })
    expect(plan.explicit).toBe(true)
    expect(plan.lap).toBe(4)
  })

  it('gives a lap-N grill the lap briefing instead of the generic ideate line', () => {
    const plan = planKickoff({ kind: 'ideation', lap: 2 })
    expect(plan.line).toBe(lapKickoff(2))
    expect(plan.lap).toBe(2)
    expect(plan.explicit).toBe(true)
  })

  it('leaves an ordinary launch alone — no line, no lap, resume as before', () => {
    expect(planKickoff({ kind: 'ideation', lap: 1 })).toEqual({ explicit: false })
    expect(planKickoff({ kind: 'revisit', lap: 3 })).toEqual({ explicit: false })
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
    await createFeatureBranch(project, slug)
    cleanup.push(worktreeDir(project.id, slug))
    const prior = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'revisit',
      worktreePath: 'w',
    })
    markSessionLive(ctx, prior.id, { ccSessionId: 'cc-prior' })
    markSessionEnded(ctx, prior.id)
    return { featureId: feature.id }
  }

  /** The `claude` argv a `spawn:false` launch rendered, and its prompt artifact. */
  async function launchAndRead(
    featureId: string,
    input: { kind: 'revisit' | 'ideation'; kickoffLine?: string },
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

  it('omits --resume when the launch carries a kickoff override', async () => {
    const { featureId } = await seedResumable('with-briefing', { phase: 'ideation', lap: 2 })
    const { command } = await launchAndRead(featureId, {
      kind: 'revisit',
      kickoffLine: lapKickoff(2),
    })

    expect(command).not.toContain('--resume')
    expect(command).not.toContain('cc-prior')
    // and nothing claims a conversation was picked up
    expect(listAfter(ctx, featureId, 0).map((e) => e.type)).not.toContain('session.resumed')
  })

  it('still resumes the last conversation for a launch with no briefing (unchanged)', async () => {
    const { featureId } = await seedResumable('no-briefing', { phase: 'implementation' })
    const { command } = await launchAndRead(featureId, { kind: 'revisit' })

    expect(command).toContain('--resume cc-prior')
    expect(listAfter(ctx, featureId, 0).map((e) => e.type)).toContain('session.resumed')
  })

  it('renders the lap framing into the prompt of a lap launch, not the revisit ban', async () => {
    const { featureId } = await seedResumable('lap-prompt', { phase: 'ideation', lap: 3 })
    const { prompt } = await launchAndRead(featureId, {
      kind: 'revisit',
      kickoffLine: lapKickoff(3),
    })

    expect(prompt).toContain('This is lap 3')
    expect(prompt).toContain('ideation → spec → tickets')
    expect(prompt).toContain('test-notes.md')
    expect(prompt).not.toMatch(/Do NOT call `complete_phase`/i)
  })

  it('a lap-N grill opens on the lap briefing, not the generic ideate line', async () => {
    const { featureId } = await seedResumable('lap-grill', { phase: 'ideation', lap: 2 })
    const { sessionId, command } = await launchAndRead(featureId, { kind: 'ideation' })

    expect(command).not.toContain('--resume')
    // going live is what types the briefing; the delivery record is what it will type
    markSessionLive(ctx, sessionId, { ccSessionId: 'cc-grill' })
    expect(kickoffDeliveryFor(sessionId)?.line).toBe(lapKickoff(2))
  })

  it('a lap-1 grill keeps the generic ideate line', () => {
    expect(planKickoff({ kind: 'ideation', lap: 1 }).line).toBeUndefined()
    expect(KICKOFF_LINES.ideation).toContain('/runcastle:ideate')
  })
})
