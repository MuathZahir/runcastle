import { projectNoteScreenshotUploadUrl } from '@runcastle/core'

/**
 * The browser half of project-note capture (project-notes, ticket 4).
 *
 * Two things live here, and both are here because more than one surface reads
 * them: the screenshot upload, which is the one part of a note that cannot ride
 * the tRPC surface, and the hotkey predicate, which the shell's window listener
 * and the embedded terminal's key handler have to agree on exactly — the
 * terminal swallows the chord so the PTY never sees it, and the shell opens the
 * popover on the same event.
 */

/**
 * Attach a screenshot to the project note it was captured with. Raw PNG bytes
 * as the body, the shape the route expects — the same arrangement test-note
 * screenshots use (`uploadScreenshot` in `lib/reviews.ts`), against the
 * project-note route beside it.
 */
export async function uploadProjectNoteScreenshot(noteId: string, png: Blob): Promise<void> {
  const res = await fetch(projectNoteScreenshotUploadUrl(noteId), {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: png,
  })
  if (!res.ok) throw new Error(`screenshot upload: ${res.status}`)
}

/** The minimal subset of `KeyboardEvent` {@link isNoteHotkey} reads. */
export interface NoteHotkeyEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * Is this ⌘/Ctrl+J — "jot a note"?
 *
 * Either modifier counts, which is the rule the ⌘K palette listener beside it
 * already follows: ⌘ is the Mac chord and Ctrl the one everywhere else, and a
 * browser that reports the other one should still open the box. Alt and Shift
 * are excluded so a longer chord someone else owns is not stolen.
 */
export function isNoteHotkey(ev: NoteHotkeyEvent): boolean {
  return (ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'j'
}
