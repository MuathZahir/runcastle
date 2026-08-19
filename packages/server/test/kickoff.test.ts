import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionKind } from '@runcastle/core'
import type { PtyEntry } from '../src/pty/registry'
import { ptyRegistry } from '../src/pty/registry'
import { CONVERGE_KICKOFF_LINE, KICKOFF_LINES } from '../src/launcher/runtimes/claude'
import {
  CLEAR_INPUT,
  KICKOFF_CONFIRM_MS,
  KICKOFF_DELAY_MS,
  KICKOFF_MAX_ATTEMPTS,
  KICKOFF_SUBMIT_DELAY_MS,
  createSessionRow,
  kickoffDeliveryFor,
  kickoffLineFor,
  lapKickoff,
  markSessionEnded,
  markSessionLive,
  noteKickoffPrompt,
  promptMatchesKickoff,
  resendKickoff,
  setKickoffOverride,
  writeKickoffSequence,
} from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Kickoff-injection regression (E2E finding): the kickoff used to write
 * `text + "\r"` in ONE chunk — claude's TUI treated the trailing carriage
 * return as pasted text, so the line sat unsubmitted in the input box until a
 * human pressed Enter. The fix is a two-write sequence: the text alone, then
 * `\r` as its OWN keystroke after a short settle delay.
 */

describe('writeKickoffSequence — two-write submit', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('writes the text first WITHOUT a carriage return, then \\r as a separate delayed write', () => {
    const writes: string[] = []
    const submitted = vi.fn()
    writeKickoffSequence(CONVERGE_KICKOFF_LINE, {
      write: (d) => writes.push(d),
      alive: () => true,
      onSubmitted: submitted,
    })

    // immediately: exactly one write — the bare text, no \r or \n anywhere
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE])
    expect(writes[0]).not.toMatch(/[\r\n]/)
    expect(submitted).not.toHaveBeenCalled()

    // just before the submit delay: still nothing
    vi.advanceTimersByTime(KICKOFF_SUBMIT_DELAY_MS - 1)
    expect(writes).toHaveLength(1)

    // at the delay: the second write is EXACTLY the carriage return, alone
    vi.advanceTimersByTime(1)
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE, '\r'])
    expect(submitted).toHaveBeenCalledTimes(1)
  })

  it('fires once — no further writes after the submit keystroke', () => {
    const writes: string[] = []
    writeKickoffSequence(CONVERGE_KICKOFF_LINE, { write: (d) => writes.push(d), alive: () => true })
    vi.advanceTimersByTime(KICKOFF_SUBMIT_DELAY_MS * 10)
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE, '\r'])
  })

  it('skips entirely when the PTY is already gone', () => {
    const writes: string[] = []
    const submitted = vi.fn()
    writeKickoffSequence(CONVERGE_KICKOFF_LINE, {
      write: (d) => writes.push(d),
      alive: () => false,
      onSubmitted: submitted,
    })
    vi.advanceTimersByTime(KICKOFF_SUBMIT_DELAY_MS + 100)
    expect(writes).toEqual([])
    expect(submitted).not.toHaveBeenCalled()
  })

  it('withholds the \\r (and the kickoff event) when the PTY dies between the two writes', () => {
    const writes: string[] = []
    const submitted = vi.fn()
    let up = true
    writeKickoffSequence(CONVERGE_KICKOFF_LINE, {
      write: (d) => writes.push(d),
      alive: () => up,
      onSubmitted: submitted,
    })
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE])

    up = false // PTY exits during the settle window
    vi.advanceTimersByTime(KICKOFF_SUBMIT_DELAY_MS + 100)
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE]) // no stray \r
    expect(submitted).not.toHaveBeenCalled() // session.kickoff means SUBMITTED
  })

  it('honours a custom submit delay', () => {
    const writes: string[] = []
    writeKickoffSequence(CONVERGE_KICKOFF_LINE, { write: (d) => writes.push(d), alive: () => true }, 50)
    vi.advanceTimersByTime(49)
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE])
    vi.advanceTimersByTime(1)
    expect(writes).toEqual([CONVERGE_KICKOFF_LINE, '\r'])
  })

  it('injects whatever line it is given (not a hardcoded converge line)', () => {
    const writes: string[] = []
    writeKickoffSequence(KICKOFF_LINES.ideation, { write: (d) => writes.push(d), alive: () => true })
    expect(writes).toEqual([KICKOFF_LINES.ideation])
    vi.advanceTimersByTime(KICKOFF_SUBMIT_DELAY_MS)
    expect(writes).toEqual([KICKOFF_LINES.ideation, '\r'])
  })
})

