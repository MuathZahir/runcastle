import { describe, expect, it } from 'vitest'
import {
  firstSetupStep,
  nextSetupStep,
  prevSetupStep,
  readyRuntimes,
  runtimeReadiness,
  setupComplete,
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
    expect(firstSetupStep(ok)).toBe('runtimes')
  })

  it('asks for an identity when it is missing, or while the probe is in flight', () => {
    expect(firstSetupStep(unset)).toBe('identity')
    expect(firstSetupStep(undefined)).toBe('identity')
  })
})

describe('wizardSteps', () => {
  it('keeps the whole sequence on the rail, whichever step is showing', () => {
    expect(wizardSteps('afk', ok).map((s) => s.key)).toEqual([
      'identity',
      'runtimes',
      'afk',
      'project',
    ])
  })

  // The bug this fixes: landing on AFK burns with "Git identity" listed first and
  // never shown, so the user cannot tell whether it passed or needs attention.
  it('shows a step the host satisfied as passed, with what was detected', () => {
    const rows = wizardSteps('afk', ok)
    expect(rows[0]?.state).toBe('passed')
    expect(rows[0]?.detected).toBe('detected from git config: Ada Lovelace <ada@example.com>')
    expect(rows.find((s) => s.key === 'afk')?.state).toBe('current')
  })

  // An unset probe's detail is a complaint ("commits would fail"), not a value —
  // a crossed step with nothing detected is just done.
  it('never dresses a missing identity up as a detected one', () => {
    const [identity] = wizardSteps('afk', unset)
    expect(identity?.state).toBe('done')
    expect(identity?.detected).toBeUndefined()
  })

  it('claims nothing is passed on the step the user is being shown', () => {
    const rows = wizardSteps('identity', unset)
    expect(rows[0]?.detected).toBeUndefined()
    expect(rows.map((s) => s.state)).toEqual(['current', 'todo', 'todo', 'todo'])
  })

  it('walks forward as the user advances', () => {
    expect(wizardSteps('project', unset).map((s) => s.state)).toEqual([
      'done',
      'done',
      'done',
      'current',
    ])
  })
})

/**
 * Both providers are peers (decision 6): the wizard shows what each host has,
 * lets the operator auth any subset, and leaves only once ONE of them can
 * actually open a session — never once a particular vendor can.
 */
describe('runtimeReadiness', () => {
  const probe = (
    runtime: string,
    check: string,
    status: string,
    over: Partial<ProbeLike> = {},
  ): ProbeLike => ({
    status,
    detail: `${runtime} ${check} ${status}`,
    runtime: runtime as ProbeLike['runtime'],
    check,
    ...over,
  })

  const claudeReady = [
    probe('claude-code', 'binary', 'ok'),
    probe('claude-code', 'auth', 'ok'),
    probe('claude-code', 'afk-key', 'unset'),
  ]
  const codexMissing = [
    probe('codex', 'binary', 'missing', { fix: 'Install Codex: npm install -g @openai/codex' }),
    probe('codex', 'auth', 'missing'),
    probe('codex', 'afk-key', 'unset'),
  ]

  it('shows both providers, whichever the host has', () => {
    const cards = runtimeReadiness([...claudeReady, ...codexMissing])
    expect(cards.map((c) => c.runtime)).toEqual(['claude-code', 'codex'])
    expect(cards.map((c) => c.label)).toEqual(['Claude Code', 'Codex'])
  })

  it('carries the install line for a provider that is not here', () => {
    const [, codex] = runtimeReadiness([...claudeReady, ...codexMissing])
    expect(codex?.installed).toBe(false)
    expect(codex?.talkReady).toBe(false)
    expect(codex?.installFix).toContain('Install Codex')
  })

  it('counts a runtime ready for sessions once it is installed and logged in', () => {
    const [claude] = runtimeReadiness([...claudeReady, ...codexMissing])
    expect(claude).toMatchObject({ installed: true, authed: true, afkReady: false, talkReady: true })
  })

  // Claude Code's unattended token authenticates a session too — an operator who
  // pasted one is not sent back to log in a second time.
  it('accepts Claude Code’s AFK token in place of an interactive login', () => {
    const [claude] = runtimeReadiness([
      probe('claude-code', 'binary', 'ok'),
      probe('claude-code', 'auth', 'unset'),
      probe('claude-code', 'afk-key', 'ok'),
    ])
    expect(claude?.talkReady).toBe(true)
  })

  // Codex burns borrow the file `codex login` writes (decision 4), so the login
  // is the AFK credential — being signed in makes Codex ready for both.
  it('counts a signed-in Codex ready for sessions and for burns', () => {
    const [, codex] = runtimeReadiness([
      probe('codex', 'binary', 'ok'),
      probe('codex', 'auth', 'ok'),
    ])
    expect(codex).toMatchObject({ installed: true, authed: true, afkReady: true, talkReady: true })
  })

  // The bug this prevents: the wizard calling Codex ready off a pasted key while
  // the launcher, which wants the login file, refuses to spawn it.
  it('never counts a key alone as a Codex login', () => {
    const [, codex] = runtimeReadiness([
      probe('codex', 'binary', 'ok'),
      probe('codex', 'auth', 'unset'),
      probe('codex', 'afk-key', 'ok'),
    ])
    expect(codex).toMatchObject({ authed: false, afkReady: false, talkReady: false })
  })

  it('never calls an installed-but-unauthed runtime ready', () => {
    const [, codex] = runtimeReadiness([
      probe('codex', 'binary', 'ok'),
      probe('codex', 'auth', 'unset'),
      probe('codex', 'afk-key', 'unset'),
    ])
    expect(codex?.installed).toBe(true)
    expect(codex?.talkReady).toBe(false)
  })

  it('reports nothing ready while the probe is still in flight', () => {
    expect(readyRuntimes(runtimeReadiness([]))).toEqual([])
  })

  it('names every ready runtime — a codex-only host included', () => {
    const cards = runtimeReadiness([
      probe('codex', 'binary', 'ok'),
      probe('codex', 'auth', 'ok'),
      probe('codex', 'afk-key', 'unset'),
      probe('claude-code', 'binary', 'missing'),
      probe('claude-code', 'auth', 'missing'),
      probe('claude-code', 'afk-key', 'unset'),
    ])
    expect(readyRuntimes(cards)).toEqual(['codex'])
  })
})

