import { describe, expect, it } from 'vitest'
import {
  AGENT_DIGEST_DOCS,
  WITHHELD_FEATURE_DOCS,
  agentDigestDocOrder,
  isAgentDigestDoc,
} from '../src/docs'

/**
 * The agent-digest allowlist. Two independent payload builders — the MCP
 * `get_feature_context` tool and the burner's docs digest — each used to glob
 * `docs/features/<slug>/*.md` and inline every match, so both shipped whatever
 * happened to be in the directory (measured: 52 KB of `outcome.md` plus 27 KB of
 * `test-notes.md` into a coder's prompt). These tests pin the shared rule that
 * replaced both globs.
 */

describe('isAgentDigestDoc', () => {
  it('accepts each canonical doc', () => {
    for (const name of AGENT_DIGEST_DOCS) expect(isAgentDigestDoc(name)).toBe(true)
  })

  it('rejects the docs that made the payloads enormous', () => {
    expect(isAgentDigestDoc('outcome.md')).toBe(false)
    expect(isAgentDigestDoc('test-notes.md')).toBe(false)
    expect(isAgentDigestDoc('findings.md')).toBe(false)
  })

  it('is case-insensitive, because the filesystem may not be', () => {
    expect(isAgentDigestDoc('SPEC.md')).toBe(true)
    expect(isAgentDigestDoc('Decisions.MD')).toBe(true)
  })

  // Research deliverables live at `research/<seq>-<slug>.md` (workflows/research.ts).
  // They are never inlined: they are indexed and read on demand, which is what
  // keeps an allowlist from silently losing a whole AFK run's output.
  it('never treats a doc in a subdirectory as canonical', () => {
    expect(isAgentDigestDoc('research/3-auth-model.md')).toBe(false)
    expect(isAgentDigestDoc('research\\3-auth-model.md')).toBe(false)
    expect(isAgentDigestDoc('audit/reports/server.md')).toBe(false)
  })

  it('rejects a name that merely contains a canonical one', () => {
    expect(isAgentDigestDoc('old-spec.md')).toBe(false)
    expect(isAgentDigestDoc('spec.md.bak')).toBe(false)
  })
})

describe('WITHHELD_FEATURE_DOCS', () => {
  // The allowlist is only safe because a withheld doc is still NAMED to the
  // agent with a reason, so it can fetch what it decides it needs.
  it('gives a reason for every doc it withholds', () => {
    for (const [name, reason] of Object.entries(WITHHELD_FEATURE_DOCS)) {
      expect(name).toMatch(/\.md$/)
      expect(reason.length).toBeGreaterThan(0)
    }
  })

  it('never withholds something the digest also inlines', () => {
    for (const name of Object.keys(WITHHELD_FEATURE_DOCS)) {
      expect(isAgentDigestDoc(name)).toBe(false)
    }
  })
})

describe('agentDigestDocOrder', () => {
  it('reads brief → map → decisions → spec whatever order the fs gave', () => {
    const shuffled = ['spec.md', 'decisions.md', 'brief.md', 'map.md']
    const sorted = [...shuffled].sort((a, b) => agentDigestDocOrder(a) - agentDigestDocOrder(b))
    expect(sorted).toEqual(['brief.md', 'map.md', 'decisions.md', 'spec.md'])
  })

  it('sorts unknown docs after every canonical one', () => {
    expect(agentDigestDocOrder('outcome.md')).toBeGreaterThan(agentDigestDocOrder('spec.md'))
  })
})
