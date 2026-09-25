import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Phase } from '@runcastle/core'
import { PhaseIcon } from '../src/icons'
import type { PhaseIconPhase } from '../src/icons'
import {
  Aside,
  AsideLayout,
  Button,
  CheckLine,
  Checkbox,
  DimLine,
  Disclosure,
  EmptyState,
  FindingSeverityChip,
  IconButton,
  LINK,
  List,
  ListRow,
  MetaLine,
  NavItem,
  NoteAuthorChip,
  PageHeader,
  PhaseTag,
  PropertyList,
  RunStatusChip,
  SectionLabel,
  SectionTitle,
  SegmentedControl,
  SessionStatusDot,
  Spinner,
  StatusDot,
  StatusLabel,
  Switch,
  Tabs,
  TextField,
  TicketKindChip,
  TicketStatusChip,
} from '../src/ui'

/**
 * The primitives are styled with Tailwind utilities written inline in the TSX
 * (apps/web/STYLE.md), so the class list a primitive emits IS its look — a
 * tier-1 static-markup test is the right instrument. These assert the
 * design-system tokens (DESIGN.md), never the deprecated aliases.
 */
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)

/** The `class` of the first `<tag>` in the markup. */
const classOf = (out: string, tag: string) => new RegExp(`<${tag}[^>]*class="([^"]*)"`).exec(out)?.[1] ?? ''

describe('Button', () => {
  const render = (props: Record<string, unknown>, label: string | null = 'Ship it') =>
    html(createElement(Button, props, label))

  it('renders its children at the default control height and radius', () => {
    const out = render({})
    expect(out).toContain('Ship it')
    expect(out).toContain('h-(--control-h)')
    expect(out).toContain('rounded-md')
  })

  it('is secondary by default, and the four variants are distinct', () => {
    const secondary = render({})
    expect(render({ variant: 'secondary' })).toBe(secondary)
    expect(secondary).toContain('data-variant="secondary"')
    expect(secondary).toContain('border-border')

    const primary = render({ variant: 'primary' })
    expect(primary).toContain('bg-primary')
    expect(primary).toContain('text-on-primary')

    const ghost = render({ variant: 'ghost' })
    expect(ghost).toContain('border-transparent')
    expect(ghost).toContain('text-text-secondary')

    const danger = render({ variant: 'danger' })
    expect(danger).toContain('text-danger')

    expect(new Set([secondary, primary, ghost, danger]).size).toBe(4)
  })

  // Deprecated spellings keep compiling and render as their new names.
  it('maps the legacy variants and size onto the new ones', () => {
    expect(render({ variant: 'solid' })).toBe(render({ variant: 'primary' }))
    expect(render({ variant: 'accent' })).toBe(render({ variant: 'secondary' }))
    expect(render({ size: 'xs' })).toBe(render({ size: 'sm' }))
  })

  it('never fills a button with the accent', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
      expect(render({ variant })).not.toMatch(/\bbg-accent\b/)
    }
  })

  // No preflight (STYLE.md): a variant must state a resting background, or it
  // renders on the user agent's `buttonface`.
  it('states a resting background on every variant', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
      expect(classOf(render({ variant }), 'button')).toMatch(/(?:^|\s)bg-/)
    }
  })

  it('sizes sm 24 · md 28 · lg 32', () => {
    expect(render({ size: 'sm' })).toContain('h-(--control-sm)')
    expect(render({ size: 'md' })).toContain('h-(--control-h)')
    expect(render({ size: 'lg' })).toContain('h-(--control-lg)')
  })

  it('presses down a pixel rather than scaling', () => {
    expect(render({})).toContain('enabled:active:translate-y-px')
    expect(render({})).not.toContain('scale')
  })

  it('leads with an icon and trails a kbd hint', () => {
    const out = render({ icon: createElement('svg', { id: 'ic' }), kbd: 'C' })
    expect(out.indexOf('id="ic"')).toBeLessThan(out.indexOf('Ship it'))
    expect(out).toMatch(/<kbd[^>]*>C<\/kbd>/)
  })

  it('swaps the icon for a spinner while loading, and is busy and disabled', () => {
    const out = render({ icon: createElement('svg', { id: 'ic' }), loading: true })
    expect(out).not.toContain('id="ic"')
    expect(out).toContain('animate-spin')
    expect(out).toContain('aria-busy="true"')
    expect(out).toContain('disabled=""')
  })

  it('keeps its width while loading without an icon', () => {
    const out = render({ loading: true })
    // The spinner is stacked over the invisible label in one grid cell — no
    // `relative`/`absolute`, so the button's position stays the caller's.
    expect(out).toMatch(/<span class="invisible col-start-1 row-start-1[^"]*">Ship it<\/span>/)
    expect(out).toContain('animate-spin')
    expect(out).not.toMatch(/(relative|absolute)/)
  })

  it('states no position, so a caller`s className places it', () => {
    const out = render({ className: 'absolute top-3 right-3 -ml-2' })
    expect(classOf(out, 'button')).not.toMatch(/(^| )(relative|static|fixed|sticky)( |$)/)
    expect(classOf(out, 'button')).toContain('absolute top-3 right-3 -ml-2')
  })

  it('has a borderless danger for a destructive action in a row of ghosts', () => {
    const out = render({ variant: 'danger-ghost' })
    expect(out).toContain('data-variant="danger-ghost"')
    expect(out).toContain('border-transparent bg-transparent text-danger')
    expect(out).toContain('enabled:hover:bg-danger-subtle')
    expect(out).not.toContain('border-border ')
    expect(out).not.toContain('!')
  })

  it('keeps a caller`s className and forwards button attributes', () => {
    const out = render({ className: 'self-start', disabled: true, type: 'submit' })
    expect(out).toContain('self-start')
    expect(out).toContain('disabled=""')
    expect(out).toContain('type="submit"')
  })

  // HTML's missing-value default for `<button>` is `submit`.
  it('is a plain button, not the submit the browser would default it to', () => {
    expect(render({})).toContain('type="button"')
  })
})