describe('kickoff registry + override', () => {
  const KINDS: SessionKind[] = ['ideation', 'qa', 'waypoint', 'converge', 'revisit']

  it('maps every session kind to a non-empty kickoff line naming its opening skill', () => {
    const skillByKind: Record<SessionKind, string> = {
      ideation: '/runcastle:ideate',
      qa: '/runcastle:qa',
      waypoint: '/runcastle:waypoint',
      converge: '/runcastle:converge',
      revisit: '/runcastle:revisit',
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

  it('kickoffLineFor lets an explicit override replace the default', () => {
    const override = 'Proceed with your task: resolve the merge conflict, then hand back.'
    expect(kickoffLineFor('revisit', override)).toBe(override)
    // an empty override is not a real override — the default still wins
    expect(kickoffLineFor('revisit', undefined)).toBe(KICKOFF_LINES.revisit)
  })
})

/**
 * Delivery confirmation matching: the `UserPromptSubmit` hook is the only proof
 * a kickoff reached Claude Code, so this decides retry-vs-stop. It must tolerate
 * the TUI re-flowing what it echoes, and must NOT claim a human's own prompt as
 * our briefing.
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

/**
 * The kickoff wiring end-to-end at the `markSessionLive` seam: going live
 * schedules the two-write injection into the session's PTY and emits
 * `session.kickoff` (carrying the kind) once the `\r` lands. A fake PTY entry
 * stands in for the terminal so no real process is spawned — the events feed is
 * the observation point, exactly as the seam intends.
 */
describe('markSessionLive — schedules a kickoff for every kind', () => {
  const KINDS: SessionKind[] = ['ideation', 'qa', 'waypoint', 'converge', 'revisit']

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  /** Point the registry at a fake live PTY that just records what is written. */
  function fakePty(): string[] {
    const written: string[] = []
    const entry = { exited: false, pty: { write: (d: string) => written.push(d) } } as unknown as PtyEntry
    vi.spyOn(ptyRegistry(), 'get').mockReturnValue(entry)
    return written
  }

  it.each(KINDS)('types the %s kickoff line and submits it via the two-write pattern', async (kind) => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind, worktreePath: 'w' })
    const written = fakePty()

    markSessionLive(ctx, session.id, { ccSessionId: 'cc' })

    // nothing typed until the post-live settle delay elapses
    vi.advanceTimersByTime(KICKOFF_DELAY_MS - 1)
    expect(written).toEqual([])
    // at the delay: the bare line, no carriage return yet
    vi.advanceTimersByTime(1)
    expect(written).toEqual([KICKOFF_LINES[kind]])
    // the \r submits as its own keystroke a beat later
    vi.advanceTimersByTime(KICKOFF_SUBMIT_DELAY_MS)
    expect(written).toEqual([KICKOFF_LINES[kind], '\r'])

    // and the submit fires exactly one session.kickoff carrying the kind
    const kickoffs = listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.kickoff')
    expect(kickoffs).toHaveLength(1)
    expect((kickoffs[0].data as { kind?: string; sessionId?: string }).kind).toBe(kind)
    expect((kickoffs[0].data as { sessionId?: string }).sessionId).toBe(session.id)
  })

  it('injects a registered override line instead of the per-kind default', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind: 'revisit', worktreePath: 'w' })
    const written = fakePty()

    const override = 'Proceed with your task: merge the base branch and resolve the conflicts.'
    setKickoffOverride(session.id, override)
    markSessionLive(ctx, session.id, { ccSessionId: 'cc' })
    vi.advanceTimersByTime(KICKOFF_DELAY_MS + KICKOFF_SUBMIT_DELAY_MS)

    expect(written).toEqual([override, '\r'])
  })

  it('only schedules once — a duplicate SessionStart does not re-inject', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: 'w' })
    const written = fakePty()

    markSessionLive(ctx, session.id, { ccSessionId: 'cc' })
    markSessionLive(ctx, session.id, { ccSessionId: 'cc' }) // already live — no second schedule
    vi.advanceTimersByTime(KICKOFF_DELAY_MS + KICKOFF_SUBMIT_DELAY_MS)

    expect(written).toEqual([KICKOFF_LINES.ideation, '\r'])
    expect(listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.kickoff')).toHaveLength(1)
  })

  it('re-types the line when Claude Code never acknowledges it, then gives up loudly', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind: 'revisit', worktreePath: 'w' })
    const written = fakePty()

    markSessionLive(ctx, session.id, { ccSessionId: 'cc' })
    vi.advanceTimersByTime(KICKOFF_DELAY_MS + KICKOFF_SUBMIT_DELAY_MS)
    expect(written).toEqual([KICKOFF_LINES.revisit, '\r'])

    // No UserPromptSubmit came back → the keystrokes went somewhere else (a
    // startup dialog). Retry clears the input line first so a half-typed first
    // attempt cannot become one doubled prompt.
    vi.advanceTimersByTime(KICKOFF_CONFIRM_MS + KICKOFF_SUBMIT_DELAY_MS)
    expect(written).toEqual([
      KICKOFF_LINES.revisit,
      '\r',
      CLEAR_INPUT,
      KICKOFF_LINES.revisit,
      '\r',
    ])

    // Third and final attempt, then the failure is announced rather than swallowed.
    vi.advanceTimersByTime(KICKOFF_CONFIRM_MS + KICKOFF_SUBMIT_DELAY_MS)
    expect(written.filter((w) => w === KICKOFF_LINES.revisit)).toHaveLength(KICKOFF_MAX_ATTEMPTS)
    expect(kickoffDeliveryFor(session.id)?.settled).toBe(false)

    vi.advanceTimersByTime(KICKOFF_CONFIRM_MS)
    const undelivered = listAfter(ctx, featureId, 0).filter(
      (e) => e.type === 'session.kickoff_undelivered',
    )
    expect(undelivered).toHaveLength(1)
    expect((undelivered[0].data as { reason?: string }).reason).toBe('unacknowledged')
    expect((undelivered[0].data as { line?: string }).line).toBe(KICKOFF_LINES.revisit)
    expect(kickoffDeliveryFor(session.id)?.settled).toBe(true)

    // and it stops there — no fourth attempt after the announcement
    const attempts = written.filter((w) => w === KICKOFF_LINES.revisit).length
    vi.advanceTimersByTime(KICKOFF_CONFIRM_MS * 3)
    expect(written.filter((w) => w === KICKOFF_LINES.revisit)).toHaveLength(attempts)
  })

  it('stops retrying once the submitted prompt comes back through the hook', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: 'w' })
    const written = fakePty()

    markSessionLive(ctx, session.id, { ccSessionId: 'cc' })
    vi.advanceTimersByTime(KICKOFF_DELAY_MS + KICKOFF_SUBMIT_DELAY_MS)

    noteKickoffPrompt(ctx, session.id, KICKOFF_LINES.ideation)
    vi.advanceTimersByTime(KICKOFF_CONFIRM_MS * 4)

    expect(written).toEqual([KICKOFF_LINES.ideation, '\r']) // typed exactly once
    expect(kickoffDeliveryFor(session.id)?.confirmed).toBe(true)
    expect(
      listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.kickoff_undelivered'),
    ).toHaveLength(0)
  })

  it('never injects over a human who typed first — it reports the briefing undelivered', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind: 'revisit', worktreePath: 'w' })
    const written = fakePty()

    setKickoffOverride(session.id, 'Proceed with your task: RESOLVE A MERGE CONFLICT. Merging main…')
    markSessionLive(ctx, session.id, { ccSessionId: 'cc' })
    vi.advanceTimersByTime(KICKOFF_DELAY_MS + KICKOFF_SUBMIT_DELAY_MS)
    const typed = written.length

    noteKickoffPrompt(ctx, session.id, 'wait, what are you doing?')
    vi.advanceTimersByTime(KICKOFF_CONFIRM_MS * 4)

    expect(written).toHaveLength(typed) // no re-injection mid-conversation
    const undelivered = listAfter(ctx, featureId, 0).filter(
      (e) => e.type === 'session.kickoff_undelivered',
    )
    expect(undelivered).toHaveLength(1)
    expect((undelivered[0].data as { reason?: string }).reason).toBe('superseded')
  })

  it('resendKickoff re-types the SAME line on demand and restarts the retry budget', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind: 'revisit', worktreePath: 'w' })
    const written = fakePty()

    const briefing = 'Proceed with your task: RESOLVE A MERGE CONFLICT. Merging main into feature/x.'
    setKickoffOverride(session.id, briefing)
    markSessionLive(ctx, session.id, { ccSessionId: 'cc' })
    vi.advanceTimersByTime(KICKOFF_DELAY_MS + KICKOFF_SUBMIT_DELAY_MS)
    noteKickoffPrompt(ctx, session.id, 'never mind, I will drive') // settles it undelivered

    const before = written.length
    expect(resendKickoff(ctx, session.id).line).toBe(briefing)
    vi.advanceTimersByTime(KICKOFF_SUBMIT_DELAY_MS)
    expect(written.slice(before)).toEqual([CLEAR_INPUT, briefing, '\r'])

    // and the resend is itself confirm-and-retry, not another blind write
    vi.advanceTimersByTime(KICKOFF_CONFIRM_MS + KICKOFF_SUBMIT_DELAY_MS)
    expect(written.slice(before)).toEqual([CLEAR_INPUT, briefing, '\r', CLEAR_INPUT, briefing, '\r'])
  })

  /**
   * A prompt that arrives BEFORE we have typed anything cannot be a human
   * reacting to the briefing — it is the session's own opening traffic. Settling
   * on it destroyed the retry budget at the exact moment the briefing needed it:
   * the keystrokes had gone into a startup dialog, and attempts 2 and 3 were
   * cancelled before the first one ever landed (F2).
   */
  it('ignores a prompt that arrives before the briefing was ever typed, and still retries', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind: 'revisit', worktreePath: 'w' })
    const written = fakePty()

    const briefing = 'Proceed with your task: invoke /runcastle:revisit for LAP 2 REVIEW ITERATION.'
    setKickoffOverride(session.id, briefing)
    markSessionLive(ctx, session.id, { ccSessionId: 'cc' })

    // ...before our first write lands, the session submits a prompt of its own
    vi.advanceTimersByTime(KICKOFF_DELAY_MS - 1)
    expect(written).toEqual([])
    noteKickoffPrompt(ctx, session.id, 'Please continue with the summary of the conversation.')

    expect(kickoffDeliveryFor(session.id)?.settled).toBe(false)
    expect(
      listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.kickoff_undelivered'),
    ).toHaveLength(0)

    // the full retry budget survives it
    vi.advanceTimersByTime(1 + KICKOFF_SUBMIT_DELAY_MS)
    expect(written).toEqual([briefing, '\r'])
    vi.advanceTimersByTime(KICKOFF_CONFIRM_MS + KICKOFF_SUBMIT_DELAY_MS)
    vi.advanceTimersByTime(KICKOFF_CONFIRM_MS + KICKOFF_SUBMIT_DELAY_MS)
    expect(written.filter((w) => w === briefing)).toHaveLength(KICKOFF_MAX_ATTEMPTS)
  })

  it('still stops for a human who types AFTER the briefing went out', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: 'w' })
    const written = fakePty()

    markSessionLive(ctx, session.id, { ccSessionId: 'cc' })
    vi.advanceTimersByTime(KICKOFF_DELAY_MS + KICKOFF_SUBMIT_DELAY_MS)
    noteKickoffPrompt(ctx, session.id, 'actually, hold on')

    expect(kickoffDeliveryFor(session.id)?.settled).toBe(true)
    vi.advanceTimersByTime(KICKOFF_CONFIRM_MS * 4)
    expect(written).toEqual([KICKOFF_LINES.ideation, '\r'])
  })

  /**
   * "Send briefing" must send the BRIEFING. The override is what a lap terminal
   * was opened to say, so it outlives its consumption at go-live and is dropped
   * only when the session ends — at no point while the terminal is alive may the
   * recovery button degrade to the generic per-kind line (F6).
   */
  it('resends the real lap briefing — before the session goes live, and after', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id, { lap: 2 }).id
    const session = createSessionRow(ctx, { featureId, kind: 'revisit', worktreePath: 'w' })
    fakePty()

    const briefing = lapKickoff(2)
    setKickoffOverride(session.id, briefing)

    // the watchdog case: SessionStart never fired, the human sends it by hand
    expect(resendKickoff(ctx, session.id).line).toBe(briefing)
    expect(resendKickoff(ctx, session.id).line).not.toBe(KICKOFF_LINES.revisit)

    // and after go-live consumed the override, with the delivery long settled
    markSessionLive(ctx, session.id, { ccSessionId: 'cc' })
    vi.advanceTimersByTime(KICKOFF_DELAY_MS + KICKOFF_SUBMIT_DELAY_MS)
    noteKickoffPrompt(ctx, session.id, 'never mind, I will drive')
    expect(resendKickoff(ctx, session.id).line).toBe(briefing)
  })

  it('resendKickoff refuses when the session is over rather than writing into a dead PTY', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind: 'qa', worktreePath: 'w' })
    fakePty()

    markSessionLive(ctx, session.id, { ccSessionId: 'cc' })
    markSessionEnded(ctx, session.id)
    expect(() => resendKickoff(ctx, session.id)).toThrow(/ended/)
  })

  it('a pending retry dies with its session — nothing types into the next terminal', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind: 'ideation', worktreePath: 'w' })
    const written = fakePty()

    markSessionLive(ctx, session.id, { ccSessionId: 'cc' })
    vi.advanceTimersByTime(KICKOFF_DELAY_MS + KICKOFF_SUBMIT_DELAY_MS)
    const typed = written.length

    markSessionEnded(ctx, session.id)
    vi.advanceTimersByTime(KICKOFF_CONFIRM_MS * 4)

    expect(written).toHaveLength(typed)
    expect(kickoffDeliveryFor(session.id)).toBeNull()
  })

  it('drops an un-consumed override when the session ends before going live', async () => {
    const ctx = await makeTestCtx()
    const featureId = seedFeature(ctx, seedProject(ctx).id).id
    const session = createSessionRow(ctx, { featureId, kind: 'revisit', worktreePath: 'w' })
    const written = fakePty()

    setKickoffOverride(session.id, 'stale override')
    markSessionEnded(ctx, session.id) // clears the pending override

    // a brand-new session reusing nothing must fall back to its per-kind default
    const next = createSessionRow(ctx, { featureId, kind: 'revisit', worktreePath: 'w' })
    markSessionLive(ctx, next.id, { ccSessionId: 'cc' })
    vi.advanceTimersByTime(KICKOFF_DELAY_MS + KICKOFF_SUBMIT_DELAY_MS)
    expect(written).toEqual([KICKOFF_LINES.revisit, '\r'])
  })
})
