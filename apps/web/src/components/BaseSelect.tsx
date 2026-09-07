import type { BranchList } from '../lib/api'
import { IconChevronDown } from '../icons'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '../ui/combobox'

/**
 * The base-branch picker every surface that cuts a branch shows (decision 8).
 * The Quick door's quick-change mode had no control at all and chose its base
 * silently; a parked draft's Start had one of its own. One component now, so the
 * two forms cannot drift on what a base looks like or which branches are offered.
 *
 * The empty state is the point of it. There is a base to show for almost every
 * checkout; when there is not — a detached HEAD, or a test drive holding the
 * checkout on a `feature/*` branch, neither of which a feature can fork from —
 * the picker says so and the form it sits in blocks its own submit until a human
 * picks. That state is the trigger's own words rather than a row in the list:
 * "choose a branch…" is a thing to be told, never a thing to pick, so a chosen
 * base cannot be un-chosen back into it by accident.
 *
 * The list is a `Combobox` (`src/ui/combobox.tsx`) — a repo's branches are more
 * than a menu's worth, and the remote half of them longer still, so it is
 * portalled, capped, and searched rather than scrolled.
 */

/** The closed control, wearing what the legacy `.nf-base-select` rule drew. */
const TRIGGER =
  'inline-flex h-(--control-h) min-w-56 max-w-full cursor-pointer items-center justify-between ' +
  'gap-1.5 rounded-md border border-hairline bg-panel-inset px-2 font-mono text-sm text-text ' +
  'transition-[border-color] duration-(--dur-1) ease-app ' +
  'disabled:cursor-default disabled:opacity-50'

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

  const row = (branch: string, suffix = '') => (
    <ComboboxItem
      key={branch}
      value={branch}
      current={branch === value}
      onSelect={() => onPick(branch)}
    >
      {branch}
      {suffix}
    </ComboboxItem>
  )

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2.5">
      <label className="text-base text-text" htmlFor={id}>
        {label}
      </label>
      <Combobox>
        <ComboboxTrigger id={id} className={TRIGGER} disabled={!branches || noBranches}>
          <span className="truncate">
            {value === '' ? (branches ? 'choose a branch…' : 'loading…') : value}
          </span>
          <IconChevronDown size={11} className="shrink-0 text-text-4" />
        </ComboboxTrigger>
        <ComboboxContent label={label} className="font-mono text-sm">
          <ComboboxInput placeholder="Find a branch…" />
          <ComboboxList label={label}>
            <ComboboxEmpty>no branch matches</ComboboxEmpty>
            {local.map((b) => row(b, b === branches?.current ? ' (current)' : ''))}
            {remote.length > 0 && (
              <ComboboxGroup heading="Remote (creates a local branch)">
                {remote.map((b) => row(b))}
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <span className="text-sm text-text-3">
        {mustPick
          ? 'This project’s checkout is not a branch a feature can fork from — say where to cut from.'
          : hint}
      </span>
    </div>
  )
}
