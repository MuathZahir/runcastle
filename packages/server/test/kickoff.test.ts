import { describe, expect, it } from 'vitest'
import type { SessionKind } from '@runcastle/core'
import { KICKOFF_LINES } from '../src/launcher/runtimes/claude'
import { KICKOFF_LINES as CODEX_KICKOFF_LINES } from '../src/launcher/runtimes/codex'
import { chatKickoffFor, selfPlanKickoffFor } from '../src/launcher/runtimes/skills'
import { kickoffLineFor } from '../src/launcher/sessions'
import { promptMatchesKickoff } from '../src/services/conversations'

describe('kickoff registry + override', () => {
  const KINDS: SessionKind[] = ['chat', 'prepare', 'project', 'drive-fix']

  it('maps every session kind to a non-empty kickoff line naming its opening skill', () => {
    const skillByKind: Record<SessionKind, string> = {
      chat: '/runcastle:revisit',
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

  it('opens a self-planning run saying no human is present, naming ideate per runtime', () => {
    for (const [runtime, ideate] of [['claude-code', '/runcastle:ideate'], ['codex', '$ideate']] as const) {
      const line = selfPlanKickoffFor(runtime)
      expect(line).toContain('no human is present')
      expect(line).toContain(ideate)
      expect(line).toContain('"Planning without a human"')
      expect(line).not.toMatch(/[\r\n]/)
    }
  })

  it("opens a chat past Go as the feature's lead, naming the lead skill per runtime", () => {
    for (const [runtime, lead] of [['claude-code', '/runcastle:lead'], ['codex', '$lead']] as const) {
      const line = chatKickoffFor(runtime, 'lead')
      expect(line).toContain(`Proceed as the feature's lead: invoke ${lead}`)
      expect(line).not.toMatch(/[\r\n]/)
    }
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
  const line = KICKOFF_LINES.project

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
