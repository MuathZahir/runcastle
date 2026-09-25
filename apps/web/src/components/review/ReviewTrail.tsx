import type { FindingStatus, TicketKind } from '@runcastle/core'
import type { ReactNode } from 'react'
import {
  Button,
  Disclosure,
  List,
  ListRow,
  MetaLine,
  TicketStatusChip,
  type MetaItem,
} from '../../ui'
import { IconCheck, IconCube, IconPlay, IconShield } from '../../icons'
import {
  lapTrail,
  type ReviewPassFigure,
  type TrailEntry,
  type TrailOutcome,
} from '../../lib/feature-ui'
import { fmtDateTime, relTimeAgo } from '../../lib/format'

/**
 * The laps (decisions 4–5), as sections rather than cards: the newest lap is a
 * `Lap N` heading, one meta line (reviewed when · how · what it found), the
 * lap's account in one paragraph, and the tickets it burned as a list. Earlier
 * laps are closed disclosures with the same anatomy inside.
 *
 * It replaces the stage's "Earlier recordings (N)" popover and the bordered lap
 * cards: "lap 2 found six defects, lap 3 verified nothing" stays readable at a
 * glance because each lap says it on its meta line.
 *
 * It is history and nothing else. The stage above stays the viewer — a review
 * pass's Recording button stages it there rather than opening a second player.
 * The open work is its own section; a defect count here is a figure, never a
 * row to act on, and observations render only in the Full account.
 */

/** A ticket as the lap list reads it. */
export interface TrailTicket {
  id: string
  seq?: number
  title?: string
  lap: number
  kind?: TicketKind
  passKind?: 'review' | 'verification'
  status: string
  digest?: string
  completedAt?: number | null
}

/** The outcome as a dot and words on the meta line, or null for no verdict. */
function outcomeItem(outcome: TrailOutcome): MetaItem | null {
  switch (outcome.kind) {
    case 'verified':
      return { tone: 'success', strong: 'Verified', ...(outcome.mode ? { text: `${outcome.mode} mode` } : {}) }
    case 'unverified':
      return { tone: 'warning', strong: 'Unverified' }
    case 'could-not-run':
      return { tone: 'warning', strong: 'Could not run' }
    case 'none':
      return null
  }
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** The lap's figures, only the ones that are not zero. */
function lapMeta(entry: TrailEntry): MetaItem[] {
  const { found, fixed, carried } = entry.defects
  const items: (MetaItem | null)[] = [
    entry.completedAt !== null
      ? { text: `Reviewed ${relTimeAgo(entry.completedAt)}`, title: fmtDateTime(entry.completedAt) }
      : { text: 'Not reviewed yet' },
    outcomeItem(entry.outcome),
    entry.burned > 0 ? { text: `${plural(entry.burned, 'ticket')} burned` } : null,
    found > 0
      ? { text: [plural(found, 'defect') + ' found', fixed > 0 ? `${fixed} fixed` : '', carried > 0 ? `${carried} carried` : ''].filter(Boolean).join(', ') }
      : null,
    entry.notes > 0 ? { text: plural(entry.notes, 'test note') } : null,
  ]
  return items.filter((i): i is MetaItem => i !== null)
}

/** A review pass's own words on its row: "Review — gates mode, verified". */
function passTitle(pass: TrailEntry['passes'][number]): string {
  const kind = pass.passKind === 'verification' ? 'Verification' : 'Review'
  const how = [pass.mode ? `${pass.mode} mode` : null, pass.couldNotRun ? 'could not run' : pass.verdict]
    .filter(Boolean)
    .join(', ')
  return how ? `${kind} — ${how}` : kind
}

function LapBody({
  entry,
  tickets,
  account,
  staged,
  onStage,
  onViewRun,
}: {
  entry: TrailEntry
  tickets: readonly TrailTicket[]
  account: string | null
  staged: string | null
  onStage: (ticketId: string) => void
  onViewRun?: () => void
}) {
  const passes = new Map(entry.passes.map((p) => [p.ticketId, p]))
  // Newest first, as the lap is read: the review that closed it, then what
  // burned under it. Passes the feed knows of but the ticket list does not are
  // still rows — a recording must never be unreachable.
  const rows = [...tickets.filter((t) => t.lap === entry.lap)].sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))
  const orphanPasses = entry.passes.filter((p) => !rows.some((t) => t.id === p.ticketId))

  const passRow = (pass: TrailEntry['passes'][number], ticket?: TrailTicket, i = 0): ReactNode => (
    <ListRow
      key={pass.ticketId}
      index={i}
      leading={pass.verdict === 'verified' ? <IconCheck /> : <IconShield />}
      title={`#${pass.seq} · ${passTitle(pass)}`}
      meta={ticket?.completedAt ? relTimeAgo(ticket.completedAt) : undefined}
      active={staged === pass.ticketId}
      actions={
        pass.videoUrl ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<IconPlay />}
            aria-pressed={staged === pass.ticketId}
            onClick={() => onStage(pass.ticketId)}
          >
            Recording
          </Button>
        ) : undefined
      }
    />
  )

  return (
    <div className="flex flex-col gap-3">
      <MetaLine items={lapMeta(entry)} />
      {account && <p className="m-0 text-base text-pretty text-text-secondary">{account}</p>}

      {/* The line runcastle filled for a lap that verified nothing (decision 5)
          — never the agent's own prose, which is in the Full account. */}
      {entry.outcome.kind === 'unverified' && (entry.outcome.line || entry.outcome.reason) && (
        <div className="flex flex-col gap-0.5 text-sm">
          {entry.outcome.line && <span className="text-warning">{entry.outcome.line}</span>}
          {entry.outcome.reason && <span className="text-text-tertiary">{entry.outcome.reason}</span>}
        </div>
      )}

      {(rows.length > 0 || orphanPasses.length > 0) && (
        <List divided label={`Lap ${entry.lap} tickets`}>
          {rows.map((ticket, i) => {
            const pass = passes.get(ticket.id)
            if (pass) return passRow(pass, ticket, i)
            const review = ticket.kind === 'review'
            return (
              <ListRow
                key={ticket.id}
                index={i}
                leading={review ? <IconShield /> : <IconCube />}
                title={`#${ticket.seq ?? '?'} · ${ticket.title ?? (review ? 'Review' : 'Ticket')}`}
                meta={
                  ticket.status === 'done' ? (
                    ticket.completedAt ? relTimeAgo(ticket.completedAt) : undefined
                  ) : (
                    <TicketStatusChip status={ticket.status as 'pending'} />
                  )
                }
                {...(onViewRun && !review ? { onClick: onViewRun } : {})}
              />
            )
          })}
          {orphanPasses.map((pass, i) => passRow(pass, undefined, rows.length + i))}
        </List>
      )}
    </div>
  )
}

