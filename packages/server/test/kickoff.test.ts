import { describe, expect, it } from 'vitest'
import type { SessionKind } from '@runcastle/core'
import { CONVERGE_KICKOFF_LINE, KICKOFF_LINES } from '../src/launcher/runtimes/claude'
import { KICKOFF_LINES as CODEX_KICKOFF_LINES } from '../src/launcher/runtimes/codex'
import { kickoffLineFor } from '../src/launcher/sessions'
import { promptMatchesKickoff } from '../src/services/conversations'

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
    expect(kickoffLineFor('ideation', undefined, 'codex')).toContain('$ideate')
  })

  it('kickoffLineFor lets an explicit override replace the default', () => {
    const override = 'Proceed with your task: resolve the merge conflict, then hand back.'
    expect(kickoffLineFor('revisit', override)).toBe(override)
    // an empty override is not a real override — the default still wins
    expect(kickoffLineFor('revisit', undefined)).toBe(KICKOFF_LINES.revisit)
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
