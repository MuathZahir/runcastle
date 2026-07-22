import { CURATED_MODELS, MODEL_STEPS } from '@runcastle/core'
import type { SettingField, SettingsView } from './api'

/**
 * Settings-overlay presentation logic (issue #47). `settings.get` returns the
 * per-field value/source/editable contract (issue #46); these pure helpers turn
 * a field into the row the overlay renders — its label, control kind, and the
 * read-only / restart-required / env-lock / project-override notes — so the
 * overlay component stays a thin view over `describeField`.
 */

/** Env var backing each field, mirroring the server's DESCRIPTORS (issue #46). */
export const FIELD_ENV_VAR: Record<string, string> = {
  serverPort: 'RUNCASTLE_SERVER_PORT',
  model: 'RUNCASTLE_MODEL',
  sandbox: 'RUNCASTLE_SANDBOX',
  sandboxImage: 'RUNCASTLE_SANDBOX_IMAGE',
  burnConcurrency: 'RUNCASTLE_BURN_CONCURRENCY',
  burnAttempts: 'RUNCASTLE_BURN_ATTEMPTS',
  mainBranch: 'RUNCASTLE_MAIN_BRANCH',
}

/** Curated model ids offered by the Default-model dropdown (curated list in core). */
export const MODEL_OPTIONS: string[] = CURATED_MODELS.map((m) => m.id)

/** `stepModels.<step>` is the key convention for a per-step override (issue #48). */
const STEP_PREFIX = 'stepModels.'
export function isStepModelKey(key: string): boolean {
  return key.startsWith(STEP_PREFIX)
}
export function stepOf(key: string): string {
  return key.slice(STEP_PREFIX.length)
}

/** Human labels for each model step (issue #48). */
const STEP_LABEL: Record<string, string> = {
  ideation: 'Ideation',
  qa: 'Q&A',
  waypoint: 'Waypoint',
  converge: 'Converge',
  research: 'Research',
  implement: 'Implement',
  smoke: 'Smoke',
}
export const STEP_KEYS: string[] = MODEL_STEPS.map((s) => `${STEP_PREFIX}${s}`)

/** Fields detected from the repo — always read-only in the UI (issue #47). */
const GIT_DETECTED = new Set(['mainBranch'])

export type ControlKind = 'text' | 'number' | 'select'

interface FieldMeta {
  label: string
  help: string
  control: ControlKind
  options?: string[]
}

const META: Record<string, FieldMeta> = {
  serverPort: {
    label: 'Server port',
    help: 'Port the runcastle server listens on.',
    control: 'number',
  },
  model: {
    label: 'Default model',
    help: 'Claude model every step inherits unless overridden below.',
    control: 'select',
    options: MODEL_OPTIONS,
  },
  sandbox: {
    label: 'Sandbox',
    help: 'Where launched sessions run.',
    control: 'select',
    options: ['docker', 'noSandbox'],
  },
  sandboxImage: {
    label: 'Sandbox image',
    help: 'Docker image used when a session is sandboxed.',
    control: 'text',
  },
  burnConcurrency: {
    label: 'Burn concurrency',
    help: 'Max tickets burned in parallel per run (1–8). Each is a full agent.',
    control: 'number',
  },
  burnAttempts: {
    label: 'Burn attempts',
    help: 'Max agent attempts per ticket per run (1–5). A transient crash (API drop, network) retries with committed work preserved.',
    control: 'number',
  },
  mainBranch: {
    label: 'Main branch',
    help: 'Branch features merge back into.',
    control: 'text',
  },
  devCommand: {
    label: 'Dev command',
    help: "Command that starts this project's dev server.",
    control: 'text',
  },
}

/** One field ready to render in the overlay. */
export interface SettingRow {
  key: string
  label: string
  help: string
  /** Effective value as a display string ('' for null). */
  value: string
  control: ControlKind
  /** Choices for a `select` control (empty otherwise). */
  options: string[]
  /** Not editable — env-locked or git-detected. */
  readOnly: boolean
  /** Changing this needs a server restart (serverPort). */
  restartRequired: boolean
  /** This project overrides the global (project scope, source `project`). */
  overridden: boolean
  source: SettingField['source']
  /** One-line status note under the field, or null. */
  note: string | null
  /** A `select` may also accept a free-text model id (the Default-model combobox). */
  allowCustom: boolean
}

function toDisplay(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/** Meta for a field, synthesising per-step model entries not in the static table. */
function metaFor(key: string): FieldMeta {
  if (isStepModelKey(key)) {
    const step = stepOf(key)
    return {
      label: STEP_LABEL[step] ?? step,
      help: `Model for the ${STEP_LABEL[step] ?? step} step.`,
      control: 'select',
      options: MODEL_OPTIONS,
    }
  }
  return META[key] ?? { label: key, help: '', control: 'text' as const }
}

/** Turn one resolved `settings.get` field into a render row. */
export function describeField(field: SettingField): SettingRow {
  const meta = metaFor(field.key)
  const gitDetected = GIT_DETECTED.has(field.key)
  const readOnly = !field.editable || gitDetected
  const overridden = field.source === 'project'

  let note: string | null = null
  if (field.source === 'env') {
    note = `Set by ${FIELD_ENV_VAR[field.key] ?? 'the environment'}`
  } else if (gitDetected) {
    note = 'Read-only — detected from git'
  } else if (field.scope === 'project') {
    note = overridden ? 'Overridden for this project' : 'Inherited from global'
  }

  return {
    key: field.key,
    label: meta.label,
    help: meta.help,
    value: toDisplay(field.value),
    control: meta.control,
    options: meta.options ?? [],
    readOnly,
    restartRequired: field.restartRequired,
    overridden,
    source: field.source,
    note,
    // The Default-model dropdown and each per-step override accept a curated
    // choice OR a free-text model id (issue #48).
    allowCustom: field.key === 'model' || isStepModelKey(field.key),
  }
}

/**
 * Rows for the Global section — the flat fields, EXCLUDING per-step model
 * overrides (those render in their own collapsed Advanced section, issue #48).
 */
export function globalRows(view: SettingsView): SettingRow[] {
  return view.fields.filter((f) => !isStepModelKey(f.key)).map(describeField)
}

/** Rows for the This-project section — only fields a project can override. */
export function projectRows(view: SettingsView): SettingRow[] {
  return view.fields.filter((f) => f.scope === 'project').map(describeField)
}

/**
 * Per-step model rows for the Advanced section (issue #48). Only steps that are
 * actually SET (source `file`) are returned, sorted by the canonical step order
 * — sparse overrides, so an inheriting step stays hidden until added.
 */
export function stepModelRows(view: SettingsView): SettingRow[] {
  const set = view.fields.filter((f) => isStepModelKey(f.key) && f.source === 'file')
  return set
    .map(describeField)
    .sort((a, b) => STEP_KEYS.indexOf(a.key) - STEP_KEYS.indexOf(b.key))
}

/** Step keys not yet set — the choices offered by the "add override" control. */
export function unsetStepKeys(view: SettingsView): { key: string; label: string }[] {
  const setKeys = new Set(
    view.fields.filter((f) => isStepModelKey(f.key) && f.source === 'file').map((f) => f.key),
  )
  return STEP_KEYS.filter((k) => !setKeys.has(k)).map((k) => ({
    key: k,
    label: STEP_LABEL[stepOf(k)] ?? stepOf(k),
  }))
}
