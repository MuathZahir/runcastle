import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { RunTimeline } from '../src/components/run/RunTimeline'

/**
 * The run's coarse record, and the one thing it has to do besides record:
 * surface a warning.
 *
 * The docs-digest warning was appended to the end of an already-long message,
 * on a row clipped to a single line, inside a panel that starts collapsed — so
 * the burn's one "every ticket is paying for this" sentence reached nobody.
 * Rendered to static markup like the lanes' tests: the panel takes everything
 * it shows as a prop, so its whole behaviour is the markup it emits.
 */
describe('RunTimeline', () => {
  const event = (over: Partial<EventRow> & { id: number }): EventRow => ({
    projectId: 'proj_1',
    ts: 1_760_000_000_000,
    type: 'burn.docs.digest',
    message: 'docs digest: 2400 bytes to every ticket (brief.md, spec.md)',
    ...over,
  })

  const oversized = event({
    id: 2,
    message:
      'docs digest: 97000 bytes to every ticket (brief.md, spec.md) — the docs digest is ' +
      '97000 bytes, over the 40000-byte budget, and every ticket in this burn pays it — trim ' +
      'the feature docs, or move what only a ticket needs into that ticket.',
    data: { bytes: 97_000, oversized: true },
  })

  const html = (events: EventRow[]): string =>
    renderToStaticMarkup(createElement(RunTimeline, { events }))

  /** The classes on the `<span>` holding one row's message. */
  const messageClass = (markup: string, message: string): string => {
    const at = markup.indexOf(message)
    const opened = markup.lastIndexOf('<span class="', at)
    return markup.slice(opened + 13, markup.indexOf('"', opened + 13))
  }

  it('clips an ordinary row to one line, and stays shut over it', () => {
    const markup = html([event({ id: 1 })])
    expect(messageClass(markup, 'docs digest: 2400 bytes')).toContain('truncate')
    expect(markup).not.toContain('open=""')
  })

  it('wraps the row carrying a warning instead of clipping it', () => {
    const markup = html([event({ id: 1 }), oversized])
    const warned = messageClass(markup, 'docs digest: 97000 bytes')
    expect(warned).not.toContain('truncate')
    expect(warned).toContain('break-words')
    expect(warned).toContain('text-warning')
    // The row beside it is untouched — only the warning costs the density.
    expect(messageClass(markup, 'docs digest: 2400 bytes')).toContain('truncate')
  })

  it('opens the panel when it holds a warning, so it is read without a click', () => {
    expect(html([event({ id: 1 }), oversized])).toContain('open=""')
  })
})
