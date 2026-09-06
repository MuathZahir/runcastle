import { useState } from 'react'
import type { ReviewFinding, TestNote } from '@runcastle/core'
import { Button, Dialog, EmptyState, LapSections } from '../../ui'
import { groupByLap, triageFooter, triageRoad } from '../../lib/feature-ui'
import { Lightbox } from './Lightbox'
import { NoteRow, itemId, itemLap, type NoteItem } from './NoteRow'

/**
 * The Iterate door (decisions 21 and 26).
 *
 * Review used to have two routes out of "this isn't ready" — Address notes,
 * which minted tickets from the checked notes, and Iterate, which opened the lap
 * session on all of them — with the same Fix/Iterate fork duplicated inside the
 * dialog and nothing anywhere saying which door to use. They were always one
 * decision, so this is one door: everything still open is listed, each row is
 * either a quick fix or something to talk about, and the two exits fall out of
 * what was ticked rather than being chosen up front.
 *
 * ONE control per row: a Quick fix checkbox, unchecked by default, because
 * minting a ticket is the mechanical act the human opts into per row. There is
 * no per-row "discuss" — discussing is not a per-note act; everything left
 * unticked rides into the ONE lap conversation together, which is what the
 * footer says out loud.
 *
 * Hook-free apart from its own selection: the rows, the standing debt and the
 * commit all arrive as props, so the step is testable as markup and the mutation
 * chain (`notes.triage`, then `feature.burn` or `feature.rethink`) stays in the
 * one place that already owns every other feature mutation.
 */

/** What the human decided, in the shape the commit sends. */
export interface TriageSelection {
  quickFixIds: string[]
  quickFixFindingIds: string[]
  dismissIds: string[]
  dismissFindingIds: string[]
  /** Take the lap road: carry everything left over into the lap conversation. */
  carry: boolean
}

/** One row under its lap, exactly as the open-work band files them. */
interface TriageRow {
  lap: number
  item: NoteItem
}

const DISMISS_PROMPT: Record<NoteItem['kind'], string> = {
  note: 'Delete this note and its picture?',
  defect: 'Dismiss this defect?',
}

/**
 * The door itself. `readonly` is answered here rather than at the call site so
 * the rule survives wherever the step is mounted (decision 33a) — a shipped
 * feature's review is history, and history has no door out.
 */
export function TriageStep(props: TriageStepProps) {
  if (props.readonly) return null
  return (
    <Dialog open onClose={props.onClose} size="xl" label="Iterate — what goes where">
      <TriagePanel {...props} />
    </Dialog>
  )
}

interface TriageStepProps {
  /** The lap the feature is on — the conversation this opens is lap + 1. */
  lap: number
  /** The open notes, in capture order. */
  notes: readonly TestNote[]
  /** The defects the server still calls open. */
  defects: readonly ReviewFinding[]
  /** Unburned fix tickets from earlier laps, which burn along with these. */
  standing: readonly { count: number; lap: number }[]
  /** When the door was opened — anything newer than this arrived while it was. */
  openedAt: number
  busy: boolean
  /** History, not work: a shipped feature's review has no door out (decision 33a). */
  readonly: boolean
  /** Why the lap conversation cannot be opened right now, if it cannot. */
  iterateBlocked?: string
  onCommit: (selection: TriageSelection) => void
  onClose: () => void
}

/**
 * What the door holds. Exported for its tier-1 test: the dialog mechanics —
 * Escape, the backdrop, the focus return — are the foundation `Dialog`'s and are
 * covered by `dialog.test.tsx`, so what is asserted here is the markup
 * (decision 36).
 */
