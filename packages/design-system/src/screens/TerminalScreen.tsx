import { Button } from '../components/Button'
import { StatusDot } from '../components/StatusDot'

type SessionStatus = 'launching' | 'live' | 'ended'

export interface TerminalScreenProps {
  /** Session kind badge (e.g. ideation / qa / burner). */
  kind?: string
  /** Claude Code session id (mono, dim). */
  sessionId?: string
  /** Session liveness. */
  status?: SessionStatus
  /** Terminal output lines. */
  lines?: string[]
}

const DOT: Record<SessionStatus, 'active' | 'ok' | 'idle'> = {
  launching: 'active',
  live: 'ok',
  ended: 'idle',
}

const DEFAULT_LINES = [
  '$ claude --resume 7f3a-ideation',
  '● Shaping tickets from SPEC.md …',
  '  read  packages/core/src/schema.ts',
  '  read  docs/SPEC.md',
  '● Proposed 5 tickets — review in the Tickets tab.',
  '',
  '> ready.',
]

/**
 * The terminal tab: a 28px strip (session-kind badge, Claude Code session id, a
 * liveness dot, Pop out / End actions) over the embedded session output.
 * @category Screens
 */
export function TerminalScreen({
  kind = 'ideation',
  sessionId = 'cc_7f3a91e2',
  status = 'live',
  lines = DEFAULT_LINES,
}: TerminalScreenProps) {
  return (
    <div className="terminal-tab">
      <div className="term-strip">
        <span className="term-kind">{kind}</span>
        <span className="term-cc mono dim">{sessionId}</span>
        <StatusDot tone={DOT[status]} pulse={status === 'launching'} title={status} />
        <span className="term-status-label mono dim">{status}</span>
        <span className="term-strip-spacer" />
        <Button size="xs">Pop out ↗</Button>
        <Button size="xs">End session</Button>
      </div>
      <div className="term-body">
        <div className="term-out">
          {lines.map((l, i) => (
            <div key={i} className={l.startsWith('$') || l.startsWith('>') ? 'term-prompt' : l.startsWith('●') ? 'term-accent' : undefined}>
              {l || ' '}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
