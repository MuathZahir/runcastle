import { useEffect, useState } from 'react'
import type { TestNote } from '@runcastle/core'
import { Button, NoteAuthorChip, SectionTitle } from '../ui'

/**
 * The one triage point for the findings inbox (decisions.md #11).
 *
 * Notes used to carry a "→ ticket" each, which made the human do ticket triage
 * one click at a time — and it competed with Iterate, which digests the same
 * notes into tickets through a conversation, with nothing anywhere saying which
 * road to take. So both roads leave from here, named by the question that
 * actually decides between them: are these quick fixes, or does this need
 * rethinking?
 *
 * Quick fixes promote in ONE mutation (`notes.promoteMany`) rather than one per
 * checked note: the panel behind this disables every row while any note mutation
 * is in flight, so a promotion per note would freeze the list for the length of
 * the batch and land the tickets one straggling seq at a time.
 *
 * The rethink road can be unavailable (a live terminal, a drive holding the
 * branch) where promotion never is — promotion only writes ticket rows. Its
 * reason is passed in from the next-step bar's own Iterate action, so the dialog
 * cannot disagree with the bar about why.
 */
export function AddressNotesDialog({
  notes,
  busy,
  iterateBlocked,
  onPromote,
  onIterate,
  onCancel,
}: {
  /** The open notes — the only ones either road can act on. */
  notes: TestNote[]
  busy: boolean
  /** Why the lap session cannot start right now, or undefined when it can. */
  iterateBlocked?: string
  onPromote: (noteIds: string[]) => void
  onIterate: () => void
  onCancel: () => void
}) {
  // Everything checked to start with: "these are all quick fixes" is the case
  // this door exists for, and unchecking the two that aren't is less work than
  // checking the six that are.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(notes.map((n) => n.id)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const picked = notes.filter((n) => selected.has(n.id))

  return (
    <div
      className="peek-backdrop"
      // mousedown, not click: a click that STARTS inside the panel and ends on
      // the backdrop (dragging across the note list) is not a dismissal.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="peek notes-dialog" role="dialog" aria-modal="true" aria-label="Address notes">
        <div className="peek-head">
          <span className="merge-dialog-title">Address notes</span>
          <button className="peek-close" onClick={onCancel} aria-label="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="peek-body notes-dialog-body">
          <p className="merge-dialog-lead">
            {notes.length} open note{notes.length === 1 ? '' : 's'} from the drive. Two ways to
            answer them — pick the one that matches what you found.
          </p>

          <section className="notes-dialog-road">
            <SectionTitle>Quick fixes</SectionTitle>
            <div className="drive-copy">
              The spec was right and the code wasn’t. Each note you pick becomes a pending fix
              ticket on this lap, ready to burn.
            </div>
            <div className="notes-dialog-list">
              {notes.map((note) => (
                <label key={note.id} className="notes-dialog-row">
                  <input
                    type="checkbox"
                    className="note-check"
                    checked={selected.has(note.id)}
                    disabled={busy}
                    onChange={() => toggle(note.id)}
                  />
                  <span className="note-text">{note.text}</span>
                  <NoteAuthorChip author={note.author} />
                </label>
              ))}
            </div>
            <div className="notes-dialog-actions">
              <Button
                variant="solid"
                disabled={busy || picked.length === 0}
                onClick={() => onPromote(picked.map((n) => n.id))}
              >
                {busy
                  ? 'Working…'
                  : `Make ${picked.length} ticket${picked.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </section>

          <section className="notes-dialog-road">
            <SectionTitle>Needs rethinking</SectionTitle>
            <div className="drive-copy">
              The drive taught you something the spec does not know yet. Iterate opens the next
              lap’s session on all {notes.length} note{notes.length === 1 ? '' : 's'} — it amends
              the spec with you and emits the lap’s tickets itself.
            </div>
            <div className="notes-dialog-actions">
              <Button
                variant="ghost"
                disabled={busy || !!iterateBlocked}
                title={iterateBlocked}
                onClick={onIterate}
              >
                Start the lap session
              </Button>
              {iterateBlocked && <span className="notes-dialog-blocked">{iterateBlocked}</span>}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