export function TriagePanel({
  lap,
  notes,
  defects,
  standing,
  openedAt,
  busy,
  iterateBlocked,
  onCommit,
  onClose,
}: TriageStepProps) {
  // Unchecked by default (decision 26b): the ticket is what the human opts into.
  const [quickFix, setQuickFix] = useState<ReadonlySet<string>>(new Set())
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const [confirming, setConfirming] = useState<NoteItem | null>(null)
  const [picture, setPicture] = useState<string | null>(null)

  // Defects first, then notes, in the order the queries hand them over — the
  // review agent's report is what the human came to answer, and their own notes
  // are what they wrote while reading it.
  const rows: TriageRow[] = [
    ...defects.map((finding): NoteItem => ({ kind: 'defect', finding })),
    ...notes.map((note): NoteItem => ({ kind: 'note', note })),
  ]
    .filter((item) => !dismissed.has(itemId(item)))
    .map((item) => ({ lap: itemLap(item), item }))

  const toggle = (id: string): void =>
    setQuickFix((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const picked = (row: TriageRow): boolean => quickFix.has(itemId(row.item))
  const minted = rows.filter(picked)
  // Only notes are carried: the lap session reads `test-notes.md`, and a defect
  // left unticked simply stays open work for the pass that comes back.
  const carried = rows.filter((row) => row.item.kind === 'note' && !picked(row))
  const nextLap = lap + 1
  const { road, label } = triageRoad({
    quickFix: minted.length,
    carried: carried.length,
    nextLap,
  })
  const footer = triageFooter({
    quickFix: minted.length,
    carried: carried.length,
    nextLap,
    standing,
  })

  const commit = (carry: boolean): void =>
    onCommit({
      quickFixIds: minted.flatMap((row) => (row.item.kind === 'note' ? [itemId(row.item)] : [])),
      quickFixFindingIds: minted.flatMap((row) =>
        row.item.kind === 'defect' ? [itemId(row.item)] : [],
      ),
      dismissIds: notes.filter((note) => dismissed.has(note.id)).map((note) => note.id),
      dismissFindingIds: defects.filter((row) => dismissed.has(row.id)).map((row) => row.id),
      carry,
    })

  const lapRoad = (text: string) => (
    <Button
      variant="solid"
      disabled={busy || !!iterateBlocked}
      title={iterateBlocked}
      onClick={() => commit(true)}
    >
      {text}
    </Button>
  )

  return (
    <>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-2">
          <h2 className="m-0 text-lg text-text">Iterate — what goes where</h2>
          <p className="m-0 text-sm text-pretty text-text-2">
            Tick the rows that are quick fixes — each becomes a ticket on this lap. Everything
            you leave goes into lap {nextLap}’s conversation together.
          </p>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            compact
            title="Nothing open to triage"
            hint={`Lap ${nextLap} starts empty-handed.`}
          />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Button
                className="px-2"
                disabled={busy}
                onClick={() => setQuickFix(new Set(rows.map((row) => itemId(row.item))))}
              >
                Mark all as quick fixes
              </Button>
              <Button className="px-2" disabled={busy} onClick={() => setQuickFix(new Set())}>
                Clear
              </Button>
            </div>

            <div className="flex max-h-[46vh] flex-col overflow-y-auto">
              <LapSections
                groups={groupByLap(rows, lap)}
                currentLap={lap}
                meta={(group) => `${group.rows.length} open`}
              >
                {(group) =>
                  group.map((row) => (
                    <NoteRow
                      key={itemId(row.item)}
                      item={row.item}
                      // No recording is on the stage behind this step, so every
                      // timestamp is a label: triage does not drive the player.
                      onStage={null}
                      readonly={false}
                      highlighted={arrivedWhileOpen(row.item, openedAt)}
                      onOpenImage={setPicture}
                      controls={
                        <span className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 font-mono text-xs text-text-3">
                            <input
                              type="checkbox"
                              className="size-3.5 accent-accent"
                              checked={picked(row)}
                              disabled={busy}
                              onChange={() => toggle(itemId(row.item))}
                            />
                            Quick fix
                          </label>
                          <Button
                            className="px-2"
                            disabled={busy}
                            onClick={() => setConfirming(row.item)}
                          >
                            Dismiss
                          </Button>
                        </span>
                      }
                    />
                  ))
                }
              </LapSections>
            </div>
          </>
        )}

        {footer && <div className="font-mono text-xs text-text-2">{footer}</div>}
        {iterateBlocked && <div className="font-mono text-xs text-warn">{iterateBlocked}</div>}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          {road === 'burn' ? (
            <>
              {/* Nothing is left to carry, but the human may still want the
                  conversation — the lap road stays one click away. */}
              {lapRoad(`Start lap ${nextLap} anyway`)}
              <Button variant="solid" disabled={busy} onClick={() => commit(false)}>
                {label}
              </Button>
            </>
          ) : (
            lapRoad(label)
          )}
        </div>
      </div>

      <Lightbox url={picture} onClose={() => setPicture(null)} />
      {/* Dismissing is decided here and committed with everything else, so the
          confirm marks the row rather than deleting behind the step's back. */}
      <Dialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        size="sm"
        label={confirming ? DISMISS_PROMPT[confirming.kind] : 'Dismiss'}
      >
        <div className="flex flex-col gap-4 p-4">
          <p className="m-0 text-base text-text">
            {confirming ? DISMISS_PROMPT[confirming.kind] : ''}
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirming(null)}>Keep it</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirming) {
                  const id = itemId(confirming)
                  setDismissed((current) => new Set(current).add(id))
                  setQuickFix((current) => {
                    const next = new Set(current)
                    next.delete(id)
                    return next
                  })
                }
                setConfirming(null)
              }}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}

/** Written while the step was open (decision 26f) — marked, and never pre-ticked. */
function arrivedWhileOpen(item: NoteItem, openedAt: number): boolean {
  return (item.kind === 'note' ? item.note.createdAt : item.finding.createdAt) > openedAt
}
