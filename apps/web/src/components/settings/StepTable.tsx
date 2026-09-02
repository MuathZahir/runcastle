import { Fragment } from 'react'
import { stepModelKey, type ModelOptionGroup, type StepGroup, type StepRow } from '../../lib/settings'
import { IconX } from '../../icons'
import { BARE_BUTTON } from './button'
import type { SettingWrites } from './ModelsPage'
import { ModelOptions, Refusal, RuntimeChip, SaveMark } from './RosterTable'
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
  { group: 'sessions', title: 'Sessions', caption: 'interactive — you are in the terminal' },
  { group: 'unattended', title: 'Unattended', caption: 'burns and scripted runs' },
]

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
        <p className="text-sm text-warn">
          This project runs everything on <span className="font-mono">{projectModel}</span> — these
          apply to other projects.
        </p>
      )}
      <div className="overflow-hidden rounded-md border border-hairline">
        {GROUPS.map(({ group, title, caption }) => {
          const shown = rows.filter(
            (row) => row.group === group && showsSetting(filter, stepModelKey(row.step)),
          )
          if (shown.length === 0) return null
          return (
            <Fragment key={group}>
              <div className="flex min-h-7.5 items-center gap-2 border-t border-hairline-soft bg-panel-2 px-3 text-xs font-semibold tracking-[0.06em] text-text-3 uppercase first:border-t-0">
                {title}
                <span className="ml-auto text-xs font-medium tracking-normal text-text-4 normal-case">
                  {caption}
                </span>
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
      </div>
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
    <div className="border-t border-hairline-soft">
      <div className="grid min-h-11 grid-cols-[1fr_250px_84px_24px] items-center gap-3 px-3 py-1.5">
        <span className="text-base font-medium text-text">
          {row.label}
          <small className="block text-xs leading-tight font-normal text-text-3">
            {row.description}
          </small>
        </span>
        <div className="flex min-w-0 items-center gap-1.5">
          <select
            // The old per-step comboboxes had no accessible name at all
            // (findings F17.7): eleven controls reading out as "combo box".
            aria-label={`Model for ${row.label}`}
            className={`h-(--control-h) min-w-0 flex-1 cursor-pointer rounded-sm border border-hairline bg-panel-inset px-2.5 text-sm hover:border-hairline-strong ${
              set ? 'font-mono text-text' : 'text-text-3'
            }`}
            value={row.value ?? ''}
            onChange={(e) => writes.save(key, key, e.target.value === '' ? null : e.target.value)}
          >
            <option value="">Default ({defaultModel})</option>
            <ModelOptions groups={groups} />
          </select>
          {writes.saved === key && <SaveMark />}
        </div>
        {/* What it will actually launch, which is a property of the model that
            wins — never inferred from the id. */}
        <RuntimeChip runtime={row.effectiveRuntime} />
        {set && (
          <button
            type="button"
            aria-label={`Reset ${row.label} to default`}
            title="Use the default"
            onClick={() => writes.save(key, key, null)}
            className={`${BARE_BUTTON} grid size-6 place-items-center rounded-sm text-text-4 hover:bg-panel-3 hover:text-text`}
          >
            <IconX size={12} />
          </button>
        )}
      </div>
      <Refusal writes={writes} cell={key} />
    </div>
  )
}
