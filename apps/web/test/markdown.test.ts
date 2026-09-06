import { describe, expect, it } from 'vitest'
import { MARKDOWN_CLASSES, MARKDOWN_POLICY } from '../src/components/Markdown'

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

/**
 * The `.md` rules in `styles.css` are gone and these class lists replaced them
 * (STYLE.md, migration rule), so the same argument applies to them: what is ours
 * is the styling decision, and it is pinned here rather than rendered.
 */
describe('MARKDOWN_CLASSES', () => {
  it('states its own face and white-space, so a pre-wrap container cannot change it', () => {
    expect(MARKDOWN_CLASSES.root).toContain('font-sans')
    expect(MARKDOWN_CLASSES.root).toContain('whitespace-normal')
  })

  it('closes the gap above the first block and below the last', () => {
    expect(MARKDOWN_CLASSES.root).toContain('[&>*:first-child]:mt-0')
    expect(MARKDOWN_CLASSES.root).toContain('[&>*:last-child]:mb-0')
  })

  it('gives a task list no marker where an ordinary list keeps one', () => {
    expect(MARKDOWN_CLASSES.taskList).toContain('list-none')
    expect(MARKDOWN_CLASSES.list).not.toContain('list-none')
  })

  it('resets the inline code chrome inside a fenced block', () => {
    expect(MARKDOWN_CLASSES.code).toContain('bg-panel-inset')
    expect(MARKDOWN_CLASSES.pre).toContain('[&>code]:bg-transparent')
    expect(MARKDOWN_CLASSES.pre).toContain('[&>code]:border-0')
  })
})
