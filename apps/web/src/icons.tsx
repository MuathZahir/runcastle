import { useId } from 'react'
import type { SVGProps } from 'react'
import type { Phase } from '@runcastle/core'

/**
 * The runcastle icon set — 16×16 viewBox, 1.5px round stroke, `currentColor`
 * (DESIGN.md §Components). Size via `size` (16 beside `text-sm`, 14 in small
 * controls and meta lines, 20 in empty states); colour inherits, so put
 * `text-icon` on the icon or its parent at rest and `text-text` on hover /
 * selected. Every nav item, tab, menu item and primary/secondary button gets
 * one; no emoji or unicode glyphs as icons.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 16, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...rest,
  }
}

export function IconSearch(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 L14 14" />
    </svg>
  )
}

export function IconSettings(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" />
    </svg>
  )
}

export function IconPanelRight(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" />
      <path d="M10.2 2.8v10.4" />
    </svg>
  )
}

export function IconBranch(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="4.5" cy="3.8" r="1.7" />
      <circle cx="4.5" cy="12.2" r="1.7" />
      <circle cx="11.5" cy="5" r="1.7" />
      <path d="M4.5 5.5v5M11.5 6.7c0 2.6-3 3-5.4 3.6" />
    </svg>
  )
}

export function IconBell(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 2a4 4 0 0 0-4 4v2.6L2.8 11h10.4L12 8.6V6a4 4 0 0 0-4-4Z" />
      <path d="M6.5 13.4a1.6 1.6 0 0 0 3 0" />
    </svg>
  )
}

export function IconBellOff(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5.2 3.2A4 4 0 0 1 12 6v2.6L13.2 11H6.5M4 6.5V8.6L2.8 11h2.4" />
      <path d="M6.5 13.4a1.6 1.6 0 0 0 3 0" />
      <path d="M2 2l12 12" />
    </svg>
  )
}

export function IconPlus(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 3.2v9.6M3.2 8h9.6" />
    </svg>
  )
}

export function IconCheck(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="m3 8.4 3.2 3.2L13 5" />
    </svg>
  )
}

export function IconX(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  )
}

export function IconTrash(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
    </svg>
  )
}

/** Take something back out of where it went — a triaged note's Reopen. */
export function IconUndo(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 6h5a3 3 0 0 1 0 6H7" />
      <path d="M7 3.5 4.5 6 7 8.5" />
    </svg>
  )
}

export function IconChevronDown(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="m4 6 4 4 4-4" />
    </svg>
  )
}

export function IconChevronRight(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="m6 4 4 4-4 4" />
    </svg>
  )
}

export function IconMore(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="3.2" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.8" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconTerminal(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" />
      <path d="m4.5 6.2 2.3 2-2.3 2M8.5 10.4h3" />
    </svg>
  )
}

export function IconMessage(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2 4.4a1.6 1.6 0 0 1 1.6-1.6h8.8A1.6 1.6 0 0 1 14 4.4v5.2a1.6 1.6 0 0 1-1.6 1.6H6.4L3.2 14v-2.8A1.6 1.6 0 0 1 2 9.6z" />
    </svg>
  )
}

export function IconDoc(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 1.8h5.2L13 5.6v8.6H4z" />
      <path d="M9 2v3.8h3.8M6 8.4h4M6 10.8h4" />
    </svg>
  )
}

/** Jot something down — the note capture door. */
export function IconPencil(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M10.6 2.4a1.7 1.7 0 0 1 2.4 2.4L5.5 12.3 2.4 13.1l.8-3.1z" />
      <path d="M9.4 3.6l2.4 2.4" />
    </svg>
  )
}

export function IconActivity(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M1.8 8h2.6l1.8-4.4 2.8 8.8L10.8 8h3.4" />
    </svg>
  )
}

export function IconFolder(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M1.8 4.2c0-.8.6-1.4 1.4-1.4h3l1.4 1.7h5.2c.8 0 1.4.6 1.4 1.4v6.5c0 .8-.6 1.4-1.4 1.4H3.2c-.8 0-1.4-.6-1.4-1.4z" />
    </svg>
  )
}

/** The model roster — one shape holding many faces. */
export function IconCube(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 1.6l5.4 3v6.8L8 14.4l-5.4-3V4.6z" />
      <path d="M8 7.6l5.4-3M8 7.6L2.6 4.6M8 7.6v6.8" />
    </svg>
  )
}

