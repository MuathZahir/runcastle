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
  it('renders recovery states as persistent alerts', () => {
    expect(bar({ alert: true, kick: 'INTERRUPTED' })).toContain('role="alert"')
  })

  it('states the count with guidance off — the primary’s reason is never hidden', () => {
    const html = bar({ counts: openWork })
    expect(html).toContain('2 defects')
    expect(html).toContain('1 note')
    expect(html).toContain('open')
  })

  it('gives the defects the danger tone and the notes the neutral one', () => {
    const html = bar({ counts: openWork })
    expect(html).toContain('bg-danger')
    expect(html).toContain('bg-icon')
  })

  it('renders the all-clear as one green pill that says it itself', () => {
    const html = bar({ counts: { pills: [{ label: 'Nothing open', tone: 'clear' }] } })
    expect(html).toContain('Nothing open')
    expect(html).toContain('bg-success')
  })

  // A bar with no title is the open-work state (decision 3): the count line is
  // the whole of what it has to say, and an empty heading must not stand in for it.
  it('leaves out the title and the paragraph when the resolver sends neither', () => {
    const html = bar({ counts: openWork }, true)
    expect(html).not.toContain('font-medium text-text')
    expect(html).not.toContain('<p class="m-0 text-pretty">')
  })

  it('renders nothing when there is nothing to do and nothing happening', () => {
    expect(bar({ primary: undefined, secondary: [{ label: 'Chat', kind: 'chat' }], title: 'Shipped to main' })).toContain('Chat')
    expect(
      renderToStaticMarkup(
        createElement(NextStepBar, {
          ns: { kick: 'SHIPPED', title: 'Shipped to main', secondary: [{ label: 'Chat', kind: 'chat' }], busy: false },
          guidance: true,
          busy: false,
          hideChat: true,
          onAction: () => undefined,
        }),
      ),
    ).toBe('')
  })

  it('keeps two secondaries beside the primary and the rest behind More', () => {
    const html = bar({
      primary: { label: 'Resolve the merge conflict', kind: 'resolveConflict' },
      secondary: [
        { label: 'Merge & ship', kind: 'merge' },
        { label: 'Start test drive', kind: 'testDriveStart' },
        { label: 'Iterate', kind: 'endSessionAndIterate' },
      ],
    })
    expect(html).toContain('Merge &amp; ship')
    expect(html).toContain('Start test drive')
    expect(html).toContain('aria-label="More actions"')
    // The overflow item is in the closed menu, not on the row.
    expect(html).not.toContain('>Iterate</button>')
  })

  it('still gates the explanatory paragraph on guidance where one exists', () => {
    const ns = { title: 'Resolve the merge conflict', desc: 'Merging main in hit conflicts.' }
    expect(bar(ns, true)).toContain('Merging main in hit conflicts.')
    expect(bar(ns, false)).not.toContain('Merging main in hit conflicts.')
  })
})
