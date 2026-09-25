import { useState } from 'react'
import { IconChevronRight, IconPencil } from '../icons'
import { BARE_BUTTON, TEXT_INPUT } from '../ui'

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
  onEnterPath,
  placeholder,
}: {
  crumbs: Crumb[]
  /**
   * What the input is pre-filled with when the control is clicked. Not always
   * the directory being listed: after the picker walks up from a path that was
   * not there, this is still what the user typed, so they can fix it in place.
   */
  value: string
  /** A crumb was clicked — a path this control was handed, so it is a real one. */
  onNavigate: (path: string) => void
  /**
   * A path was typed and entered. Kept apart from {@link onNavigate} because it
   * is a claim rather than a place: nothing has established that it exists, and
   * the picker answers for that difference.
   */
  onEnterPath: (path: string) => void
  placeholder: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft !== null

  const elided = crumbs.length > MAX_CRUMBS
  const shown = elided ? crumbs.slice(-CRUMB_TAIL) : crumbs

  if (editing) {
    return (
      <input
        className={`${TEXT_INPUT} flex-1 font-mono text-xs`}
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
            onEnterPath(draft.trim())
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
          <IconChevronRight size={12} className="shrink-0 text-text-disabled" />
          {/* The segments between are still readable, just not clickable — a
              title is cheaper than a menu nobody would open twice. */}
          <span className="shrink-0 px-1 text-sm text-text-tertiary" title={crumbs[crumbs.length - 1].path}>
            …
          </span>
        </>
      )}
      {shown.map((crumb, i) => (
        <span key={crumb.path} className="flex shrink-0 items-center gap-0.5">
          {(i > 0 || elided) && <IconChevronRight size={12} className="shrink-0 text-text-disabled" />}
          <CrumbButton crumb={crumb} onNavigate={onNavigate} />
        </span>
      ))}
      <button
        type="button"
        className={`${BARE_BUTTON} ml-1 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-icon transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover hover:text-text`}
        aria-label="Edit path"
        title="Edit path"
        onClick={() => setDraft(value)}
      >
        <IconPencil size={14} />
      </button>
    </div>
  )
}

function CrumbButton({ crumb, onNavigate }: { crumb: Crumb; onNavigate: (path: string) => void }) {
  return (
    <button
      type="button"
      className={`${BARE_BUTTON} shrink-0 rounded-sm px-1 py-0.5 cursor-pointer font-mono text-xs text-text-secondary transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover hover:text-text`}
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
