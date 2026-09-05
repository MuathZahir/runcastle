import type { SVGProps } from 'react'

/**
 * Inline icon set for the IDE shell — 16×16 viewBox, 1.5px stroke,
 * currentColor. Replaces the ad-hoc unicode glyphs (⚙ ▥ ⎇ 🔔 …) so chrome
 * reads as a designed product instead of terminal cosplay. Size via the
 * `size` prop; color inherits from the parent.
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

/** The quick-change door — a tweak that skips the conversation. */
export function IconBolt(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8.9 1.8 3.4 9.1h3.9l-.7 5.1 5.5-7.3H8.2z" />
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

/* ============================================================================
   BRAND — castle mark with a play-triangle gate (Runcastle Logo template,
   Runcastle Design System). One silhouette: a crenellated wall whose gate is
   the run button, cut in negative space via the evenodd fill rule.
   ========================================================================== */

const LOGO_PATH =
  'M4 29 V6 H10 V11 H13 V6 H19 V11 H22 V6 H28 V29 H4 Z M12.5 15 L21.5 20 L12.5 25 Z'

export type LogoVariant = 'solid' | 'outline' | 'mono' | 'ink'

/**
 * The brand mark. Treatments from the logo spec: `solid` (accent, primary),
 * `outline` (hairline, quiet surfaces), `mono` (neutral, inherits currentColor),
 * `ink` (on an accent surface).
 */
export function LogoMark({
  size = 16,
  variant = 'solid',
  ...rest
}: SVGProps<SVGSVGElement> & { size?: number; variant?: LogoVariant }) {
  const fill =
    variant === 'solid'
      ? 'var(--accent)'
      : variant === 'mono'
        ? 'currentColor'
        : variant === 'ink'
          ? 'var(--accent-ink)'
          : 'none'
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden {...rest}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d={LOGO_PATH}
        fill={fill}
        stroke={variant === 'outline' ? 'var(--accent-hi)' : 'none'}
        strokeWidth={variant === 'outline' ? 1.5 : 0}
        strokeLinejoin="miter"
      />
    </svg>
  )
}

/**
 * The two-tone wordmark: mono, semibold, `run` in accent to teach the name's
 * parse. Size via the `wordmark` CSS class scale (`is-lg` for hero uses).
 */
export function LogoWordmark({ large }: { large?: boolean }) {
  return (
    <span className={`wordmark${large ? ' is-lg' : ''}`}>
      <span className="wordmark-run">run</span>
      <span className="wordmark-castle">castle</span>
    </span>
  )
}