/** Unattended burns. */
export function IconFlame(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 14.4c2.7 0 4.7-2 4.7-4.7 0-2-1.3-3.4-2-4.7-.7 1.3-1.3 2-2 2 0-2-.7-4-2.7-5.4 0 2.7-2.7 4-2.7 8.1 0 2.7 2 4.7 4.7 4.7z" />
    </svg>
  )
}

/** A value the environment owns — this app cannot change it. */
export function IconLock(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="3.4" y="7.2" width="9.2" height="6.6" rx="1.3" />
      <path d="M5.6 7.2V5a2.4 2.4 0 0 1 4.8 0v2.2" />
    </svg>
  )
}

export function IconArrowRight(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2.5 8h11M9.5 4l4 4-4 4" />
    </svg>
  )
}

export function IconPlay(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5 3.2v9.6L13 8z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconStop(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconShield(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 1.8 13 3.6v4.2c0 3.2-2.1 5.3-5 6.4-2.9-1.1-5-3.2-5-6.4V3.6z" />
    </svg>
  )
}

export function IconSparkle(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 1.8 9.4 6l4.2 1.4L9.4 8.8 8 13 6.6 8.8 2.4 7.4 6.6 6z" />
    </svg>
  )
}

/**
 * The two agent runtimes a lane can burn on (decisions.md #10). Marks, not
 * logos: a radiating burst for Claude Code and the angle brackets for Codex,
 * drawn on the same 16×16 stroke grid as everything else here so a lane's
 * runtime reads at a glance without a second typeface arriving with it.
 */
export function IconClaude(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 2.4v11.2M3.2 5.2l9.6 5.6M12.8 5.2l-9.6 5.6" />
    </svg>
  )
}

export function IconCodex(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5.6 4.8 2.4 8l3.2 3.2M10.4 4.8 13.6 8l-3.2 3.2" />
    </svg>
  )
}

/* ---- navigation, status and chrome (redesign set) ---- */

export function IconInbox(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M1.8 9.2 3.5 3.6c.2-.5.6-.8 1.1-.8h6.8c.5 0 .9.3 1.1.8l1.7 5.6v3.4c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" />
      <path d="M1.8 9.2h3.4l1 1.8h3.6l1-1.8h3.4" />
    </svg>
  )
}

export function IconArchive(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="1.8" y="2.8" width="12.4" height="3.2" rx="1" />
      <path d="M3 6v6.2c0 .7.5 1.2 1.2 1.2h7.6c.7 0 1.2-.5 1.2-1.2V6M6.5 8.8h3" />
    </svg>
  )
}

export function IconPanelLeft(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" />
      <path d="M5.8 2.8v10.4" />
    </svg>
  )
}

export function IconGitMerge(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="4.5" cy="3.8" r="1.7" />
      <circle cx="4.5" cy="12.2" r="1.7" />
      <circle cx="11.5" cy="9.6" r="1.7" />
      <path d="M4.5 5.5v5M4.5 5.5c0 2.6 2.4 4.1 5.3 4.1" />
    </svg>
  )
}

export function IconExternalLink(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5" />
      <path d="M12 9.5v3a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2 12.5v-7A1.5 1.5 0 0 1 3.5 4h3" />
    </svg>
  )
}

export function IconCopy(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5" />
      <path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
    </svg>
  )
}

export function IconSun(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9" />
    </svg>
  )
}

export function IconMoon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1z" />
    </svg>
  )
}

/** "Follow the system" — the third theme choice. */
export function IconMonitor(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="1.8" y="2.5" width="12.4" height="8.5" rx="1.4" />
      <path d="M5.5 14h5M8 11v3" />
    </svg>
  )
}

export function IconHome(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2.5 7 8 2.5 13.5 7v5.8c0 .7-.5 1.2-1.2 1.2H3.7c-.7 0-1.2-.5-1.2-1.2z" />
      <path d="M6.3 14v-3.8h3.4V14" />
    </svg>
  )
}

export function IconList(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M5.8 4h7.7M5.8 8h7.7M5.8 12h7.7" />
      <circle cx="2.8" cy="4" r=".9" fill="currentColor" stroke="none" />
      <circle cx="2.8" cy="8" r=".9" fill="currentColor" stroke="none" />
      <circle cx="2.8" cy="12" r=".9" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconClock(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.8V8l2.2 1.4" />
    </svg>
  )
}

