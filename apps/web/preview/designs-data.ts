import type { DesignEntry, PlanCounts } from '../src/lib/feature-ui/designs'
import type { ThreadItem } from '../src/lib/chat-thread'

/**
 * Sample data for the plan and design cards and the Design tab
 * (docs/features/designs-and-the-plan-get-their-own-place): one feature,
 * "Export notes as PDF", that a planning run left with a plan and four designs.
 */

export const TITLE = 'Export notes as PDF'
const MIN = 60_000
export const NOW = Date.UTC(2026, 10, 3, 9, 0)

/** A made-up screen: a sidebar, a header and a few blocks, tinted by `accent`, as a picture would show it. */
function screen(accent: string, layout: 'desktop' | 'mobile' | 'dialog' | 'empty'): string {
  const bg = '#16191f'
  const panel = '#1f232b'
  const line = '#323946'
  const shapes: Record<typeof layout, string> = {
    desktop: `<rect x="0" y="0" width="120" height="250" fill="${panel}"/>
<rect x="14" y="18" width="80" height="10" rx="3" fill="${line}"/>
<rect x="14" y="44" width="92" height="22" rx="5" fill="${accent}" opacity=".35"/>
<rect x="14" y="74" width="70" height="8" rx="3" fill="${line}"/>
<rect x="14" y="92" width="84" height="8" rx="3" fill="${line}"/>
<rect x="140" y="18" width="180" height="14" rx="3" fill="#cfd5df"/>
<rect x="140" y="44" width="240" height="8" rx="3" fill="${line}"/>
<rect x="140" y="72" width="246" height="150" rx="8" fill="${panel}"/>
<rect x="156" y="90" width="150" height="9" rx="3" fill="${line}"/>
<rect x="156" y="108" width="200" height="9" rx="3" fill="${line}"/>
<rect x="156" y="126" width="120" height="9" rx="3" fill="${line}"/>
<rect x="290" y="190" width="80" height="22" rx="6" fill="${accent}"/>`,
    mobile: `<rect x="150" y="10" width="100" height="230" rx="14" fill="${panel}"/>
<rect x="162" y="28" width="60" height="9" rx="3" fill="#cfd5df"/>
<rect x="162" y="48" width="76" height="40" rx="6" fill="${accent}" opacity=".35"/>
<rect x="162" y="98" width="70" height="7" rx="3" fill="${line}"/>
<rect x="162" y="112" width="56" height="7" rx="3" fill="${line}"/>
<rect x="162" y="208" width="76" height="20" rx="6" fill="${accent}"/>`,
    dialog: `<rect x="0" y="0" width="400" height="250" fill="#0d0f13"/>
<rect x="90" y="40" width="220" height="170" rx="10" fill="${panel}"/>
<rect x="108" y="60" width="120" height="12" rx="3" fill="#cfd5df"/>
<rect x="108" y="86" width="184" height="8" rx="3" fill="${line}"/>
<rect x="108" y="102" width="150" height="8" rx="3" fill="${line}"/>
<rect x="108" y="124" width="184" height="30" rx="6" fill="${line}" opacity=".6"/>
<rect x="226" y="176" width="66" height="20" rx="6" fill="${accent}"/>
<rect x="160" y="176" width="58" height="20" rx="6" fill="${line}"/>`,
    empty: `<rect x="0" y="0" width="120" height="250" fill="${panel}"/>
<circle cx="260" cy="110" r="16" fill="none" stroke="${line}" stroke-width="3"/>
<rect x="210" y="138" width="100" height="10" rx="3" fill="#cfd5df"/>
<rect x="196" y="156" width="128" height="7" rx="3" fill="${line}"/>
<rect x="226" y="178" width="68" height="20" rx="6" fill="${accent}" opacity=".7"/>`,
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="250" viewBox="0 0 400 250"><rect width="400" height="250" fill="${bg}"/>${shapes[layout]}</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** The four designs the planning run recorded, as the server would list them. */
export const DESIGNS: DesignEntry[] = [
  {
    id: 'dsn_export',
    title: 'Export dialog',
    path: '/preview/export.html?state=dialog',
    picture: screen('#5b8def', 'dialog'),
    state: 'waiting',
    isNew: true,
    shownAt: NOW - 14 * 60 * MIN,
  },
  {
    id: 'dsn_list',
    title: 'Notes list with the export button',
    path: '/preview/export.html?state=list',
    picture: screen('#5b8def', 'desktop'),
    state: 'waiting',
    isNew: true,
    shownAt: NOW - 14 * 60 * MIN - 6 * MIN,
  },
  {
    id: 'dsn_mobile',
    title: 'Export on the phone',
    path: '/preview/export.html?state=mobile',
    width: 390,
    picture: screen('#5b8def', 'mobile'),
    state: 'waiting',
    isNew: false,
    shownAt: NOW - 14 * 60 * MIN - 9 * MIN,
  },
  {
    id: 'dsn_empty',
    title: 'Nothing to export yet',
    path: '/preview/export.html?state=empty',
    state: 'approved',
    isNew: false,
    shownAt: NOW - 26 * 60 * MIN,
  },
]

export const PLAN_ONE_LINER = 'A notes page exports the open note, or a whole folder, as a PDF the human can save or send.'

export const PLAN_COUNTS: PlanCounts = { decisions: 14, checkFirst: 4, tickets: 4, designs: DESIGNS.length }

/** The conversation above the cards: the planning run's opening, its work folded. */
export const OPENING: ThreadItem[] = [
  {
    kind: 'user',
    id: 'u1',
    from: 'runcastle',
    text: 'Proceed with your task: no human is present. Plan this feature by yourself, design its screens, and end by asking for the human’s yes.',
  },
  {
    kind: 'work',
    id: 'w1',
    seconds: 41 * 60 + 12,
    steps: [{ kind: 'narration', id: 'n1', text: 'Planning the export, then designing its four screens.' }],
  },
]

/** The planning run's closing words, under its cards. */
export const CLOSING = `I planned this without you: **14 decisions**, four to check first (3, 6, 9, 12). It is **4 tickets** and a review round.

I designed four screens and looked at each in screenshots. Open them from the cards above, or from the Design tab; approve each one you are happy with, or tell me what to change.

Say yes to start round 1.`