describe('IconButton', () => {
  const render = (props: Record<string, unknown>) =>
    html(createElement(IconButton, { label: 'Open settings', icon: createElement('svg', { id: 'ic' }), ...props }))

  it('is a square, named, ghost button around its one icon', () => {
    const out = render({})
    expect(out).toContain('aria-label="Open settings"')
    expect(out).toContain('size-(--control-h)')
    expect(out).toContain('text-icon')
    expect(out).toContain('id="ic"')
  })

  it('shows its on state as pressed', () => {
    expect(render({ active: true })).toContain('aria-pressed="true"')
    expect(render({})).not.toContain('aria-pressed="')
  })

  it('renders as a link with href, opening a new tab safely', () => {
    const out = html(createElement(IconButton, { label: 'Open app', href: 'http://x', target: '_blank', icon: 'I' }))
    expect(out).toMatch(/^<a /)
    expect(out).toContain('href="http://x"')
    expect(out).toContain('rel="noreferrer noopener"')
    expect(out).toContain('aria-label="Open app"')
    expect(out).toContain('no-underline')
  })

  it('carries a small neutral count badge, and none at zero', () => {
    const out = html(createElement(IconButton, { label: 'Notes', badge: 3, icon: 'I' }))
    expect(out).toContain('aria-label="Notes (3)"')
    expect(out).toMatch(/<span aria-hidden="true" class="[^"]*rounded-full[^"]*bg-text-tertiary[^"]*">3<\/span>/)
    // Only a badge positions the button (the badge is placed in its corner).
    expect(classOf(out, 'button')).toContain('relative')
    const none = html(createElement(IconButton, { label: 'Notes', badge: 0, icon: 'I' }))
    expect(none).toContain('aria-label="Notes"')
    expect(classOf(none, 'button')).not.toContain('relative')
    expect(html(createElement(IconButton, { label: 'N', badge: 120, icon: 'I' }))).toContain('>99+<')
  })

  it('stays quiet at rest and turns danger on hover as a danger-ghost', () => {
    const out = html(createElement(IconButton, { label: 'Delete', variant: 'danger-ghost', icon: 'I' }))
    expect(classOf(out, 'button')).toContain('text-icon')
    expect(classOf(out, 'button')).toContain('enabled:hover:text-danger')
  })

  it('sizes down inside rows', () => {
    expect(render({ size: 'sm' })).toContain('size-(--control-sm)')
  })
})

