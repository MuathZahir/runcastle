import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AGENT_RUNTIMES, mergeModelEntries } from '@runcastle/core'
import type { AgentRuntime, ModelEntry, ModelStep } from '@runcastle/core'
import {
  customModelCommit,
  hiddenCuratedCount,
  rosterVisibleRows,
  RUNTIME_LABEL,
  type ModelOptionGroup,
  type RosterRow,
} from '../../lib/settings'
import { Button } from '../../ui'
import { IconX } from '../../icons'
import { BARE_BUTTON, PLAIN_BUTTON } from './button'
import type { SettingWrites } from './ModelsPage'
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
 * The runtime chip and the save mark live here rather than in a module of their
 * own: the roster is where a model's runtime is declared, and the per-step table
 * is the only other reader.
 */

/** Fits the 940px dialog's page column without a horizontal scrollbar. */
const COLUMNS = 'grid grid-cols-[168px_86px_minmax(140px,1fr)_118px_92px_24px] items-center gap-2'

/**
 * A row's feedback slot: one row, one place its "Saved ✓" or its refusal
 * appears, whichever of the row's controls issued the write.
 */
const rowCell = (id: string) => `models:${id}`
const ADD_CELL = 'models:new'

/** The add row's controls, which are ordinary 32px fields rather than cells. */
const ADD_FIELD =
  'h-(--control-h) min-w-0 rounded-sm border border-hairline bg-panel-inset px-2.5 text-sm ' +
  'text-text placeholder:text-text-4 hover:border-hairline-strong'

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
  const hidden = showAll || filtering ? 0 : hiddenCuratedCount(rows)

  return (
    <>
      <div className="overflow-hidden rounded-md border border-hairline">
        <div
          className={`${COLUMNS} min-h-7.5 bg-panel-2 px-2.5 text-xs font-semibold tracking-[0.06em] text-text-3 uppercase`}
        >
          <span>Model</span>
          <span>Runtime</span>
          <span>Use-case note</span>
          <span>Used for</span>
          <span>Default</span>
          <span />
        </div>
        {shown.map((row) => (
          <ModelRow
            key={row.id}
            row={row}
            stepLabels={stepLabels}
            customModels={customModels}
            writes={writes}
          />
        ))}
        {!filtering && <AddModelRow customModels={customModels} writes={writes} />}
      </div>
      {hidden > 0 && (
        <p className="text-sm text-text-3">
          {hidden} curated {hidden === 1 ? 'model' : 'models'} not shown:{' '}
          <button
            type="button"
            className={`${BARE_BUTTON} text-accent-hi hover:underline`}
            onClick={() => setShowAll(true)}
          >
            show all
          </button>
        </p>
      )}
    </>
  )
}

