import { Button } from '../components/Button'
import { Chip } from '../components/Chip'
import { DimLine } from '../components/DimLine'

type TicketStatus = 'pending' | 'burning' | 'done' | 'failed' | 'blocked'

export interface TicketRowData {
  seq: number
  title: string
  status: TicketStatus
  blockedBy?: number[]
  commits?: number
}

export interface TicketsScreenProps {
  /** Ticket ledger rows. */
  tickets?: TicketRowData[]
  /** Sandbox mode chip. */
  sandbox?: string
  /** Model chip. */
  model?: string
}

const TONE: Record<TicketStatus, 'pending' | 'active' | 'done' | 'failed' | 'blocked'> = {
  pending: 'pending',
  burning: 'active',
  done: 'done',
  failed: 'failed',
  blocked: 'blocked',
}

const DEFAULT_TICKETS: TicketRowData[] = [
  { seq: 1, title: 'Add session table + drizzle schema', status: 'done', commits: 2 },
  { seq: 2, title: 'Wire /api/auth login + logout routes', status: 'done', commits: 3 },
  { seq: 3, title: 'Session cookie middleware + guard', status: 'burning', commits: 1 },
  { seq: 4, title: 'Login form + error states', status: 'blocked', blockedBy: [3] },
  { seq: 5, title: 'E2E: happy-path + bad-credentials', status: 'pending' },
]

/**
 * The tickets tab: a burn bar (ticket counts + sandbox/model chips + the single
 * solid Burn button) over a ledger of collapsible ticket rows. One row is shown
 * expanded to its goal / acceptance / seams / commits.
 * @category Screens
 */
export function TicketsScreen({
  tickets = DEFAULT_TICKETS,
  sandbox = 'worktree',
  model = 'claude-opus-4-8',
}: TicketsScreenProps) {
  const blocked = tickets.filter((t) => (t.blockedBy?.length ?? 0) > 0).length
  return (
    <div className="tickets">
      <div className="burn-bar">
        <div className="burn-counts mono">
          {tickets.length} tickets<span className="burn-sep"> · </span>{blocked} blocked
        </div>
        <div className="burn-right">
          <Chip tone="neutral">{sandbox}</Chip>
          <Chip tone="neutral">{model}</Chip>
          <Button variant="solid">Burn {tickets.length} tickets</Button>
        </div>
      </div>

      <div className="ledger">
        {tickets.map((t, i) => (
          <div key={t.seq} className={`ledger-row status-${t.status}`}>
            <button className="ledger-head">
              <span className="lg-seq mono">#{t.seq}</span>
              <span className="lg-title">{t.title}</span>
              <span className="lg-meta">
                {t.blockedBy && t.blockedBy.length > 0 && (
                  <Chip tone="blocked">⇠ {t.blockedBy.join(',')}</Chip>
                )}
                {t.commits ? <span className="lg-commits mono">{t.commits}⧉</span> : null}
                <Chip tone={TONE[t.status]} pulse={t.status === 'burning'}>{t.status}</Chip>
              </span>
            </button>
            {i === 2 && (
              <div className="ledger-detail mono">
                <div className="td-section">
                  <div className="td-heading"># goal</div>
                  <div className="td-body">Attach a signed session cookie on login and clear it on logout; guard tRPC context.</div>
                </div>
                <div className="td-section">
                  <div className="td-heading"># acceptance criteria</div>
                  <ul className="td-list">
                    <li>Requests without a valid cookie get 401</li>
                    <li>Cookie is httpOnly + sameSite=lax</li>
                  </ul>
                </div>
                <div className="td-section">
                  <div className="td-heading"># seams</div>
                  <ul className="td-list">
                    <li>packages/server/src/trpc/context.ts</li>
                  </ul>
                </div>
                <div className="td-section">
                  <div className="td-heading"># commits</div>
                  <div className="td-commits">
                    <span className="commit-sha">a1f9c2b</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {tickets.length === 0 && <DimLine>no tickets emitted yet — grill the feature to shape them</DimLine>}
      </div>
    </div>
  )
}