/** A warning triangle — needs attention, not failed. */
export function IconAlert(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M7.1 2.8a1 1 0 0 1 1.8 0l5.4 9.6a1 1 0 0 1-.9 1.5H2.6a1 1 0 0 1-.9-1.5z" />
      <path d="M8 6.4v3" />
      <circle cx="8" cy="11.5" r=".85" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconInfo(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.4V11" />
      <circle cx="8" cy="5.1" r=".85" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconFilter(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
    </svg>
  )
}

export function IconArrowLeft(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M13.5 8h-11M6.5 4l-4 4 4 4" />
    </svg>
  )
}

export function IconChevronUp(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="m4 10 4-4 4 4" />
    </svg>
  )
}

export function IconEye(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  )
}

export function IconRefresh(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M13.2 6.4A5.3 5.3 0 0 0 3.4 5.1M2.8 9.6a5.3 5.3 0 0 0 9.8 1.3" />
      <path d="M13.5 2.8v3.7H9.8M2.5 13.2V9.5h3.7" />
    </svg>
  )
}

export function IconUser(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="8" cy="5.5" r="2.7" />
      <path d="M2.8 13.8c.6-2.6 2.8-4.2 5.2-4.2s4.6 1.6 5.2 4.2" />
    </svg>
  )
}

/** The command key — the palette's door. */
export function IconCommand(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M10 4v8a2 2 0 1 0 2-2H4a2 2 0 1 0 2 2V4a2 2 0 1 0-2 2h8a2 2 0 1 0-2-2z" />
    </svg>
  )
}

/** A solid 6px dot on the 16px grid — a status mark that lines up with icons. */
export function IconDot(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
    </svg>
  )
}

/* ============================================================================
   PHASE ICON — a feature's pipeline phase as a 16px progress glyph (DESIGN.md:
   shape first, hue second). draft dashed ring · ideation ring · spec/planning
   quarter · tickets half · implementation/building three-quarters · review
   ring + centre dot · shipped filled check.
   ========================================================================== */

/**
 * Every phase a glyph exists for: the app's own four (`Phase` in
 * @runcastle/core — planning, building, review, shipped), `draft` (a parked
 * feature, which is a status rather than a phase), and the design system's
 * finer steps (ideation, spec, tickets, implementation) for surfaces that know
 * where inside planning/building a feature is.
 */
export type PhaseIconPhase = Phase | 'draft' | 'ideation' | 'spec' | 'tickets' | 'implementation'

/** The glyph's hue: a whole class per phase so Tailwind can see it. */
export const PHASE_TEXT: Record<PhaseIconPhase, string> = {
  draft: 'text-phase-draft',
  ideation: 'text-phase-ideation',
  spec: 'text-phase-spec',
  planning: 'text-phase-planning',
  tickets: 'text-phase-tickets',
  implementation: 'text-phase-implementation',
  building: 'text-phase-building',
  review: 'text-phase-review',
  shipped: 'text-phase-shipped',
}

/** Sentence-case name of each phase — the glyph's accessible label. */
export const PHASE_NAME: Record<PhaseIconPhase, string> = {
  draft: 'Draft',
  ideation: 'Ideation',
  spec: 'Spec',
  planning: 'Planning',
  tickets: 'Tickets',
  implementation: 'Build',
  building: 'Build',
  review: 'Review',
  shipped: 'Shipped',
}

/** How much of the inner disc is filled, in percent (the pie sweeps between these). */
const PHASE_FILL: Record<PhaseIconPhase, number> = {
  draft: 0,
  ideation: 0,
  spec: 25,
  planning: 25,
  tickets: 50,
  implementation: 75,
  building: 75,
  review: 0,
  shipped: 100,
}

const SWEEP = 'var(--dur-3) var(--ease-app)'

/**
 * A feature's phase as a 16px glyph with `role="img"` and a sentence-case
 * `aria-label` (override with `label`). The hue comes from the `phase-*`
 * tokens. When `phase` changes on a mounted glyph, the fill sweeps to its new
 * fraction and the colour cross-fades (240ms) — so a phase advance is seen.
 *
 * Props: `phase` (required), `size` (16; 14 in steppers and meta lines),
 * `label` (`''` makes it decorative — use when a word beside it names the
 * phase), `className` (appended — pass a `text-*` to override the hue, e.g.
 * `text-text` for the current step).
 */
