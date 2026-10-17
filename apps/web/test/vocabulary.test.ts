import { describe, expect, it } from 'vitest'
import {
  AFK_BURN_EXPLAINER,
  agentName,
  BURN_EXPLAINER,
  sessionAgentName,
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

  // The surfaces that show these have not launched anything, so they cannot
  // know which runtime the session will open on (decision 11).
  it('does not name a runtime it cannot know yet', () => {
    expect(BURN_EXPLAINER).not.toMatch(/Claude|Codex/)
  })

  it('defines AFK as unattended', () => {
    expect(AFK_BURN_EXPLAINER).toContain('unattended')
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
