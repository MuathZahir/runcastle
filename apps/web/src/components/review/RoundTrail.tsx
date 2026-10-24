import type { RunStatus, TicketStatus } from '@runcastle/core'
import {
  Button,
  Disclosure,
  List,
  ListRow,
  MetaLine,
  SectionLabel,
  TicketStatusChip,
  type MetaItem,
  type StatusTone,
} from '../../ui'
import { IconPlay } from '../../icons'
import type {
  AgentFixEntry,
  ReadyEntry,
  RoundEntry,
  RoundTrail as RoundTrailFigure,
  TrailTicket,
} from '../../lib/feature-ui/rounds'
import { noun } from '../../lib/feature-ui/tickets'
import { fmtDuration, shortSha } from '../../lib/format'

/**
 * The round trail (`the-feature-lead-runs-rounds` decision 16), oldest first:
 * each round the agent dispatched — its workers, what landed, the gates, how
 * long it took and the agent's one-line verdict — with the agent's
 * own fixes and its "Ready for you" declarations between them. Facts are text
 * (MetaLine); the long content (the workers, what to test) folds into a
 * Disclosure. Shipped features read the same way: their old runs are rounds.
 *
 * History, nothing else: a review worker's recording can be staged in the
 * evidence stage above, and a worker opens the run view where its lane is.
 */

const RUN_WORD: Record<RunStatus, { word: string; tone: StatusTone }> = {
  running: { word: 'running', tone: 'live' },
  succeeded: { word: 'succeeded', tone: 'success' },
  failed: { word: 'failed', tone: 'danger' },
  cancelled: { word: 'stopped', tone: 'neutral' },
}

/** "3 workers · 18 min" and the outcome after it — only the parts the round has. */
export function roundMeta(entry: RoundEntry): MetaItem[] {
  const status = RUN_WORD[entry.status]
  const items: (MetaItem | null)[] = [
    { text: noun(entry.workers.length, 'worker') },
    entry.durationMs !== null ? { text: fmtDuration(0, entry.durationMs) } : null,
    entry.status === 'running' || entry.status === 'cancelled'
      ? { tone: status.tone, text: status.word }
      : null,
    entry.landed > 0 ? { tone: 'success', text: `${entry.landed} landed` } : null,
    entry.failed > 0 ? { tone: 'danger', text: `${entry.failed} failed` } : null,
    entry.gates === null
      ? null
      : entry.gates.ok
        ? { tone: 'success', text: 'gates passed' }
        : { tone: 'danger', text: `gates failed: ${entry.gates.failed.join(', ')}` },
  ]
  return items.filter((i): i is MetaItem => i !== null)
}

function EntryHeading({ title, meta }: { title: string; meta: MetaItem[] }) {
  return (
    <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
      <h3 className="m-0 text-sm font-medium text-text">{title}</h3>
      <MetaLine items={meta} className="min-w-0" />
    </div>
  )
}

interface Recordings {
  /** Review workers' recordings by ticket id. */
  byTicket: ReadonlyMap<string, string>
  /** The recording the stage is playing, so its button reads as the pressed one. */
  staged: string | null
  onStage: (ticketId: string) => void
}

function WorkerRows({
  workers,
  label,
  recordings,
  onViewRun,
}: {
  workers: readonly TrailTicket[]
  label: string
  recordings?: Recordings
  onViewRun?: () => void
}) {
  return (
    <List label={label}>
      {workers.map((ticket) => {
        const video = recordings?.byTicket.get(ticket.id)
        return (
          <ListRow
            key={ticket.id}
            className="-ml-3"
            title={`#${ticket.seq} · ${ticket.title}`}
            meta={<TicketStatusChip status={ticket.status as TicketStatus} />}
            {...(video && recordings
              ? {
                  control: (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<IconPlay />}
                      aria-pressed={recordings.staged === ticket.id}
                      onClick={() => recordings.onStage(ticket.id)}
                    >
                      Recording
                    </Button>
                  ),
                }
              : {})}
            {...(onViewRun ? { onClick: onViewRun } : {})}
          />
        )
      })}
    </List>
  )
}