describe('Spinner', () => {
  it('spins quietly, states no text of its own, and is hidden from assistive tech', () => {
    const out = html(createElement(Spinner))
    expect(out).toContain('animate-spin')
    expect(out).toContain('aria-hidden="true"')
    expect(out).toContain('border-text-tertiary')
    expect(out).toContain('border-[1.5px]')
  })

  it('takes the smaller size', () => {
    expect(html(createElement(Spinner, { size: 'sm' }))).toContain('size-3')
  })
})

describe('PhaseIcon', () => {
  const phases: PhaseIconPhase[] = [
    'draft',
    'ideation',
    'spec',
    'planning',
    'tickets',
    'implementation',
    'building',
    'review',
    'shipped',
  ]
  const render = (phase: PhaseIconPhase, props: Record<string, unknown> = {}) =>
    html(createElement(PhaseIcon, { phase, ...props }))
  const fill = (out: string) => /stroke-dasharray:\s*(\d+)/.exec(out)?.[1]
  const opacityOf = (out: string, r: string) =>
    new RegExp(`r="${r}"[^>]*style="opacity:\\s*([01])`).exec(out)?.[1]

  it('labels itself and takes its hue from its own phase token', () => {
    for (const phase of phases) {
      const out = render(phase)
      expect(out).toContain('role="img"')
      expect(out).toMatch(/aria-label="[A-Z][a-z]+"/)
      expect(out).toContain(`text-phase-${phase}`)
    }
  })

  it('is told by shape: dashed draft, empty ideation, a filling pie, review dot, shipped check', () => {
    expect(render('draft')).toContain('stroke-dasharray="2.2 2.2"')
    expect(render('ideation')).not.toContain('stroke-dasharray="2.2 2.2"')
    expect(fill(render('ideation'))).toBe('0')
    expect(fill(render('spec'))).toBe('25')
    expect(fill(render('planning'))).toBe('25')
    expect(fill(render('tickets'))).toBe('50')
    expect(fill(render('implementation'))).toBe('75')
    expect(fill(render('building'))).toBe('75')
    expect(opacityOf(render('review'), '2.5')).toBe('1')
    expect(opacityOf(render('spec'), '2.5')).toBe('0')
    expect(opacityOf(render('shipped'), '7')).toBe('1')
    expect(render('shipped')).toMatch(/<g mask="url\(#phase-check-[^)]+\)">/)
    expect(render('review')).not.toMatch(/<g mask=/)
  })

  it('sweeps between phases rather than jumping', () => {
    expect(render('tickets')).toContain('transition:stroke-dasharray var(--dur-3)')
  })

  it('goes decorative with an empty label, and takes a size', () => {
    const out = render('review', { label: '', size: 14 })
    expect(out).toContain('aria-hidden="true"')
    expect(out).not.toContain('role="img"')
    expect(out).toContain('width="14"')
  })
})

