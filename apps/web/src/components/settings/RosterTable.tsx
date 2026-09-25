import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AGENT_RUNTIMES, mergeModelEntries } from '@runcastle/core'
import type { AgentRuntime, ModelEntry, ModelStep } from '@runcastle/core'
import {
  customModelCommit,
  DISCOVERY_SOURCE_LABEL,
  hiddenRosterCount,
  rosterVisibleRows,
  RUNTIME_LABEL,
  type ModelOptionGroup,
  type RosterRow,
} from '../../lib/settings'
import { Button, cx, IconButton, StatusLabel, TextField } from '../../ui'
import {
  SELECT_FIELD,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../../ui/select'
import { IconCheck, IconClaude, IconCodex, IconPlus, IconTrash } from '../../icons'
import type { SettingWrites } from './ModelsPage'
import { SELECT_TRUNCATE, SaveMark } from './SettingRow'
import { showsSetting, type FilterState } from './types'

/**
 * The model roster (decisions 6 / 15 / 16): every model this machine offers,
 * what each is for, and which one is the default.
 *
 * Annotating a model is typing in its note cell — including a curated one, which
 * writes an entry with that id into the `models` roster. The note is the opt-in
 * for per-ticket model choice, which is why it is a first-class column rather
 * than something reachable only through a dropdown's "Custom…" branch.
 *
 * A clean data table: a sentence-case header row, 40px rows divided by
 * `border-subtle`, the provider's glyph before each model, status as a
 * `StatusLabel`, and the row actions (make default, remove) revealed on hover.
 *
 * The runtime icon lives here rather than in a module of its own: the roster is
 * where a model's runtime is declared, and the per-step table is the only other
 * reader.
 */

/** The roster's columns: model · use-case note · used for · default · row actions. */
const COLUMNS =
  'grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_88px_24px] items-center gap-3'

/** A column heading row: 12px tertiary, sentence case, no fill. */
export const TABLE_HEAD =
  'min-h-8 border-b border-border-subtle px-2 text-xs font-medium text-text-tertiary'

/**
 * A row's feedback slot: one row, one place its "Saved" or its refusal
 * appears, whichever of the row's controls issued the write.
 */
const rowCell = (id: string) => `models:${id}`
const ADD_CELL = 'models:new'

/** Hover-revealed, like every row action: never visible at rest. */
export const REVEAL =
  'opacity-0 transition-opacity duration-(--dur-1) group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'

export function RosterTable({
  rows,
  stepLabels,
  customModels,
  filter,
  writes,
}: {
  rows: RosterRow[]
  /** Human wording per step, for the "Used for" column. */
  stepLabels: ReadonlyMap<ModelStep, string>
  /** The operator's own roster entries — what a write merges into. */
  customModels: ModelEntry[]
  filter: FilterState
  writes: SettingWrites
}) {
  const [showAll, setShowAll] = useState(false)
  // While filtering, everything is searched: a curated model collapsed out of
  // the way is exactly what someone types a name to find.
  const filtering = filter.query.trim() !== ''
  const shown = (showAll || filtering ? rows : rosterVisibleRows(rows)).filter((row) =>
    showsSetting(filter, row.id),
  )
  const hidden = showAll || filtering ? 0 : hiddenRosterCount(rows)

  return (
    <div className="mt-3">
      <div className={cx(COLUMNS, TABLE_HEAD)}>
        <span>Model</span>
        <span>Use-case note</span>
        <span>Used for</span>
        <span>Default</span>
        <span />
      </div>
      {shown.map((row, i) => (
        <ModelRow
          key={row.id}
          index={i}
          row={row}
          stepLabels={stepLabels}
          customModels={customModels}
          writes={writes}
        />
      ))}
      {hidden > 0 && (
        <div className="flex min-h-10 items-center gap-2 border-b border-border-subtle px-2 text-xs text-text-tertiary">
          {hidden} more {hidden === 1 ? 'model' : 'models'} nobody uses
          <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
            Show all
          </Button>
        </div>
      )}
      {!filtering && <AddModelRow customModels={customModels} writes={writes} />}
    </div>
  )
}

function ModelRow({
  row,
  index,
  stepLabels,
  customModels,
  writes,
}: {
  row: RosterRow
  index: number
  stepLabels: ReadonlyMap<ModelStep, string>
  customModels: ModelEntry[]
  writes: SettingWrites
}) {
  const cell = rowCell(row.id)
  const usedFor = row.usedFor.map((step) => stepLabels.get(step) ?? step).join(', ')

  const saveNote = (note: string) => {
    const trimmed = note.trim()
    // A curated model with nothing left to say about it is not an entry at all
    // — it goes back to being the curated one. A custom id has to stay.
    const next =
      trimmed === '' && !row.custom
        ? customModels.filter((m) => m.id !== row.id)
        : mergeModelEntries(customModels, [
            { id: row.id, runtime: row.runtime, ...(trimmed ? { note: trimmed } : {}) },
          ])
    writes.save(cell, 'models', next)
  }

  const remove = () => {
    if (row.isDefault) {
      writes.refuse(cell, `${row.id} is the default model — make another model the default first.`)
      return
    }
    if (row.usedFor.length > 0) {
      writes.refuse(cell, `${row.id} runs ${usedFor} — reset those steps first.`)
      return
    }
    writes.save(
      cell,
      'models',
      customModels.filter((m) => m.id !== row.id),
    )
  }

  // The first rows of the initial render rise in with a 20ms stagger (DESIGN.md
  // §Motion). Keyed rows keep their element across refetches, so it runs once.
  const staggered = index < 8
  return (
    <div
      className={cx(
        'group border-b border-border-subtle transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover',
        staggered && 'animate-rise-in',
      )}
      style={staggered ? { animationDelay: `${index * 20}ms` } : undefined}
    >
      <div className={cx(COLUMNS, 'min-h-10 px-2 text-sm')}>
        <span className="flex min-w-0 items-center gap-2">
          <RuntimeIcon runtime={row.runtime} />
          <span
            className="truncate text-text"
            title={row.displayName ? `${row.displayName} — ${row.id}` : row.id}
          >
            {row.id}
          </span>
          {row.isNew && (
            <StatusLabel tone="accent" className="shrink-0">
              New
            </StatusLabel>
          )}
        </span>
        <div className="flex min-w-0 items-center gap-1.5">
          <NoteCell row={row} onCommit={saveNote} />
          {writes.saved === cell && <SaveMark />}
        </div>
        <span className="truncate text-xs text-text-tertiary" title={usedFor || undefined}>
          {/* "Default" leads: every step with no model of its own is on it. */}
          {row.isDefault && <span className="text-text-secondary">Default</span>}
          {row.isDefault && usedFor !== '' && ', '}
          {usedFor !== '' ? usedFor : row.isDefault ? '' : '—'}
        </span>
        {row.isDefault ? (
          <span data-default-mark="" className="inline-flex">
            <StatusLabel strong icon={<IconCheck />}>
              Default
            </StatusLabel>
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Make ${row.id} the default`}
            // Attributed to this row, not to the row at the top of the page: a
            // refusal belongs where the click was.
            onClick={() => writes.save(cell, 'model', row.id)}
            className={cx('-ml-2 justify-self-start', REVEAL)}
          >
            Make default
          </Button>
        )}
        {row.custom ? (
          <IconButton
            label={`Remove ${row.id}`}
            size="sm"
            icon={<IconTrash />}
            onClick={remove}
            className={cx('enabled:hover:text-danger', REVEAL)}
          />
        ) : (
          <span />
        )}
      </div>
      <ProviderNotice row={row} />
      <Refusal writes={writes} cell={cell} />
    </div>
  )
}

/**
 * What the providers say about a row that is not in its cells: that its source
 * stopped offering it while something still uses it, and when the Codex cache
 * says it retires — each a warning before a launch fails on it.
 */
function ProviderNotice({ row }: { row: RosterRow }) {
  if (!row.noLongerOffered && !row.retirement) return null
  return (
    <p className="m-0 flex flex-wrap gap-x-4 pr-2 pb-2.5 pl-8 text-xs text-warning">
      {row.noLongerOffered && (
        <span>no longer offered by {DISCOVERY_SOURCE_LABEL[row.noLongerOffered]}</span>
      )}
      {row.retirement && (
        <span>
          retires {row.retirement.at} → {row.retirement.replacement}
        </span>
      )}
    </p>
  )
}

/**
 * The note, edited in place. It reads as text until it is hovered or focused,
 * and is committed when it is left, as everything on this surface is; Enter is
 * the same as leaving it.
 */
function NoteCell({ row, onCommit }: { row: RosterRow; onCommit: (note: string) => void }) {
  const [draft, setDraft] = useState(row.note)
  useEffect(() => setDraft(row.note), [row.note])

  return (
    <input
      type="text"
      aria-label={`Note for ${row.id}`}
      // The default's example is what a note is FOR; every other row's is what
      // typing one buys you.
      placeholder={row.isDefault ? 'e.g. UI/UX work, design-heavy tickets' : 'Add a note'}
      className={cx(
        '-ml-2 h-7 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm text-text',
        'transition-colors duration-(--dur-1) ease-app placeholder:text-text-disabled',
        'hover:border-border focus:border-accent focus:bg-surface-inset',
      )}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== row.note.trim() && onCommit(draft)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

/**
 * Adding a model: an id, the runtime it runs on, and an optional note. The
 * runtime is REQUIRED and never inferred from the id — pattern matching fails
 * silently on proxies and unguessable future ids, and the failure mode is
 * launching the wrong CLI. Adding does not select: it puts the model on the
 * roster, and the default and the per-step table are where it gets used.
 */
function AddModelRow({
  customModels,
  writes,
}: {
  customModels: ModelEntry[]
  writes: SettingWrites
}) {
  const [id, setId] = useState('')
  const [runtime, setRuntime] = useState('')
  const [note, setNote] = useState('')

  const add = () => {
    const commit = customModelCommit(id, runtime, note)
    if ('error' in commit) {
      writes.refuse(ADD_CELL, commit.error)
      return
    }
    writes.save(ADD_CELL, 'models', mergeModelEntries(customModels, [commit.entry]))
    setId('')
    setRuntime('')
    setNote('')
  }

  const onEnter = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter') add()
  }

  return (
    <div className="pt-3">
      {/* Its own columns rather than the table's: this row is three controls and
          a button, and none of them is the column above it. */}
      <div className="grid grid-cols-[minmax(0,1fr)_132px_minmax(0,1.2fr)_auto] items-center gap-2">
        <TextField
          mono
          aria-label="New model id"
          placeholder="Model id, e.g. claude-opus-5[1m]"
          value={id}
          onChange={(e) => setId(e.target.value)}
          onKeyDown={onEnter}
        />
        <Select value={runtime} onValueChange={setRuntime}>
          <SelectTrigger
            aria-label="Runtime (required)"
            className={cx(SELECT_FIELD, SELECT_TRUNCATE, 'w-full', runtime === '' && 'text-text-tertiary')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Runs on…</SelectItem>
            {AGENT_RUNTIMES.map((r) => (
              <SelectItem key={r} value={r}>
                {RUNTIME_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <TextField
          aria-label="New model note"
          placeholder="Use-case note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={onEnter}
        />
        <Button icon={<IconPlus />} onClick={add}>
          Add model
        </Button>
      </div>
      <Refusal writes={writes} cell={ADD_CELL} className="pt-1.5" />
    </div>
  )
}

/** Why a write was refused, under the row — or the control — that asked for it. */
export function Refusal({
  writes,
  cell,
  className = 'pr-2 pb-2.5 pl-8',
}: {
  writes: SettingWrites
  cell: string
  className?: string
}) {
  if (writes.error?.cell !== cell) return null
  return (
    <p role="alert" className={cx('m-0 text-xs text-danger', className)}>
      {writes.error.message}
    </p>
  )
}

/**
 * Which CLI a model launches, as that provider's glyph. A property of the
 * model, not a status, so it is a neutral icon rather than a coloured chip; the
 * runtime's name is its accessible name and its tooltip.
 */
export function RuntimeIcon({ runtime }: { runtime: AgentRuntime }) {
  const Glyph = runtime === 'codex' ? IconCodex : IconClaude
  return (
    <span
      role="img"
      aria-label={RUNTIME_LABEL[runtime]}
      title={RUNTIME_LABEL[runtime]}
      className="inline-flex size-4 shrink-0 items-center justify-center text-icon"
    >
      <Glyph size={14} />
    </span>
  )
}

/** The roster as `Select` groups — the runtime a model launches is part of it. */
export function ModelOptions({ groups }: { groups: ModelOptionGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <SelectGroup key={group.runtime}>
          <SelectLabel>{group.label}</SelectLabel>
          {group.entries.map((entry) => (
            <SelectItem key={entry.id} value={entry.id} title={entry.note}>
              {entry.note ? `${entry.id} — ${entry.note}` : entry.id}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  )
}
