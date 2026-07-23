import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionKind } from '@runcastle/core'
import type { PtyEntry } from '../src/pty/registry'
import { ptyRegistry } from '../src/pty/registry'
import {
  CONVERGE_KICKOFF_LINE,
  KICKOFF_DELAY_MS,
  KICKOFF_LINES,
  KICKOFF_SUBMIT_DELAY_MS,
  createSessionRow,
  kickoffLineFor,
  markSessionEnded,
  markSessionLive,
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
