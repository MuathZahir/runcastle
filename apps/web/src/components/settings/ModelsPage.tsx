import { useEffect, useRef, useState } from 'react'
import type { ModelEntry, ModelStep } from '@runcastle/core'
import { trpc } from '../../trpc'
import {
  customModelsFromView,
  defaultModelOf,
  discoveryStatusLines,
  modelOptionGroups,
  projectModelWarning,
  rosterFromView,
  rosterRows,
  stepModelKey,
  stepRows,
  type ModelOptionGroup,
} from '../../lib/settings'
import type { SettingsView } from '../../lib/api'
import { Button, cx, DimLine } from '../../ui'
import { SELECT_FIELD, Select, SelectContent, SelectTrigger, SelectValue } from '../../ui/select'
import { IconRefresh } from '../../icons'
import { useHighlight } from './highlight'
import { ModelOptions, Refusal, RosterTable, RuntimeIcon } from './RosterTable'
import { SELECT_TRUNCATE, SaveMark, SettingLine, SettingSection } from './SettingRow'
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
 * row at the top and the roster's Default column — because a reader should not
 * have to read a note to find out what "default" means.
 */

/** How long "Saved" stays up after a commit, as on the shared setting row. */
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

  if (globals.isLoading) return <DimLine>Loading settings…</DimLine>
  if (globals.error) return <DimLine>Could not load settings: {globals.error.message}</DimLine>
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
    <>
      {showsSetting(filter, 'model') && (
        // No heading of its own: the row's label already says it all.
        <div className="-mt-3.5">
          <DefaultModelRow
            value={defaultModel}
            groups={groups}
            writes={writes}
            highlight={highlightField === 'model'}
          />
        </div>
      )}
      {roster.some((row) => showsSetting(filter, row.id)) && (
        <SettingSection
          title="Roster"
          action={<RefreshModels />}
          description={
            <>
              A model with a <span className="text-text-secondary">use-case note</span> is offered
              to the tickets agent, which may pick it per ticket; models without a note are never
              picked automatically.
            </>
          }
        >
          <DiscoveryStatus view={view} />
          <RosterTable
            rows={roster}
            stepLabels={stepLabels}
            customModels={customModelsFromView(view)}
            filter={filter}
            writes={writes}
          />
        </SettingSection>
      )}
      {steps.some((step) => showsSetting(filter, stepModelKey(step.step))) && (
        <SettingSection
          title="Per step"
          description="Every step runs the default unless it names a model of its own."
        >
          <StepTable
            rows={steps}
            groups={groups}
            defaultModel={defaultModel}
            projectModel={projectModelWarning(scoped.data)}
            filter={filter}
            writes={writes}
          />
        </SettingSection>
      )}
    </>
  )
}

/**
 * Where the discovered models came from: one line per source — how many and how
 * long ago, or why it failed. A failed source is quiet: it keeps its last good
 * models, so its line is information, not an error to act on.
 */
function DiscoveryStatus({ view }: { view: SettingsView }) {
  return (
    <ul
      aria-label="Model discovery"
      className="m-0 mt-1.5 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-xs"
    >
      {discoveryStatusLines(view).map((line) => (
        <li
          key={line.runtime}
          className={cx(
            'inline-flex items-center gap-1.5',
            line.failed ? 'text-warning' : 'text-text-tertiary',
          )}
        >
          <RuntimeIcon runtime={line.runtime} />
          {line.text}
        </li>
      ))}
    </ul>
  )
}

/**
 * Re-asks both sources now, for the "a model just shipped" moment (decision 3).
 * Sits on the Roster heading, the one thing it changes.
 */
function RefreshModels() {
  const utils = trpc.useUtils()
  const refresh = trpc.settings.refreshModels.useMutation({
    onSuccess: () => void utils.settings.get.invalidate(),
  })
  return (
    <>
      {refresh.error && (
        <span role="alert" className="text-xs text-danger">
          Refresh failed: {refresh.error.message}
        </span>
      )}
      <Button
        variant="ghost"
        size="sm"
        icon={<IconRefresh />}
        loading={refresh.isPending}
        onClick={() => refresh.mutate()}
      >
        {refresh.isPending ? 'Refreshing…' : 'Refresh'}
      </Button>
    </>
  )
}

/**
 * What the default model is, in the one place a reader looks first. It is stated
 * again in the roster, and the two are the same value: changing either writes
 * `model` and the other follows.
 */
function DefaultModelRow({
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
  const { ref, flash } = useHighlight<HTMLDivElement>(highlight)
  return (
    <SettingLine
      rowRef={ref}
      flash={flash}
      label="Default model"
      htmlFor="settings-default-model"
      description="Runs every step that has no model of its own below — and every project that has not set one."
      aside={writes.saved === DEFAULT_CELL && <SaveMark />}
      control={
        <Select value={value} onValueChange={(next) => writes.save(DEFAULT_CELL, 'model', next)}>
          <SelectTrigger id="settings-default-model" className={cx(SELECT_FIELD, SELECT_TRUNCATE, 'w-full')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <ModelOptions groups={groups} />
          </SelectContent>
        </Select>
      }
      below={<Refusal writes={writes} cell={DEFAULT_CELL} className="" />}
    />
  )
}
