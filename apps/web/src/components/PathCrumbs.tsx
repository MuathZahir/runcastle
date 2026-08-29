import { useState } from 'react'
import { IconChevronRight } from '../icons'

/** One clickable segment of the current path, as the server spelled it. */
export interface Crumb {
  name: string
  path: string
}

/** How many trailing segments survive a collapse — where you are, and its way in. */
const CRUMB_TAIL = 3

/**
 * Beyond this many segments the middle collapses to `root … last three`. Four is
 * the most that fits a dialog header beside the Hidden toggle at the widths this
 * app is read at, and it is what the collapsed form itself costs.
 */
const MAX_CRUMBS = CRUMB_TAIL + 1

/**
 * The directory picker's header: breadcrumbs you can click, or a path you can
 * type, in one control (decision 6).
 *
 * They used to be two stacked rows — a crumb trail that scrolled sideways and a
 * separate labelled "Path" field. On any deep directory the trail overflowed and
 * the second row pushed the Hidden toggle off the header, so the two halves of
 * "where am I" cost a third of the dialog and still could not both be read. Here
 * the trail *is* the field: it shows where you are, and a click puts a caret in
 * it.
 *
 * The control clips rather than wraps — a header row that grows a second line
 * moves everything below it — so a long path collapses to `root … last three`
 * and anything still too wide is cut off, never folded.
 */
export function PathCrumbs({
  crumbs,
  value,
  onNavigate,
  placeholder,
}: {
  crumbs: Crumb[]
  /**
   * What the input is pre-filled with when the control is clicked. Not always
   * the directory being listed: after the picker walks up from a path that was
   * not there, this is still what the user typed, so they can fix it in place.
   */
  value: string
  onNavigate: (path: string) => void
  placeholder: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft !== null

  const elided = crumbs.length > MAX_CRUMBS
  const shown = elided ? crumbs.slice(-CRUMB_TAIL) : crumbs

  if (editing) {
    return (
      <input
        className="h-8 min-w-0 flex-1 rounded-md border border-hairline bg-panel-inset px-2.5 font-mono text-sm text-text outline-none focus:border-accent"
        aria-label="Path"
        spellCheck={false}
        autoComplete="off"
        autoFocus
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onNavigate(draft.trim())
            setDraft(null)
          }
          // Escape abandons the edit and shows where we actually are. The dialog
          // closes on Escape too, so this one has to be stopped from reaching
          // it — one key, the innermost thing it can answer.
          if (e.key === 'Escape') {
            e.stopPropagation()
            setDraft(null)
          }
        }}
      />
    )
  }

  return (
    // The whole strip is the way into the field, so a click anywhere that is not
    // a crumb starts an edit — including the empty space after a short path.
    <div
      className="flex min-w-0 flex-1 cursor-text items-center gap-0.5 truncate"
      onClick={() => setDraft(value)}
      role="group"
      aria-label="Current path"
    >
      {elided && (
        <>
          <CrumbButton crumb={crumbs[0]} onNavigate={onNavigate} />
          <IconChevronRight size={11} />
          {/* The segments between are still readable, just not clickable — a
              title is cheaper than a menu nobody would open twice. */}
          <span className="shrink-0 px-1 text-sm text-text-4" title={crumbs[crumbs.length - 1].path}>
            …
          </span>
        </>
      )}
      {shown.map((crumb, i) => (
        <span key={crumb.path} className="flex shrink-0 items-center gap-0.5">
          {(i > 0 || elided) && <IconChevronRight size={11} />}
          <CrumbButton crumb={crumb} onNavigate={onNavigate} />
        </span>
      ))}
      <button
        type="button"
        className="ml-1 shrink-0 rounded-sm px-1 text-sm text-text-4 hover:text-text"
        aria-label="Edit path"
        title="Edit path"
        onClick={() => setDraft(value)}
      >
        ✎
      </button>
    </div>
  )
}

function CrumbButton({ crumb, onNavigate }: { crumb: Crumb; onNavigate: (path: string) => void }) {
  return (
    <button
      type="button"
      className="shrink-0 rounded-sm px-1 py-0.5 font-mono text-sm text-text-2 hover:bg-panel-inset hover:text-text"
      // Navigating is not "click the empty area", so it must not also open the
      // editor the strip around it opens.
      onClick={(e) => {
        e.stopPropagation()
        onNavigate(crumb.path)
      }}
    >
      {crumb.name}
    </button>
  )
}
