import { useEffect, useState, type RefObject } from 'react'
import type { ReviewFinding, TestNote } from '@runcastle/core'
import { Button, IconButton, LapSections } from '../../ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../ui/dropdown-menu'
import { IconCheck, IconMore, IconPencil, IconTrash, IconUndo, IconX } from '../../icons'
import { trpc } from '../../trpc'
import type { FeatureFull } from '../../lib/api'
import { groupByLap } from '../../lib/feature-ui'
import { useToast } from '../../lib/toast'
import { DeleteNoteDialog, NoteEditor } from './NoteComposer'
import { Lightbox } from './Lightbox'
import { NoteRow, itemId, itemLap, rowElementId, type NoteItem } from './NoteRow'

/**
 * The rows of the review page's work — and the one place that renders them.
 *
 * The list is split in two on the page (decision 8): what still needs attention
 * is the visual centre of arrival, and everything already dealt with sits inside
 * the Full account disclosure at the bottom. They are the same rows with the
 * same anatomy and the same lifecycle controls, so they are one component asked
 * for a different half — {@link partitionWork} decides which row is which, once,
 * so the two halves can never disagree about a row.
 */

/** One row of the list, and where it stands. */
export interface WorkRow {
  lap: number
  item: NoteItem
  /** Still the human's own to act on — a defect the server calls open, or an open note. */
  open: boolean
}

/** Where a defect stands, keyed off the server's own open set so it cannot
 *  disagree with the count beside it. What is left to derive is what that set
 *  cannot say: fixed-versus-fixing, which the join with the fix ticket decides,
 *  and — since the set describes the CURRENT lap only — whether a defect it
 *  leaves out was parked or is an earlier lap's leftover. */
type DefectStanding = 'open' | 'fixing' | 'fixed' | 'dismissed' | 'carried'

