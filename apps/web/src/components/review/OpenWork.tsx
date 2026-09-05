import { useEffect, useState } from 'react'
import type { ReviewFinding, TestNote } from '@runcastle/core'
import { Button, EmptyState, LapSections, SectionTitle } from '../../ui'
import { trpc } from '../../trpc'
import type { FeatureFull } from '../../lib/api'
import { findingCountsLine, groupByLap, headline, type FindingCounts } from '../../lib/feature-ui'
import { useToast } from '../../lib/toast'
import { DeleteNoteDialog, NoteComposer, NoteEditor } from './NoteComposer'
import { Lightbox } from './Lightbox'
import { NoteRow, itemId, rowElementId, type NoteItem } from './NoteRow'


/**
 * "What still needs attention" — the review agent's defects and the human's
 * notes as ONE section (decision 18c).
 *
 * They were two lists with two designs and two vocabularies even though they
 * share their triage destinations, and the split is what let a defect being
 * fixed in the running burn be invisible while a note about the same thing sat
 * three cards away. One list, one row anatomy ({@link NoteRow}), one lap
 * grouping.
 *
 * Everything that has been dealt with — carried into a lap, quick-fixed into a
 * ticket, scratched off, fixed or dismissed — leaves this list at the moment it
 * is dealt with (decision 27b) and lands in the collapsed group underneath,
 * where it keeps its evidence and can be reopened. So the rows above are only
 * ever what is genuinely unaddressed.
 */

/** One row of either list, in the shape the lap grouping reads. */
interface WorkRow {
  lap: number
  item: NoteItem
}

/** Where a defect stands, keyed off the server's own open set so it cannot
 *  disagree with the count beside it — the only thing derived here is
 *  fixed-versus-fixing, which the join with the fix ticket decides. */
type DefectStanding = 'open' | 'fixing' | 'fixed' | 'dismissed'

function defectStanding(
  finding: ReviewFinding,
  openIds: ReadonlySet<string>,
  fixTicket: FeatureFull['tickets'][number] | undefined,
): DefectStanding {
  if (openIds.has(finding.id)) return 'open'
  if (finding.status === 'dismissed') return 'dismissed'
  if (finding.status === 'fixed' || fixTicket?.status === 'done') return 'fixed'
  return 'fixing'
}

/**
 * Newest first, defects before notes within a lap: the review agent's report is
 * what a returning human came to read, and their own notes are what they wrote
 * while reading it.
 */
function byUrgency(a: WorkRow, b: WorkRow): number {
  if (a.item.kind !== b.item.kind) return a.item.kind === 'defect' ? -1 : 1
  const at = a.item.kind === 'note' ? a.item.note.createdAt : a.item.finding.createdAt
  const bt = b.item.kind === 'note' ? b.item.note.createdAt : b.item.finding.createdAt
  return bt - at
}

/**
 * The counts line and the observations, at the head of the section they are a
 * verdict about (this was the deleted Summary card's lead block). Observations
 * are everything the review saw that no fix ticket could act on, so they are
 * information here and never rows in a list the human has to clear.
 */
