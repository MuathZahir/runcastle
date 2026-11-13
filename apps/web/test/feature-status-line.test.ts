import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FeatureStatus } from '../src/lib/feature-ui/status-line'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'

/**
 * The feature header's one status line (needs-you-is-the-agent-s-call decision
 * 15): one quiet line, nothing beside it. Tier 1: what it says is the markup it
 * emits; the derivation is asserted in `status-line.test.ts`.
 */
const line = (status: FeatureStatus, onOpenThread?: (id: string) => void): string =>
  renderToStaticMarkup(createElement(FeatureStatusLine, { status, ...(onOpenThread ? { onOpenThread } : {}) }))

const WORKING: FeatureStatus = { kind: 'working', label: 'Working', primary: 'stop' }
const NEEDS: FeatureStatus = { kind: 'needsYou', label: 'Needs you', why: 'Ready to test · Apply a coupon', threadId: 'lead-chat' }

describe('FeatureStatusLine', () => {
  it('says the status once, as text beside a dot', () => {
    const html = line(WORKING)
    expect(html).toContain('Working')
    expect(html).toContain('role="status"')
  })

  it('says Needs you with the agent’s line, on one line with no disclosure in it', () => {
    const html = line(NEEDS)
    expect(html).toContain('Needs you')
    expect(html).toContain('· Ready to test · Apply a coupon')
    expect(html).not.toContain('<details')
  })

  it('says Idle for a feature with nothing running and nothing asked', () => {
    expect(line({ kind: 'idle', label: 'Idle' })).toContain('Idle')
  })

  it('opens the chat the need waits in only when given the way there', () => {
    expect(line(NEEDS)).not.toContain('<button')
    expect(line(NEEDS, () => undefined)).toContain('<button')
    expect(line(WORKING, () => undefined)).not.toContain('<button')
  })

  it('carries no switch and no token figure', () => {
    for (const status of [WORKING, NEEDS]) {
      const html = line(status)
      expect(html).not.toContain('Autonomy')
      expect(html).not.toContain('tokens')
    }
  })
})
