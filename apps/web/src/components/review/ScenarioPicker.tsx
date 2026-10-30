import type { DriveScenario, ScenarioEntry } from '@runcastle/core'
import { BARE_BUTTON, Spinner, StatusDot, cx } from '../../ui'
import {
  Combobox,
  ComboboxAction,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '../../ui/combobox'
import { IconChevronDown, IconPlus } from '../../icons'
import type { ScenarioMenu } from '../../lib/feature-ui/scenarios'

/**
 * The one way a scenario is picked (test-drive-looks-the-part decision 1): the
 * caret on the feature's Test drive, the caret on the project's, and the
 * running drive's scenario control all open this list.
 *
 * A searchable list rather than a menu of actions, because the pick is a value —
 * which state the app is in — and a project's scenarios can run to dozens. The
 * search box shows only past {@link SEARCH_FROM} scenarios: below that the list
 * is plain rows, one click to pick.
 */

/** More scenarios than this and the list opens with a search box. */
export const SEARCH_FROM = 8

/** The scenarios grouped as the list shows them: "This feature", the project's groups, then the ungrouped. */
export function scenarioGroups(menu: ScenarioMenu): { heading: string; entries: ScenarioEntry[] }[] {
  const groups: { heading: string; entries: ScenarioEntry[] }[] = []
  if (menu.own.length > 0) groups.push({ heading: 'This feature', entries: menu.own })
  // `others` is already ordered group by group, the ungrouped last.
  for (const s of menu.others) {
    const heading = s.group ?? (groups.length > 0 ? 'Other' : menu.othersLabel)
    const last = groups[groups.length - 1]
    if (last && last.heading === heading && last.heading !== 'This feature') last.entries.push(s)
    else groups.push({ heading, entries: [s] })
  }
  return groups
}

/**
 * The list itself, for a {@link Combobox} the caller owns — the split button's
 * caret, or {@link ScenarioControl}'s trigger. `current` is the scenario the
 * drive is on (its file), `null` for Blank app, `undefined` before any drive.
 */
export function ScenarioPickerContent({
  menu,
  current,
  onPick,
  onNew,
  align = 'start',
}: {
  menu: ScenarioMenu
  current?: string | null
  /** A scenario's file, or `null` for Blank app. */
  onPick: (file: string | null) => void
  /** Write a new scenario: the running drive offers it, a drive not yet started does not. */
  onNew?: () => void
  align?: 'start' | 'end'
}) {
  const groups = scenarioGroups(menu)
  const count = menu.own.length + menu.others.length
  return (
    <ComboboxContent align={align} className="w-80">
      {count > SEARCH_FROM && <ComboboxInput placeholder={`Search ${count} scenarios`} />}
      <ComboboxList label="Scenarios">
        <ComboboxEmpty>No scenario matches</ComboboxEmpty>
        {groups.map((g) => (
          <ComboboxGroup key={g.heading} heading={g.heading}>
            {g.entries.map((s) => (
              <ComboboxItem
                key={s.file}
                value={`${s.name} ${s.group ?? ''} ${s.file}`}
                title={s.file}
                current={current === s.file}
                onSelect={() => onPick(s.file)}
              >
                {s.name}
                {s.hasCall && <span className="ml-2 text-xs text-text-tertiary">API</span>}
              </ComboboxItem>
            ))}
          </ComboboxGroup>
        ))}
        <ComboboxGroup>
          {count > 0 && <div className="mx-2 my-1 h-px bg-border-subtle" role="separator" />}
          <ComboboxItem value="Blank app" current={current === null} onSelect={() => onPick(null)}>
            Blank app
          </ComboboxItem>
          {onNew && (
            <ComboboxAction value="New scenario" onSelect={onNew}>
              <IconPlus size={14} />
              New scenario
            </ComboboxAction>
          )}
        </ComboboxGroup>
      </ComboboxList>
    </ComboboxContent>
  )
}

/** The glyph before the scenario's name: where its run is, by shape first (DESIGN.md principle 3). */
function ScenarioGlyph({ scenario }: { scenario: DriveScenario | undefined }) {
  if (scenario?.status === 'running') return <Spinner size="sm" />
  if (scenario?.status === 'failed') return <StatusDot tone="danger" label="failed" />
  if (scenario?.status === 'landed') return <StatusDot tone="success" label="landed" />
  return <StatusDot tone="neutral" />
}

/**
 * The trigger: a ghost control at the toolbar's height that, unlike a `Button`,
 * may shrink — the scenario's name is what gives way in a narrow panel.
 */
const SCENARIO_TRIGGER = cx(
  BARE_BUTTON,
  'flex h-(--control-h) min-w-0 max-w-80 items-center gap-2 rounded-md px-2.5 text-sm font-medium',
  'transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover data-[state=open]:bg-surface-selected',
)

/**
 * The running drive's scenario control, first in the window's toolbar
 * (decisions 1, 4): the scenario the app is in, with its run's state, opening
 * the list. Its name gives way first when the panel narrows (decision 10).
 */
export function ScenarioControl({
  menu,
  scenario,
  blank,
  onPick,
  onNew,
}: {
  menu: ScenarioMenu
  scenario: DriveScenario | undefined
  /** The human went back to the plain app over a landed scenario. */
  blank: boolean
  onPick: (file: string | null) => void
  onNew: () => void
}) {
  const on = scenario && !blank ? scenario : undefined
  return (
    <Combobox>
      <ComboboxTrigger asChild>
        <button
          type="button"
          data-scenario-trigger=""
          title={on ? `Scenario: ${on.name} — ${on.file}` : 'Land on a scenario, or write a new one'}
          className={SCENARIO_TRIGGER}
        >
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            <ScenarioGlyph scenario={on} />
          </span>
          <span className={cx('min-w-0 truncate', on ? 'text-text' : 'text-text-secondary')}>
            {on ? on.name : 'Blank app'}
          </span>
          <IconChevronDown size={14} className="shrink-0 text-icon" />
        </button>
      </ComboboxTrigger>
      <ScenarioPickerContent menu={menu} current={on ? on.file : null} onPick={onPick} onNew={onNew} />
    </Combobox>
  )
}
