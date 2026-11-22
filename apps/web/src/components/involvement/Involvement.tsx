import * as SelectPrimitive from '@radix-ui/react-select'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import {
  INVOLVEMENT_HINT,
  INVOLVEMENT_LABEL,
  INVOLVEMENT_LEVELS,
  INVOLVEMENT_NAME,
  type Involvement,
} from '@runcastle/core'
import { IconCheck, IconChevronDown, IconEye, IconGitMerge, IconImage, IconMessage } from '../../icons'
import { cx } from '../../ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '../../ui/dropdown-menu'
import {
  FLOATING_CAP,
  FLOATING_ITEM,
  FLOATING_SCROLLBAR,
  FLOATING_SURFACE,
} from '../../ui/floating'

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
 * waits on anyone.
 */
const MARK: Record<Involvement, { Icon: typeof IconMessage; tile: string; dot: string }> = {
  everything: { Icon: IconMessage, tile: 'bg-accent/22 text-accent-text', dot: 'bg-accent' },
  designsAndResult: { Icon: IconImage, tile: 'bg-accent/13 text-accent-text/85', dot: 'bg-accent/70' },
  resultOnly: { Icon: IconEye, tile: 'bg-accent/7 text-accent-text/65', dot: 'bg-accent/40' },
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

/** The closed control: a quiet ghost button, as the app's inline pickers wear. */
const TRIGGER =
  'inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md text-text-tertiary whitespace-nowrap ' +
  'transition-colors duration-(--dur-1) ease-app enabled:hover:bg-surface-hover enabled:hover:text-text-secondary ' +
  'data-[state=open]:bg-surface-selected data-[state=open]:text-text-secondary disabled:cursor-not-allowed disabled:opacity-60'

const TRIGGER_SIZE = {
  /** In a card's row: 24px, 12px words. */
  sm: 'h-(--control-sm) pr-1.5 pl-[3px] text-xs',
  /** In a page header: 32px, 13px words. */
  md: 'h-(--control-h) pr-2 pl-1.5 text-sm',
} as const

/** "Involve me in: <level>", the level in the stronger grey. */
function TriggerWords({ level }: { level: Involvement | null }) {
  return (
    <span className="min-w-0 truncate">
      {INVOLVEMENT_NAME}: <span className="font-medium text-text">{level ? INVOLVEMENT_LABEL[level] : 'Mixed'}</span>
    </span>
  )
}

/** A level's row in an open list: its mark, its name, then what it means. */
function LevelLines({ level }: { level: Involvement }) {
  return (
    <>
      <span className="pt-1.5">
        <LevelMark level={level} size="lg" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
        <span className="text-md font-medium text-text">{INVOLVEMENT_LABEL[level]}</span>
        <span className="text-xs leading-4 text-pretty text-text-tertiary">{INVOLVEMENT_HINT[level]}</span>
      </span>
    </>
  )
}

// Not FLOATING_ITEM_DEFAULT: its rule greys every icon in the row, and each mark keeps its own colour.
const ITEM = cx(FLOATING_ITEM, 'items-start gap-2.5 text-text hover:bg-surface-hover data-highlighted:bg-surface-hover')
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
  size?: keyof typeof TRIGGER_SIZE
  disabled?: boolean
  align?: 'start' | 'end'
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={(v) => onChange(v as Involvement)} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={`${INVOLVEMENT_NAME}: ${INVOLVEMENT_LABEL[value]}`}
        className={cx(TRIGGER, TRIGGER_SIZE[size])}
      >
        <LevelMark level={value} />
        <TriggerWords level={value} />
        <SelectPrimitive.Icon className="inline-flex shrink-0 text-icon">
          <IconChevronDown size={size === 'sm' ? 12 : 14} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          align={align}
          sideOffset={4}
          collisionPadding={8}
          onEscapeKeyDown={(e) => e.stopPropagation()}
          className={cx(FLOATING_SURFACE, FLOATING_CAP.select, LIST_W)}
        >
          <SelectPrimitive.Viewport className={cx('p-1', FLOATING_SCROLLBAR)}>
            <div className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-text-tertiary">{INVOLVEMENT_NAME}</div>
            {INVOLVEMENT_LEVELS.map((level) => (
              <SelectPrimitive.Item key={level} value={level} className={ITEM}>
                <SelectPrimitive.ItemText asChild>
                  <span className="sr-only">{INVOLVEMENT_LABEL[level]}</span>
                </SelectPrimitive.ItemText>
                <LevelLines level={level} />
                <span className="grid size-4 shrink-0 place-items-center pt-3.5">
                  <SelectPrimitive.ItemIndicator>
                    <IconCheck size={14} className="text-text" />
                  </SelectPrimitive.ItemIndicator>
                </span>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
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
        className={cx(TRIGGER, TRIGGER_SIZE.md)}
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
          <DropdownMenuPrimitive.Item key={level} className={ITEM} onSelect={() => onSetAll(level)}>
            <LevelLines level={level} />
            <span className="grid size-4 shrink-0 place-items-center pt-3.5">
              {shared === level && <IconCheck size={14} className="text-text" />}
            </span>
          </DropdownMenuPrimitive.Item>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