function RoundItem({
  entry,
  open,
  recordings,
  onViewRun,
}: {
  entry: RoundEntry
  open: boolean
  recordings?: Recordings
  onViewRun?: () => void
}) {
  return (
    <>
      <EntryHeading title={`Round ${entry.round}`} meta={roundMeta(entry)} />
      {entry.verdict && <p className="m-0 text-sm text-pretty text-text-secondary">{entry.verdict}</p>}
      {entry.workers.length > 0 && (
        <Disclosure size="sm" title="Workers" defaultOpen={open}>
          <WorkerRows
            workers={entry.workers}
            label={`Round ${entry.round} workers`}
            {...(recordings ? { recordings } : {})}
            {...(onViewRun ? { onViewRun } : {})}
          />
        </Disclosure>
      )}
    </>
  )
}

function AgentFixItem({ entry }: { entry: AgentFixEntry }) {
  return (
    <>
      <EntryHeading
        title="Agent fix"
        meta={[
          { text: noun(entry.commits.length, 'commit') },
          ...(entry.files.length > 0 ? [{ text: noun(entry.files.length, 'file') }] : []),
        ]}
      />
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {entry.commits.map((commit) => (
          <li key={commit.sha} className="flex min-w-0 gap-2 text-sm text-text-secondary">
            <span className="shrink-0 font-mono text-xs leading-5 text-text-tertiary">{shortSha(commit.sha)}</span>
            <span className="min-w-0 truncate">{commit.subject}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

function ReadyItem({ entry }: { entry: ReadyEntry }) {
  return (
    <>
      <EntryHeading
        title="Ready for you"
        meta={[{ text: entry.afterRound !== null ? `after round ${entry.afterRound}` : 'before any round' }]}
      />
      <p className="m-0 text-sm text-text">Test drive ▸ {entry.scenario}</p>
    </>
  )
}

export function RoundTrail({
  trail,
  recordings,
  onViewRun,
}: {
  trail: RoundTrailFigure
  /** Review workers' recordings, for staging on the evidence stage. Absent where there is no stage. */
  recordings?: Recordings
  /** Go to the run view, where the round's lanes are. Absent where it cannot. */
  onViewRun?: () => void
}) {
  const { entries, notDispatched } = trail
  if (entries.length === 0 && notDispatched.length === 0) return null
  const rounds = entries.filter((e) => e.type === 'round').length
  const lastRound = entries.findLast((e) => e.type === 'round')
  return (
    <section id="round-trail" className="flex flex-col gap-1">
      <SectionLabel count={rounds > 0 ? rounds : undefined}>Rounds</SectionLabel>
      {entries.length > 0 && (
        <ol aria-label="Round trail" className="m-0 flex list-none flex-col p-0">
          {entries.map((entry, i) => (
            <li
              key={entry.type === 'round' ? entry.runId : `${entry.type}-${i}`}
              data-entry={entry.type}
              className="flex min-w-0 flex-col gap-1 border-t border-border-subtle py-3 first:border-t-0 first:pt-1"
            >
              {entry.type === 'round' ? (
                <RoundItem
                  entry={entry}
                  open={entry === lastRound}
                  {...(recordings ? { recordings } : {})}
                  {...(onViewRun ? { onViewRun } : {})}
                />
              ) : entry.type === 'agent-fix' ? (
                <AgentFixItem entry={entry} />
              ) : (
                <ReadyItem entry={entry} />
              )}
            </li>
          ))}
        </ol>
      )}
      {notDispatched.length > 0 && (
        <Disclosure size="sm" title={`Not yet dispatched · ${notDispatched.length}`}>
          <WorkerRows workers={notDispatched} label="Not yet dispatched" />
        </Disclosure>
      )}
    </section>
  )
}
