import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface GhostLinkProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode
}

/**
 * A borderless inline text action — secondary to a {@link Button}. Hover lifts
 * it to the violet high tone. Renders a real `<button>` so it stays keyboard
 * and screen-reader accessible.
 */
export function GhostLink({ className, children, type, ...rest }: GhostLinkProps) {
  return (
    <button className={['ghost-link', className].filter(Boolean).join(' ')} type={type ?? 'button'} {...rest}>
      {children}
    </button>
  )
}
