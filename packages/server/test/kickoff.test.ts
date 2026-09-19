import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Feature, SessionKind, Ticket, TicketStatus } from '@runcastle/core'
import { reviewDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import { features } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { renderSystemPrompt } from '../src/launcher/artifacts'
import { carriedWork } from '../src/services/carried-work'
import { storeTickets, updateTicket } from '../src/services/tickets'
import { CONVERGE_KICKOFF_LINE, KICKOFF_LINES } from '../src/launcher/runtimes/claude'
import { KICKOFF_LINES as CODEX_KICKOFF_LINES } from '../src/launcher/runtimes/codex'
import { kickoffLineFor, lapKickoff } from '../src/launcher/sessions'
import { resolvePluginDir } from '../src/launcher/skills-root'
import { promptMatchesKickoff } from '../src/services/conversations'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

describe('kickoff registry + override', () => {
  const KINDS: SessionKind[] = ['chat', 'waypoint', 'converge', 'prepare', 'project', 'drive-fix']

  it('maps every session kind to a non-empty kickoff line naming its opening skill', () => {
    const skillByKind: Record<SessionKind, string> = {
      chat: '/runcastle:revisit',
      waypoint: '/runcastle:waypoint',
      converge: '/runcastle:converge',
      prepare: '/runcastle:prepare',
      project: '/runcastle:project',
      'drive-fix': 'retry_drive',
    }
    for (const kind of KINDS) {
      expect(KICKOFF_LINES[kind]).toContain(skillByKind[kind])
      // A pasted-as-text regression guard: the line must carry no CR/LF of its own.
      expect(KICKOFF_LINES[kind]).not.toMatch(/[\r\n]/)
    }
  })

  it('keeps the converge line byte-for-byte (regression: converge behaves as before)', () => {
    expect(KICKOFF_LINES.converge).toBe(CONVERGE_KICKOFF_LINE)
  })

  it('kickoffLineFor returns the per-kind default when no override is given', () => {
    for (const kind of KINDS) {
      expect(kickoffLineFor(kind)).toBe(KICKOFF_LINES[kind])
    }
  })

  /**
   * The kickoff a session opens with depends on the runtime its row records, not
   * on a table the launcher holds: the argv builder passes `session.runtime`
   * through. A Codex session launched with `/runcastle:ideate` would sit there
   * doing nothing.
   */
  it('kickoffLineFor spells the line for the runtime the session runs on', () => {
    for (const kind of KINDS) {
      expect(kickoffLineFor(kind, undefined, 'codex')).toBe(CODEX_KICKOFF_LINES[kind])
      expect(kickoffLineFor(kind, undefined, 'claude-code')).toBe(KICKOFF_LINES[kind])
    }
    expect(kickoffLineFor('chat', undefined, 'codex')).toContain('$revisit')
  })

  it('kickoffLineFor lets an explicit override replace the default', () => {
    const override = 'Proceed with your task: resolve the merge conflict, then hand back.'
    expect(kickoffLineFor('chat', override)).toBe(override)
    // an empty override is not a real override — the default still wins
    expect(kickoffLineFor('chat', undefined)).toBe(KICKOFF_LINES.chat)
  })
})

/**
 * What a lap ≥ 2 is told to READ before it plans.
 *
 * The postmortem this pins: a lap session asked "what are these tickets based
 * on? did you test the app?" answered "No, I moved too quickly to Burn" — and it
 * was right to, because nothing it was handed named the previous lap's review.
 * The evidence lives in host scratch space outside the repo
 * (`~/.runcastle/reviews/<reviewTicketId>/`) and every ticket's `digest` is
 * stripped out of `get_feature_context`, so both renders — the kickoff line typed
 * into the PTY and the injected system prompt — must name the paths themselves.
 */
describe('the lap briefing names the previous lap’s review evidence', () => {
  /** A feature on lap 2 whose lap-1 review pass burned, and its review ticket. */
  async function seedLapTwo(
    reviewStatus: TicketStatus = 'done',
  ): Promise<{ ctx: AppCtx; feature: Feature; review: Ticket }> {
    const ctx = await makeTestCtx()
    const feature = seedFeature(ctx, seedProject(ctx).id, { phase: 'planning' })
    // Stored at the feature's CURRENT lap (1), then the feature moves to lap 2 —
    // the shape a Rethink leaves behind.
    const [review] = storeTickets(ctx, feature.id, [
      {
        title: 'Review the burn',
        goal: 'Exercise the integrated feature',
        context: '',
        acceptanceCriteria: [],
        seams: [],
        blockedBy: [],
        kind: 'review',
      },
    ])
    updateTicket(ctx, review.id, { status: reviewStatus })
    ctx.db.update(features).set({ lap: 2 }).where(eq(features.id, feature.id)).run()
    return { ctx, feature: { ...feature, lap: 2 }, review }
  }

  it('states the DIGEST.md, the screenshots directory and the pass outcome in the kickoff line', async () => {
    const { ctx, feature, review } = await seedLapTwo()

    const line = lapKickoff(2, carriedWork(ctx, feature.id))

    expect(line).toContain(join(reviewDir(review.id), 'DIGEST.md'))
    expect(line).toContain(reviewDir(review.id))
    expect(line).toContain('walkthrough.webm')
    expect(line).toContain('pass done')
    // Still one PTY-safe line: a CR/LF here sits half-submitted in the input box.
    expect(line).not.toMatch(/[\r\n]/)
  })

  it('states the same paths in the injected prompt, with the two rules a lap kept skipping', async () => {
    const { ctx, feature, review } = await seedLapTwo()

    const prompt = renderSystemPrompt(
      feature,
      'chat',
      undefined,
      2,
      undefined,
      undefined,
      carriedWork(ctx, feature.id),
    )

    expect(prompt).toContain(join(reviewDir(review.id), 'DIGEST.md'))
    expect(prompt).toContain(reviewDir(review.id))
    expect(prompt).toContain('walkthrough.webm')
    expect(prompt).toContain("Ticket 1's review pass ended `done`")
    // …and the two rules the same postmortem asked for, beside the paths.
    expect(prompt).toContain('not demonstrable')
    expect(prompt).toContain('do not demo')
    expect(prompt).toContain('Stand on the failure')
    expect(prompt).toContain('FIRST acceptance criterion')
  })

  it('names no evidence for a review pass that never burned, and says so', async () => {
    const { ctx, feature } = await seedLapTwo('pending')

    const line = lapKickoff(2, carriedWork(ctx, feature.id))
    const prompt = renderSystemPrompt(
      feature,
      'chat',
      undefined,
      2,
      undefined,
      undefined,
      carriedWork(ctx, feature.id),
    )

    // A pending pass wrote no digest: promising one would send the session to a
    // path that is not there and read as a broken environment.
    expect(line).not.toContain('DIGEST.md')
    expect(prompt).not.toContain('DIGEST.md')
    expect(prompt).toContain('left NO review evidence on disk')
    // The rules do not depend on the evidence existing.
    expect(prompt).toContain('Stand on the failure')
  })

  it('offers a lap-1 feature no previous lap to read', async () => {
    const ctx = await makeTestCtx()
    const feature = seedFeature(ctx, seedProject(ctx).id, { phase: 'planning' })

    expect(carriedWork(ctx, feature.id).reviewEvidence).toEqual([])
  })

  /**
   * The briefing states the per-lap facts; the skill the briefing names carries
   * the procedure for them. Pinned together because a briefing that points at a
   * rule the skill dropped is a session told to do something with no method.
   */
  it('the revisit skill carries the procedure for both rules', () => {
    const skill = readFileSync(
      join(resolvePluginDir(), 'skills', 'revisit', 'SKILL.md'),
      'utf8',
    )

    expect(skill).toContain('reviewEvidence')
    expect(skill).toContain('walkthrough.webm')
    expect(skill).toContain('not demonstrable')
    expect(skill).toContain('do not demo')
    expect(skill).toContain('### Stand on the failure')
    expect(skill).toMatch(/Unreproduced/)
  })
})

/**
 * Kickoff recognition in a transcript (`services/conversations`): the line the
 * session was launched with is recorded as a `user` turn nobody typed, so it is
 * stripped from what the UI renders and from what a conversation is named after.
 * It must tolerate the runtime re-flowing what it writes down, and must NOT
 * claim a human's own prompt as our briefing.
 */
describe('promptMatchesKickoff', () => {
  const line = KICKOFF_LINES.converge

  it('matches the line verbatim', () => {
    expect(promptMatchesKickoff(line, line)).toBe(true)
  })

  it('matches through whitespace re-flow and case', () => {
    expect(promptMatchesKickoff(line, `  ${line.replace(/ /g, '\n  ').toUpperCase()}  `)).toBe(true)
  })

  it('matches a prompt the TUI prefixed or suffixed', () => {
    expect(promptMatchesKickoff(line, `> ${line}`)).toBe(true)
  })

  it('rejects a human prompt, an empty prompt, and a missing one', () => {
    expect(promptMatchesKickoff(line, 'what are you working on?')).toBe(false)
    expect(promptMatchesKickoff(line, '')).toBe(false)
    expect(promptMatchesKickoff(line, undefined)).toBe(false)
  })

  it('does not confuse two different briefings that share an opening clause', () => {
    const a = 'Proceed with your task: RESOLVE A MERGE CONFLICT. Merging main into feature/a.'
    const b = 'Proceed with your task: REVIEW ITERATION. Read the run outcome and interview me.'
    expect(promptMatchesKickoff(a, b)).toBe(false)
  })
})
