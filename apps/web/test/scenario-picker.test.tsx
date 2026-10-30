// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScenarioEntry } from '@runcastle/core'
import { Combobox, ComboboxTrigger } from '../src/ui/combobox'
import { ScenarioPickerContent, scenarioGroups } from '../src/components/review/ScenarioPicker'
import { scenarioMenu } from '../src/lib/feature-ui/scenarios'
import { openList } from './floating'

/**
 * The one way a scenario is picked (test-drive-looks-the-part decision 1).
 * Tier 2: the list is a portal, and a click opens it.
 */
const entry = (name: string, group?: string, own = false, hasCall = false): ScenarioEntry => ({
  file: `.runcastle/scenarios/${name}.ts`,
  name,
  ...(group ? { group } : {}),
  own,
  hasCall,
})

const menuOf = (scenarios: ScenarioEntry[]) => scenarioMenu(scenarios, { withOwnSection: true, runnerConfigured: true })

function picker(scenarios: ScenarioEntry[], props: { current?: string | null; onNew?: () => void } = {}) {
  const onPick = vi.fn()
  render(
    <Combobox>
      <ComboboxTrigger>Open</ComboboxTrigger>
      <ScenarioPickerContent menu={menuOf(scenarios)} onPick={onPick} {...props} />
    </Combobox>,
  )
  return onPick
}

afterEach(cleanup)

describe('the groups', () => {
  it('runs This feature, the project’s groups, then the ungrouped', () => {
    const groups = scenarioGroups(menuOf([entry('mine', 'Checkout', true), entry('b', 'Auth'), entry('a', 'Auth'), entry('loose')]))
    expect(groups.map((g) => [g.heading, g.entries.map((s) => s.name)])).toEqual([
      ['This feature', ['mine']],
      ['Auth', ['a', 'b']],
      ['Other', ['loose']],
    ])
  })

  it('calls an ungrouped list by the menu’s own heading', () => {
    expect(scenarioGroups(menuOf([entry('loose')])).map((g) => g.heading)).toEqual(['Other scenarios'])
  })
})

describe('the list', () => {
  it('ends in Blank app and, on a running drive, New scenario', () => {
    picker([entry('Signed out', 'Auth')], { onNew: vi.fn() })
    expect(openList(screen.getByText('Open'))).toEqual(['Signed out', 'Blank app', 'New scenario'])
  })

  it('offers no New scenario before a drive runs', () => {
    picker([entry('Signed out', 'Auth')])
    expect(openList(screen.getByText('Open'))).toEqual(['Signed out', 'Blank app'])
  })

  it('says a scenario is an API call too', () => {
    picker([entry('Fetch order', 'Orders', false, true)])
    expect(openList(screen.getByText('Open'))[0]).toBe('Fetch orderAPI')
  })

  it('marks the scenario the drive is on', () => {
    const on = entry('Signed out', 'Auth')
    picker([on, entry('Empty cart', 'Cart')], { current: on.file })
    openList(screen.getByText('Open'))
    expect(screen.getByRole('option', { name: /Signed out/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('option', { name: /Empty cart/ }).getAttribute('aria-current')).toBeNull()
  })

  it('hands back the file picked, and null for Blank app', () => {
    const on = entry('Signed out', 'Auth')
    const onPick = picker([on])
    openList(screen.getByText('Open'))
    fireEvent.click(screen.getByRole('option', { name: /Signed out/ }))
    expect(onPick).toHaveBeenCalledWith(on.file)

    openList(screen.getByText('Open'))
    fireEvent.click(screen.getByRole('option', { name: 'Blank app' }))
    expect(onPick).toHaveBeenLastCalledWith(null)
  })
})

describe('the search box', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => entry(`Scenario ${i}`, 'Group'))

  it('stays away up to eight scenarios: a handful is one click', () => {
    picker(many(8))
    openList(screen.getByText('Open'))
    expect(screen.queryByPlaceholderText(/Search/)).toBeNull()
  })

  it('heads the list past eight, naming how many', () => {
    picker(many(9))
    openList(screen.getByText('Open'))
    expect(screen.getByPlaceholderText('Search 9 scenarios')).toBeTruthy()
  })
})
