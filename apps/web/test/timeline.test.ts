import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Timeline, TimelineNode } from '../src/ui'

/**
 * The timeline primitive: nodes in order on one connector, a small ring for an
 * ordinary step and a toned milestone disc for the steps a story turns on —
 * drawn from theme tokens only.
 */
describe('Timeline', () => {
  const html = renderToStaticMarkup(
    createElement(Timeline, {
      label: 'Lap 1',
      className: 'ml-6',
      children: [
        createElement(TimelineNode, { key: 1, title: 'Burned 1 ticket', children: createElement('p', null, '#1 work') }),
        createElement(TimelineNode, {
          key: 2,
          variant: 'milestone',
          tone: 'success',
          icon: createElement('svg'),
          title: 'Review #2',
          meta: 'gates mode',
          aside: createElement('button', null, 'Recording'),
        }),
      ],
    }),
  )

  it('is an ordered list the caller names and places', () => {
    expect(html).toMatch(/^<ol aria-label="Lap 1" class="[^"]* ml-6"/)
    expect(html.match(/<li/g)).toHaveLength(2)
  })

  it('draws its connector in border-strong', () => {
    expect(html).toContain('before:bg-border-strong')
  })

  it('keeps the nodes in the order given, with their bodies and asides', () => {
    expect(html.indexOf('Burned 1 ticket')).toBeLessThan(html.indexOf('#1 work'))
    expect(html.indexOf('#1 work')).toBeLessThan(html.indexOf('Review #2'))
    expect(html.indexOf('Review #2')).toBeLessThan(html.indexOf('gates mode'))
    expect(html).toContain('<button>Recording</button>')
  })

  it('marks an ordinary step with a small ring', () => {
    expect(html).toContain('data-node="ring"')
    expect(html).toContain('size-[9px] rounded-full border-[1.5px] border-border-strong')
  })

  it('fills a milestone disc with a tint of its tone', () => {
    expect(html).toContain('data-node="milestone"')
    expect(html).toContain('text-success bg-[color-mix(in_srgb,var(--color-success)_16%,var(--color-surface))]')
  })

  it('tones each milestone by what it says', () => {
    for (const tone of ['warning', 'danger'] as const) {
      const one = renderToStaticMarkup(createElement(TimelineNode, { variant: 'milestone', tone, title: 'x' }))
      expect(one).toContain(`text-${tone} bg-[color-mix(in_srgb,var(--color-${tone})_16%`)
    }
  })

  it('uses no raw colour', () => {
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgba?\(/i)
  })
})
