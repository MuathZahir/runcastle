import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Phase } from '@runcastle/core'
import {
  Button,
  CheckLine,
  DimLine,
  EmptyState,
  FindingSeverityChip,
  NoteAuthorChip,
  PhaseTag,
  RunStatusChip,
  SectionTitle,
  SessionStatusDot,
  Spinner,
  TicketKindChip,
  TicketStatusChip,
} from '../src/ui'

/**
 * The primitives are styled with Tailwind utilities written inline in the TSX
 * (apps/web/STYLE.md, decision 5), so the class list a primitive emits IS its
 * look — a tier-1 static-markup test is the right instrument for it. These
 * assert the theme-driven utilities rather than the `styles.css` names the
 * primitives used to carry: those rules are gone, and a test that still named
 * them would pass over markup that renders unstyled.
 */
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

describe('Button', () => {
  const render = (props: Record<string, unknown>) =>
    html(createElement(Button, props, 'Ship it'))

  it('renders its children on the theme control height and radius', () => {
    const out = render({})
    expect(out).toContain('Ship it')
    expect(out).toContain('h-(--control-h)')
    expect(out).toContain('rounded-md')
  })

  it('is ghost by default and the three variants are distinct', () => {
    const ghost = render({})
    const solid = render({ variant: 'solid' })
    const danger = render({ variant: 'danger' })

    expect(render({ variant: 'ghost' })).toBe(ghost)
    expect(ghost).toContain('bg-transparent')
    expect(solid).toContain('bg-accent')
    expect(solid).toContain('text-accent-ink')
    expect(danger).toContain('text-danger')
    expect(new Set([ghost, solid, danger]).size).toBe(3)
  })

  // No preflight (STYLE.md), so a variant that names only a border and a colour
  // renders on the user agent's `buttonface` — white, under near-white text.
  // The background has to be unconditional: an `enabled:hover:bg-*` is exactly
  // what `danger` had while it rendered white at rest and disabled.
  it('states a resting background on every variant, enabled and disabled', () => {
    const restingBg = /(?:^|[\s"])bg-/
    for (const variant of ['ghost', 'solid', 'danger'] as const) {
      expect(render({ variant })).toMatch(restingBg)
      expect(render({ variant, disabled: true })).toMatch(restingBg)
    }
  })

  it('keeps a caller`s className and forwards button attributes', () => {
    const out = render({ className: 'self-start', disabled: true, type: 'submit' })
    expect(out).toContain('self-start')
    expect(out).toContain('disabled=""')
    expect(out).toContain('type="submit"')
  })

  // `xs` is the row-height button the surfaces used to reach for as `btn-xs`.
  it('sizes to the control height by default and shrinks on `xs`', () => {
    expect(render({})).toContain('h-(--control-h)')
    const xs = render({ size: 'xs' })
    expect(xs).not.toContain('h-(--control-h)')
    expect(xs).toContain('h-5.5')
  })
})

describe('Spinner', () => {
  it('spins, states no text of its own, and is hidden from assistive tech', () => {
    const out = html(createElement(Spinner))
    expect(out).toContain('animate-spin')
    expect(out).toContain('aria-hidden="true"')
    expect(out).toContain('border-ph-implementation')
  })

  it('takes the accent tone and the in-a-chip size', () => {
    const out = html(createElement(Spinner, { size: 'sm', tone: 'accent' }))
    expect(out).toContain('border-accent')
    expect(out).toContain('size-2.5')
  })
})

describe('SectionTitle and DimLine', () => {
  it('renders the section title as an 11px tracked micro-label', () => {
    const out = html(createElement(SectionTitle, null, 'Tickets'))
    expect(out).toContain('Tickets')
    expect(out).toContain('text-xs')
    expect(out).toContain('uppercase')
  })

  it('renders a dim mono line', () => {
    const out = html(createElement(DimLine, null, 'no waypoints yet'))
    expect(out).toContain('no waypoints yet')
    expect(out).toContain('font-mono')
    expect(out).toContain('text-text-3')
  })
})

describe('EmptyState', () => {
  const render = (props: Record<string, unknown>) =>
    html(createElement(EmptyState, { title: 'Nothing here', ...props }))

  it('renders the title alone when that is all it is given', () => {
    const out = render({})
    expect(out).toContain('Nothing here')
    expect(out).not.toContain('mt-2')
  })

  it('renders the icon chip, hint and action when given them', () => {
    const out = render({
      icon: createElement('span', null, '★'),
      hint: 'they appear as the map takes shape',
      action: createElement('span', null, 'Start'),
    })
    expect(out).toContain('★')
    expect(out).toContain('they appear as the map takes shape')
    expect(out).toContain('Start')
  })

  it('pads a compact empty state less than a full one', () => {
    expect(render({ compact: true })).toContain('py-6')
    expect(render({})).toContain('py-11')
  })
})

describe('CheckLine', () => {
  it('paints the dot from the row`s tone and shows key and value', () => {
    const out = html(createElement(CheckLine, { row: { key: 'tickets', value: '4/4', tone: 'ok' } }))
    expect(out).toContain('tickets')
    expect(out).toContain('4/4')
    expect(out).toContain('bg-ok')
  })

  /** Findings F23: absence is grey, never green. */
  it('paints an idle figure grey', () => {
    const out = html(
      createElement(CheckLine, { row: { key: 'test drive', value: 'not taken', tone: 'idle' } }),
    )
    expect(out).toContain('bg-text-3')
    expect(out).not.toContain('bg-ok')
  })
})

describe('PhaseTag', () => {
  it('colours each phase from its own token', () => {
    const phases: Phase[] = ['ideation', 'spec', 'tickets', 'implementation', 'review', 'shipped']
    for (const phase of phases) {
      const out = html(createElement(PhaseTag, { phase }))
      expect(out).toContain(phase)
      expect(out).toContain(`text-ph-${phase}`)
    }
  })
})

describe('chips', () => {
  it('renders a ticket status chip per status, distinctly', () => {
    const pending = html(createElement(TicketStatusChip, { status: 'pending' }))
    const done = html(createElement(TicketStatusChip, { status: 'done' }))
    expect(pending).toContain('pending')
    expect(done).toContain('text-ok')
    expect(pending).not.toBe(done)
  })

  it('breathes while a ticket is burning', () => {
    const out = html(createElement(TicketStatusChip, { status: 'burning' }))
    expect(out).toContain('animate-[pulse_1.5s_ease-in-out_infinite]')
  })

  it('renders a run status chip', () => {
    expect(html(createElement(RunStatusChip, { status: 'succeeded' }))).toContain('text-ok')
    expect(html(createElement(RunStatusChip, { status: 'failed' }))).toContain('text-danger')
  })

  /** Severity is read, never enforced — even `high` is amber, not red. */
  it('renders every finding severity, high in the warning colour', () => {
    expect(html(createElement(FindingSeverityChip, { severity: 'high' }))).toContain('text-warn')
    expect(html(createElement(FindingSeverityChip, { severity: 'medium' }))).toContain('medium')
    expect(html(createElement(FindingSeverityChip, { severity: 'low' }))).toContain('low')
  })

  it('badges a review ticket and stays silent about an implementation one', () => {
    expect(html(createElement(TicketKindChip, { kind: 'review' }))).toContain('text-ph-review')
    expect(html(createElement(TicketKindChip, { kind: 'implementation' }))).toBe('')
  })

  it('badges the agent`s note and stays silent about the human`s', () => {
    expect(html(createElement(NoteAuthorChip, { author: 'agent' }))).toContain('text-ph-review')
    expect(html(createElement(NoteAuthorChip, { author: 'human' }))).toBe('')
  })
})

describe('SessionStatusDot', () => {
  it('paints and titles each session status', () => {
    expect(html(createElement(SessionStatusDot, { status: 'launching' }))).toContain(
      'title="launching"',
    )
    expect(html(createElement(SessionStatusDot, { status: 'live' }))).toContain('bg-ok')
    expect(html(createElement(SessionStatusDot, { status: 'ended' }))).toContain('bg-text-3')
  })
})
