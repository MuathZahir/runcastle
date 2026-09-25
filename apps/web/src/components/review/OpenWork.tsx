import { useRef, type RefObject } from 'react'
import { EmptyState } from '../../ui'
import { IconInbox } from '../../icons'
import { NoteComposer } from './NoteComposer'
import { WorkList, type WorkRow } from './WorkList'

/**
 * "What still needs attention" — the review agent's defects and the human's
 * notes as ONE list (decision 18c), and the content of the notes rail
 * ({@link NotesRail}) that stands beside the stage at all times (decision 2).
 *
 * It is laid out as the rail is: a heading that stays put, a scroll region of
 * its own holding the rows, and the composer pinned to the bottom. Writing a
 * note therefore never moves the list, and reading the list never moves the
 * stage — which is the whole point of the rail (revising decision 18's band
 * order, where this sat below the fold).
 *
 * They were two lists with two designs and two vocabularies even though they
 * share their triage destinations, and the split is what let a defect being
 * fixed in the running burn be invisible while a note about the same thing sat
 * three cards away. One list, one row anatomy ({@link WorkList}), one lap
 * grouping.
 *
 * Only what is genuinely unaddressed is here: the page's one partition (see
 * `partitionWork`) files everything already dealt with into the settled half,
 * which it renders inside the Full account disclosure instead. Observations are not rows at all —
 * after decision 1 redrew the defect boundary, what is left in that bucket is
 * inert by construction and lives in the same disclosure (decision 2).
 */
export interface OpenWorkProps {
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
}

/** "2 open · 1 being fixed" — a defect the burn is fixing still needs watching but is not the human's problem. */
export function openTally(rows: readonly WorkRow[]): string {
  const beingFixed = rows.filter((r) => r.item.kind === 'defect' && r.item.fixTicket).length
  const tally = [`${rows.length - beingFixed} open`]
  if (beingFixed > 0) tally.push(`${beingFixed} being fixed`)
  return tally.join(' · ')
}

/**
 * The page's section form (DESIGN.md: no permanent right rail). It appears only
 * when there is something: rows under a "Needs attention" heading, and — on the
 * live page — the composer under them. With nothing open, a live page keeps
 * only the composer under a quiet "Notes" heading, and a history view renders
 * nothing at all.
 */
export function OpenWork({ featureId, lap, rows, readonly, ...rest }: OpenWorkProps) {
  if (rows.length === 0 && readonly) return null
  const empty = rows.length === 0

  return (
    <section id="open-work" className="flex flex-col gap-2">
      <div className="flex min-h-7 items-baseline gap-3">
        <h2 className="m-0 text-lg font-semibold text-text">{empty ? 'Notes' : 'Needs attention'}</h2>
        {!empty && <span className="text-xs text-text-tertiary tabular-nums">{openTally(rows)}</span>}
      </div>
      {empty ? (
        <p className="m-0 text-sm text-text-tertiary">
          Nothing needs attention. Write down what you see while you drive — a pasted screenshot rides
          along.
        </p>
      ) : (
        <WorkList featureId={featureId} rows={rows} readonly={readonly} currentLap={lap} {...rest} />
      )}
      {!readonly && (
        <div className="mt-2">
          <NoteComposer featureId={featureId} />
        </div>
      )}
    </section>
  )
}

/**
 * The aside form: the same rows in a scroller of their own with the composer
 * pinned under them, so writing a note never moves the list and reading the
 * list never moves the stage. What {@link NotesRail} puts in the one aside.
 */
export function OpenWorkPane({
  featureId,
  lap,
  rows,
  readonly,
  scroller,
  ...rest
}: OpenWorkProps & { scroller: RefObject<HTMLDivElement | null> }) {
  return (
    <>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        {rows.length === 0 ? (
          <EmptyState
            compact
            icon={<IconInbox />}
            title="Nothing needs attention"
            hint={
              readonly
                ? 'Nothing was left open when this feature shipped.'
                : 'The review found nothing open and you have written no notes. Write what you see.'
            }
          />
        ) : (
          <WorkList
            featureId={featureId}
            rows={rows}
            readonly={readonly}
            currentLap={lap}
            scroller={scroller}
            {...rest}
          />
        )}
      </div>
      {!readonly && (
        <div className="shrink-0 border-t border-border-subtle p-3">
          <NoteComposer featureId={featureId} />
        </div>
      )}
    </>
  )
}

/** The rail's own scroller, owned by whoever frames the pane. */
export function usePaneScroller(): RefObject<HTMLDivElement | null> {
  return useRef<HTMLDivElement>(null)
}
