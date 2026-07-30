import { describe, expect, it } from 'vitest'
import {
  detectedIdentity,
  firstSetupStep,
  wizardSteps,
  type ProbeLike,
} from '../src/lib/first-run'

/**
 * The wizard's promise to a first-time user: nothing was skipped behind your
 * back. Every assertion here is about that — a step the host satisfied is still
 * on the rail, marked passed, saying what it found (finding F13).
 */

const ok: ProbeLike = { status: 'ok', detail: 'Ada Lovelace <ada@example.com>' }
const unset: ProbeLike = { status: 'unset', detail: 'user.email not set — commits would fail' }

describe('firstSetupStep', () => {
  it('skips the identity form when git already has one', () => {
    expect(firstSetupStep(ok)).toBe('afk')
  })

  it('asks for an identity when it is missing, or while the probe is in flight', () => {
    expect(firstSetupStep(unset)).toBe('identity')
    expect(firstSetupStep(undefined)).toBe('identity')
  })
})

describe('detectedIdentity', () => {
  it('names where the value came from and what it was', () => {
    expect(detectedIdentity(ok)).toBe('detected from git config: Ada Lovelace <ada@example.com>')
  })

  // An unset probe's detail is a complaint ("commits would fail"), not a value —
  // reporting it as "detected" would read as a pass.
  it('detects nothing when the identity is unset', () => {
    expect(detectedIdentity(unset)).toBeUndefined()
    expect(detectedIdentity(undefined)).toBeUndefined()
  })
})

describe('wizardSteps', () => {
  it('keeps the whole sequence on the rail, whichever step is showing', () => {
    expect(wizardSteps('afk', ok).map((s) => s.key)).toEqual(['identity', 'afk', 'project'])
  })

  // The bug this fixes: landing on AFK burns with "Git identity" listed first and
  // never shown, so the user cannot tell whether it passed or needs attention.
  it('shows a step the host satisfied as passed, with what was detected', () => {
    const [identity, afk] = wizardSteps('afk', ok)
    expect(identity?.state).toBe('passed')
    expect(identity?.detected).toContain('Ada Lovelace')
    expect(afk?.state).toBe('current')
  })

  it('claims nothing is passed on the step the user is being shown', () => {
    const rows = wizardSteps('identity', unset)
    expect(rows[0]?.detected).toBeUndefined()
    expect(rows.map((s) => s.state)).toEqual(['current', 'todo', 'todo'])
  })

  it('walks forward as the user advances', () => {
    expect(wizardSteps('project', unset).map((s) => s.state)).toEqual(['done', 'done', 'current'])
  })
})
