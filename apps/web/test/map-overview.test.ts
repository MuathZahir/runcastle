import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { MapModel } from '@runcastle/core'
import { MapOverview } from '../src/components/map/MapOverview'
import { MapGroupPage } from '../src/components/map/MapGroupPage'
import { couponsGroup, mapModel } from './fixtures'

/**
 * The map's overview and group pages, tier 1: for a given map model the whole
 * of what they show is the markup they emit — the tallies, the catalogue line
 * in each state, each empty situation's words, and which sections a group has.
 * Clicks and lazy frames are the tier-2 file's (map-view.test.tsx).
 */

const noop = (): void => {}
const build = { onBuild: noop, pending: false }
const doors = { onSetUpStories: noop, onNewScenario: noop }

const overview = (model: MapModel): string =>
  renderToStaticMarkup(createElement(MapOverview, { model, build, doors, onOpenGroup: noop }))

const groupPage = (model: MapModel, group = couponsGroup()): string =>
  renderToStaticMarkup(
    createElement(MapGroupPage, { model, group, build, onOpenGroup: noop, onOpenDrive: noop }),
  )

/** Text without tags or entity noise, for reading sentences across inline elements. */
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')

const catalogue = (over: Partial<MapModel['catalogue']>): MapModel['catalogue'] => ({
  ...mapModel().catalogue,
  ...over,
})

describe('the map overview', () => {
  it('lists every group with a tally of only what it has, children indented under their parent', () => {
    const html = overview(mapModel())
    const t = text(html)
    expect(t).toContain('Auth3 UI states · 2 ways in · 1 call')
    expect(t).toContain('Coupons5 UI states · 2 ways in · 1 call')
    expect(html.indexOf('>Checkout<')).toBeLessThan(html.indexOf('>Coupons<'))
    expect(html).toMatch(/class="[^"]*ml-6[^"]*"[^>]*>(?:(?!data-list-row).)*Coupons/)
  })

  it('counts in the singular where there is one of a thing', () => {
    const [badge] = couponsGroup().pages
    if (!badge) throw new Error('no component')
    const one = couponsGroup({
      pages: [{ ...badge, states: badge.states.slice(0, 1) }],
      scenarios: couponsGroup().scenarios.slice(0, 1),
    })
    expect(text(overview(mapModel({ groups: [one] })))).toContain('1 UI state · 1 way in · 1 call')
  })

  it('says the catalogue was built from main, and how long ago', () => {
    const t = text(overview(mapModel()))
    expect(t).toContain('Built from main · 2h ago')
    expect(t).not.toContain('main has moved since')
    expect(t).not.toContain('Rebuild')
  })

  it('offers Rebuild when main has moved since', () => {
    const t = text(overview(mapModel({ catalogue: catalogue({ stale: true }) })))
    expect(t).toContain('Built from main · 2h ago · main has moved since')
    expect(t).toContain('Rebuild')
  })

  it('shows a build in flight beside the previous catalogue, with no button to start another', () => {
    const t = text(overview(mapModel({ catalogue: catalogue({ stale: true, building: true }) })))
    expect(t).toContain('Built from main')
    expect(t).toContain('Building…')
    expect(t).not.toContain('Rebuild')
  })

  it('keeps the last good catalogue over a failure, with the reason and log folded away', () => {
    const html = overview(
      mapModel({
        catalogue: catalogue({ failure: { reason: 'exit 1', log: 'vite: cannot resolve ./Coupon', at: 1 } }),
      }),
    )
    const t = text(html)
    expect(t).toContain('Built from main · 2h ago')
    expect(t).toContain('The latest build of main failed')
    expect(t).toContain('Rebuild')
    expect(html).toMatch(/<details data-disclosure=""(?! open)/)
    expect(t).toContain('exit 1')
    expect(t).toContain('vite: cannot resolve ./Coupon')
  })

  it('puts the failure in the line’s place when there is no good catalogue to keep', () => {
    const t = text(
      overview(
        mapModel({
          catalogue: { state: 'never_built', stale: false, building: false, failure: { log: 'boom', at: 1 } },
          groups: [],
        }),
      ),
    )
    expect(t).toContain('Main’s catalogue didn’t build')
    expect(t).toContain('Rebuild')
    expect(t).not.toContain('Built from main')
    expect(t).not.toContain('Build the catalogue')
  })

  it('offers Build the catalogue when stories are set up but main was never built', () => {
    const t = text(
      overview(mapModel({ catalogue: { state: 'never_built', stale: false, building: false } })),
    )
    expect(t).toContain('main’s catalogue hasn’t been built')
    expect(t).toContain('Build the catalogue')
  })

  it('says UI states aren’t set up, with Set up stories, on a map of scenarios alone', () => {
    const scenariosOnly = mapModel().groups.map((g) => ({ ...g, pages: [] }))
    const t = text(
      overview({
        storiesSetUp: false,
        catalogue: { state: 'not_set_up', stale: false, building: false },
        groups: scenariosOnly,
      }),
    )
    expect(t).toContain('UI states aren’t set up · Set up stories')
    expect(t).toContain('Auth2 ways in · 1 call')
    expect(t).not.toContain('Built from main')
    expect(t).not.toContain('Build the catalogue')
  })

  it('says there are no ways in yet, with New scenario, on a map of stories alone', () => {
    const storiesOnly = mapModel().groups.map((g) => ({ ...g, scenarios: [] }))
    const t = text(overview(mapModel({ groups: storiesOnly })))
    expect(t).toContain('No ways in yet · New scenario')
    expect(t).toContain('Auth3 UI states')
  })

  it('is one empty state with both doors when there are neither stories nor scenarios', () => {
    const t = text(
      overview({ storiesSetUp: false, catalogue: { state: 'not_set_up', stale: false, building: false }, groups: [] }),
    )
    expect(t).toContain('The map is built from your stories and scenarios')
    expect(t).toContain('Set up stories')
    expect(t).toContain('New scenario')
    expect(t).not.toContain('Overview')
  })
})

