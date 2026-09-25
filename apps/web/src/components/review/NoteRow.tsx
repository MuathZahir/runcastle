import type { ReactNode } from 'react'
import { fmtClock, type ReviewFinding, type TestNote } from '@runcastle/core'
import { cx, Disclosure, FindingSeverityChip, LINK, NoteAuthorChip, NoteThumbnail } from '../../ui'
import { findingOpenReason, headline } from '../../lib/feature-ui'
import { findingStanding, type FindingStanding } from '../../lib/feature-ui/review'
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

/**
 * What a defect wrote, one click away — the walls decision 5(4) demoted. A
 * compact text-level `Disclosure` (`size="sm"`): its headline wraps, the rest
 * opens beneath it.
 */
function FindingDetail({ finding }: { finding: ReviewFinding }) {
  const { head, rest } = headline(finding.detail)
  const location = finding.location.trim()
  return (
    <Disclosure size="sm" title={head} bodyClassName="flex flex-col gap-1">
      {rest && <p className="m-0 text-pretty">{rest}</p>}
      {location && <div className="font-mono text-xs text-text-tertiary">{location}</div>}
      <div className="font-mono text-xs text-text-tertiary">{finding.citation}</div>
      {finding.reproStep && <div className="font-mono text-xs text-text-tertiary">{finding.reproStep}</div>}
    </Disclosure>
  )
}

/**
 * What a defect's standing is worth, in colour: a parked one is quiet, a
 * session's attestation is amber because nothing verified it, and a landed fix
 * ticket is the only green one. Whole classes in a lookup map, never
 * interpolated — Tailwind's scanner cannot see a built class name (STYLE.md).
 */
const EVIDENCE_TONE: Record<FindingStanding['evidence'], string> = {
  carried: 'text-text-tertiary',
  attested: 'text-warning',
  verified: 'text-success',
}

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
      ? `Promoted to ${item.kind === 'note' && item.ticket ? `#${item.ticket.seq} ${item.ticket.title}` : 'a ticket'}`
      : note?.status === 'carried'
        ? `carried into lap ${note.carriedLap}`
        : null
  const text = note?.text ?? finding?.title ?? ''
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
  // The defect's half of the same statement: where a carried one was parked, or
  // — for one that is closed — whether a fix ticket verified it or a lap session
  // attested it. Part of the record too, so it survives `readonly`.
  const disposition = finding ? findingStanding(finding) : null
  const fixing = item.kind === 'defect' ? item.fixTicket : undefined

  return (
    <div
      id={rowElementId(itemId(item))}
      data-list-row=""
      className={cx(
        'group/row flex gap-3 rounded-md px-3 py-3 animate-rise-in',
        'transition-colors duration-(--dur-2) ease-app',
        highlighted ? 'bg-accent-subtle' : 'hover:bg-surface-hover',
      )}
    >
      <NoteThumbnail url={note?.screenshotUrl} onOpen={onOpenImage} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {editor ?? (
          <p
            className={cx(
              'm-0 text-sm text-pretty whitespace-pre-wrap',
              note?.status === 'done' ? 'text-text-tertiary line-through' : 'text-text',
            )}
          >
            {text}
          </p>
        )}

        <div className="flex min-h-4 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
          {finding && <FindingSeverityChip severity={finding.severity} />}
          {note && <NoteAuthorChip author={note.author} />}
          {showLap && <span>Lap {itemLap(item)}</span>}
          {moment !== undefined &&
            (mode === 'live-seek' ? (
              <button
                type="button"
                className="cursor-pointer rounded-sm font-mono tabular-nums text-text-tertiary transition-colors duration-(--dur-1) hover:text-accent-text"
                title="jump the walkthrough to this moment"
                onClick={() => onSeek?.(moment)}
              >
                {fmtClock(moment)}
              </button>
            ) : (
              // The recording this was drawn on is not the one on the stage, so
              // the moment is a label and the picture is the evidence
              // (decision 22).
              <span className="font-mono tabular-nums">{fmtClock(moment)} · earlier walkthrough</span>
            ))}
          {why && <span className="text-warning">{why}</span>}
          {standing && <span>{standing}</span>}
          {disposition && <span className={EVIDENCE_TONE[disposition.evidence]}>{disposition.text}</span>}
          {fixing &&
            (readonly || !onViewLane ? (
              <span className="text-phase-implementation">fixed in the burn by #{fixing.seq}</span>
            ) : (
              <button
                type="button"
                className={LINK}
                onClick={() => onViewLane(fixing.id)}
              >
                being fixed in the running burn · lane #{fixing.seq}
              </button>
            ))}
        </div>

        {disposition?.note && <p className="m-0 text-sm text-pretty text-text-secondary">{disposition.note}</p>}

        {finding && <FindingDetail finding={finding} />}
      </div>

      {!readonly && controls && <div className="-my-0.5 flex shrink-0 items-start gap-1">{controls}</div>}
    </div>
  )
}
