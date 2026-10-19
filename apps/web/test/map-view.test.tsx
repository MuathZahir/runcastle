// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapModel } from '@runcastle/core'
import { MAP_FRAME, couponsGroup, mapModel } from './fixtures'

/**
 * The map in the content panel (the-map-of-stories-and-scenarios), tier 2:
 * what a click does — opening a group, the build mutation, the empty map's
 * doors, the drive intents, a feature credit — and the frames that mount only
 * once they scroll into view. The server is the boundary: `project.map`
 * answers the model the test says, and the build mutation is recorded.
 */

let model: MapModel | undefined
const buildMutate = vi.fn()

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ project: { map: { invalidate: vi.fn() } } }),
    project: {
      map: { useQuery: () => ({ data: model }) },
      buildMapCatalogue: {
        useMutation: () => ({ mutate: (input: unknown) => buildMutate(input), isPending: false }),
      },
    },
  },
}))
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))

const { MapView } = await import('../src/components/map/MapView')

/** IntersectionObserver as the test drives it: `scrollIntoView()` reports every observed frame visible. */
const observed = new Set<{ cb: IntersectionObserverCallback; el: Element[] }>()
class StubObserver {
  private entry: { cb: IntersectionObserverCallback; el: Element[] }
  constructor(cb: IntersectionObserverCallback) {
    this.entry = { cb, el: [] }
    observed.add(this.entry)
  }
  observe(el: Element) {
    this.entry.el.push(el)
  }
  disconnect() {
    observed.delete(this.entry)
  }
}
function scrollIntoView(): void {
  act(() => {
    for (const { cb, el } of [...observed]) {
      cb(
        el.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
        {} as IntersectionObserver,
      )
    }
  })
}

const handlers = () => ({
  onOpenGroup: vi.fn(),
  onOpenDrive: vi.fn(),
  onOpenFeature: vi.fn(),
  onOpenPreparation: vi.fn(),
  onNewScenario: vi.fn(),
})

function mount(group: string | null, h = handlers()) {
  render(<MapView projectId="proj_1" group={group} {...h} />)
  return h
}

beforeEach(() => {
  model = mapModel()
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = StubObserver
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  observed.clear()
})

describe('the overview', () => {
  it('opens a group from its row', () => {
    const h = mount(null)
    fireEvent.click(screen.getByText('Coupons'))
    expect(h.onOpenGroup).toHaveBeenCalledWith('checkout/coupons')
  })

  it('never starts a build on its own', () => {
    model = mapModel({ catalogue: { state: 'never_built', stale: false, building: false } })
    mount(null)
    expect(buildMutate).not.toHaveBeenCalled()
  })

  it('builds main’s catalogue from Build the catalogue', () => {
    model = mapModel({ catalogue: { state: 'never_built', stale: false, building: false } })
    mount(null)
    fireEvent.click(screen.getByRole('button', { name: 'Build the catalogue' }))
    expect(buildMutate).toHaveBeenCalledWith({ projectId: 'proj_1' })
  })

  it('rebuilds a catalogue main has moved past', () => {
    model = mapModel({ catalogue: { ...mapModel().catalogue, stale: true } })
    mount(null)
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }))
    expect(buildMutate).toHaveBeenCalledWith({ projectId: 'proj_1' })
  })

  it('opens preparation from Set up stories', () => {
    model = {
      storiesSetUp: false,
      catalogue: { state: 'not_set_up', stale: false, building: false },
      groups: [couponsGroup({ pages: [] })],
    }
    const h = mount(null)
    fireEvent.click(screen.getByRole('button', { name: 'Set up stories' }))
    expect(h.onOpenPreparation).toHaveBeenCalledTimes(1)
  })

  it('opens the scenario chat from New scenario', () => {
    model = mapModel({ groups: [couponsGroup({ scenarios: [] })] })
    const h = mount(null)
    fireEvent.click(screen.getByRole('button', { name: 'New scenario' }))
    expect(h.onNewScenario).toHaveBeenCalledTimes(1)
  })

  it('offers both doors on a map with neither stories nor scenarios', () => {
    model = { storiesSetUp: false, catalogue: { state: 'not_set_up', stale: false, building: false }, groups: [] }
    const h = mount(null)
    fireEvent.click(screen.getByRole('button', { name: 'Set up stories' }))
    fireEvent.click(screen.getByRole('button', { name: 'New scenario' }))
    expect(h.onOpenPreparation).toHaveBeenCalledTimes(1)
    expect(h.onNewScenario).toHaveBeenCalledTimes(1)
  })
})

