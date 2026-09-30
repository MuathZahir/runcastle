import {
  Button,
  Disclosure,
  LINK,
  List,
  ListRow,
  MetaLine,
  SectionLabel,
  TicketStatusChip,
  TONE_TEXT,
  Timeline,
  TimelineNode,
  type MetaItem,
  type StatusTone,
  type TimelineTone,
} from '../../ui'
import { IconCheck, IconPlay, IconShield } from '../../icons'
import {
  gateCheckLines,
  lapTimeline,
  lapTrail,
  type BurnNode,
  type CheckTone,
  type GateCheckState,
  type PassNode,
  type ReviewPassFigure,
  type TimelineFinding,
  type TimelineTicket,
  type TrailEntry,
  type TrailOutcome,
} from '../../lib/feature-ui'
import { fmtDateTime, relTimeAgo } from '../../lib/format'
import type { ReviewGateRunWire } from '../../lib/reviews'

/**
 * The laps as a timeline, oldest first (decision 5): each lap reads top to
 * bottom in the order things happened — the work it burned, the review pass,
 * the fixes burned under it, the verification. Passes are milestones and never
 * ticket rows.
 *
 * The current lap is last and open, its heading only the time: the Review
 * status row owns its verdict (decision 3). Earlier laps sit above it, each
 * folded to a heading line that still carries its verdict and counts — every
 * lap stays visible, only its detail folds (knowingly bending
 * review-as-a-lap-trail d4).
 *
 * It is history and nothing else. The stage above stays the viewer — a pass's
 * Recording button stages it there rather than opening a second player. The
 * open work is its own section; a defect count here is a figure, never a row
 * to act on, and observations render only in the Full account.
 *
 * It leads the page's Reference tier (decision 7), so it opens on a quiet
 * "History" label rather than a heading as loud as the work above it.
 */

/** The outcome as a dot and words on an earlier lap's heading, or null for no verdict. */
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

/**
 * When an earlier lap was reviewed, or that it has not been yet. A pass that
 * predates the completion stamp still reviewed the lap, only at no known time.
 */
function reviewedItem(entry: TrailEntry): MetaItem {
  if (entry.completedAt !== null) {
    return { text: `Reviewed ${relTimeAgo(entry.completedAt)}`, title: fmtDateTime(entry.completedAt) }
  }
  return { text: entry.reviewed ? 'Reviewed' : 'Not reviewed yet' }
}

/** The current lap's heading figure: only the time (decision 5) — the Review row owns the rest. */
function timeItems(entry: TrailEntry): MetaItem[] {
  return entry.completedAt !== null
    ? [{ text: relTimeAgo(entry.completedAt), title: fmtDateTime(entry.completedAt) }]
    : []
}

/** An earlier lap's heading figures: its verdict, then only the counts that are not zero. */
function lapMeta(entry: TrailEntry): MetaItem[] {
  const { found, fixed, carried } = entry.defects
  const items: (MetaItem | null)[] = [
    outcomeItem(entry.outcome),
    entry.burned > 0 ? { text: `${plural(entry.burned, 'ticket')} burned` } : null,
    found > 0
      ? { text: [plural(found, 'defect') + ' found', fixed > 0 ? `${fixed} fixed` : '', carried > 0 ? `${carried} carried` : ''].filter(Boolean).join(', ') }
      : null,
    entry.notes > 0 ? { text: plural(entry.notes, 'test note') } : null,
    reviewedItem(entry),
  ]
  return items.filter((i): i is MetaItem => i !== null)
}

/** A pass's verdict as its milestone's tone. */
function passTone(pass: PassNode): TimelineTone {
  if (pass.couldNotRun || pass.verdict === 'unverified') return 'warning'
  if (pass.verdict === 'verified') return 'success'
  return 'neutral'
}

/** "gates mode · Verified · 3 defects found" — only the parts the pass has. */
function PassMeta({ pass }: { pass: PassNode }) {
  const word = pass.couldNotRun
    ? 'Could not run'
    : pass.verdict === 'verified'
      ? 'Verified'
      : pass.verdict === 'unverified'
        ? 'Unverified'
        : null
  const parts = [
    pass.mode ? `${pass.mode} mode` : null,
    word && (
      <span key="verdict" className={`font-medium ${TONE_TEXT[passTone(pass)]}`}>
        {word}
      </span>
    ),
    pass.found > 0 ? `${plural(pass.found, 'defect')} found` : null,
    pass.fixed > 0 ? `${pass.fixed} fixed` : null,
  ].filter(Boolean)
  return <>{parts.flatMap((part, i) => (i === 0 ? [part] : [' · ', part]))}</>
}

