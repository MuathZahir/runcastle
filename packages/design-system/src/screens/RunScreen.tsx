import { Button } from '../components/Button'
import { Chip } from '../components/Chip'

type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'
type LaneStatus = 'pending' | 'burning' | 'done' | 'failed'

export interface RunLane {
  seq: number
  title: string
  status: LaneStatus
  commits?: string[]
  dur?: string
}
export interface RunStreamLine {
  level: 'info' | 'ok' | 'active' | 'error'
  type: string
  message: string
}

export interface RunScreenProps {
  status?: RunStatus
  done?: number
  total?: number
  elapsed?: string
  lanes?: RunLane[]
  stream?: RunStreamLine[]
}

const RUN_TONE: Record<RunStatus, 'active' | 'done' | 'failed' | 'pending'> = {
  running: 'active',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'pending',
}
const LANE_TONE: Record<LaneStatus, 'pending' | 'active' | 'done' | 'failed'> = {
  pending: 'pending',
  burning: 'active',
  done: 'done',
  failed: 'failed',
}

const DEFAULT_LANES: RunLane[] = [
  { seq: 1, title: 'Add session table + drizzle schema', status: 'done', commits: ['a1f9c2b', 'b2e8d10'], dur: '48s' },
  { seq: 2, title: 'Wire /api/auth login + logout routes', status: 'done', commits: ['c3f7a94'], dur: '1m 12s' },
  { seq: 3, title: 'Session cookie middleware + guard', status: 'burning', commits: ['d4a1e88'] },
  { seq: 4, title: 'Login form + error states', status: 'pending' },
]
const DEFAULT_STREAM: RunStreamLine[] = [
  { level: 'active', type: 'burn.start', message: 'burning 5 tickets in worktree sandbox' },
  { level: 'ok', type: 'ticket.done', message: '#1 session table — 2 commits' },
  { level: 'ok', type: 'ticket.done', message: '#2 auth routes — 1 commit' },
  { level: 'active', type: 'ticket.start', message: '#3 cookie middleware' },
  { level: 'info', type: 'tool.edit', message: 'packages/server/src/trpc/context.ts' },
  { level: 'info', type: 'tool.test', message: 'vitest run auth.test.ts' },
]

/**
 * The run tab: a 40/60 split — ticket lanes on the left (coloured by status),
 * a live event stream on the right (auto-follow). The header shows the run
 * status chip, X/Y done, elapsed, and a Cancel action.
 * @category Screens
 */
export function RunScreen({
  status = 'running',
  done = 2,
  total = 5,
  elapsed = '2m 14s',
  lanes = DEFAULT_LANES,
  stream = DEFAULT_STREAM,
}: RunScreenProps) {
  return (
    <div className="run">
      <div className="run-header">
        <div className="run-header-left">
          <Chip tone={RUN_TONE[status]} pulse={status === 'running'}>{status}</Chip>
          <span className="mono run-count">{done}/{total} done</span>
          <span className="mono run-elapsed">{elapsed}</span>
        </div>
        <Button size="xs">Cancel</Button>
      </div>

      <div className="run-split">
        <div className="run-lanes">
          <div className="section-title">Lanes</div>
          {lanes.map((l) => (
            <div key={l.seq} className={`lane status-${l.status}`}>
              <div className="lane-head">
                <span className="lane-seq mono">#{l.seq}</span>
                <span className="lane-title">{l.title}</span>
                <Chip tone={LANE_TONE[l.status]} pulse={l.status === 'burning'}>{l.status}</Chip>
              </div>
              <div className="lane-foot mono">
                {l.commits && l.commits.length > 0 ? (
                  <span className="lane-commits">
                    {l.commits.map((c) => (
                      <span key={c} className="commit-sha">{c}</span>
                    ))}
                  </span>
                ) : (
                  <span className="dim-line">no commits</span>
                )}
                {l.dur && <span className="lane-dur">{l.dur}</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="run-stream">
          <div className="stream-head">
            <span className="section-title">Events</span>
          </div>
          <div className="stream-body mono">
            {stream.map((e, i) => (
              <div key={i} className={`stream-line level-${e.level}`}>
                <span className="sl-type">{e.type}</span>
                <span className="sl-msg">{e.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
