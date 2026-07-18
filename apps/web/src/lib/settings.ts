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
  smokeModel: 'RUNCASTLE_SMOKE_MODEL',
  sandbox: 'RUNCASTLE_SANDBOX',
  sandboxImage: 'RUNCASTLE_SANDBOX_IMAGE',
  mainBranch: 'RUNCASTLE_MAIN_BRANCH',
}

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
    label: 'Model',
    help: 'Claude model used to drive pipeline sessions.',
    control: 'text',
  },
  smokeModel: {
    label: 'Smoke model',
    help: 'Lighter model for smoke and test-drive checks.',
    control: 'text',
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
}

function toDisplay(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/** Turn one resolved `settings.get` field into a render row. */
export function describeField(field: SettingField): SettingRow {
  const meta = META[field.key] ?? { label: field.key, help: '', control: 'text' as const }
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
  }
}

/** Rows for the Global section — every field in the global view. */
export function globalRows(view: SettingsView): SettingRow[] {
  return view.fields.map(describeField)
}

/** Rows for the This-project section — only fields a project can override. */
export function projectRows(view: SettingsView): SettingRow[] {
  return view.fields.filter((f) => f.scope === 'project').map(describeField)
}
