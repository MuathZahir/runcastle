import type { SVGProps } from 'react'

/**
 * Glyphs the evidence stage needs that `src/icons.tsx` does not carry yet
 * (pause, expand/collapse, image, the three drawing tools, redo). Drawn to the
 * same contract — 16px box, 1.5 round stroke, `currentColor` — so they sit
 * beside the shared set without a seam. They belong in `icons.tsx`; they live
 * here only until that file is free to take them.
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

export function IconPause(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="4" y="3.5" width="2.5" height="9" rx="0.8" fill="currentColor" stroke="none" />
      <rect x="9.5" y="3.5" width="2.5" height="9" rx="0.8" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconExpand(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9.5 6.5M2.5 13.5l4-4" />
    </svg>
  )
}

export function IconCollapse(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5l4-4M6.5 9.5l-4 4" />
    </svg>
  )
}

export function IconImage(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1" />
      <path d="m3 12 3.5-3.5 2.5 2.5 1.5-1.5L13 12" />
    </svg>
  )
}

export function IconPen(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2.5 13.5c2-1 3-3.5 5-3.5s2 2 4 1.5 2.5-3 2.5-3" />
    </svg>
  )
}

export function IconArrowTool(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3 13 13 3M7 3h6v6" />
    </svg>
  )
}

export function IconRect(p: IconProps) {
  return (
    <svg {...base(p)}>
      <rect x="2.5" y="4" width="11" height="8" rx="1" />
    </svg>
  )
}

export function IconRedo(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M11 6H6a3 3 0 0 0 0 6h3" />
      <path d="M9 3.5 11.5 6 9 8.5" />
    </svg>
  )
}

export function IconSelectArea(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M2.5 5V3.5a1 1 0 0 1 1-1H5M11 2.5h1.5a1 1 0 0 1 1 1V5M13.5 11v1.5a1 1 0 0 1-1 1H11M5 13.5H3.5a1 1 0 0 1-1-1V11" />
    </svg>
  )
}
