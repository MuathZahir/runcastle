import { describe, expect, it } from 'vitest'
import { isChatLinkHref, parseChatLink } from '../src/lib/chat-links'
import { markdownUrlTransform } from '../src/components/Markdown'

describe('parseChatLink', () => {
  it('reads a feature, and its Plan or Design tab', () => {
    expect(parseChatLink('feature:faster-cheaper-reviews')).toEqual({ kind: 'feature', slug: 'faster-cheaper-reviews' })
    expect(parseChatLink('feature:faster-cheaper-reviews/plan')).toEqual({
      kind: 'feature',
      slug: 'faster-cheaper-reviews',
      view: 'plan',
    })
    expect(parseChatLink('feature:faster-cheaper-reviews/design')).toEqual({
      kind: 'feature',
      slug: 'faster-cheaper-reviews',
      view: 'design',
    })
  })

  it('reads a worker', () => {
    expect(parseChatLink('worker:sess_vM8lStLBcKpg')).toEqual({ kind: 'worker', id: 'sess_vM8lStLBcKpg' })
  })

  it.each([
    'feature:',
    'feature:/plan',
    'feature:x/',
    'feature:x/drive',
    'feature:x/plan/more',
    'feature:a b',
    'feature:%E0',
    'worker:',
    'worker:a/b',
    'Feature:x',
    'https://example.com',
    '/p/x/f/y',
    'mailto:a@b.c',
  ])('is null for %s', (href) => {
    expect(parseChatLink(href)).toBeNull()
  })

  it('claims only its own schemes, well-formed or not', () => {
    expect(isChatLinkHref('feature:')).toBe(true)
    expect(isChatLinkHref('worker:x')).toBe(true)
    expect(isChatLinkHref('https://feature:x')).toBe(false)
  })
})

describe('markdownUrlTransform', () => {
  it('keeps our targets and leaves every other URL to the library default', () => {
    expect(markdownUrlTransform('feature:x/plan')).toBe('feature:x/plan')
    expect(markdownUrlTransform('worker:w1')).toBe('worker:w1')
    expect(markdownUrlTransform('https://example.com/a')).toBe('https://example.com/a')
    expect(markdownUrlTransform('docs/a.md')).toBe('docs/a.md')
    expect(markdownUrlTransform('javascript:alert(1)')).toBe('')
  })
})