function ModelRow({
  row,
  stepLabels,
  customModels,
  writes,
}: {
  row: RosterRow
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

  return (
    <div className="group border-t border-hairline-soft">
      <div className={`${COLUMNS} min-h-10 px-2.5 py-1.5 text-sm`}>
        <span
          className={`truncate font-mono ${row.isDefault ? 'text-accent-hi' : 'text-text'}`}
          title={row.id}
        >
          {row.id}
        </span>
        <RuntimeChip runtime={row.runtime} />
        <div className="flex min-w-0 items-center gap-1.5">
          <NoteCell row={row} onCommit={saveNote} />
          {writes.saved === cell && <SaveMark />}
        </div>
        <span className="text-xs leading-tight text-text-3">
          {/* "Default" leads: every step with no model of its own is on it. */}
          {row.isDefault && <span className="text-text-2">Default</span>}
          {row.isDefault && usedFor !== '' && ' · '}
          {usedFor !== '' ? usedFor : row.isDefault ? '' : '—'}
        </span>
        {row.isDefault ? (
          <span className="justify-self-start rounded-pill border border-accent-line bg-accent-soft px-2 py-0.5 text-xs font-semibold tracking-[0.06em] text-accent-hi uppercase">
            Default
          </span>
        ) : (
          <button
            type="button"
            aria-label={`Make ${row.id} the default`}
            // Attributed to this row, not to the card at the top of the page:
            // a refusal belongs where the click was.
            onClick={() => writes.save(cell, 'model', row.id)}
            className={`${PLAIN_BUTTON} justify-self-start rounded-pill border border-transparent px-2 py-0.5 text-xs whitespace-nowrap text-text-3 opacity-0 group-hover:border-hairline group-hover:opacity-100 hover:border-accent-line hover:text-accent-hi focus-visible:opacity-100`}
          >
            Make default
          </button>
        )}
        {row.custom && (
          <button
            type="button"
            aria-label={`Remove ${row.id}`}
            onClick={remove}
            className={`${BARE_BUTTON} grid size-6 place-items-center rounded-sm text-text-4 hover:bg-panel-3 hover:text-danger`}
          >
            <IconX size={12} />
          </button>
        )}
      </div>
      <Refusal writes={writes} cell={cell} />
    </div>
  )
}

/**
 * The note, edited in place. Committed when it is left, as everything on this
 * surface is; Enter is the same as leaving it.
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
      placeholder={
        row.isDefault ? 'e.g. UI/UX work, design-heavy tickets' : 'Add a note to offer it per ticket'
      }
      className="h-6.5 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-2 text-sm text-text placeholder:text-text-4 placeholder:italic hover:border-hairline hover:bg-panel-inset focus:border-accent-line focus:bg-panel-inset"
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
    <div className="border-t border-hairline-soft bg-panel-2">
      {/* Its own columns rather than the table's: this row is three controls and
          a button, and none of them is the column above it. */}
      <div className="grid grid-cols-[minmax(0,1fr)_150px_minmax(0,1.2fr)_auto] items-center gap-2 px-2.5 py-1.5">
        <input
          type="text"
          aria-label="New model id"
          placeholder="model id, e.g. claude-opus-5[1m]"
          className={`${ADD_FIELD} font-mono`}
          value={id}
          onChange={(e) => setId(e.target.value)}
          onKeyDown={onEnter}
        />
        <select
          aria-label="Runtime (required)"
          className={`${ADD_FIELD} cursor-pointer`}
          value={runtime}
          onChange={(e) => setRuntime(e.target.value)}
        >
          <option value="">Runs on…</option>
          {AGENT_RUNTIMES.map((r) => (
            <option key={r} value={r}>
              {RUNTIME_LABEL[r]}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label="New model note"
          placeholder="use-case note (optional)"
          className={ADD_FIELD}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={onEnter}
        />
        <Button type="button" onClick={add}>
          Add model
        </Button>
      </div>
      <Refusal writes={writes} cell={ADD_CELL} />
    </div>
  )
}

/** Why a write was refused, under the row — or the card — that asked for it. */
export function Refusal({
  writes,
  cell,
  className = 'px-2.5 pb-1.5',
}: {
  writes: SettingWrites
  cell: string
  className?: string
}) {
  if (writes.error?.cell !== cell) return null
  return (
    <p role="alert" className={`text-sm text-danger ${className}`}>
      {writes.error.message}
    </p>
  )
}

/**
 * Which CLI a model launches. Two token-adjacent tints, no new tokens: the
 * runtime is a property of the model, not a status, so it is not on the status
 * palette.
 */
const RUNTIME_CHIP: Record<AgentRuntime, string> = {
  'claude-code': 'border-accent-line bg-accent-soft text-accent-hi',
  codex: 'border-ok/35 bg-ok/10 text-ok',
}

export function RuntimeChip({ runtime }: { runtime: AgentRuntime }) {
  return (
    <span
      className={`inline-flex h-5 w-fit items-center rounded-pill border px-2 font-mono text-xs whitespace-nowrap ${RUNTIME_CHIP[runtime]}`}
    >
      {RUNTIME_LABEL[runtime]}
    </span>
  )
}

/** The roster as `<optgroup>`s — the runtime a model launches is part of it. */
export function ModelOptions({ groups }: { groups: ModelOptionGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <optgroup key={group.runtime} label={group.label}>
          {group.entries.map((entry) => (
            <option key={entry.id} value={entry.id} title={entry.note}>
              {entry.note ? `${entry.id} — ${entry.note}` : entry.id}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  )
}

/** The brief "it landed" beside a control, as on the shared setting row. */
export function SaveMark() {
  return <span className="shrink-0 text-xs text-ok">Saved ✓</span>
}