const CHECK_TONE: Record<CheckTone, StatusTone> = {
  ok: 'success',
  warn: 'warning',
  danger: 'danger',
  idle: 'neutral',
}

const CHECK_LINE: Record<GateCheckState, { word: string; tone: StatusTone }> = {
  passed: { word: 'passed', tone: 'success' },
  failed: { word: 'failed', tone: 'danger' },
  couldnt_run: { word: "couldn't run", tone: 'warning' },
}

function outputLink(url: string): MetaItem {
  return {
    text: (
      <a className={LINK} href={url} target="_blank" rel="noreferrer noopener">
        output
      </a>
    ),
  }
}

/**
 * The checks the server ran on the branch before this pass (gates-mode
 * decision 6): the pass's own record, on its own sha, so a lap reads "failed →
 * fixed → passes" across its passes. The output is a click away for anything
 * not green.
 */
function PassChecks({ gateRun }: { gateRun: ReviewGateRunWire }) {
  const checks = gateCheckLines(gateRun)
  return (
    <div role="group" aria-label="Checks" className="flex flex-col gap-0.5">
      <MetaLine
        items={[
          { tone: CHECK_TONE[checks.tone], strong: checks.summary },
          checks.commit !== null && { text: `@${checks.commit}`, mono: true, title: 'the feature-branch commit the checks ran on' },
          checks.outputUrl !== undefined && outputLink(checks.outputUrl),
        ]}
      />
      {checks.lines.map((line, i) => (
        <MetaLine
          key={i}
          items={[
            { tone: CHECK_LINE[line.state].tone, strong: CHECK_LINE[line.state].word },
            { text: line.label, mono: true },
            line.detail !== undefined && { text: line.detail },
            line.outputUrl !== undefined && outputLink(line.outputUrl),
          ]}
        />
      ))}
    </div>
  )
}

function PassMilestone({
  pass,
  staged,
  onStage,
}: {
  pass: PassNode
  staged: string | null
  onStage: (ticketId: string) => void
}) {
  const unverified = pass.verdict === 'unverified'
  return (
    <TimelineNode
      variant="milestone"
      tone={passTone(pass)}
      icon={pass.passKind === 'verification' ? <IconCheck /> : <IconShield />}
      title={`${pass.passKind === 'verification' ? 'Verification' : 'Review'} #${pass.seq}`}
      meta={<PassMeta pass={pass} />}
      aside={
        <>
          {pass.completedAt ? (
            <span className="text-xs text-text-tertiary" title={fmtDateTime(pass.completedAt)}>
              {relTimeAgo(pass.completedAt)}
            </span>
          ) : null}
          {pass.videoUrl && (
            <Button
              size="sm"
              variant="ghost"
              icon={<IconPlay />}
              aria-pressed={staged === pass.ticketId}
              onClick={() => onStage(pass.ticketId)}
            >
              Recording
            </Button>
          )}
        </>
      }
    >
      {/* An unverified pass states the line runcastle templated (decision 5)
          — never the agent's own prose, which is in the Full account. */}
      {(pass.account || pass.reason) && (
        <div className="flex flex-col gap-0.5 text-sm text-pretty">
          {pass.account && <span className={unverified ? 'text-warning' : 'text-text-secondary'}>{pass.account}</span>}
          {pass.reason && <span className="text-text-tertiary">{pass.reason}</span>}
        </div>
      )}
      {pass.gateRun && <PassChecks gateRun={pass.gateRun} />}
    </TimelineNode>
  )
}

/** "Burned 3 fixes" — or Burning while one is, or Queued while none has started. */
function burnTitle(node: BurnNode) {
  const verb = node.tickets.some((t) => t.status === 'burning')
    ? 'Burning'
    : node.tickets.some((t) => t.status === 'done')
      ? 'Burned'
      : 'Queued'
  // A cancelled ticket keeps its row, but leaves the count (decision 2).
  const n = node.tickets.filter((t) => t.status !== 'cancelled').length
  const what = node.fixes ? (n === 1 ? 'fix' : 'fixes') : n === 1 ? 'ticket' : 'tickets'
  return (
    <>
      {verb} <span className="font-medium text-text">{`${n} ${what}`}</span>
    </>
  )
}