describe('a group page', () => {
  const headings = (html: string): string[] =>
    [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1] ?? '')

  it('shows UI states, Ways in and Calls in that order', () => {
    const html = groupPage(mapModel())
    expect(headings(html)).toEqual(['UI states', 'Ways in', 'Calls'])
    const t = text(html)
    expect(t).toContain('Built from main · 2h ago · commit a41c09e')
    expect(t).toContain('POST /api/cart/coupon')
    expect(t).toContain('beside “Cart with coupon”')
  })

  it('leaves out every section the group has nothing of', () => {
    const waysInOnly = couponsGroup({
      pages: [],
      scenarios: couponsGroup().scenarios.slice(1),
    })
    expect(headings(groupPage(mapModel(), waysInOnly))).toEqual(['Ways in'])
  })

  it('says compactly that the catalogue failed, in UI states, when there is no good one', () => {
    const model = mapModel({
      catalogue: { state: 'never_built', stale: false, building: false, failure: { log: 'boom', at: 1 } },
    })
    const html = groupPage(model, couponsGroup({ pages: [] }))
    expect(headings(html)).toEqual(['UI states', 'Ways in', 'Calls'])
    expect(text(html)).toContain('Main’s catalogue didn’t build')
  })

  it('never nags about stories that are not set up', () => {
    const model = mapModel({ storiesSetUp: false, catalogue: { state: 'not_set_up', stale: false, building: false } })
    const html = groupPage(model, couponsGroup({ pages: [] }))
    expect(headings(html)).toEqual(['Ways in', 'Calls'])
    expect(text(html)).not.toContain('set up')
  })

  it('shows a component’s latest change inline, the earlier ones folded, and no changed or new marks', () => {
    const html = groupPage(mapModel())
    const t = text(html)
    expect(t).toContain('CouponFieldChanged by Coupons, Oct 12')
    expect(t).toContain('3 earlier')
    expect(t).toContain('CouponBadgeChanged on main, “fix badge spacing”, Sep 30')
    expect(t).not.toMatch(/>(Changed|New)</)
    expect(t).not.toContain('Before')
  })

  it('holds every frame as a placeholder until it scrolls into view', () => {
    const html = groupPage(mapModel())
    expect(html).not.toContain('<iframe')
    expect(html.match(/data-frame-placeholder/g)).toHaveLength(5)
  })
})
