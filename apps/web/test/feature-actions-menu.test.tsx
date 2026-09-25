// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FeatureActionsMenu } from '../src/components/FeatureActionsMenu'
import { openMenu } from './floating'

/**
 * The kebab menu on a feature row. Tier 2: its items only exist once the
 * `DropdownMenu` primitive has portalled them open, so a rendered string has
 * nothing to assert on.
 */

const actions = [
  { key: 'copy-link', label: 'Copy link', onSelect: () => {} },
  { key: 'delete', label: 'Delete…', danger: true, onSelect: () => {} },
]

describe('FeatureActionsMenu', () => {
  afterEach(cleanup)

  it('states its type size on the items, so they read at the sans size the rows around them do', () => {
    render(<FeatureActionsMenu actions={actions} />)
    openMenu(screen.getByRole('button', { name: 'Feature actions' }))

    // Tailwind emits `text-xs` after every other size, so the surface's own
    // default is the later declaration however the class attribute is written
    // — a size handed to the surface never reaches the items. The family is
    // safe there (`font-sans` sorts after `font-mono`); the size is not.
    expect(screen.getByRole('menu').className).toContain('font-sans')
    for (const { label } of actions) {
      expect(screen.getByRole('menuitem', { name: label }).className).toContain('text-sm')
    }
  })

  it('gives every item an icon and sorts the destructive ones last, behind a rule', () => {
    render(<FeatureActionsMenu actions={[actions[1]!, actions[0]!]} />)
    openMenu(screen.getByRole('button', { name: 'Feature actions' }))

    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Copy link', 'Delete…'])
    for (const item of items) expect(item.querySelector('svg')).toBeTruthy()
    expect(screen.getByRole('separator')).toBeTruthy()
  })
})
