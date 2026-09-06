import type { ReactNode } from 'react'
import { fmtClock, type ReviewFinding, type TestNote } from '@runcastle/core'
import { FindingSeverityChip, NoteAuthorChip } from '../../ui'
import { findingOpenReason, headline } from '../../lib/feature-ui'
import { timestampMode } from '../../lib/walkthrough'

/**
 * ONE row anatomy for everything that still needs attention (decisions 18c and
 * 25a).
 *
 * The review agent's defects and the human's drive/annotation notes were two
 * lists with two row designs and two vocabularies, even though they share their
 * triage destinations — so they are one row here, and the triage step imports
 * this rather than cloning it (decision 26a). What differs between a note and a
 * defect is which chip it carries and whether it has a picture; everything else
 * — evidence first, then the words, then the reason — is the same shape.
 *
 * Evidence-forward is the point (walk dead ends 11–15): the thumbnail that
 * justifies a note is big enough to read at ~96×54 and opens in the app rather
 * than in a browser tab, the timestamp is a live jump only into the recording it
 * was actually taken against, and the full text is on the row instead of behind
 * a one-line headline the human had to open to learn whether it mattered.
 *
 * Hook-free: everything it needs arrives as props, so its whole behaviour is the
 * markup it emits and it is testable without a tRPC provider.
 */

/** A row's subject: a test note, or a defect the review agent reported. */
export type NoteItem =
  | {
      kind: 'note'
      note: TestNote
      /** The ticket a quick-fixed note was frozen into, when it was one. */
      ticket?: { seq: number; title: string }
    }
  | {
      kind: 'defect'
      finding: ReviewFinding
      /** The fix ticket burning it right now, when one is (decision 18c). */
      fixTicket?: { id: string; seq: number }
    }

/** The row's own id — the notes and findings tables never share one. */
export function itemId(item: NoteItem): string {
  return item.kind === 'note' ? item.note.id : item.finding.id
}

/** Which lap this row belongs under, for the list's lap grouping. */
export function itemLap(item: NoteItem): number {
  return item.kind === 'note' ? item.note.lap : item.finding.lap
}

/** The DOM id a jump or a highlight addresses a row by, from its item id. */
export function rowElementId(id: string): string {
  return `work-${id}`
}

/** What a defect wrote, one click away — the walls decision 5(4) demoted. */
function FindingDetail({ finding }: { finding: ReviewFinding }) {
  const { head, rest } = headline(finding.detail)
  const location = finding.location.trim()
  return (
    <details className="min-w-0">
      <summary className="cursor-pointer list-none text-sm text-text-3 underline decoration-dotted">
        {head}
      </summary>
      <div className="mt-1.5 flex flex-col gap-1 text-sm leading-relaxed text-text-2">
        {rest && <p className="m-0 text-pretty">{rest}</p>}
        {location && <div className="font-mono text-xs text-text-3">{location}</div>}
        <div className="font-mono text-xs text-text-3">{finding.citation}</div>
        {finding.reproStep && <div className="font-mono text-xs text-text-3">{finding.reproStep}</div>}
      </div>
    </details>
  )
}

const LAP_BADGE =
  'inline-flex h-5 shrink-0 items-center rounded-pill border border-hairline px-2 font-mono text-xs text-text-3'

