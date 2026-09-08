import { EmptyState, SectionTitle } from '../../ui'
import { NoteComposer } from './NoteComposer'
import { WorkList, type WorkRow } from './WorkList'

/**
 * "What still needs attention" — the review agent's defects and the human's
 * notes as ONE list (decision 18c), and the visual centre of arrival
 * (decision 8).
 *
 * They were two lists with two designs and two vocabularies even though they
 * share their triage destinations, and the split is what let a defect being
 * fixed in the running burn be invisible while a note about the same thing sat
 * three cards away. One list, one row anatomy ({@link WorkList}), one lap
 * grouping.
 *
 * Only what is genuinely unaddressed is here: {@link partitionWork} files
 * everything already dealt with into the settled half, which the page renders
 * inside its Full account disclosure instead. Observations are not rows at all —
 * after decision 1 redrew the defect boundary, what is left in that bucket is
 * inert by construction and lives in the same disclosure (decision 2).
 */
export function OpenWork({
  featureId,
  lap,
  rows,
  readonly,
  onStage,
  onSeek,
  onViewLane,
  highlight,
  scrollTo,
}: {
  featureId: string
  /** The feature's current lap — which group the lap sections open on. */
  lap: number
  /** What still needs attention, from {@link partitionWork}. */
  rows: readonly WorkRow[]
  readonly: boolean
  /** The recording the stage is playing, or null when none is (decision 22). */
  onStage: { ticketId: string } | null
  /** Send that recording to a moment — the stage comes into view with it. */
  onSeek?: (seconds: number) => void
  onViewLane?: (ticketId: string) => void
  /** Rows to mark briefly: a marker click, or a note just captured. */
  highlight?: readonly string[]
  /** A row to bring into view — the other direction of the same jump. */
  scrollTo?: string | null
}) {
  // A defect the burn is fixing still needs watching but is not the human's
  // problem, so the tally says both rather than calling it open.
  const beingFixed = rows.filter((r) => r.item.kind === 'defect' && r.item.fixTicket).length
  const tally = [`${rows.length - beingFixed} open`]
  if (beingFixed > 0) tally.push(`${beingFixed} being fixed`)

  return (
    <section id="open-work" className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <SectionTitle>What still needs attention</SectionTitle>
        <span className="font-mono text-xs text-text-3">{tally.join(' · ')}</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          compact
          title="Nothing needs attention"
          hint={
            readonly
              ? 'Nothing was left open when this feature shipped.'
              : 'The review found nothing open and you have written no notes. Take a test drive and write what you see.'
          }
        />
      ) : (
        <WorkList
          featureId={featureId}
          rows={rows}
          readonly={readonly}
          currentLap={lap}
          onStage={onStage}
          onSeek={onSeek}
          onViewLane={onViewLane}
          highlight={highlight}
          scrollTo={scrollTo}
        />
      )}

      {!readonly && <NoteComposer featureId={featureId} />}
    </section>
  )
}
