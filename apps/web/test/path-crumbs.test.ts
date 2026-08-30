import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PathCrumbs } from '../src/components/PathCrumbs'

/**
 * Decision 6 — the picker header is one control, and the half of it that is
 * markup is which segments it prints. Tier 1: no DOM is needed to see whether a
 * deep path collapsed. The click-to-type half is in `path-crumbs-edit.test.tsx`.
 */

const crumbs = (...names: string[]) =>
  names.map((name, i) => ({ name, path: `/${names.slice(0, i + 1).join('/')}` }))

const render = (segments: string[]) =>
  renderToStaticMarkup(
    createElement(PathCrumbs, {
      crumbs: crumbs(...segments),
      value: `/${segments.join('/')}`,
      onNavigate: () => undefined,
      onEnterPath: () => undefined,
      placeholder: '/path/to/your/repo',
    }),
  )

/** The crumb labels, in order, without the edit affordance or the separators. */
function labels(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)]
    .map((m) => m[1])
    .filter((text) => text !== '✎')
}

describe('PathCrumbs', () => {
  it('shows every segment of a shallow path', () => {
    expect(labels(render(['home', 'you', 'code']))).toEqual(['home', 'you', 'code'])
    expect(render(['home', 'you', 'code'])).not.toContain('…')
  })

  it('still shows four segments whole — the collapse starts above that', () => {
    const html = render(['home', 'you', 'code', 'repo'])
    expect(labels(html)).toEqual(['home', 'you', 'code', 'repo'])
    expect(html).not.toContain('…')
  })

  it('collapses a deep path to the root, an ellipsis and the last three', () => {
    const html = render(['home', 'you', 'code', 'org', 'repo', 'packages'])
    expect(labels(html)).toEqual(['home', 'org', 'repo', 'packages'])
    expect(html).toContain('…')
  })

  it('titles the ellipsis with the path it stands in for', () => {
    const html = render(['home', 'you', 'code', 'org', 'repo'])
    expect(html).toContain('title="/home/you/code/org/repo"')
  })

  it('clips rather than wraps, so the header cannot grow a second row', () => {
    const html = render(['home', 'you', 'code'])
    // `min-w-0` + `truncate` is what keeps a long path from pushing the Hidden
    // toggle out of the header (decision 6); legacy class names would beat both.
    expect(html).toMatch(/class="[^"]*\bmin-w-0\b[^"]*\btruncate\b/)
    expect(html).not.toMatch(/class="[^"]*\bdir-/)
  })

  it('offers a keyboard route into the field, not only a click on the strip', () => {
    expect(render(['home'])).toContain('aria-label="Edit path"')
  })

  it('paints its own background — the app ships no preflight to reset one', () => {
    // Without a background of its own a bare <button> keeps the user agent's
    // `buttonface` grey under the dark theme's near-white text: a light pill
    // with unreadable text where the header's navigation should be.
    const classes = [...render(['home', 'you', 'code']).matchAll(/<button[^>]*class="([^"]*)"/g)]
    expect(classes).toHaveLength(4) // three crumbs and the pencil
    for (const [, className] of classes) expect(className).toMatch(/\bbg-transparent\b/)
  })
})
