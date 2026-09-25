import { Fragment } from 'react'
import { stepModelKey, type ModelOptionGroup, type StepGroup, type StepRow } from '../../lib/settings'
import { IconUndo } from '../../icons'
import { cx, IconButton, StatusDot } from '../../ui'
import { SELECT_FIELD, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import type { SettingWrites } from './ModelsPage'
import { ModelOptions, REVEAL, Refusal, RuntimeIcon, TABLE_HEAD } from './RosterTable'
import { SaveMark } from './SettingRow'
import { showsSetting, type FilterState } from './types'

/**
 * Which model runs each step (decision 15). All eleven are always listed — the
 * old surface hid the unset ones behind an "add an override" picker, which made
 * the whole per-step idea a two-step discovery — and each carries a line saying
 * what the step does, so the names need no help text.
 *
 * The two groups are different spending decisions: a session is one you are
 * sitting in front of, an unattended run is one you are paying for while away.
 */
const GROUPS: readonly { group: StepGroup; title: string; caption: string }[] = [
  { group: 'sessions', title: 'Sessions', caption: 'Interactive — you are in the terminal' },
  { group: 'unattended', title: 'Unattended', caption: 'Burns and scripted runs' },
]

const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_260px_24px] items-center gap-3'

export function StepTable({
  rows,
  groups,
  defaultModel,
  projectModel,
  filter,
  writes,
}: {
  rows: StepRow[]
  groups: ModelOptionGroup[]
  /** What an unset step runs, named in its select's first option. */
  defaultModel: string
  /** The model the open project runs everything on, when it sets one. */
  projectModel: string | null
  filter: FilterState
  writes: SettingWrites
}) {
  return (
    <>
      {projectModel && (
        <p className="m-0 mt-3 flex items-center gap-2 text-xs text-text-secondary">
          <StatusDot tone="warning" />
          <span>
            This project runs everything on <span className="font-mono">{projectModel}</span> —
            these apply to other projects.
          </span>
        </p>
      )}
      {GROUPS.map(({ group, title, caption }) => {
        const shown = rows.filter(
          (row) => row.group === group && showsSetting(filter, stepModelKey(row.step)),
        )
        if (shown.length === 0) return null
        return (
          <Fragment key={group}>
            <div className={cx(COLUMNS, TABLE_HEAD, 'mt-4')}>
              <span>
                {title}
                <span className="ml-2 font-normal text-text-disabled">{caption}</span>
              </span>
              <span>Model</span>
              <span />
            </div>
            {shown.map((row) => (
              <StepModelRow
                key={row.step}
                row={row}
                groups={groups}
                defaultModel={defaultModel}
                writes={writes}
              />
            ))}
          </Fragment>
        )
      })}
    </>
  )
}

function StepModelRow({
  row,
  groups,
  defaultModel,
  writes,
}: {
  row: StepRow
  groups: ModelOptionGroup[]
  defaultModel: string
  writes: SettingWrites
}) {
  const key = stepModelKey(row.step)
  const set = row.value !== null

  return (
    <div className="group border-b border-border-subtle transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover">
      <div className={cx(COLUMNS, 'min-h-12 px-2 py-1.5')}>
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2 text-sm text-text">
            {row.label}
            {writes.saved === key && <SaveMark />}
          </span>
          <span className="truncate text-xs text-text-tertiary" title={row.description}>
            {row.description}
          </span>
        </span>
        <Select
          value={row.value ?? ''}
          onValueChange={(next) => writes.save(key, key, next === '' ? null : next)}
        >
          <SelectTrigger
            // The old per-step comboboxes had no accessible name at all
            // (findings F17.7): eleven controls reading out as "combo box".
            aria-label={`Model for ${row.label}`}
            className={cx(SELECT_FIELD, 'w-full', !set && 'text-text-tertiary')}
          >
            {/* What it will actually launch, which is a property of the model
                that wins — never inferred from the id. */}
            <span className="flex min-w-0 items-center gap-2 [&>span:last-child]:truncate">
              <RuntimeIcon runtime={row.effectiveRuntime} />
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Default ({defaultModel})</SelectItem>
            <ModelOptions groups={groups} />
          </SelectContent>
        </Select>
        {set ? (
          <IconButton
            label={`Reset ${row.label} to default`}
            size="sm"
            icon={<IconUndo />}
            onClick={() => writes.save(key, key, null)}
            className={REVEAL}
          />
        ) : (
          <span />
        )}
      </div>
      <Refusal writes={writes} cell={key} className="px-2 pb-2.5" />
    </div>
  )
}