describe('nextSetupStep', () => {
  it('walks the setup order and stops at the end', () => {
    expect(nextSetupStep('identity')).toBe('runtimes')
    expect(nextSetupStep('runtimes')).toBe('afk')
    expect(nextSetupStep('afk')).toBe('project')
    expect(nextSetupStep('project')).toBeUndefined()
  })
})

/**
 * Decision 4 — Back on every step after the intro. Back walks the steps the user
 * was actually shown: a step the host satisfied was never presented, so landing
 * on it would ask for something git already has.
 */
describe('prevSetupStep', () => {
  it('walks back down the setup order', () => {
    expect(prevSetupStep('project', unset)).toBe('afk')
    expect(prevSetupStep('afk', unset)).toBe('runtimes')
    expect(prevSetupStep('runtimes', unset)).toBe('identity')
  })

  // The first shown step's Back goes to the intro, which is not a setup step.
  it('has nowhere earlier to go from the first step it showed', () => {
    expect(prevSetupStep('identity', unset)).toBeUndefined()
    expect(prevSetupStep('identity', undefined)).toBeUndefined()
  })

  it('never lands on an identity step the host passed for us', () => {
    expect(prevSetupStep('runtimes', ok)).toBeUndefined()
    expect(prevSetupStep('afk', ok)).toBe('runtimes')
    expect(prevSetupStep('project', ok)).toBe('afk')
  })
})

/**
 * Decision 3 — first run is what the doctor says about the host, not whether the
 * projects table happens to be empty. Both halves must hold: an identity to
 * attribute commits with, and something that can open a session.
 */
describe('setupComplete', () => {
  const identity = (status: string): ProbeLike => ({
    id: 'git-identity',
    status,
    detail: status === 'ok' ? 'Ada Lovelace <ada@example.com>' : 'user.email not set',
  })
  const runtime = (check: string, status: string): ProbeLike => ({
    status,
    detail: `codex ${check} ${status}`,
    runtime: 'codex',
    check,
  })
  const signedIn = [runtime('binary', 'ok'), runtime('auth', 'ok')]
  const signedOut = [runtime('binary', 'ok'), runtime('auth', 'unset')]

  it('is complete with a git identity and a ready runtime', () => {
    expect(setupComplete([identity('ok'), ...signedIn])).toBe(true)
  })

  it('is incomplete without a git identity, however ready the agents are', () => {
    expect(setupComplete([identity('unset'), ...signedIn])).toBe(false)
  })

  it('is incomplete while no runtime can open a session', () => {
    expect(setupComplete([identity('ok'), ...signedOut])).toBe(false)
  })

  it('is incomplete when neither is in place', () => {
    expect(setupComplete([identity('unset'), ...signedOut])).toBe(false)
  })

  // An empty report is the probe still in flight, or a doctor that failed: the
  // safe reading is "not set up", never "set up enough to skip onboarding".
  it('is incomplete when the report says nothing at all', () => {
    expect(setupComplete([])).toBe(false)
  })
})
