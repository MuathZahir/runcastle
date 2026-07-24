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