export function ReviewTrail({
  passes,
  tickets,
  findings,
  notes,
  currentLap,
  account = null,
  staged,
  onStage,
  onViewRun,
}: {
  /** Every review pass this feature ran, from the artifacts feed. */
  passes: readonly ReviewPassFigure[]
  /** The feature's tickets — what burned, and what the feed cannot say. */
  tickets: readonly TrailTicket[]
  findings: readonly {
    lap: number
    kind: 'defect' | 'observation'
    status: FindingStatus
    fixTicketId?: string | null
  }[]
  notes: readonly { lap: number }[]
  currentLap: number
  /** The current lap's account at one line, when the review wrote one. */
  account?: string | null
  /** The recording the stage is playing, so its row reads as the picked one. */
  staged: string | null
  /** Put this pass's recording on the stage — the page owns which one is up. */
  onStage: (ticketId: string) => void
  /** Go to the run view, where the lap's lanes are. Absent where it cannot. */
  onViewRun?: () => void
}) {
  const entries = lapTrail({ passes, tickets, findings, notes, currentLap })
  // Nothing reviewed and nothing burned: no laps to tell, and a heading over a
  // line saying so would be the dead box the page no longer draws. Otherwise
  // the current lap is always told, even before its own review has run — a lap
  // not reviewed yet reads differently from a lap that does not exist.
  if (passes.length === 0 && tickets.length === 0) return null
  const shown = entries.filter(
    (e) =>
      e.lap === currentLap ||
      e.passes.length > 0 ||
      tickets.some((t) => t.lap === e.lap) ||
      e.defects.found > 0 ||
      e.notes > 0,
  )
  const [latest, ...earlier] = shown

  const body = (entry: TrailEntry) => (
    <LapBody
      entry={entry}
      tickets={tickets}
      account={entry.lap === currentLap ? account : null}
      staged={staged}
      onStage={onStage}
      {...(onViewRun ? { onViewRun } : {})}
    />
  )

  return (
    <section id="lap-trail" className="flex flex-col gap-3">
      <h2 className="m-0 text-lg font-semibold text-text">Lap {latest!.lap}</h2>
      {body(latest!)}
      {earlier.length > 0 && (
        <div className="mt-3">
          {earlier.map((entry) => {
            const outcome = outcomeItem(entry.outcome)
            return (
              <Disclosure
                key={entry.lap}
                title={`Lap ${entry.lap}`}
                aside={outcome?.strong ?? (entry.completedAt !== null ? `Reviewed ${relTimeAgo(entry.completedAt)}` : undefined)}
              >
                {body(entry)}
              </Disclosure>
            )
          })}
        </div>
      )}
    </section>
  )
}
