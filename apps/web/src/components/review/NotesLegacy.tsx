import { useState } from 'react'
import { fmtClock, type TestNote } from '@runcastle/core'
import { Button, LapSections, NoteAuthorChip, SectionTitle } from '../../ui'
import { trpc } from '../../trpc'
import type { FeatureFull } from '../../lib/api'
import { groupByLap, headline } from '../../lib/feature-ui'
import { useToast } from '../../lib/toast'

/**
 * The notes inbox as it stands today, lifted out of `ReviewBody` (ticket 7).
 *
 * It is legacy by name because ticket 8 replaces it with `OpenWork` + `NoteRow`
 * (decisions 18c and 25): evidence-forward rows, bidirectional visible jumps, an
 * in-app lightbox, in-place edit and a confirmed delete. Nothing here is
 * redesigned — the rows keep the behaviour and the `styles.css` rules they had,
 * so the band rebuild above them lands without taking the inbox with it.
 */

/**
 * The findings inbox (decisions.md #11): what was seen while clicking through
 * the branch, grouped under the lap it was seen on.
 *
 * Deliberately NOT gated on an active drive (decisions #4). Observations do not
 * stop when the dev server does — the "one more thing" typed right after Stop,
 * or something spotted in the diff, would be lost if the box only existed while
 * a drive was live, and there is no integrity reason to require a running server
 * to record an observation.
 *
 * A note is `open` until it is ticked (`done` — handled or dismissed, toggleable
 * both ways) or promoted. Promoted is frozen with a link to its ticket: it is
 * the record of what that ticket was built from, so it offers no affordances at
 * all. The server refuses every one of those transitions anyway; this only
 * avoids showing a button that would be turned down.
 *
 * Notes the review agent wrote are badged (decisions #7) and otherwise identical.
 */
