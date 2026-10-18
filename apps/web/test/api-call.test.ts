import { describe, expect, it } from 'vitest'
import type { ScenarioEntry } from '@runcastle/core'
import { callForm, callMenu, callMethods, callRequest, hasCalls, prettyBody, statusTone } from '../src/lib/feature-ui/api-call'
import { scenarioMenu, showsScenarioNudge } from '../src/lib/feature-ui/scenarios'

/**
 * Try it's derivations (drive-scenarios decisions 10, 11) and the Blank app
 * nudge's rule (decision 14). Tier 1: all of it is lists and strings.
 */
const entry = (file: string, name: string, own: boolean, hasCall: boolean, group?: string): ScenarioEntry => ({
  file: `.runcastle/scenarios/${file}`,
  name,
  own,
  hasCall,
  ...(group ? { group } : {}),
})

const SCENARIOS: ScenarioEntry[] = [
  entry('feed/blocked-only.ts', 'Blocked only', false, true, 'Feed'),
  entry('auth/signed-out.ts', 'Signed out', false, false, 'Auth'),
  entry('checkout/apply-coupon.ts', 'Apply coupon', true, true, 'Checkout'),
  entry('checkout/full-cart.ts', 'Full cart', true, false, 'Checkout'),
]

describe('callMenu', () => {
  it('keeps only the scenarios with a call, in the Scenario menu’s sections and order', () => {
    const menu = callMenu(scenarioMenu(SCENARIOS, { withOwnSection: true, runnerConfigured: true }))
    expect(menu.own.map((s) => s.name)).toEqual(['Apply coupon'])
    expect(menu.others.map((s) => s.name)).toEqual(['Blocked only'])
    expect(menu.othersLabel).toBe('Other scenarios')
  })

  it('says whether there is any call at all', () => {
    expect(hasCalls(scenarioMenu(SCENARIOS, { withOwnSection: false, runnerConfigured: true }))).toBe(true)
    expect(hasCalls(scenarioMenu(SCENARIOS, { withOwnSection: false, runnerConfigured: false }))).toBe(false)
    expect(hasCalls(scenarioMenu([SCENARIOS[1]!], { withOwnSection: false, runnerConfigured: true }))).toBe(false)
  })
})

describe('the request form', () => {
  const call = {
    method: 'POST',
    url: 'http://localhost:5173/api/feed',
    headers: [
      ['Authorization', 'Bearer t0k'],
      ['Accept', 'application/json'],
    ] as Array<[string, string]>,
    body: '{"blocked":true}',
  }

  it('starts from the filled call and goes back to the same request', () => {
    const form = callForm(call)
    expect(form.headers).toEqual([
      { name: 'Authorization', value: 'Bearer t0k' },
      { name: 'Accept', value: 'application/json' },
    ])
    expect(callRequest(form)).toEqual(call)
  })

  it('drops nameless header rows and an empty body', () => {
    const form = { ...callForm({ ...call, body: undefined }), headers: [{ name: ' ', value: 'x' }, { name: 'X-Run', value: '7f3a' }] }
    expect(callRequest(form)).toEqual({ method: 'POST', url: call.url, headers: [['X-Run', '7f3a']] })
  })

  it('offers the usual methods, plus the call’s own when it is unusual', () => {
    expect(callMethods('GET')).toContain('DELETE')
    expect(callMethods('PROPFIND').at(-1)).toBe('PROPFIND')
  })
})

describe('the response', () => {
  it('colours the status by class', () => {
    expect([200, 204, 302, 404, 422, 500, 503].map(statusTone)).toEqual([
      'success',
      'success',
      'neutral',
      'warning',
      'warning',
      'danger',
      'danger',
    ])
  })

  it('pretty-prints a JSON body and leaves anything else as it came', () => {
    expect(prettyBody('{"a":1,"b":[2]}')).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}')
    expect(prettyBody('<h1>Not found</h1>')).toBe('<h1>Not found</h1>')
    expect(prettyBody('')).toBe('')
  })
})

describe('the Blank app nudge', () => {
  const base = { scenario: undefined, scenarios: [] as ScenarioEntry[], dismissed: false }

  it('shows on a Blank app drive of a project with no scenarios', () => {
    expect(showsScenarioNudge(base)).toBe(true)
  })

  it('is absent once any scenario exists, while the list loads, in a scenario, or after ✕', () => {
    expect(showsScenarioNudge({ ...base, scenarios: [SCENARIOS[1]!] })).toBe(false)
    expect(showsScenarioNudge({ ...base, scenarios: undefined })).toBe(false)
    expect(showsScenarioNudge({ ...base, dismissed: true })).toBe(false)
    expect(
      showsScenarioNudge({ ...base, scenario: { file: 'x.ts', name: 'X', status: 'running' } }),
    ).toBe(false)
  })
})
