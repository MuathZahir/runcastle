import { describe, expect, it } from 'vitest'
import { MARKDOWN_POLICY } from '../src/components/Markdown'

/**
 * The shared <Markdown> component has no DOM to assert against — this repo has
 * no DOM test environment and its rendering is upstream's. What is ours is the
 * *policy* we hand the renderer, so that is exported and pinned here; visual
 * correctness is checked against the committed prototype by eye.
 */
describe('MARKDOWN_POLICY', () => {
  it('enables GitHub-flavored markdown — agents write tables, task lists, strikethrough', () => {
    expect(MARKDOWN_POLICY.gfm).toBe(true)
  })

  it('leaves raw HTML passthrough off', () => {
    expect(MARKDOWN_POLICY.rawHtml).toBe(false)
  })

  it('ships no syntax highlighter — a styled <pre><code> in the mono face is enough', () => {
    expect(MARKDOWN_POLICY.syntaxHighlighting).toBe(false)
  })
})