export function NotesPanel({
  featureId,
  lap,
  tickets,
  rows,
  readonly,
  onJump,
}: {
  featureId: string
  /** The feature's current lap — the group rendered expanded. */
  lap: number
  tickets: FeatureFull['tickets']
  /** The feature's notes, read by the parent so the bands above count these rows. */
  rows: TestNote[]
  /** Looking back at review on a shipped feature — the checklist, no editing. */
  readonly: boolean
  /** Send the recording on the stage to a moment, when its own recording is up. */
  onJump?: (seconds: number) => void
}) {
  const utils = trpc.useUtils()
  const toast = useToast()
  const [draft, setDraft] = useState('')
  // The note being edited in place, or null. One at a time — same as the ticket
  // ledger's editor.
  const [editing, setEditing] = useState<string | null>(null)

  const refresh = (): void => void utils.notes.list.invalidate({ featureId })
  const onError = (e: { message: string }): void => toast.push(e.message)

  const add = trpc.notes.add.useMutation({
    onSuccess: () => {
      setDraft('')
      refresh()
    },
    onError,
  })
  const edit = trpc.notes.edit.useMutation({
    onSuccess: () => {
      setEditing(null)
      refresh()
    },
    onError,
  })
  const remove = trpc.notes.remove.useMutation({ onSuccess: refresh, onError })
  const toggle = trpc.notes.toggle.useMutation({ onSuccess: refresh, onError })

  // One mutation in flight at a time: the list is about to be refetched, so a
  // second click would act on a row the server is already moving.
  const busy = edit.isPending || remove.isPending || toggle.isPending
  const submit = (): void => {
    if (draft.trim() && !add.isPending) add.mutate({ featureId, text: draft })
  }

  // The inbox's standing tally, in the same shape the ticket ledger's meta line
  // uses: what is still open always, the rest only once there is any of it.
  const count = (status: TestNote['status']) => rows.filter((n) => n.status === status).length
  const metaParts = [`${count('open')} open`]
  if (count('done') > 0) metaParts.push(`${count('done')} handled`)
  if (count('promoted') > 0) metaParts.push(`${count('promoted')} ticketed`)
  const meta = metaParts.join(' · ')

  const noteRow = (note: TestNote) => {
    const ticket = note.ticketId ? tickets.find((t) => t.id === note.ticketId) : undefined
    const open = note.status === 'open'
    // The moment in the walkthrough this note was taken from, when it came from
    // one at all — plain notes have none and render exactly as they always did.
    const moment = note.videoTimestamp

    if (editing === note.id) {
      return (
        <NoteEditor
          key={note.id}
          text={note.text}
          busy={edit.isPending}
          onCancel={() => setEditing(null)}
          onSave={(text) => edit.mutate({ noteId: note.id, text })}
        />
      )
    }

    return (
      <div key={note.id} className={`note-row is-${note.status}`}>
        {note.status === 'promoted' ? (
          <span className="note-frozen" title="promoted — frozen as its ticket's record">
            →
          </span>
        ) : (
          <input
            type="checkbox"
            className="note-check"
            checked={note.status === 'done'}
            disabled={readonly || busy}
            aria-label={open ? 'mark handled' : 'reopen'}
            onChange={() => toggle.mutate({ noteId: note.id })}
          />
        )}

        {note.screenshotUrl && (
          <a
            className="note-shot"
            href={note.screenshotUrl}
            target="_blank"
            rel="noreferrer noopener"
            title="the annotated frame"
          >
            <img src={note.screenshotUrl} alt="the annotated frame this note is about" />
          </a>
        )}

        {moment !== undefined &&
          (onJump ? (
            <button
              type="button"
              className="note-at"
              title="jump the walkthrough to this moment"
              onClick={() => onJump(moment)}
            >
              {fmtClock(moment)}
            </button>
          ) : (
            <span className="note-at" title="the moment in the walkthrough this was seen at">
              {fmtClock(moment)}
            </span>
          ))}

        <NoteText text={note.text} />

        <NoteAuthorChip author={note.author} />

        {ticket && (
          <span className="note-ticket" title={ticket.title}>
            #{ticket.seq} {ticket.title}
          </span>
        )}

        {!readonly && open && (
          <span className="note-actions">
            <button className="btn btn-xs btn-ghost" onClick={() => setEditing(note.id)}>
              Edit
            </button>
            <button
              className="btn btn-xs btn-ghost"
              disabled={busy}
              onClick={() => remove.mutate({ noteId: note.id })}
            >
              Delete
            </button>
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="review-card notes-card">
      <div className="notes-head">
        <SectionTitle>Test-drive notes</SectionTitle>
        {rows.length > 0 && <span className="body-meta">{meta}</span>}
      </div>

      {!readonly && (
        <>
          <div className="notes-form">
            <input
              className="notes-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
              placeholder="What did you just see? e.g. the run chip goes grey while burning"
            />
            <Button onClick={submit} disabled={!draft.trim() || add.isPending}>
              {add.isPending ? 'Adding…' : 'Add'}
            </Button>
          </div>
          <div className="notes-hint">
            Just type what you see. When you’re done looking, <strong>Iterate</strong> in the bar
            above turns the quick fixes into tickets — or hands the whole inbox to the next lap’s
            session.
          </div>
        </>
      )}

      {rows.length === 0 ? (
        <div className="drive-copy">
          Nothing noted yet. Anything you write here lands in the feature’s
          <code> test-notes.md</code>, which the next lap’s session reads.
        </div>
      ) : (
        <div className="notes-list">
          <LapSections
            groups={groupByLap(rows, lap)}
            currentLap={lap}
            meta={(g) => `${g.rows.filter((n) => n.status === 'open').length} open`}
          >
            {(group) => group.map(noteRow)}
          </LapSections>
        </div>
      )}
    </div>
  )
}

/**
 * A note, compact (decisions #4): its first line on the row, the rest one click
 * away. A note that already fits on its row renders as the plain text it always
 * was, with no disclosure to click.
 */
function NoteText({ text }: { text: string }) {
  const { head, rest } = headline(text)
  return (
    <span className="note-text">
      {rest ? (
        <details className="note-more">
          <summary>{head}</summary>
          <div className="note-rest">{rest}</div>
        </details>
      ) : (
        text
      )}
    </span>
  )
}

/** One note's text, in place. Only open notes reach here. */
function NoteEditor({
  text,
  busy,
  onCancel,
  onSave,
}: {
  text: string
  busy: boolean
  onCancel: () => void
  onSave: (text: string) => void
}) {
  const [value, setValue] = useState(text)
  const save = (): void => {
    if (value.trim() && !busy) onSave(value)
  }

  return (
    <div className="note-row is-editing">
      <input
        className="notes-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') onCancel()
        }}
        autoFocus
      />
      <span className="note-actions">
        <button className="btn btn-xs btn-ghost" disabled={!value.trim() || busy} onClick={save}>
          Save
        </button>
        <button className="btn btn-xs btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  )
}