export function PhaseIcon({
  phase,
  size = 16,
  label,
  className,
}: {
  phase: PhaseIconPhase
  size?: number
  label?: string
  className?: string
}) {
  const maskId = `phase-check-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const fill = PHASE_FILL[phase]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      role={label === '' ? undefined : 'img'}
      aria-label={label === '' ? undefined : (label ?? PHASE_NAME[phase])}
      aria-hidden={label === '' ? true : undefined}
      data-phase={phase}
      className={[
        'inline-block shrink-0 transition-colors duration-(--dur-3) ease-app',
        PHASE_TEXT[phase],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <defs>
        <mask id={maskId}>
          <rect width="16" height="16" fill="white" />
          <path
            d="M5.2 8.2 7 10l3.8-3.8"
            fill="none"
            stroke="black"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      {/* shipped cuts the check out of everything below it */}
      <g mask={phase === 'shipped' ? 'url(#' + maskId + ')' : undefined}>
        {/* the ring — dashed while the feature is only a draft */}
        <circle cx="8" cy="8" r="6" strokeDasharray={phase === 'draft' ? '2.2 2.2' : undefined} />
        {/* the pie: a 4px-wide stroke on a 2px circle fills radius 0–4; its dash
            length is the fraction, so a phase change sweeps it round */}
        <circle
          cx="8"
          cy="8"
          r="2"
          strokeWidth={4}
          pathLength={100}
          transform="rotate(-90 8 8)"
          style={{ strokeDasharray: `${fill} 100`, transition: `stroke-dasharray ${SWEEP}` }}
        />
        {/* review's centre dot */}
        <circle
          cx="8"
          cy="8"
          r="2.5"
          fill="currentColor"
          stroke="none"
          style={{ opacity: phase === 'review' ? 1 : 0, transition: `opacity ${SWEEP}` }}
        />
        {/* shipped: the filled disc with the check cut out of it */}
        <circle
          cx="8"
          cy="8"
          r="7"
          fill="currentColor"
          stroke="none"
          style={{ opacity: phase === 'shipped' ? 1 : 0, transition: `opacity ${SWEEP}` }}
        />
      </g>
    </svg>
  )
}

/* ============================================================================
   BRAND — castle mark with a play-triangle gate (Runcastle Logo template,
   Runcastle Design System). One silhouette: a crenellated wall whose gate is
   the run button, cut in negative space via the evenodd fill rule.
   ========================================================================== */

const LOGO_PATH =
  'M4 29 V6 H10 V11 H13 V6 H19 V11 H22 V6 H28 V29 H4 Z M12.5 15 L21.5 20 L12.5 25 Z'

export type LogoVariant = 'solid' | 'outline' | 'mono' | 'ink'

/**
 * The brand mark. Neutral by default (DESIGN.md): `mono` inherits
 * `currentColor`, so it takes the text colour it sits in. `solid` paints it in
 * `text`, `ink` in `on-primary` (on a `primary` fill), `outline` as a
 * `border-strong` hairline for quiet, large uses. The accent mark is retired.
 */
export function LogoMark({
  size = 16,
  variant = 'mono',
  ...rest
}: SVGProps<SVGSVGElement> & { size?: number; variant?: LogoVariant }) {
  const fill =
    variant === 'solid'
      ? 'var(--color-text)'
      : variant === 'mono'
        ? 'currentColor'
        : variant === 'ink'
          ? 'var(--color-on-primary)'
          : 'none'
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden {...rest}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d={LOGO_PATH}
        fill={fill}
        stroke={variant === 'outline' ? 'var(--color-border-strong)' : 'none'}
        strokeWidth={variant === 'outline' ? 1.5 : 0}
        strokeLinejoin="miter"
      />
    </svg>
  )
}

/**
 * The name, set plainly: lowercase "runcastle" in the UI face, medium weight,
 * `text` colour. The two-tone mono wordmark is retired; the export stays so
 * callers compile. `large` is the hero size (`text-xl`).
 */
export function LogoWordmark({ large }: { large?: boolean }) {
  return (
    <span
      className={
        large
          ? 'text-xl font-medium whitespace-nowrap text-text'
          : 'text-sm font-medium whitespace-nowrap text-text'
      }
    >
      runcastle
    </span>
  )
}