describe('StatusDot and StatusLabel', () => {
  it('paints a 6px dot in its tone, and breathes when live', () => {
    expect(html(createElement(StatusDot, { tone: 'success' }))).toContain('bg-success')
    expect(html(createElement(StatusDot, { tone: 'warning' }))).toContain('size-1.5')
    expect(html(createElement(StatusDot, { tone: 'live' }))).toContain('animate-breathe')
    expect(html(createElement(StatusDot, {}))).toContain('bg-icon')
  })

  it('is decorative unless it is the only thing saying the state', () => {
    expect(html(createElement(StatusDot, { tone: 'danger' }))).toContain('aria-hidden="true"')
    const named = html(createElement(StatusDot, { tone: 'danger', label: 'Failed' }))
    expect(named).toContain('role="img"')
    expect(named).toContain('aria-label="Failed"')
  })

  it('is a glyph and a word — no pill, no outline, no tinted ground', () => {
    const out = html(createElement(StatusLabel, { tone: 'success', children: 'Passed' }))
    expect(out).toContain('Passed')
    expect(out).toContain('bg-success')
    expect(out).toContain('text-text-secondary')
    expect(out).not.toMatch(/\bborder\b|rounded-pill|rounded-full[^"]*px-/)
  })

  it('draws a tone-coloured icon, a phase glyph or a spinner in place of the dot', () => {
    const icon = html(createElement(StatusLabel, { tone: 'warning', icon: createElement('svg', { id: 'ic' }), children: 'High' }))
    expect(icon).toContain('text-warning')
    expect(icon).toContain('id="ic"')
    expect(html(createElement(StatusLabel, { phase: 'review', children: 'Review' }))).toContain('text-phase-review')
    expect(html(createElement(StatusLabel, { spinning: true, children: 'Burning' }))).toContain('animate-spin')
  })

  it('reads larger and stronger on request', () => {
    const out = html(createElement(StatusLabel, { size: 'sm', strong: true, children: 'Shipped' }))
    expect(out).toContain('text-sm')
    expect(out).toContain('text-text')
  })
})

describe('the former chips', () => {
  it('say ticket status in sentence case, distinctly', () => {
    const outs = (['pending', 'burning', 'done', 'failed', 'cancelled'] as const).map((status) =>
      html(createElement(TicketStatusChip, { status })),
    )
    expect(outs[0]).toContain('Pending')
    expect(outs[1]).toContain('animate-spin')
    expect(outs[2]).toContain('text-success')
    expect(outs[3]).toContain('bg-danger')
    expect(outs[4]).toContain('line-through')
    expect(new Set(outs).size).toBe(5)
    for (const out of outs) expect(out).not.toContain('rounded-pill')
  })

  it('say run status', () => {
    expect(html(createElement(RunStatusChip, { status: 'running' }))).toContain('animate-spin')
    expect(html(createElement(RunStatusChip, { status: 'succeeded' }))).toContain('text-success')
    expect(html(createElement(RunStatusChip, { status: 'failed' }))).toContain('bg-danger')
  })

  /** Severity is read, never enforced — even `high` is a warning, not danger. */
  it('say every finding severity, high as a warning', () => {
    const high = html(createElement(FindingSeverityChip, { severity: 'high' }))
    expect(high).toContain('text-warning')
    expect(high).not.toContain('danger')
    expect(html(createElement(FindingSeverityChip, { severity: 'medium' }))).toContain('Medium')
    expect(html(createElement(FindingSeverityChip, { severity: 'low' }))).toContain('Low')
  })

  it('badge a review ticket and stay silent about an implementation one', () => {
    expect(html(createElement(TicketKindChip, { kind: 'review' }))).toContain('Review')
    expect(html(createElement(TicketKindChip, { kind: 'review', passKind: 'verification' }))).toContain('Verification')
    expect(html(createElement(TicketKindChip, { kind: 'implementation' }))).toBe('')
  })

  it('badge the agent`s note and stay silent about the human`s', () => {
    expect(html(createElement(NoteAuthorChip, { author: 'agent' }))).toContain('text-accent')
    expect(html(createElement(NoteAuthorChip, { author: 'human' }))).toBe('')
  })

  it('tag a phase with its glyph and its sentence-case name', () => {
    const phases: [Phase, string][] = [
      ['planning', 'Planning'],
      ['building', 'Build'],
      ['review', 'Review'],
      ['shipped', 'Shipped'],
    ]
    for (const [phase, name] of phases) {
      const out = html(createElement(PhaseTag, { phase }))
      expect(out).toContain(`text-phase-${phase}`)
      expect(out).toContain(`>${name}</span>`)
    }
  })

  // A title, not an accessible name: the dot sits inside buttons named by
  // their own title, which it must not prefix.
  it('dot a session by its lifecycle', () => {
    const launching = html(createElement(SessionStatusDot, { status: 'launching' }))
    expect(launching).toContain('title="Starting"')
    expect(launching).toContain('bg-warning')
    expect(launching).not.toContain('aria-label')
    expect(html(createElement(SessionStatusDot, { status: 'live' }))).toContain('bg-accent')
    expect(html(createElement(SessionStatusDot, { status: 'ended' }))).toContain('bg-icon')
  })
})

describe('CheckLine', () => {
  it('paints the dot from the row`s tone and shows key and value', () => {
    const out = html(createElement(CheckLine, { row: { key: 'planning', value: '4/4', tone: 'ok' } }))
    expect(out).toContain('planning')
    expect(out).toContain('4/4')
    expect(out).toContain('bg-success')
  })

  /** Findings F23: absence is neutral, never green. */
  it('paints an idle figure neutral', () => {
    const out = html(createElement(CheckLine, { row: { key: 'test drive', value: 'not taken', tone: 'idle' } }))
    expect(out).toContain('bg-icon')
    expect(out).not.toContain('bg-success')
  })
})

describe('SectionLabel and SectionTitle', () => {
  it('is 12px medium, sentence case, tertiary — never uppercase-tracked', () => {
    const out = html(createElement(SectionLabel, { count: 104, children: 'Shipped' }))
    expect(out).toContain('Shipped')
    expect(out).toContain('104')
    expect(out).toContain('text-xs')
    expect(out).toContain('font-medium')
    expect(out).toContain('text-text-tertiary')
    expect(out).not.toContain('uppercase')
    expect(out).not.toContain('tracking')
  })

  it('puts its one action at the end', () => {
    const out = html(createElement(SectionLabel, { action: createElement('button', { id: 'act' }), children: 'Drafts' }))
    expect(out).toMatch(/ml-auto[^>]*><button id="act"/)
  })

  it('renders the old SectionTitle exactly as a SectionLabel', () => {
    const out = html(createElement(SectionTitle, null, 'Tickets'))
    expect(out).toBe(html(createElement(SectionLabel, null, 'Tickets')))
    expect(out).toContain('text-xs')
    expect(out).not.toContain('uppercase')
  })

  it('renders a quiet dim line', () => {
    const out = html(createElement(DimLine, null, 'no waypoints yet'))
    expect(out).toContain('no waypoints yet')
    expect(out).toContain('text-text-tertiary')
  })
})

describe('NavItem', () => {
  it('is a 32px row with a leading glyph, a truncated label and trailing meta', () => {
    const out = html(createElement(NavItem, { phase: 'building', label: 'Auto-continue burns', meta: '3/7', onClick: () => {} }))
    expect(out).toContain('h-(--row-h)')
    expect(out).toContain('text-phase-building')
    expect(out).toMatch(/truncate">Auto-continue burns</)
    expect(out).toContain('3/7')
    expect(out).toContain('<button')
  })

  it('marks the current page with the selected ground alone', () => {
    const out = html(createElement(NavItem, { label: 'Chats', active: true, href: '/chats' }))
    expect(out).toContain('bg-surface-selected')
    expect(out).toContain('aria-current="page"')
    expect(out).toContain('href="/chats"')
  })

  it('hides its actions until hover or focus', () => {
    const out = html(createElement(NavItem, { label: 'Row', actions: createElement('button', { id: 'more' }) }))
    expect(out).toMatch(/opacity-0[^"]*group-hover\/nav:opacity-100[^>]*><button id="more"/)
  })
})

describe('ListRow and List', () => {
  it('is a 40px row with glyph, title and meta', () => {
    const out = html(createElement(ListRow, { leading: createElement('svg'), title: 'Untitled chat', meta: '22m', onClick: () => {} }))
    expect(out).toContain('min-h-10')
    expect(out).toContain('Untitled chat')
    expect(out).toContain('22m')
    expect(out).toContain('hover:bg-surface-hover')
  })

  it('staggers only the first eight rows of an initial render', () => {
    const third = html(createElement(ListRow, { title: 'a', index: 2 }))
    expect(third).toContain('animate-rise-in')
    expect(third).toContain('--i:2')
    expect(html(createElement(ListRow, { title: 'a', index: 9 }))).not.toContain('animate-rise-in')
    expect(html(createElement(ListRow, { title: 'a' }))).not.toContain('animate-rise-in')
  })

  it('divides a long list with subtle rules', () => {
    const out = html(createElement(List, { divided: true, children: createElement(ListRow, { title: 'a' }) }))
    expect(out).toContain('border-border-subtle')
  })
})

describe('PropertyList and MetaLine', () => {
  it('lays facts out as two quiet columns', () => {
    const out = html(
      createElement(PropertyList, {
        items: [
          { label: 'Review', tone: 'success', value: 'Passed', sub: 'this build' },
          { label: 'Branch', value: 'feature/x', mono: true },
          { label: 'Status', phase: 'shipped', value: 'Shipped' },
        ],
      }),
    )
    expect(out).toMatch(/^<dl/)
    expect(out.match(/<dt/g)).toHaveLength(3)
    expect(out).toContain('text-text-tertiary')
    expect(out).toContain('bg-success')
    expect(out).toContain('this build')
    expect(out).toMatch(/font-mono[^>]*>feature\/x/)
    expect(out).toContain('text-phase-shipped')
  })

  it('writes a few facts on one line, skipping the absent ones', () => {
    const out = html(
      createElement(MetaLine, {
        items: [{ text: 'Merged 19h ago', tone: 'success' }, false, { strong: '2/2', text: 'tickets' }],
      }),
    )
    expect(out).toContain('Merged 19h ago')
    expect(out).toContain('2/2')
    expect(out).toContain('text-xs')
    expect(out.match(/inline-flex min-w-0 items-center gap-1.5/g)).toHaveLength(2)
  })
})

describe('Tabs', () => {
  const items = [
    { id: 'overview', label: 'Overview' },
    { id: 'tickets', label: 'Tickets', count: 2 },
    { id: 'activity', label: 'Activity' },
  ]
  const out = html(createElement(Tabs, { items, value: 'tickets', onChange: () => {}, label: 'Views' }))

  it('is a named ARIA tablist of tabs', () => {
    expect(out).toContain('role="tablist"')
    expect(out).toContain('aria-label="Views"')
    expect(out.match(/role="tab"/g)).toHaveLength(3)
  })

  it('selects one tab, and only it is in the Tab order', () => {
    expect(out.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(out).toMatch(/aria-selected="true" tabindex="0"[^>]*bg-surface-selected[^>]*>Tickets/)
    expect(out.match(/tabindex="-1"/g)).toHaveLength(2)
  })

  it('shows the count quietly beside its label', () => {
    expect(out).toMatch(/Tickets<span class="[^"]*text-text-tertiary[^"]*">2<\/span>/)
  })
})

describe('TextField', () => {
  it('sits on the inset ground with its icon and kbd, forwarding attributes to the input', () => {
    const out = html(
      createElement(TextField, { icon: createElement('svg'), kbd: 'Ctrl K', placeholder: 'Search', id: 'q' }),
    )
    expect(out).toContain('bg-surface-inset')
    expect(out).toMatch(/<input[^>]*id="q"/)
    expect(out).toMatch(/<input[^>]*placeholder="Search"/)
    expect(out).toContain('>Ctrl K</kbd>')
  })
})

describe('Disclosure', () => {
  it('is a closed details with a rotating chevron and an aside', () => {
    const out = html(createElement(Disclosure, { title: 'How to drive this app', aside: 'Edit in settings', children: 'body' }))
    expect(out).toMatch(/^<details data-disclosure=""/)
    expect(out).not.toMatch(/<details[^>]* open/)
    expect(out).toContain('group-open/disclosure:rotate-90')
    expect(out).toContain('Edit in settings')
  })

  it('can start open', () => {
    expect(html(createElement(Disclosure, { title: 'Digest', defaultOpen: true, children: 'x' }))).toMatch(/<details[^>]* open=""/)
  })
})

describe('PageHeader', () => {
  it('sets the title once, with the meta line beneath', () => {
    const out = html(createElement(PageHeader, { title: 'Settings shows step models', meta: [{ text: 'Merged 19h ago' }] }))
    expect(out).toMatch(/<h1[^>]*text-xl[^>]*font-semibold[^>]*>Settings shows step models<\/h1>/)
    expect(out).toContain('Merged 19h ago')
  })
})

describe('EmptyState', () => {
  const render = (props: Record<string, unknown>) =>
    html(createElement(EmptyState, { title: 'Nothing here', ...props }))

  it('renders the title alone when that is all it is given', () => {
    const out = render({})
    expect(out).toContain('Nothing here')
    expect(out).not.toContain('mt-3')
  })

  it('renders the icon, hint and action — with no frame and no icon chip', () => {
    const out = render({
      icon: createElement('span', null, '★'),
      hint: 'they appear as the map takes shape',
      action: createElement('span', null, 'Start'),
    })
    expect(out).toContain('★')
    expect(out).toContain('they appear as the map takes shape')
    expect(out).toContain('Start')
    expect(out).not.toMatch(/\bborder\b/)
    expect(out).not.toContain('bg-')
  })

  it('pads a compact empty state less than a full one', () => {
    expect(render({ compact: true })).toContain('py-8')
    expect(render({})).toContain('py-12')
  })
})

describe('primitive gaps closed by the consistency pass', () => {
  it('counts a section in plain tertiary, not a tinted alpha', () => {
    const out = html(createElement(SectionLabel, { count: 4, children: 'Needs you' }))
    expect(out).toContain('font-normal text-text-tertiary tabular-nums')
    expect(out).not.toContain('/80')
  })

  it('has a quiet NavItem for "Show all (N)" rows, lined up under the labels', () => {
    const out = html(createElement(NavItem, { tone: 'quiet', label: 'Show all (12)', onClick: () => {} }))
    expect(out).toContain('h-7')
    expect(out).toContain('text-text-tertiary')
    expect(out).toContain('pl-8.5 text-xs')
    expect(out).not.toContain('h-(--row-h)')
  })

  it('keeps a ListRow`s control out of its button, with the meta after it', () => {
    const out = html(
      createElement(ListRow, {
        title: 'Ticket',
        label: 'Expand ticket #1',
        expanded: false,
        onClick: () => {},
        control: createElement('button', { id: 'model' }),
        meta: 'Pending',
      }),
    )
    expect(out).toContain('aria-label="Expand ticket #1"')
    expect(out).toContain('aria-expanded="false"')
    // The control is a sibling of the row's button, never nested in it.
    expect(out).toMatch(/<\/button><span[^>]*><button id="model"><\/button><\/span>/)
    expect(out.indexOf('id="model"')).toBeLessThan(out.indexOf('Pending'))
  })

  it('floats a ListRow`s actions over its meta when asked, fading the meta', () => {
    const out = html(
      createElement(ListRow, { title: 'A', meta: '2h', actions: createElement('button', { id: 'act' }), actionsOverlay: true }),
    )
    expect(out).toMatch(/group-hover\/row:opacity-0[^>]*>2h</)
    expect(out).toMatch(/absolute right-2[^>]*><button id="act"/)
    const reserved = html(createElement(ListRow, { title: 'A', meta: '2h', actions: createElement('button', { id: 'act' }) }))
    expect(reserved).not.toContain('absolute right-2')
    expect(reserved).not.toContain('group-hover/row:opacity-0')
  })

  it('takes a second line, wraps prose, and renders as a list item', () => {
    const two = html(createElement(ListRow, { title: 'runcastle', description: '/code/runcastle' }))
    expect(two).toMatch(/text-xs text-text-tertiary">\/code\/runcastle</)
    const prose = html(createElement(ListRow, { as: 'li', wrap: true, title: 'a long note' }))
    expect(prose).toMatch(/^<li /)
    expect(prose).toContain('wrap-anywhere')
    expect(prose).not.toMatch(/"min-w-0 truncate">a long note/)
  })

  it('has a compact Disclosure that staggers in', () => {
    const out = html(createElement(Disclosure, { size: 'sm', title: 'What the engine reported', index: 1, children: 'raw' }))
    expect(out).toContain('min-h-6')
    expect(out).toContain('text-xs')
    expect(out).toContain('width="12"')
    expect(out).not.toContain('border-t')
    expect(out).toContain('--i:1')
    expect(out).toContain('animate-rise-in')
  })

  it('names an Aside whose title is not a string', () => {
    const out = html(createElement(Aside, { title: createElement('span', null, 'tabs'), label: 'Details', onClose: () => {}, children: 'x' }))
    expect(out).toContain('aria-label="Details"')
  })

  it('lays an aside beside the page, and floats it in a narrow panel', () => {
    const body = createElement('main', null, 'page')
    // Closed, the page keeps its column (so opening an aside never remounts it).
    const closed = html(createElement(AsideLayout, { aside: null, children: body }))
    expect(closed).toContain('<main>page</main>')
    expect(closed).not.toContain('@max-4xl:absolute')
    const out = html(createElement(AsideLayout, { aside: createElement('aside', null, 'a'), children: body }))
    expect(out).toContain('@container')
    expect(out).toContain('@max-4xl:absolute')
    expect(out).toContain('@max-4xl:shadow-dialog')
  })

  it('is one quiet link look: accent text, underlined on hover', () => {
    expect(LINK).toContain('text-accent-text')
    expect(LINK).toContain('no-underline')
    expect(LINK).toContain('hover:underline')
  })

  it('is a radio group of segments, the chosen one alone in the Tab order', () => {
    const out = html(
      createElement(SegmentedControl, {
        label: 'Theme',
        value: 'light',
        onChange: () => {},
        items: [
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
          { value: 'system', label: 'System' },
        ],
      }),
    )
    expect(out).toContain('role="radiogroup" aria-label="Theme"')
    expect(out.match(/role="radio"/g)).toHaveLength(3)
    expect(out).toMatch(/aria-checked="true" tabindex="0"[^>]*>(?:<[^>]+>)*Light/)
    expect(out.match(/tabindex="-1"/g)).toHaveLength(2)
    // The raised ground slides to the chosen segment: transform only.
    expect(out).toContain('translateX(100%)')
    expect(out).toContain('transition-transform')
  })

  it('draws a checkbox on the tokens, native underneath', () => {
    const out = html(createElement(Checkbox, { checked: true, onChange: () => {}, label: 'Quick fix' }))
    expect(out).toContain('type="checkbox"')
    expect(out).toContain('checked=""')
    expect(out).toContain('appearance-none')
    expect(out).toContain('checked:bg-primary')
    expect(out).toContain('focus-visible:outline-focus-ring')
    expect(out).toContain('Quick fix')
    expect(out).not.toMatch(/accent-\(|accent-accent/)
  })

  it('is a named switch', () => {
    const out = html(createElement(Switch, { checked: false, onChange: () => {}, 'aria-label': 'Sandbox' }))
    expect(out).toContain('role="switch"')
    expect(out).toContain('aria-checked="false"')
    expect(out).toContain('aria-label="Sandbox"')
  })
})
