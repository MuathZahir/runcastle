import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FeatureFull } from '../src/lib/api'
import type { NextStep } from '../src/lib/feature-ui'
import { DraftBody } from '../src/components/bodies/DraftBody'
import { NextStepBar } from '../src/components/workspace/NextStepBar'

function draft(brief: string | null): FeatureFull {
  return {
    feature: {
      id: 'draft-1',
      title: 'Slack alerts',
      oneLiner: 'Tell the team when a burn fails.',
      brief,
    },
  } as unknown as FeatureFull
}

describe('draft creation surfaces', () => {
  it('shows the parked idea and renders its notes as Markdown', () => {
    const html = renderToStaticMarkup(
      createElement(DraftBody, { full: draft('## Scope\n\n**Builds** only.') }),
    )

    // The title and "parked" are the page header's now (said once); the body
    // is the one-liner and the notes.
    expect(html).not.toContain('PARKED')
    expect(html).toContain('Tell the team when a burn fails.')
    expect(html).toContain('>Notes</h2>')
    expect(html).toContain('>Scope</h2>')
    expect(html).toContain('>Builds</strong> only.')
    expect(html).not.toContain('Advanced')
  })

  it('names the empty notes state', () => {
    const html = renderToStaticMarkup(createElement(DraftBody, { full: draft('') }))

    expect(html).toContain('No notes.')
  })

  it('puts a warning branch picker beside a disabled Start when no base is usable', () => {
    const ns: NextStep = {
      kick: 'NEXT STEP',
      title: 'Start this feature',
      desc: 'Cuts the branch, commits the brief, opens the grill session.',
      primary: { label: 'Start', kind: 'startDraft', disabled: 'pick a branch first' },
      secondary: [],
      busy: false,
    }
    const html = renderToStaticMarkup(
      createElement(NextStepBar, {
        ns,
        guidance: true,
        busy: false,
        onAction: () => undefined,
        draftBranch: {
          branches: ['main', 'release'],
          value: null,
          missing: true,
          onPick: () => undefined,
        },
      }),
    )

    expect(html).toContain('from …')
    // The picker and the caption beneath the dead Start both say it in warning.
    expect(html).toContain('border-transparent text-warning')
    expect(html).toContain('title="pick a branch first"')
    expect(html).toMatch(/text-warning"><span>pick a branch first<\/span>/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-variant="primary"[^>]*>.*Start<\/button>/)
  })

  it('renders one dim note and action hints without legacy next-step classes', () => {
    const ns: NextStep = {
      kick: 'NEXT STEP',
      title: 'Review the tickets, then burn',
      desc: 'Three tickets for this lap.',
      note: 'Still unspecified: keyboard behavior',
      primary: { label: 'Burn 3 tickets', kind: 'burn' },
      secondary: [{ label: 'Chat', kind: 'chat', hint: 'Open the chat to change the tickets before burning' }],
      busy: false,
    }
    const html = renderToStaticMarkup(createElement(NextStepBar, { ns, guidance: true, busy: false, onAction: () => undefined }))

    expect(html).toContain('role="note"')
    expect(html).toContain('Still unspecified: keyboard behavior')
    expect(html).toContain('title="Open the chat to change the tickets before burning"')
    expect(html).not.toMatch(/class="[^"]*nextstep/)
  })
})
