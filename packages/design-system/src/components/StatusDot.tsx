export interface StatusDotProps {
  /** Colour of the dot — health, session, or attention state. */
  tone?: 'idle' | 'ok' | 'warn' | 'danger' | 'active'
  /** Pulse to signal a live or transitional state (launching, running). */
  pulse?: boolean
  /** Accessible label, rendered as the title tooltip. */
  title?: string
}

/**
 * A 7px status dot — the system's most compact state signal. Health checks,
 * session liveness, and needs-attention flags all reduce to one coloured (and
 * optionally pulsing) dot.
 */
export function StatusDot({ tone = 'idle', pulse, title }: StatusDotProps) {
  const cls = ['status-dot', `dot-${tone}`, pulse ? 'is-pulsing' : ''].filter(Boolean).join(' ')
  return <span className={cls} title={title} />
}
