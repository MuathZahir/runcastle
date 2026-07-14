export interface SpinnerProps {
  /** Diameter in px (default 10). */
  size?: number
  /** Accessible label, rendered as the title tooltip. */
  title?: string
}

/**
 * A small indeterminate ring in the orange "implementation" tone — the system's
 * one spinner, used inline beside a running count or in a busy toolbar.
 */
export function Spinner({ size = 10, title }: SpinnerProps) {
  return <span className="spinner" style={{ width: size, height: size }} title={title} />
}