function BurnStep({ node, lap, onViewRun }: { node: BurnNode; lap: number; onViewRun?: () => void }) {
  return (
    <TimelineNode title={burnTitle(node)}>
      <List label={`Lap ${lap} ${node.fixes ? 'fixes' : 'tickets'}`}>
        {node.tickets.map((ticket) => (
          <ListRow
            key={ticket.id}
            className="-ml-3"
            title={`#${ticket.seq ?? '?'} · ${ticket.title ?? 'Ticket'}`}
            meta={
              ticket.status === 'done' ? (
                ticket.completedAt ? relTimeAgo(ticket.completedAt) : undefined
              ) : (
                <TicketStatusChip status={ticket.status as 'pending'} />
              )
            }
            {...(onViewRun ? { onClick: onViewRun } : {})}
          />
        ))}
      </List>
    </TimelineNode>
  )
}

function LapTimeline({
  entry,
  tickets,
  findings,
  staged,
  onStage,
  onViewRun,
}: {
  entry: TrailEntry
  tickets: readonly TimelineTicket[]
  findings: readonly TimelineFinding[]
  staged: string | null
  onStage: (ticketId: string) => void
  onViewRun?: () => void
}) {
  const nodes = lapTimeline(entry, tickets, findings)
  if (nodes.length === 0) return null
  return (
    <Timeline label={`Lap ${entry.lap}`}>
      {nodes.map((node) =>
        node.kind === 'pass' ? (
          <PassMilestone key={node.ticketId} pass={node} staged={staged} onStage={onStage} />
        ) : (
          <BurnStep
            key={node.tickets[0]!.id}
            node={node}
            lap={entry.lap}
            {...(onViewRun ? { onViewRun } : {})}
          />
        ),
      )}
    </Timeline>
  )
}

export function ReviewTrail({
  passes,
  tickets,
  findings,
  notes,
  currentLap,
  staged,
  onStage,
  onViewRun,
}: {
  /** Every review pass this feature ran, from the artifacts feed. */
  passes: readonly ReviewPassFigure[]
  /** The feature's tickets — what burned, and what the feed cannot say. */
  tickets: readonly TimelineTicket[]
  findings: readonly TimelineFinding[]
  notes: readonly { lap: number }[]
  currentLap: number
  /** The recording the stage is playing, so its button reads as the pressed one. */
  staged: string | null
  /** Put this pass's recording on the stage — the page owns which one is up. */
  onStage: (ticketId: string) => void
  /** Go to the run view, where the lap's lanes are. Absent where it cannot. */
  onViewRun?: () => void
}) {
  // Nothing reviewed and nothing burned: no laps to tell, and a heading over a
  // line saying so would be the dead box the page no longer draws. Otherwise
  // the current lap is always told, even before its own review has run — a lap
  // not reviewed yet reads differently from a lap that does not exist.
  if (passes.length === 0 && tickets.length === 0) return null
  const entries = lapTrail({ passes, tickets, findings, notes, currentLap })
    .filter(
      (e) =>
        e.lap === currentLap ||
        e.passes.length > 0 ||
        tickets.some((t) => t.lap === e.lap) ||
        e.defects.found > 0 ||
        e.notes > 0,
    )
    .reverse()
  const current = entries.find((e) => e.lap === currentLap)!
  const earlier = entries.filter((e) => e !== current)

  const timeline = (entry: TrailEntry) => (
    <LapTimeline
      entry={entry}
      tickets={tickets}
      findings={findings}
      staged={staged}
      onStage={onStage}
      {...(onViewRun ? { onViewRun } : {})}
    />
  )

  return (
    <section id="lap-trail" className="flex flex-col gap-1">
      <SectionLabel>History</SectionLabel>
      {earlier.map((entry) => (
        <Disclosure
          key={entry.lap}
          bare
          title={
            <span className="flex min-w-0 items-center gap-4">
              <span className="font-medium text-text">Lap {entry.lap}</span>
              <MetaLine items={lapMeta(entry)} className="min-w-0" />
            </span>
          }
        >
          {timeline(entry)}
        </Disclosure>
      ))}
      <div className="flex flex-col">
        <div className="flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1">
          <h3 className="m-0 text-sm font-medium text-text">Lap {current.lap}</h3>
          <MetaLine items={timeItems(current)} />
        </div>
        {timeline(current)}
      </div>
    </section>
  )
}
