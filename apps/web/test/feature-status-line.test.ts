import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NextStep } from '../src/lib/feature-ui'
import type { FeatureStatus } from '../src/lib/feature-ui/status-line'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { NextStepBar } from '../src/components/workspace/NextStepBar'

/**
 * The feature header's one status line (`the-feature-lead-runs-rounds`
 * decisions 21 and 24): the line and, when ready, what to test — nothing
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

  it('puts what to test one click from Ready, closed', () => {
    const html = line(READY)
    expect(html).toContain('Test drive ▸ Apply a coupon at checkout')
    expect(html).toContain('<details')
    expect(html).not.toContain('<details open')
    expect(html).toContain('What to test')
    expect(html).toContain('Enter SAVE10 at checkout')
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

describe('the next-step row with the status line in it', () => {
  const ns: NextStep = {
    kick: 'NEXT STEP',
    title: 'Running tickets',
    desc: 'Running 3 tickets — 1 done.',
    note: 'a note',
    counts: { pills: [{ label: '2 defects', tone: 'danger' }], trailing: 'open' },
    primary: { label: 'Merge & ship', kind: 'merge' },
    secondary: [],
    busy: true,
  }

  it('says the status line instead of the resolver’s sentence, counts and note', () => {
    const html = renderToStaticMarkup(
      createElement(NextStepBar, {
        ns,
        guidance: true,
        busy: false,
        onAction: () => undefined,
        status: createElement(FeatureStatusLine, { status: WORKING }),
      }),
    )
    expect(html).toContain('Working · Round 3')
    expect(html).toContain('Merge &amp; ship')
    expect(html).not.toContain('Running tickets')
    expect(html).not.toContain('2 defects')
    expect(html).not.toContain('a note')
  })
})