export function NoteRow({
  item,
  onStage,
  readonly,
  controls,
  editor,
  highlighted = false,
  showLap = false,
  onSeek,
  onOpenImage,
  onViewLane,
}: {
  item: NoteItem
  /** The recording the stage is playing, or null when none is (decision 22). */
  onStage: { ticketId: string } | null
  /** Looking back at review on a shipped feature — evidence, never an action. */
  readonly: boolean
  /** Edit / Delete / Dismiss / Reopen, or the triage step's checkbox. */
  controls?: ReactNode
  /** The in-place editor; it takes the text's place and leaves the evidence up. */
  editor?: ReactNode
  /** Briefly marked — a jump landed here, or this row was just captured. */
  highlighted?: boolean
  /** Laps span this list, so say which one this is from (decision 25a). */
  showLap?: boolean
  onSeek?: (seconds: number) => void
  onOpenImage: (url: string) => void
  /** Go to the lane fixing this defect in the running burn (decision 18c). */
  onViewLane?: (ticketId: string) => void
}) {
  const note = item.kind === 'note' ? item.note : undefined
  const finding = item.kind === 'defect' ? item.finding : undefined
  // Where a note ended up, as a statement rather than a control: it is part of
  // the record and so survives `readonly`, which drops every action (decision 33a).
  const standing =
    note?.status === 'promoted'
      ? `→ ${item.kind === 'note' && item.ticket ? `#${item.ticket.seq} ${item.ticket.title}` : 'quick-fixed into a ticket'}`
      : note?.status === 'carried'
        ? `carried into lap ${note.carriedLap}`
        : null
  const text = note?.text ?? finding?.title ?? ''
  const picture = note?.screenshotUrl
  const moment = note?.videoTimestamp
  const mode = timestampMode(
    {
      id: itemId(item),
      videoTimestamp: note?.videoTimestamp ?? null,
      reviewTicketId: note?.reviewTicketId ?? null,
    },
    onStage,
  )
  const why = finding ? findingOpenReason(finding) : null
  const fixing = item.kind === 'defect' ? item.fixTicket : undefined

  return (
    <div
      id={rowElementId(itemId(item))}
      className={`flex gap-3 border-t border-hairline-soft py-3 transition-colors duration-(--dur-2) ease-app first:border-t-0 ${
        highlighted ? 'bg-accent-soft' : ''
      }`}
    >
      {picture && (
        <button
          type="button"
          className="h-[54px] w-24 shrink-0 overflow-hidden rounded-sm border border-hairline bg-black p-0 hover:border-accent-line"
          title="see the whole picture"
          onClick={() => onOpenImage(picture)}
        >
          <img
            src={picture}
            alt="the picture attached to this note"
            className="h-full w-full object-cover"
          />
        </button>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {moment !== undefined &&
            (mode === 'live-seek' ? (
              <button
                type="button"
                className="border-0 bg-transparent p-0 font-mono text-xs text-text-3 hover:text-accent"
                title="jump the walkthrough to this moment"
                onClick={() => onSeek?.(moment)}
              >
                {fmtClock(moment)}
              </button>
            ) : (
              // The recording this was drawn on is not the one on the stage, so
              // the moment is a label and the picture is the evidence
              // (decision 22).
              <span className="font-mono text-xs text-text-3">
                {fmtClock(moment)} · earlier walkthrough
              </span>
            ))}

          {finding && <FindingSeverityChip severity={finding.severity} />}
          {note && <NoteAuthorChip author={note.author} />}
          {showLap && <span className={LAP_BADGE}>Lap {itemLap(item)}</span>}

          <span className="flex-1" />
          {!readonly && controls}
        </div>

        {editor ?? (
          <p
            className={`m-0 text-sm text-pretty whitespace-pre-wrap ${
              note?.status === 'done' ? 'text-text-3 line-through' : 'text-text'
            }`}
          >
            {text}
          </p>
        )}

        {why && <div className="font-mono text-xs text-warn">{why}</div>}
        {standing && <div className="font-mono text-xs text-text-3">{standing}</div>}

        {fixing &&
          (readonly || !onViewLane ? (
            <div className="font-mono text-xs text-ph-implementation">
              fixed in the burn by #{fixing.seq}
            </div>
          ) : (
            <button
              type="button"
              className="self-start border-0 bg-transparent p-0 font-mono text-xs text-ph-implementation underline decoration-dotted"
              onClick={() => onViewLane(fixing.id)}
            >
              being fixed in the running burn · lane #{fixing.seq}
            </button>
          ))}

        {finding && <FindingDetail finding={finding} />}
      </div>
    </div>
  )
}
