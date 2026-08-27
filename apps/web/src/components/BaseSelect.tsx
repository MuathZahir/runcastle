import type { BranchList } from '../lib/api'

/**
 * The base-branch picker every surface that cuts a branch shows (decision 8).
 * The Quick door's quick-change mode had no control at all and chose its base
 * silently; a parked draft's Start had one of its own. One component now, so the
 * two forms cannot drift on what a base looks like or which branches are offered.
 *
 * The empty option is the point of it. It appears only when there is no base to
 * show — a detached HEAD, or a test drive holding the checkout on a `feature/*`
 * branch, neither of which a feature can fork from — and it is not a choice: it
 * is the one state where every default would be a guess, so the picker says so
 * and the form it sits in blocks its own submit until a human picks.
 */
export function BaseSelect({
  id,
  label,
  branches,
  value,
  onPick,
  hint,
}: {
  id: string
  /** The field's own label — each form names the cut in its own words. */
  label: string
  /** The project's branches, or undefined while the list is still loading. */
  branches: BranchList | undefined
  /** The base shown — an explicit pick, else the client default. */
  value: string
  onPick: (base: string) => void
  /** What forking off this branch will mean, in the calling form's words. */
  hint: string
}) {
  const local = branches?.branches ?? []
  // Remote-only branches (origin/…); picking one materializes a local base.
  const remote = branches?.remoteBranches ?? []
  const noBranches = local.length === 0 && remote.length === 0
  const mustPick = !!branches && value === ''

  return (
    <div className="nf-base">
      <label className="nf-base-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="nf-base-select"
        value={value}
        disabled={!branches || noBranches}
        onChange={(e) => onPick(e.target.value)}
      >
        {/* Present only while there is nothing to show, so a chosen base can
            never be un-chosen back into the blocking state by accident. */}
        {value === '' && <option value="">{branches ? 'choose a branch…' : 'loading…'}</option>}
        {local.map((b) => (
          <option key={b} value={b}>
            {b}
            {b === branches?.current ? ' (current)' : ''}
          </option>
        ))}
        {remote.length > 0 && (
          <optgroup label="Remote (creates a local branch)">
            {remote.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <span className="size-hint">
        {mustPick
          ? 'This project’s checkout is not a branch a feature can fork from — say where to cut from.'
          : hint}
      </span>
    </div>
  )
}
