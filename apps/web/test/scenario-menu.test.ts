import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ScenarioEntry } from '@runcastle/core'
import {
  scenarioFailureLine,
  scenarioMenu,
  scenarioTarget,
  testDriveLabel,
} from '../src/lib/feature-ui/scenarios'
import { NextStepBar } from '../src/components/workspace/NextStepBar'
import type { NextStep } from '../src/lib/feature-ui'

/**
 * The scenario list both drive menus show (drive-scenarios decision 7), the
 * failure strip's words (decision 3), and the panel's target per landing.
 * Tier 1: all of it is ordering, strings and markup.
 */
const entry = (file: string, name: string, own: boolean, group?: string): ScenarioEntry => ({
  file: `.runcastle/scenarios/${file}`,
  name,
  own,
  ...(group ? { group } : {}),
})

const SCENARIOS: ScenarioEntry[] = [
  entry('smoke.ts', 'Smoke', false),
  entry('review/feature-at-review.ts', 'Feature at review', false, 'Review'),
  entry('checkout/full-cart.ts', 'Full cart', true, 'Checkout'),
  entry('auth/signed-out.ts', 'Signed out', false, 'Auth'),
  entry('checkout/expired-coupon.ts', 'Expired coupon', true, 'Checkout'),
]

const names = (list: ScenarioEntry[]) => list.map((s) => s.name)

describe('scenarioMenu', () => {
  it('puts the feature’s own first in path order, then the others by group with the ungrouped last', () => {
    const menu = scenarioMenu(SCENARIOS, { withOwnSection: true, runnerConfigured: true })

    expect(names(menu.own)).toEqual(['Expired coupon', 'Full cart'])
    expect(names(menu.others)).toEqual(['Signed out', 'Feature at review', 'Smoke'])
    expect(menu.othersLabel).toBe('Other scenarios')
    expect(menu.defaultScenario?.name).toBe('Expired coupon')
  })

  it('defaults to Blank app when the feature owns no scenario', () => {
    const menu = scenarioMenu(
      SCENARIOS.filter((s) => !s.own),
      { withOwnSection: true, runnerConfigured: true },
    )
    expect(menu.defaultScenario).toBeNull()
    expect(menu.own).toEqual([])
  })

  it('lists everything as one section on a project drive, defaulting to Blank app', () => {
    const menu = scenarioMenu(SCENARIOS, { withOwnSection: false, runnerConfigured: true })

    expect(menu.own).toEqual([])
    expect(names(menu.others)).toEqual(['Signed out', 'Expired coupon', 'Full cart', 'Feature at review', 'Smoke'])
    expect(menu.othersLabel).toBe('Scenarios')
    expect(menu.defaultScenario).toBeNull()
  })

  it('offers only Blank app when no scenario runner is set', () => {
    const menu = scenarioMenu(SCENARIOS, { withOwnSection: true, runnerConfigured: false })
    expect(menu.own).toEqual([])
    expect(menu.others).toEqual([])
    expect(menu.defaultScenario).toBeNull()
  })
})

describe('testDriveLabel', () => {
  it('names the scenario the main click starts on', () => {
    expect(testDriveLabel(SCENARIOS[4]!, 'Start test drive')).toBe('Test drive · Expired coupon')
    expect(testDriveLabel(null, 'Start test drive')).toBe('Start test drive')
  })
})

describe('scenarioFailureLine', () => {
  const failed = (failure: NonNullable<Parameters<typeof scenarioFailureLine>[0]['failure']>) =>
    scenarioFailureLine({ name: 'Expired coupon', failure })

  it('says the actual reason', () => {
    expect(failed({ reason: 'exit', exitCode: 1, outputTail: '' })).toBe('Scenario “Expired coupon” failed: exit 1')
    expect(failed({ reason: 'no-entry-url', exitCode: 0, outputTail: '' })).toBe(
      'Scenario “Expired coupon” failed: printed no ENTRY_URL',
    )
    expect(failed({ reason: 'timeout', outputTail: '' })).toBe('Scenario “Expired coupon” failed: timed out after 2 min')
    expect(failed({ reason: 'no-runner', outputTail: '' })).toBe(
      'Scenario “Expired coupon” failed: no scenario runner set',
    )
  })
})

describe('scenarioTarget', () => {
  const DEV = 'http://localhost:5173'
  it('lands on the entry URL, keyed by landing so a repeat still reloads', () => {
    const landed = { file: 'f', name: 'n', status: 'landed' as const, entryUrl: `${DEV}/cart` }
    expect(scenarioTarget(DEV, { ...landed, landingId: 'l1' })).toEqual({ url: `${DEV}/cart`, key: 'l1' })
    expect(scenarioTarget(DEV, { ...landed, landingId: 'l2' }).key).toBe('l2')
  })

  it('stays on the plain URL while running, after a failure, and with no scenario', () => {
    expect(scenarioTarget(DEV, undefined).url).toBe(DEV)
    expect(scenarioTarget(DEV, { file: 'f', name: 'n', status: 'running' }).url).toBe(DEV)
    expect(
      scenarioTarget(DEV, { file: 'f', name: 'n', status: 'failed', failure: { reason: 'exit', exitCode: 1, outputTail: '' } })
        .url,
    ).toBe(DEV)
  })
})

describe('the next-step bar’s Test drive', () => {
  const ns: NextStep = {
    kick: 'NEXT STEP',
    primary: { label: 'Merge & ship', kind: 'merge' },
    secondary: [{ label: 'Start test drive', kind: 'testDriveStart' }],
    busy: false,
  }

  it('renders as a split button under the scenario’s label', () => {
    const html = renderToStaticMarkup(
      createElement(NextStepBar, {
        ns,
        guidance: false,
        busy: false,
        onAction: () => undefined,
        split: { kind: 'testDriveStart', label: 'Test drive · Expired coupon', menu: null, menuLabel: 'Choose a scenario' },
      }),
    )
    expect(html).toContain('Test drive · Expired coupon')
    expect(html).toContain('aria-label="Choose a scenario"')
    expect(html).not.toContain('Start test drive')
  })

  it('stays a plain button without a split', () => {
    const html = renderToStaticMarkup(
      createElement(NextStepBar, { ns, guidance: false, busy: false, onAction: () => undefined }),
    )
    expect(html).toContain('Start test drive')
    expect(html).not.toContain('Choose a scenario')
  })
})
