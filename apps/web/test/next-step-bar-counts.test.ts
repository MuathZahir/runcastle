import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NextStep } from '../src/lib/feature-ui'
import { NextStepBar } from '../src/components/workspace/NextStepBar'

/**
 * The bar's count line (decision 3). Tier 1: the line is markup the bar emits
 * from what the resolver handed it — the counts themselves are asserted at the
 * pure derivation in `feature-ui.test.ts`.
 *
 * The one thing that could only go wrong here is the gate: `desc` is guidance-
 * gated, and a count line that went through the same gate would be a primary
 * whose reason disappears with a setting.
 */
const bar = (ns: Partial<NextStep>, guidance = false): string =>
  renderToStaticMarkup(
    createElement(NextStepBar, {
      ns: {
        kick: 'NEXT STEP',
        primary: { label: 'Iterate', kind: 'iterate' as const },
        secondary: [{ label: 'Merge & ship', kind: 'merge' as const }],
        busy: false,
        ...ns,
      },
      guidance,
      busy: false,
      onAction: () => undefined,
    }),
  )

const openWork: NextStep['counts'] = {
  pills: [
    { label: '2 defects', tone: 'danger' },
    { label: '1 note', tone: 'note' },
  ],
  trailing: 'open',
}

describe('the next-step bar’s count line', () => {
  it('states the count with guidance off — the primary’s reason is never hidden', () => {
    const html = bar({ counts: openWork })
    expect(html).toContain('2 defects')
    expect(html).toContain('1 note')
    expect(html).toContain('open')
  })

  it('gives the defects the danger tone and the notes the neutral one', () => {
    const html = bar({ counts: openWork })
    expect(html).toContain('text-danger')
    expect(html).toContain('bg-text-4')
  })

  it('renders the all-clear as one green pill that says it itself', () => {
    const html = bar({ counts: { pills: [{ label: 'Nothing open', tone: 'clear' }] } })
    expect(html).toContain('Nothing open')
    expect(html).toContain('text-ok')
  })

  // A bar with no title is the open-work state (decision 3): the count line is
  // the whole of what it has to say, and an empty heading must not stand in for it.
  it('leaves out the title and the paragraph when the resolver sends neither', () => {
    const html = bar({ counts: openWork }, true)
    expect(html).not.toContain('text-lg font-semibold')
    expect(html).not.toContain('max-w-[68ch]')
  })

  it('still gates the explanatory paragraph on guidance where one exists', () => {
    const ns = { title: 'Resolve the merge conflict', desc: 'Merging main in hit conflicts.' }
    expect(bar(ns, true)).toContain('Merging main in hit conflicts.')
    expect(bar(ns, false)).not.toContain('Merging main in hit conflicts.')
  })
})