function defectStanding(
  finding: ReviewFinding,
  openIds: ReadonlySet<string>,
  fixTicket: FeatureFull['tickets'][number] | undefined,
): DefectStanding {
  if (openIds.has(finding.id)) return 'open'
  if (finding.status === 'dismissed') return 'dismissed'
  // Carried outranks the fix-ticket join, exactly as the server's own state does:
  // a defect is only carriable once its fix attempt was given up on, so the dead
  // ticket must not drag it back into a state the lap has already answered for.
  if (finding.status === 'carried') return 'carried'
  if (finding.status === 'fixed' || fixTicket?.status === 'done') return 'fixed'
  if (fixTicket && fixTicket.status !== 'failed' && fixTicket.status !== 'cancelled') {
    return 'fixing'
  }
  // Outside this lap's open set with no live fix ticket behind it: an earlier
  // lap's leftover, which the server counts on no lap but nobody has answered
  // either — so the row keeps the human's Dismiss rather than claiming a burn
  // is on it.
  return finding.status === 'open' || finding.status === 'failed' ? 'open' : 'fixing'
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
 * The review's defects and the human's notes, split into what still needs
 * attention and what has been dealt with (decision 27b).
 *
 * Everything carried into a lap, quick-fixed into a ticket, scratched off, fixed
 * or dismissed leaves the attention list at the moment it is dealt with and
 * lands in the settled half, where it keeps its evidence and can be reopened. So
 * the rows on arrival are only ever what is genuinely unaddressed.
 */
export function partitionWork(input: {
  /** Everything the review reported — its observations are not rows (decision 2). */
  findings: readonly ReviewFinding[]
  notes: readonly TestNote[]
  tickets: FeatureFull['tickets']
  /** The server's own open set, so these rows cannot disagree with the counts. */
  openDefects: readonly ReviewFinding[]
}): { attention: WorkRow[]; settled: WorkRow[] } {
  const openIds = new Set(input.openDefects.map((f) => f.id))
  const ticketOf = (id: string | null): FeatureFull['tickets'][number] | undefined =>
    id ? input.tickets.find((t) => t.id === id) : undefined

  const attention: WorkRow[] = []
  const settled: WorkRow[] = []
  const file = (item: NoteItem, open: boolean, needsAttention: boolean): void => {
    ;(needsAttention ? attention : settled).push({ lap: itemLap(item), item, open })
  }
  for (const finding of input.findings) {
    if (finding.kind !== 'defect') continue
    const fix = ticketOf(finding.fixTicketId)
    const standing = defectStanding(finding, openIds, fix)
    // A parked defect is neither open work nor settled work: it has its own
    // band (`CarriedFindings`), fed by the server's own carried pile, so filing
    // it here as well would render it twice.
    if (standing === 'carried') continue
    file(
      {
        kind: 'defect',
        finding,
        ...(standing === 'fixing' && fix ? { fixTicket: { id: fix.id, seq: fix.seq } } : {}),
      },
      standing === 'open',
      standing === 'open' || standing === 'fixing',
    )
  }
  for (const note of input.notes) {
    const ticket = ticketOf(note.ticketId ?? null)
    file(
      {
        kind: 'note',
        note,
        ...(ticket ? { ticket: { seq: ticket.seq, title: ticket.title } } : {}),
      },
      note.status === 'open',
      note.status === 'open',
    )
  }
  attention.sort(byUrgency)
  settled.sort(byUrgency)
  return { attention, settled }
}

export function WorkList({
  featureId,
  rows,
  readonly,
  currentLap,
  onStage,
  onSeek,
  onViewLane,
  highlight,
  scrollTo,
  scroller,
}: {
  featureId: string
  rows: readonly WorkRow[]
  readonly: boolean
  /**
   * Group the rows under their `Lap N` headers, opened on this lap. Omitted
   * where the rows are a flat list and each row names its own lap instead.
   */
  currentLap?: number
  /** The recording the stage is playing, or null when none is (decision 22). */
  onStage: { ticketId: string } | null
  /** Send that recording to a moment — the stage comes into view with it. */
  onSeek?: (seconds: number) => void
  onViewLane?: (ticketId: string) => void
  /** Rows to mark briefly: a marker click, or a note just captured. */
  highlight?: readonly string[]
  /** A row to bring into view — the other direction of the same jump. */
  scrollTo?: string | null
  /**
   * The box these rows scroll inside — the notes rail's own scroller, and what a
   * `scrollTo` moves. The settled half sits in no scroller of its own, inside
   * the Full account disclosure, and is the half nothing ever jumps to: it
   * passes neither.
   */
  scroller?: RefObject<HTMLElement | null>
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<TestNote | null>(null)
  const [picture, setPicture] = useState<string | null>(null)

  const onError = (e: { message: string }): void => toast.push(e.message)
  const refreshNotes = (): void => void utils.notes.list.invalidate({ featureId })
  const refreshFindings = (): void => void utils.findings.listByFeature.invalidate({ featureId })
  // Dismissing is how the open count reaches zero without a burn — a defect the
  // human judged shippable is a decision, not a fix.
  const dismiss = trpc.findings.dismiss.useMutation({ onSuccess: refreshFindings, onError })
  // The other half of carry, and the human's alone (decisions #3): a lap session
  // parks a defect, only a person un-parks one.
  const reopenFinding = trpc.findings.reopen.useMutation({ onSuccess: refreshFindings, onError })
  const toggle = trpc.notes.toggle.useMutation({ onSuccess: refreshNotes, onError })
  const reopen = trpc.notes.reopen.useMutation({ onSuccess: refreshNotes, onError })
  // One note mutation in flight at a time: the list is about to be refetched, so
  // a second click would act on a row the server is already moving.
  const busy = toggle.isPending || reopen.isPending

  // Both directions of a jump are visible (decision 25b): a marker click or a
  // fresh annotation brings its row into view rather than changing the list off
  // screen. Re-runs as the list arrives, so a note saved a moment ago is scrolled
  // to when its query settles rather than being missed.
  //
  // The rail's scroller is moved by hand rather than by `scrollIntoView`, which
  // walks every scrollable ancestor: the whole point of the rail is that
  // reaching a note never moves the stage.
  useEffect(() => {
    if (!scrollTo) return
    const row = document.getElementById(rowElementId(scrollTo))
    if (!row) return
    const box = scroller?.current
    // In the page's own flow (no box of its own), the nearest edge is enough —
    // the row comes into view without yanking the page to its middle.
    if (!box) {
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      return
    }
    const rowBox = row.getBoundingClientRect()
    const boxBox = box.getBoundingClientRect()
    box.scrollBy({
      top: rowBox.top - boxBox.top - (boxBox.height - rowBox.height) / 2,
      behavior: 'smooth',
    })
  }, [scrollTo, rows, scroller])

  const marked = new Set(highlight ?? [])

  const rowFor = (row: WorkRow) => (
    <NoteRow
      key={itemId(row.item)}
      item={row.item}
      onStage={onStage}
      readonly={readonly}
      showLap={currentLap === undefined}
      highlighted={marked.has(itemId(row.item))}
      editor={
        row.item.kind === 'note' && editing === row.item.note.id ? (
          <NoteEditor note={row.item.note} onDone={() => setEditing(null)} />
        ) : undefined
      }
      controls={controlsFor(row)}
      onSeek={onSeek}
      onOpenImage={setPicture}
      onViewLane={onViewLane}
    />
  )

  function controlsFor(row: WorkRow) {
    const { item } = row
    if (item.kind === 'defect') {
      const findingId = item.finding.id
      const wave = (
        <Button
          size="sm"
          variant="ghost"
          icon={<IconX />}
          disabled={dismiss.isPending}
          onClick={() => dismiss.mutate({ findingId })}
        >
          Dismiss
        </Button>
      )
      // A parked defect offers both of the human's verbs: back into the open
      // pile, or waved away for good. Nothing about it is the burn's any more.
      if (item.finding.status === 'carried') {
        return (
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={<IconUndo />}
              disabled={reopenFinding.isPending}
              onClick={() => reopenFinding.mutate({ findingId })}
            >
              Reopen
            </Button>
            {wave}
          </>
        )
      }
      // Only a defect the server still calls open is the human's to wave away;
      // one being fixed has not been given up on yet.
      if (!row.open) return undefined
      return wave
    }

    const note = item.note
    // A promoted note is frozen as the record of what its ticket was built from,
    // so it offers nothing at all; the row states where it went itself.
    if (note.status === 'promoted') return undefined
    if (note.status === 'carried') {
      return (
        <Button
          size="sm"
          variant="ghost"
          icon={<IconUndo />}
          disabled={busy}
          onClick={() => reopen.mutate({ noteId: note.id })}
        >
          Reopen
        </Button>
      )
    }
    if (editing === note.id) return undefined
    const done = note.status === 'done'
    return (
      <>
        <IconButton
          size="sm"
          label={done ? 'Mark not done' : 'Mark done'}
          icon={<IconCheck />}
          active={done}
          disabled={busy}
          onClick={() => toggle.mutate({ noteId: note.id })}
        />
        {note.status === 'open' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" label="Note actions" icon={<IconMore />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<IconPencil />} onSelect={() => setEditing(note.id)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem tone="danger" icon={<IconTrash />} onSelect={() => setDeleting(note)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </>
    )
  }

  return (
    <div className="flex flex-col">
      {currentLap === undefined ? (
        rows.map((row) => rowFor(row))
      ) : (
        <LapSections
          groups={groupByLap(rows, currentLap)}
          currentLap={currentLap}
          meta={(g) => `${g.rows.length} open`}
        >
          {(grouped) => grouped.map((row) => rowFor(row))}
        </LapSections>
      )}

      <Lightbox url={picture} onClose={() => setPicture(null)} />
      <DeleteNoteDialog note={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}
