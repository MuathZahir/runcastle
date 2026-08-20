import { describe, expect, it } from 'vitest'
import {
  AFK_BURN_EXPLAINER,
  agentName,
  BURN_EXPLAINER,
  GATE_EXPLAINER,
  GRILL_EXPLAINER,
  lapExplainer,
  sessionAgentName,
  testDriveExplainer,
} from '../src/lib/vocabulary'

/**
 * The jargon sweep (finding F16). An explainer earns its place by naming the
 * mechanics the word hides — "burn" that never mentions where the commits land
 * is still jargon, just longer.
 */

describe('the explainers', () => {
  it('says where a burn runs and where its commits land', () => {
    expect(BURN_EXPLAINER).toContain('sandboxed agent')
    expect(BURN_EXPLAINER).toContain('feature branch')
  })

  it('says a grill is a conversation, before any code', () => {
    expect(GRILL_EXPLAINER).toMatch(/conversation/)
    expect(GRILL_EXPLAINER).toMatch(/before any code/)
  })

  // The form that shows this has not launched anything, so it cannot know which
  // runtime the session will open on (decision 11).
  it('does not name a runtime it cannot know yet', () => {
    expect(GRILL_EXPLAINER).not.toMatch(/Claude|Codex/)
  })

  it('says a gate is where runcastle waits for the human', () => {
    expect(GATE_EXPLAINER).toMatch(/human/)
    expect(GATE_EXPLAINER).toMatch(/waits/)
  })

  it('defines AFK as unattended', () => {
    expect(AFK_BURN_EXPLAINER).toContain('unattended')
  })

  it('names the lap it is explaining, and what opened it', () => {
    expect(lapExplainer(3)).toMatch(/^Lap 3 —/)
    expect(lapExplainer(3)).toContain('Iterate')
  })

  // A form printing "lap 1" must not be told Iterate sent it back — nothing has.
  it('does not claim a first lap was sent back', () => {
    expect(lapExplainer(1)).toMatch(/^Lap 1 —/)
    expect(lapExplainer(1)).toContain('first pass')
    expect(lapExplainer(1)).not.toContain('sent this feature back')
  })
})

/**
 * Test drive is the one word whose meaning CHANGES per project: on a prepared
 * project it runs the setup command and boots the dev server; on an unprepared
 * one it checks out the branch and stops. One sentence
 * cannot cover both, so the explainer is told which project it is describing.
 */
describe('testDriveExplainer', () => {
  const none = { setup: false, dev: false, teardown: false }
  const all = { setup: true, dev: true, teardown: true }

  it('always names the checkout — the half that happens on every project', () => {
    for (const caps of [none, all, undefined]) {
      expect(testDriveExplainer(caps)).toContain('checks out')
      expect(testDriveExplainer(caps)).toContain('branch')
    }
  })

  it('says the checkout is all an unprepared project gets, and where to fix that', () => {
    const copy = testDriveExplainer(none)
    expect(copy).toContain('the checkout is all it does')
    expect(copy).toContain('Preparation')
    // Nothing may be promised that no command exists to deliver.
    expect(copy).not.toMatch(/dev server|database|setup command/)
  })

  it('names the setup command and the dev server when set', () => {
    const copy = testDriveExplainer(all)
    expect(copy).toContain('setup command')
    expect(copy).toContain('dev server')
    expect(copy).not.toContain('the checkout is all it does')
  })

  it('names only the steps this project actually configured', () => {
    const devOnly = testDriveExplainer({ ...none, dev: true })
    expect(devOnly).toContain('dev server')
    expect(devOnly).not.toContain('setup command')

    const setupOnly = testDriveExplainer({ ...none, setup: true })
    expect(setupOnly).toContain('setup command')
    expect(setupOnly).not.toContain('dev server')
  })

  // Stopping is the half that surprises people: it switches the branch back.
  it('says stopping returns you to the branch you were on', () => {
    expect(testDriveExplainer(none)).toMatch(/back on the branch you were on/)
    expect(testDriveExplainer(all)).toMatch(/back on the branch you were on/)
  })

  it('mentions the teardown command only when there is one', () => {
    expect(testDriveExplainer(all)).toContain('teardown command')
    expect(testDriveExplainer({ ...all, teardown: false })).not.toContain('teardown command')
  })

  // Rendered before the settings query resolves: the shared half is true
  // everywhere, so it is safe to print; the per-project half is not yet known.
  it('claims nothing about commands when the project is still unknown', () => {
    const copy = testDriveExplainer(undefined)
    expect(copy).not.toMatch(/dev server|database|setup command|Preparation/)
  })
})

/**
 * Naming the correspondent (decision 11). A Codex-only human reading "Claude"
 * is a broken product, not a cosmetic nit — and guessing a runtime where none
 * has been resolved is the same bug wearing a default.
 */
describe('agentName', () => {
  it('names the runtime a session is actually running on', () => {
    expect(agentName('claude-code')).toBe('Claude')
    expect(agentName('codex')).toBe('Codex')
  })

  // Shorter than RUNTIME_LABEL's product name on purpose: this word goes into a
  // sentence ("shape the idea with Claude"), not into a settings dropdown.
  it('names the correspondent, not the product', () => {
    expect(agentName('claude-code')).not.toContain('Code')
  })

  it('says "the agent" rather than guessing when no runtime is settled', () => {
    expect(agentName(undefined)).toBe('the agent')
    expect(agentName(null)).toBe('the agent')
  })

  /**
   * A session that exists always ran on SOMETHING, so it is never "the agent" —
   * a row written before the runtime column reads as the historical default,
   * which is the convention the db schema states and the server applies.
   */
  it('names a session that predates the runtime column as the historical default', () => {
    expect(sessionAgentName({ runtime: 'codex' })).toBe('Codex')
    expect(sessionAgentName({ runtime: null })).toBe('Claude')
    expect(sessionAgentName({})).toBe('Claude')
  })
})