function FindingsSummaryBlock({
  summary,
  findings,
}: {
  summary?: FindingCounts
  findings: readonly ReviewFinding[]
}) {
  const line = findingCountsLine(summary)
  if (!line) return null
  const observations = findings.filter((f) => f.kind === 'observation')

  return (
    <div className="flex flex-col gap-2 border-b border-hairline-soft pb-4">
      <div className="font-mono text-xs text-text-2">{line}</div>
      {observations.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {observations.map((finding) => (
            <li key={finding.id} className="flex flex-col">
              <span className="text-sm text-text-2">{finding.title}</span>
              <details className="min-w-0">
                <summary className="cursor-pointer list-none text-sm text-text-3 underline decoration-dotted">
                  {headline(finding.detail).head}
                </summary>
                <div className="mt-1.5 text-sm leading-relaxed text-pretty text-text-2">
                  {finding.detail}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function OpenWork({
  featureId,
  lap,
  tickets,
  notes,
  findings,
  summary,
  openDefects,
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
  tickets: FeatureFull['tickets']
  notes: readonly TestNote[]
  /** Everything the review reported — the observations among them lead here. */
  findings: readonly ReviewFinding[]
  summary?: FindingCounts
  /** The server's own open set, so this list cannot disagree with the counts. */
  openDefects: readonly ReviewFinding[]
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
  const utils = trpc.useUtils()
  const toast = useToast()
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<TestNote | null>(null)
  const [picture, setPicture] = useState<string | null>(null)

  const onError = (e: { message: string }): void => toast.push(e.message)
  const refreshNotes = (): void => void utils.notes.list.invalidate({ featureId })
  // Dismissing is how the open count reaches zero without a burn — a defect the
  // human judged shippable is a decision, not a fix.
  const dismiss = trpc.findings.dismiss.useMutation({
    onSuccess: () => void utils.findings.listByFeature.invalidate({ featureId }),
    onError,
  })
  const toggle = trpc.notes.toggle.useMutation({ onSuccess: refreshNotes, onError })
  const reopen = trpc.notes.reopen.useMutation({ onSuccess: refreshNotes, onError })
  // One note mutation in flight at a time: the list is about to be refetched, so
  // a second click would act on a row the server is already moving.
  const busy = toggle.isPending || reopen.isPending

  const openIds = new Set(openDefects.map((f) => f.id))
  const ticketOf = (id: string | null): FeatureFull['tickets'][number] | undefined =>
    id ? tickets.find((t) => t.id === id) : undefined

  const attention: WorkRow[] = []
  const settled: WorkRow[] = []
  for (const finding of findings) {
    if (finding.kind !== 'defect') continue
    const fix = ticketOf(finding.fixTicketId)
    const standing = defectStanding(finding, openIds, fix)
    const item: NoteItem = {
      kind: 'defect',
      finding,
      ...(standing === 'fixing' && fix ? { fixTicket: { id: fix.id, seq: fix.seq } } : {}),
    }
    ;(standing === 'open' || standing === 'fixing' ? attention : settled).push({
      lap: finding.lap,
      item,
    })
  }
  for (const note of notes) {
    const ticket = ticketOf(note.ticketId ?? null)
    const row: WorkRow = {
      lap: note.lap,
      item: { kind: 'note', note, ...(ticket ? { ticket: { seq: ticket.seq, title: ticket.title } } : {}) },
    }
    ;(note.status === 'open' ? attention : settled).push(row)
  }
  attention.sort(byUrgency)
  settled.sort(byUrgency)

  // Both directions of a jump are visible (decision 25b): a marker click or a
  // fresh annotation brings its row into view rather than changing the list off
  // screen. Re-runs as the list arrives, so a note saved a moment ago is scrolled
  // to when its query settles rather than being missed.
  useEffect(() => {
    if (!scrollTo) return
    document
      .getElementById(rowElementId(scrollTo))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [scrollTo, notes])

  const marked = new Set(highlight ?? [])

  const rowFor = (row: WorkRow, showLap: boolean) => (
    <NoteRow
      key={itemId(row.item)}
      item={row.item}
      onStage={onStage}
      readonly={readonly}
      showLap={showLap}
      highlighted={marked.has(itemId(row.item))}
      editor={
        row.item.kind === 'note' && editing === row.item.note.id ? (
          <NoteEditor note={row.item.note} onDone={() => setEditing(null)} />
        ) : undefined
      }
      controls={controlsFor(row.item)}
      onSeek={onSeek}
      onOpenImage={setPicture}
      onViewLane={onViewLane}
    />
  )

  function controlsFor(item: NoteItem) {
    if (item.kind === 'defect') {
      // Only a defect the server still calls open is the human's to wave away;
      // one being fixed has not been given up on yet.
      if (!openIds.has(item.finding.id)) return undefined
      return (
        <Button className="px-2" disabled={dismiss.isPending} onClick={() => dismiss.mutate({ findingId: item.finding.id })}>
          Dismiss
        </Button>
      )
    }

    const note = item.note
    // A promoted note is frozen as the record of what its ticket was built from,
    // so it offers nothing at all; the row states where it went itself.
    if (note.status === 'promoted') return undefined
    if (note.status === 'carried') {
      return (
        <Button className="px-2" disabled={busy} onClick={() => reopen.mutate({ noteId: note.id })}>
          Reopen
        </Button>
      )
    }
    if (editing === note.id) return undefined
    return (
      <span className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 font-mono text-xs text-text-3">
          <input
            type="checkbox"
            className="size-3.5 accent-accent"
            checked={note.status === 'done'}
            disabled={busy}
            onChange={() => toggle.mutate({ noteId: note.id })}
          />
          done
        </label>
        {note.status === 'open' && (
          <>
            <Button className="px-2" onClick={() => setEditing(note.id)}>
              Edit
            </Button>
            <Button className="px-2" onClick={() => setDeleting(note)}>
              Delete
            </Button>
          </>
        )}
      </span>
    )
  }

  return (
    <section id="open-work" className="flex flex-col gap-4">
      <FindingsSummaryBlock summary={summary} findings={findings} />

      <div className="flex items-baseline gap-3">
        <SectionTitle>What still needs attention</SectionTitle>
        <span className="font-mono text-xs text-text-3">
          {attention.length === 0 ? 'nothing open' : `${attention.length} open`}
        </span>
      </div>

      {attention.length === 0 ? (
        <EmptyState
          compact
          title="Nothing needs attention"
          hint={
            readonly
              ? 'Nothing was left open when this feature shipped.'
              : 'The review found nothing open and you have written no notes. Open the app above and write what you see.'
          }
        />
      ) : (
        <div className="flex flex-col">
          <LapSections
            groups={groupByLap(attention, lap)}
            currentLap={lap}
            meta={(g) => `${g.rows.length} open`}
          >
            {(rows) => rows.map((row) => rowFor(row, false))}
          </LapSections>
        </div>
      )}

      {!readonly && <NoteComposer featureId={featureId} />}

      {settled.length > 0 && (
        <details className="rounded-md border border-hairline bg-panel-2 px-4 py-2">
          <summary className="cursor-pointer list-none py-1 text-sm text-text-3">
            Carried, quick-fixed and handled ({settled.length})
          </summary>
          <div className="flex flex-col pb-2">
            {settled.map((row) => rowFor(row, true))}
          </div>
        </details>
      )}

      <Lightbox url={picture} onClose={() => setPicture(null)} />
      <DeleteNoteDialog note={deleting} onClose={() => setDeleting(null)} />
    </section>
  )
}