describe('a group page', () => {
  it('crumbs back to the map and to its parent group', () => {
    const h = mount('checkout/coupons')
    expect(screen.getByRole('heading', { level: 1, name: 'Coupons' })).toBeTruthy()
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    fireEvent.click(within(crumbs).getByText('Checkout'))
    expect(h.onOpenGroup).toHaveBeenCalledWith('checkout')
    fireEvent.click(within(crumbs).getByText('Map'))
    expect(h.onOpenGroup).toHaveBeenCalledWith(null)
  })

  it('says an unknown group is not on the map, with a way back to the overview', () => {
    const h = mount('billing')
    expect(screen.getByText('This group isn’t on the map')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the overview' }))
    expect(h.onOpenGroup).toHaveBeenCalledWith(null)
  })

  it('mounts no frame until it scrolls into view, then one per state', () => {
    mount('checkout/coupons')
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(document.querySelectorAll('[data-frame-placeholder]')).toHaveLength(5)
    scrollIntoView()
    const frames = [...document.querySelectorAll('iframe')].map((f) => f.getAttribute('src'))
    expect(frames).toEqual([
      `${MAP_FRAME}coupon-badge--default`,
      `${MAP_FRAME}coupon-badge--stacked`,
      `${MAP_FRAME}coupon-field--empty`,
      `${MAP_FRAME}coupon-field--applied`,
      `${MAP_FRAME}coupon-field--expired`,
    ])
  })

  it('opens one state larger', () => {
    mount('checkout/coupons')
    fireEvent.click(screen.getAllByRole('button', { name: 'Open larger' })[3] as HTMLElement)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('CouponField · Applied')).toBeTruthy()
    expect(dialog.querySelector('iframe')?.getAttribute('src')).toBe(`${MAP_FRAME}coupon-field--applied`)
  })

  it('folds the earlier changes behind a disclosure that opens', () => {
    mount('checkout/coupons')
    const details = screen.getByText('3 earlier').closest('details')
    if (!details) throw new Error('no disclosure')
    expect(details.open).toBe(false)
    fireEvent.click(screen.getByText('3 earlier'))
    expect(details.open).toBe(true)
    expect(details.textContent).toContain('Changed on main, “rename coupon prop”, Aug 20')
    expect(details.textContent).toContain('Changed by Cart, Jul 1')
  })

  it('opens the feature a change is credited to', () => {
    const h = mount('checkout/coupons')
    fireEvent.click(screen.getAllByRole('button', { name: 'Coupons' })[0] as HTMLElement)
    expect(h.onOpenFeature).toHaveBeenCalledWith('feat_coupons')
  })

  it('opens a way in on the drive’s App side', () => {
    const h = mount('checkout/coupons')
    const waysIn = screen.getByLabelText('Ways in')
    fireEvent.click(within(waysIn).getAllByRole('button', { name: 'Open in drive' })[1] as HTMLElement)
    expect(h.onOpenDrive).toHaveBeenCalledWith({
      scenario: '.runcastle/scenarios/checkout/coupons/expired-coupon.ts',
      side: 'app',
    })
  })

  it('tries a call on the drive’s API side, with that call', () => {
    const h = mount('checkout/coupons')
    fireEvent.click(screen.getByRole('button', { name: 'Try it' }))
    expect(h.onOpenDrive).toHaveBeenCalledWith({
      scenario: '.runcastle/scenarios/checkout/coupons/cart-with-coupon.ts',
      side: 'api',
      call: '.runcastle/scenarios/checkout/coupons/cart-with-coupon.http',
    })
  })
})
