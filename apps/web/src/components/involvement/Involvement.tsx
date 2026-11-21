import * as SelectPrimitive from '@radix-ui/react-select'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import {
  INVOLVEMENT_HINT,
  INVOLVEMENT_LABEL,
  INVOLVEMENT_LEVELS,
  INVOLVEMENT_NAME,
  type Involvement,
} from '@runcastle/core'
import { IconCheck, IconChevronDown } from '../../icons'
import { cx } from '../../ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '../../ui/dropdown-menu'
import {
  FLOATING_CAP,
  FLOATING_ITEM,
  FLOATING_ITEM_DEFAULT,
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

/** The closed control: a quiet ghost button, as the app's inline pickers wear. */
const TRIGGER =
  'inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-md text-text-tertiary whitespace-nowrap ' +
  'transition-colors duration-(--dur-1) ease-app enabled:hover:bg-surface-hover enabled:hover:text-text-secondary ' +
  'data-[state=open]:bg-surface-selected data-[state=open]:text-text-secondary disabled:cursor-not-allowed disabled:opacity-60'

const TRIGGER_SIZE = {
  /** In a card's row: 24px, 12px words. */
  sm: 'h-(--control-sm) px-1.5 text-xs',
  /** In a page header: 32px, 13px words. */
  md: 'h-(--control-h) px-2 text-sm',
} as const

/** "Involve me in: <level>", the level in the stronger grey. */
function TriggerWords({ level }: { level: Involvement | null }) {
  return (
    <span className="min-w-0 truncate">
      {INVOLVEMENT_NAME}: <span className="font-medium text-text">{level ? INVOLVEMENT_LABEL[level] : 'Mixed'}</span>
    </span>
  )
}

/** A level's two lines in an open list: its name, then what it means. */
function LevelLines({ level }: { level: Involvement }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
      <span className="text-md text-text">{INVOLVEMENT_LABEL[level]}</span>
      <span className="text-xs leading-4 text-pretty text-text-tertiary">{INVOLVEMENT_HINT[level]}</span>
    </span>
  )
}

const ITEM = cx(FLOATING_ITEM, FLOATING_ITEM_DEFAULT, 'items-start gap-3')
const LIST_W = 'w-72'

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
                <span className="grid size-4 shrink-0 place-items-center pt-2.5">
                  <SelectPrimitive.ItemIndicator>
                    <IconCheck size={14} className="text-text!" />
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
            <span className="grid size-4 shrink-0 place-items-center pt-2.5">
              {shared === level && <IconCheck size={14} className="text-text!" />}
            </span>
          </DropdownMenuPrimitive.Item>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
