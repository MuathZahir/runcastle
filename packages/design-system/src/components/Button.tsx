import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight. `solid` is the single violet primary — show only one per view. */
  variant?: 'ghost' | 'solid' | 'danger'
  /** `xs` is the compact 22px height used in dense rows. */
  size?: 'md' | 'xs'
  children?: ReactNode
}

/**
 * The core action control. Exactly one `solid` (violet) button should be
 * visible per view; everything else is `ghost`. `danger` outlines a
 * destructive action in red. No shadows, no elevation — a 1px border does
 * the work.
 */
export function Button({ variant = 'ghost', size = 'md', className, children, type, ...rest }: ButtonProps) {
  const cls = ['btn', `btn-${variant}`, size === 'xs' ? 'btn-xs' : '', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button className={cls} type={type ?? 'button'} {...rest}>
      {children}
    </button>
  )
}
