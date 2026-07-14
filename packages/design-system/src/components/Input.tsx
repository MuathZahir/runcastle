import type { InputHTMLAttributes } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Switch the hairline to the danger red for a validation error. */
  invalid?: boolean
  /** Render the value in the mono family — for identifiers, paths, branches. */
  mono?: boolean
}

/**
 * A single-line text field on the darkest surface. Focus switches the hairline
 * to violet; `invalid` switches it to red. Set `mono` for identifier input.
 */
export function Input({ invalid, mono, className, ...rest }: InputProps) {
  const cls = ['input', invalid ? 'input-invalid' : '', mono ? 'input-mono' : '', className]
    .filter(Boolean)
    .join(' ')
  return <input className={cls} {...rest} />
}
