import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { UiStatesModel } from '../src/lib/api'
import { BASE_FRAME, FEATURE_FRAME, uiStatesModel, uiStory } from './fixtures'
import { UiStatesSection } from '../src/components/review/UiStatesSection'

/**
 * The feature page's "UI states" section (decision 12), tier 1: the whole of
 * what it shows for a given section model is the markup it emits.
 */

const render = (m: UiStatesModel | null, betweenReviews = false): string =>
  renderToStaticMarkup(createElement(UiStatesSection, { model: m, betweenReviews }))

const frames = (html: string): string[] =>
  [...html.matchAll(/<iframe[^>]*src="([^"]+)"/g)].map((m) => m[1]?.replace(/&amp;/g, '&') ?? '')

describe('UiStatesSection', () => {
  it('heads the section "UI states" with the build it shows', () => {
    const html = render(uiStatesModel())
    expect(html).toContain('UI states')
    expect(html).toContain('Built at review')
    expect(html).toContain('4e1c9a0')
  })

  it('says between reviews that the build is the last review’s, never naming a lap', () => {
    const html = render(uiStatesModel({ lap: 3 }), true)
    expect(html).toContain('Built at the last review')
    expect(html).toContain('4e1c9a0')
    expect(html).not.toMatch(/lap/i)
  })

  it('shows a changed story as a Before / This feature pair', () => {
    const html = render(uiStatesModel({ new: [], affected: [] }))
    expect(html).toContain('Checkout / Coupon field')
    expect(html).toContain('Expired')
    expect(html).toContain('>Before<')
    expect(html).toContain('>This feature<')
    expect(frames(html)).toEqual([
      `${BASE_FRAME}checkout-coupon--expired&viewMode=story`,
      `${FEATURE_FRAME}checkout-coupon--expired&viewMode=story`,
    ])
    expect(html).toContain('loading="lazy"')
    expect(html).not.toContain('sandbox')
  })

  it('shows a new story alone with a New badge', () => {
    const html = render(uiStatesModel({ changed: [], affected: [] }))
    expect(html).toContain('>New<')
    expect(html).not.toContain('>Before<')
    expect(frames(html)).toEqual([`${FEATURE_FRAME}checkout-coupon--expiring&viewMode=story`])
  })

  it('counts the far matches on one collapsed line, with no frames of their own', () => {
    const html = render(uiStatesModel({ changed: [], new: [] }))
    expect(html).toContain('2 more stories use changed code')
    expect(html).toMatch(/<details data-disclosure=""(?! open)/)
    expect(html).toContain('Checkout / Coupon field · With coupon')
    expect(frames(html)).toEqual([])
  })

  it('frames a page story as a whole page, before and this feature, and its components as today', () => {
    const page = { ...uiStory('feature-review--findings-open', 'Findings open', true), page: true }
    const html = render(uiStatesModel({ changed: [page], affected: [] }))
    // The page's pair: two whole-page pictures, loading as they scroll in, opened by a click.
    expect(html.match(/data-page-frame/g)).toHaveLength(2)
    expect(html).toContain('>Before<')
    expect(html).toContain('aria-label="Open Checkout / Coupon field · Findings open, before larger"')
    // The new component story keeps its fixed-height frame and its Open larger.
    expect(frames(html)).toEqual([`${FEATURE_FRAME}checkout-coupon--expiring&viewMode=story`])
    expect(html.match(/Open larger/g)).toHaveLength(1)
  })

  it('pictures a page story among the far matches as a page, behind the collapsed line', () => {
    const page = { ...uiStory('feature-review--findings-open', 'Findings open', false), page: true }
    const html = render(uiStatesModel({ changed: [], new: [], affected: [page, uiStory('cart-drawer--discount', 'With discount', false)] }))
    expect(html).toContain('2 more stories use changed code')
    expect(html.match(/data-page-frame/g)).toHaveLength(1)
    expect(html.match(/Open larger/g)).toHaveLength(1)
    expect(frames(html)).toEqual([])
  })

  it('says once that the before versions did not build, and frames this feature only', () => {
    const html = render(
      uiStatesModel({
        base: 'failed',
        changed: [uiStory('checkout-coupon--expired', 'Expired', false)],
        new: [],
        affected: [],
      }),
    )
    expect(html).toContain('The before versions didn’t build')
    expect(html).not.toContain('>Before<')
    expect(frames(html)).toEqual([`${FEATURE_FRAME}checkout-coupon--expired&viewMode=story`])
  })

  it('shows a failed build with its commit and log, as a failed gate', () => {
    const html = render(
      uiStatesModel({
        status: 'failed',
        log: '✘ [ERROR] Could not resolve "../CouponBanner"',
        changed: [],
        new: [],
        affected: [],
      }),
    )
    expect(html).toContain('The UI states didn’t build')
    expect(html).toContain('4e1c9a0')
    expect(html).toContain('<pre')
    expect(html).toContain('Could not resolve &quot;../CouponBanner&quot;')
    expect(html).toContain('failed gate')
    expect(frames(html)).toEqual([])
  })

  it('shows why a build could not run', () => {
    const html = render(
      uiStatesModel({ status: 'couldnt_run', reason: 'The sandbox has no host path.', changed: [], new: [], affected: [] }),
    )
    expect(html).toContain('The UI states couldn’t be built')
    expect(html).toContain('The sandbox has no host path.')
  })

  it('renders nothing with no model, or a build with no stories', () => {
    expect(render(null)).toBe('')
    expect(render(uiStatesModel({ changed: [], new: [], affected: [] }))).toBe('')
  })

  it('never names the tool that builds the stories', () => {
    for (const m of [uiStatesModel(), uiStatesModel({ status: 'failed', log: 'x' }), uiStatesModel({ status: 'couldnt_run' })]) {
      const html = render(m).toLowerCase()
      expect(html).not.toContain('storybook')
      expect(html).not.toContain('catalogue')
    }
  })
})
