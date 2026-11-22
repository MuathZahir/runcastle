import {
  INVOLVEMENT_HINT,
  INVOLVEMENT_LABEL,
  INVOLVEMENT_LEVELS,
  INVOLVEMENT_NAME,
  type Involvement,
} from '@runcastle/core'
import { IconChevronDown, IconEye, IconGitMerge, IconImage, IconMessage } from '../../icons'
import { cx } from '../../ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu'
import {
  SELECT_MARKED,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '../../ui/select'

/**
 * "Involve me in" (docs/features/how-involved-am-i): how involved the human is
 * in a feature, picked from four nested levels. Two controls share one look:
 * {@link InvolvementSelect} for one feature (a feature card's row, the
 * feature's header) and {@link SetAllInvolvement} for every feature of an epic.
 *
 * Closed, each reads "Involve me in: <level>", the setting named with its
 * value, so it never needs a legend. Open, every level carries one line of what
 * it means, so the four read as the nesting they are.
 */

/**
 * Each level's mark: the first moment it still stops for the human, drawn on
 * a tile whose blue fades as the human steps back. "Everything" asks (a
 * question), "Designs and result" shows screens, "Result only" is tried, and
 * "Nothing" merges by itself, in the neutral grey of a feature that no longer
 * waits on anyone. The tints are theme tokens (`--color-involve-*`).
 */
const MARK: Record<Involvement, { Icon: typeof IconMessage; tile: string; dot: string }> = {
  everything: { Icon: IconMessage, tile: 'bg-involve-everything text-accent-text', dot: 'bg-accent' },
  designsAndResult: { Icon: IconImage, tile: 'bg-involve-designs text-involve-designs-mark', dot: 'bg-involve-designs-dot' },
  resultOnly: { Icon: IconEye, tile: 'bg-involve-result text-involve-result-mark', dot: 'bg-involve-result-dot' },
  nothing: { Icon: IconGitMerge, tile: 'bg-surface-hover text-icon', dot: 'bg-text-tertiary' },
}

/** A level's mark on its tile: 18px in a closed control, 28px in an open list. */
export function LevelMark({ level, size = 'sm' }: { level: Involvement; size?: 'sm' | 'lg' }) {
  const { Icon, tile } = MARK[level]
  return (
    <span className={cx('grid shrink-0 place-items-center', size === 'sm' ? 'size-[18px] rounded-sm' : 'size-7 rounded-md', tile)}>
      <Icon size={size === 'sm' ? 12 : 15} />
    </span>
  )
}

/** "Mixed": one small dot per level the features hold, in the order of the levels. */
function MixedMark({ levels }: { levels: readonly Involvement[] }) {
  const held = INVOLVEMENT_LEVELS.filter((l) => levels.includes(l))
  return (
    <span className="flex size-[18px] shrink-0 items-center justify-center -space-x-px rounded-sm bg-surface-hover">
      {held.map((l) => (
        <span key={l} className={cx('size-[5px] rounded-full', MARK[l].dot)} />
      ))}
    </span>
  )
}

/** "Involve me in: <level>", the level in the stronger grey. */
function TriggerWords({ level }: { level: Involvement | null }) {
  return (
    <span className="min-w-0 truncate">
      {INVOLVEMENT_NAME}: <span className="font-medium text-text">{level ? INVOLVEMENT_LABEL[level] : 'Mixed'}</span>
    </span>
  )
}

const LIST_W = 'w-80'

/**
 * One feature's level. `onChange` fires with the new level; the caller saves
 * it. `disabled` while a save is in flight or the feature is shipped.
 */
export function InvolvementSelect({
  value,
  onChange,
  size = 'sm',
  disabled = false,
  align = 'end',
}: {
  value: Involvement
  onChange: (level: Involvement) => void
  /** `sm` in a card's row (24px), `md` in a page header (32px). */
  size?: keyof typeof SELECT_MARKED
  disabled?: boolean
  align?: 'start' | 'end'
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Involvement)} disabled={disabled}>
      <SelectTrigger marked={size} aria-label={`${INVOLVEMENT_NAME}: ${INVOLVEMENT_LABEL[value]}`}>
        <LevelMark level={value} />
        <TriggerWords level={value} />
      </SelectTrigger>
      <SelectContent align={align} className={LIST_W}>
        <SelectGroup>
          <SelectLabel>{INVOLVEMENT_NAME}</SelectLabel>
          {INVOLVEMENT_LEVELS.map((level) => (
            <SelectItem
              key={level}
              value={level}
              mark={<LevelMark level={level} size="lg" />}
              description={INVOLVEMENT_HINT[level]}
            >
              {INVOLVEMENT_LABEL[level]}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/** The one level every feature shares, or null when they differ (or there are none). */
export function sharedLevel(levels: readonly Involvement[]): Involvement | null {
  const first = levels[0]
  return first && levels.every((l) => l === first) ? first : null
}

/**
 * "Set all to…" on an epic: the epic's features' level, and one pick that sets
 * every one of them (decision 4). Closed, it says the level they share, or
 * "Mixed"; there is no undo (decision 7), so the menu says how many features a
 * pick changes.
 */
export function SetAllInvolvement({
  levels,
  onSetAll,
  disabled = false,
}: {
  /** The level of each of the epic's features that a pick would change. */
  levels: readonly Involvement[]
  onSetAll: (level: Involvement) => void
  disabled?: boolean
}) {
  const shared = sharedLevel(levels)
  const n = levels.length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || n === 0}
        aria-label={`${INVOLVEMENT_NAME} for all features: ${shared ? INVOLVEMENT_LABEL[shared] : 'Mixed'}`}
        className={SELECT_MARKED.md}
      >
        {shared ? <LevelMark level={shared} /> : <MixedMark levels={levels} />}
        <TriggerWords level={shared} />
        <IconChevronDown size={14} className="shrink-0 text-icon" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={LIST_W}>
        <DropdownMenuLabel>
          Set all {n} {n === 1 ? 'feature' : 'features'} to…
        </DropdownMenuLabel>
        {INVOLVEMENT_LEVELS.map((level) => (
          <DropdownMenuItem
            key={level}
            mark={<LevelMark level={level} size="lg" />}
            description={INVOLVEMENT_HINT[level]}
            current={shared === level}
            onSelect={() => onSetAll(level)}
          >
            {INVOLVEMENT_LABEL[level]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
