import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FeatureStatus } from '../src/lib/feature-ui/status-line'
import { FeatureStatusLine, WhatToTest } from '../src/components/workspace/FeatureStatusLine'

/**
 * The feature header's one status line (`the-feature-lead-runs-rounds`
 * decisions 21 and 24; design-mode decision 12): one quiet line, and — atop the
 * chat, when ready — what to test; nothing
 * beside it. Tier 1: what it says is the markup it emits; the derivation is
 * asserted in `status-line.test.ts`, and Stop's confirmation in
 * `feature-status-clicks.test.tsx`.
 */
const line = (status: FeatureStatus): string => renderToStaticMarkup(createElement(FeatureStatusLine, { status }))

const WORKING: FeatureStatus = { kind: 'working', label: 'Working · Round 3', round: 3, primary: 'stop' }
const READY: FeatureStatus = {
  kind: 'ready',
  label: 'Ready for you',
  why: 'Test drive ▸ Apply a coupon at checkout',
  scenario: 'Apply a coupon at checkout',
  whatToTest: 'Enter SAVE10 at checkout; the total drops 10% before tax.',
  primary: 'testDriveStart',
}

describe('FeatureStatusLine', () => {
  it('says the status once, as text beside a dot', () => {
    const html = line(WORKING)
    expect(html).toContain('Working · Round 3')
    expect(html).toContain('role="status"')
  })

  it('says why the agent waits', () => {
    expect(line({ kind: 'waiting', label: 'Waiting for you', why: 'stopped' })).toContain('· stopped')
  })

  it('says the drive Ready asks for, on one line with no disclosure in it', () => {
    const html = line(READY)
    expect(html).toContain('Test drive ▸ Apply a coupon at checkout')
    expect(html).not.toContain('<details')
  })

  it('carries no switch, no token figure and no button of its own', () => {
    for (const status of [WORKING, READY]) {
      const html = line(status)
      expect(html).not.toContain('Autonomy')
      expect(html).not.toContain('tokens')
      expect(html).not.toContain('<button')
    }
  })
})

describe('WhatToTest', () => {
  const what = (status: FeatureStatus) => renderToStaticMarkup(createElement(WhatToTest, { status }))

  it('puts what to test one click from Ready, closed', () => {
    const html = what(READY)
    expect(html).toContain('<details')
    expect(html).not.toContain('<details open')
    expect(html).toContain('What to test')
    expect(html).toContain('Enter SAVE10 at checkout')
  })

  it('says nothing in any other state', () => {
    expect(what(WORKING)).toBe('')
  })
})
