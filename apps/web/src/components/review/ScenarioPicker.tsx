import type { DriveScenario } from '@runcastle/core'
import { BARE_BUTTON, Spinner, StatusDot, cx } from '../../ui'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '../../ui/combobox'
import { FLOATING_SEPARATOR } from '../../ui/floating'
import { SELECT_BAR } from '../../ui/select'
import { IconChevronDown, IconPlus } from '../../icons'
import { scenarioGroups, type ScenarioMenu } from '../../lib/feature-ui/scenarios'

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
          {count > 0 && <div className={FLOATING_SEPARATOR} role="separator" />}
          <ComboboxItem value="Blank app" current={current === null} onSelect={() => onPick(null)}>
            Blank app
          </ComboboxItem>
          {onNew && (
            <ComboboxItem value="New scenario" onSelect={onNew}>
              <span className="flex items-center gap-2">
                <IconPlus size={14} className="text-icon" />
                New scenario
              </span>
            </ComboboxItem>
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
  const shown = scenario && !blank ? scenario : undefined
  return (
    <Combobox>
      <ComboboxTrigger asChild>
        <button
          type="button"
          data-scenario-trigger=""
          title={shown ? `Scenario: ${shown.name} — ${shown.file}` : 'Land on a scenario, or write a new one'}
          className={cx(BARE_BUTTON, SELECT_BAR, 'flex items-center gap-2')}
        >
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            <ScenarioGlyph scenario={shown} />
          </span>
          <span className={cx('min-w-0 truncate', shown ? 'text-text' : 'text-text-secondary')}>
            {shown ? shown.name : 'Blank app'}
          </span>
          <IconChevronDown size={14} className="shrink-0 text-icon" />
        </button>
      </ComboboxTrigger>
      <ScenarioPickerContent menu={menu} current={shown ? shown.file : null} onPick={onPick} onNew={onNew} />
    </Combobox>
  )
}
