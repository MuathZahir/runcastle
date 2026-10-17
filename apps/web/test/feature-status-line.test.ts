import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NextStep } from '../src/lib/feature-ui'
import type { FeatureStatus } from '../src/lib/feature-ui/status-line'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { NextStepBar } from '../src/components/workspace/NextStepBar'

/**
 * The feature header's one status line (`the-feature-lead-runs-rounds`
 * decision 21), with the autonomy switch, the token total and Stop beside it.
 * Tier 1: what it says is the markup it emits; the derivation is asserted in
 * `status-line.test.ts`, and the switch's clicks in `feature-status-clicks.test.tsx`.
 */
const line = (status: FeatureStatus, over: Partial<Parameters<typeof FeatureStatusLine>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(FeatureStatusLine, {
      status,
      autonomy: 'run-until-ready',
      onAutonomy: () => undefined,
      onStop: () => undefined,
      ...over,
    }),
  )

const WORKING: FeatureStatus = { kind: 'working', label: 'Working · Round 3', round: 3 }
const READY: FeatureStatus = {
  kind: 'ready',
  label: 'Ready for you',
  why: 'Test drive ▸ Apply a coupon at checkout',
  scenario: 'Apply a coupon at checkout',
  whatToTest: 'Enter SAVE10 at checkout; the total drops 10% before tax.',
}

describe('FeatureStatusLine', () => {
  it('says the status once, as text beside a dot', () => {
    const html = line(WORKING)
    expect(html).toContain('Working · Round 3')
    expect(html).toContain('role="status"')
  })

  it('says why the agent waits', () => {
    expect(line({ kind: 'waiting', label: 'Waiting for you', why: 'round 4 proposed' })).toContain(
      '· round 4 proposed',
    )
  })

  it('puts what to test one click from Ready, closed', () => {
    const html = line(READY)
    expect(html).toContain('Test drive ▸ Apply a coupon at checkout')
    expect(html).toContain('<details')
    expect(html).not.toContain('<details open')
    expect(html).toContain('What to test')
    expect(html).toContain('Enter SAVE10 at checkout')
  })

  it('offers Stop only while the agent works', () => {
    expect(line(WORKING)).toContain('Stop')
    for (const status of [READY, { kind: 'planning', label: 'Planning with you' } as const]) {
      expect(line(status)).not.toContain('Stop')
    }
  })

  it('shows the autonomy switch on the resolved value', () => {
    const html = line(WORKING, { autonomy: 'ask' })
    expect(html).toContain('aria-label="Autonomy"')
    expect(html).toContain('Run until ready')
    expect(html).toMatch(/aria-checked="true"[^>]*>(<[^>]*>)*Ask before each round/)
  })

  it('has no switch once merged — nothing is left to run', () => {
    expect(line({ kind: 'merged', label: 'Merged' })).not.toContain('Autonomy')
  })

  it('shows the token total when one was counted, and nothing otherwise', () => {
    expect(line(WORKING, { tokens: 1_800_000 })).toContain('1.8M tokens')
    expect(line(WORKING, { tokens: null })).not.toContain('tokens')
  })
})

describe('the next-step row with the status line in it', () => {
  const ns: NextStep = {
    kick: 'NEXT STEP',
    title: 'Burning tickets',
    desc: 'Burning 3 tickets — 1 done.',
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
        status: createElement(FeatureStatusLine, {
          status: WORKING,
          autonomy: 'run-until-ready',
          onAutonomy: () => undefined,
          onStop: () => undefined,
        }),
      }),
    )
    expect(html).toContain('Working · Round 3')
    expect(html).toContain('Merge &amp; ship')
    expect(html).not.toContain('Burning tickets')
    expect(html).not.toContain('2 defects')
    expect(html).not.toContain('a note')
  })
})
