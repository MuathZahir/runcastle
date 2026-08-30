import { useEffect, useRef, useState } from 'react'
import type { ModelEntry, ModelStep } from '@runcastle/core'
import { trpc } from '../../trpc'
import {
  customModelsFromView,
  defaultModelOf,
  modelOptionGroups,
  projectModelWarning,
  rosterFromView,
  rosterRows,
  stepModelKey,
  stepRows,
  type ModelOptionGroup,
} from '../../lib/settings'
import { DimLine } from '../../ui'
import { ModelOptions, Refusal, RosterTable, SaveMark } from './RosterTable'
import { StepTable } from './StepTable'
import { showsSetting, type SettingsPageProps } from './types'

/**
 * Models (flow-redesign-settings, decisions 6 / 15 / 16): the default model, the
 * roster of models this machine offers, and which model runs each step —
 * machine-wide, all of it read off the global `settings.get` view.
 *
 * The page exists because the multi-model flow the tickets agent depends on was
 * invisible: a use-case note could only be typed into the "Custom…" branch of a
 * dropdown, and a curated model could not be annotated at all. Here, annotating
 * any model is typing in its note cell, and the default is stated twice — the
 * card at the top and the roster's Default column — because a reader should not
 * have to read a note to find out what "default" means.
 */

/** How long "Saved ✓" stays up after a commit, as on the shared setting row. */
const SAVED_MS = 1400

/** The default card's feedback slot; its key is the setting it writes. */
const DEFAULT_CELL = 'model'

/** What a settings write on this page may carry: a model id, or the roster. */
type SettingValue = ModelEntry[] | string | null

/**
 * The page's write channel. Every control here autosaves the moment it commits,
 * so several writes can be in flight at once — and the config file is
 * read-modify-write, so two overlapping writes lose one of them. They are
 * therefore queued and chained: one request at a time, the next going out only
 * once the last has landed.
 *
 * `cell` is what a write is attributed to, so the "Saved ✓" and any refusal land
 * beside the control that issued it rather than at the top of the page.
 */
export interface SettingWrites {
  /** Queue a global write, attributed to `cell`. */
  save: (cell: string, key: string, value: SettingValue) => void
  /** Refuse locally, in the same place a server refusal would appear. */
  refuse: (cell: string, message: string) => void
  /** The cell whose write just landed. */
  saved: string | null
  /** The cell whose write was refused, and why. */
  error: { cell: string; message: string } | null
}

function useSettingWrites(): SettingWrites {
  const utils = trpc.useUtils()
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<{ cell: string; message: string } | null>(null)
  const queued = useRef<{ cell: string; key: string; value: SettingValue }[]>([])
  const inFlight = useRef<string | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(savedTimer.current), [])

  const next = () => {
    const write = queued.current.shift()
    if (!write) {
      inFlight.current = null
      return
    }
    inFlight.current = write.cell
    update.mutate({ key: write.key, value: write.value })
  }

  const update = trpc.settings.update.useMutation({
    onSuccess: () => {
      setSaved(inFlight.current)
      clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setSaved(null), SAVED_MS)
      void utils.settings.get.invalidate()
      next()
    },
    onError: (e) => {
      const cell = inFlight.current
      if (cell) setError({ cell, message: e.message })
      // A refusal is a question about the value just typed; sending the writes
      // stacked up behind it would answer it with unrelated ones.
      queued.current = []
      inFlight.current = null
    },
  })

  /** A new write to a cell is the answer to whatever was refused there. */
  const forget = (cell: string) => setError((e) => (e && e.cell === cell ? null : e))

  return {
    saved,
    error,
    save: (cell, key, value) => {
      forget(cell)
      queued.current.push({ cell, key, value })
      if (inFlight.current === null) next()
    },
    refuse: (cell, message) => setError({ cell, message }),
  }
}

export function ModelsPage({ globals, scoped, filter, highlightField }: SettingsPageProps) {
  const writes = useSettingWrites()

  if (globals.isLoading) return <DimLine>loading…</DimLine>
  if (globals.error) return <DimLine>could not load settings: {globals.error.message}</DimLine>
  if (!globals.data) return null

  const view = globals.data
  const roster = rosterRows(view)
  const steps = stepRows(view)
  const groups = modelOptionGroups(rosterFromView(view))
  const defaultModel = defaultModelOf(view)
  // The roster's "Used for" column names steps, which only the step table knows
  // the human wording for.
  const stepLabels = new Map<ModelStep, string>(steps.map((s) => [s.step, s.label]))

  return (
    <div className="flex flex-col gap-5.5">
      {showsSetting(filter, 'model') && (
        <DefaultModelCard
          value={defaultModel}
          groups={groups}
          writes={writes}
          highlight={highlightField === 'model'}
        />
      )}
      {roster.some((row) => showsSetting(filter, row.id)) && (
        <section className="flex flex-col gap-2.5">
          <GroupHeading>Roster</GroupHeading>
          <p className="text-sm text-text-3">
            A model with a <b className="font-medium text-text-2">use-case note</b> is offered to
            the tickets agent, which may pick it per ticket; models without a note are never picked
            automatically.
          </p>
          <RosterTable
            rows={roster}
            stepLabels={stepLabels}
            customModels={customModelsFromView(view)}
            filter={filter}
            writes={writes}
          />
        </section>
      )}
      {steps.some((step) => showsSetting(filter, stepModelKey(step.step))) && (
        <section className="flex flex-col gap-2.5">
          <GroupHeading>Per step</GroupHeading>
          <StepTable
            rows={steps}
            groups={groups}
            defaultModel={defaultModel}
            projectModel={projectModelWarning(scoped.data)}
            filter={filter}
            writes={writes}
          />
        </section>
      )}
    </div>
  )
}

/** The 11px uppercase heading over a section, with its hairline to the edge. */
function GroupHeading({ children }: { children: string }) {
  return (
    <h3 className="flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-text-3 uppercase">
      {children}
      <span className="h-px flex-1 bg-hairline-soft" />
    </h3>
  )
}

/**
 * What the default model is, in the one place a reader looks first. It is stated
 * again as the roster's Default column, and the two are the same value: changing
 * either writes `model` and the other follows.
 */
function DefaultModelCard({
  value,
  groups,
  writes,
  highlight,
}: {
  value: string
  groups: ModelOptionGroup[]
  writes: SettingWrites
  highlight: boolean
}) {
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (highlight) card.current?.scrollIntoView?.({ block: 'center' })
  }, [highlight])

  return (
    <div
      ref={card}
      className={`grid grid-cols-[auto_1fr] items-center gap-x-4.5 gap-y-1 rounded-md border border-accent-line bg-accent-soft p-3 ${
        highlight ? 'outline-2 outline-offset-2 outline-accent' : ''
      }`}
    >
      <label htmlFor="settings-default-model" className="text-base font-semibold text-text">
        Default model
      </label>
      <div className="flex items-center gap-2">
        <select
          id="settings-default-model"
          className="h-(--control-h) max-w-85 min-w-0 flex-1 cursor-pointer rounded-sm border border-accent-line bg-panel-inset px-2.5 font-mono text-sm text-text"
          value={value}
          onChange={(e) => writes.save(DEFAULT_CELL, 'model', e.target.value)}
        >
          <ModelOptions groups={groups} />
        </select>
        {writes.saved === DEFAULT_CELL && <SaveMark />}
      </div>
      <p className="col-span-2 text-sm text-text-2">
        Runs every step that has no model of its own below — and every project that has not set
        one.
      </p>
      <Refusal writes={writes} cell={DEFAULT_CELL} className="col-span-2" />
    </div>
  )
}

