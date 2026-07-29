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
  sessionMcp: 'RUNCASTLE_SESSION_MCP',
  burnConcurrency: 'RUNCASTLE_BURN_CONCURRENCY',
  burnAttempts: 'RUNCASTLE_BURN_ATTEMPTS',
  burnConflictAttempts: 'RUNCASTLE_BURN_CONFLICT_ATTEMPTS',
  burnCpus: 'RUNCASTLE_BURN_CPUS',
  setupCommand: 'RUNCASTLE_SETUP_COMMAND',
  verifyCommands: 'RUNCASTLE_VERIFY_COMMANDS',
  knownFailures: 'RUNCASTLE_KNOWN_FAILURES',
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
  prepare: 'Prepare',
  smoke: 'Smoke',
}
export const STEP_KEYS: string[] = MODEL_STEPS.map((s) => `${STEP_PREFIX}${s}`)

/** Fields detected from the repo — always read-only in the UI (issue #47). */
const GIT_DETECTED = new Set(['mainBranch'])

export type ControlKind = 'text' | 'number' | 'select' | 'textarea'

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
  sessionMcp: {
    label: 'MCP servers in sessions',
    help: 'inherit — sessions get your own MCP servers (user, project, and plugin) alongside runcastle’s. runcastleOnly — sessions see runcastle’s MCP server and nothing else.',
    control: 'select',
    options: ['inherit', 'runcastleOnly'],
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
  burnConflictAttempts: {
    label: 'Conflict resolver passes',
    help: 'Max agent passes spent resolving a ticket’s landing conflict before asking you (0–3). 0 sends every conflict straight to you.',
    control: 'number',
  },
  burnCpus: {
    label: 'Burn CPU limit',
    help: 'CPU ceiling per burn container (--cpus). Blank leaves it unconstrained. Roughly cores ÷ concurrency keeps parallel tickets from oversubscribing the machine.',
    control: 'number',
  },
  verifyCommands: {
    label: 'Verify commands',
    help: 'Exact typecheck/test/lint commands for this repo, one per line. Given these, burn agents stop discovering workspace filter names by running suites that error out.',
    control: 'textarea',
  },
  knownFailures: {
    label: 'Known failing tests',
    help: 'Tests already red on main — a count plus suite names is enough. Saves every burn agent a full pre-work suite run to establish its own baseline.',
    control: 'textarea',
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
  setupCommand: {
    label: 'Setup command',
    help: 'Command that takes a clean checkout to a buildable state — dependency install plus any codegen every task would otherwise discover it needed mid-flight.',
    control: 'text',
  },
  driveSetupCommand: {
    label: 'Test drive setup',
    help: 'Command run before the dev server starts a test drive — bring up services, apply schema, whatever this project needs. Chain steps with &&. Runs on your machine; a failure is reported, never fatal.',
    control: 'text',
  },
  driveStopCommand: {
    label: 'Test drive teardown',
    help: 'Command run when a test drive stops, while the feature branch is still checked out. The counterpart to setup — stop services, drop the branch database.',
    control: 'text',
  },
  driveEnv: {
    label: 'Test drive environment',
    help: 'KEY=VALUE per line, overlaid on the dev server and the setup/teardown commands during a drive. {{id}} is the branch as a safe database name, {{slug}} and {{branch}} are the raw forms. Pair DATABASE_URL=…/myapp_{{id}} with a setup command that creates it to give each branch its own database.',
    control: 'textarea',
  },
  dbResetCommand: {
    label: 'Database reset command',
    help: 'Command that rebuilds the dev database from the migrations in the working tree. Offered (never run automatically) after a test drive whose branch carried migrations this one does not have.',
    control: 'text',
  },
}

/**
 * Human labels for prepared fields, used by the preparation card (which lists
 * findings by key, not by settings row). Kept in sync with `META` labels.
 */
export const PREPARED_LABEL: Record<string, string> = {
  setupCommand: 'Setup command',
  verifyCommands: 'Verify commands',
  knownFailures: 'Known failing tests',
  devCommand: 'Dev command',
  dbResetCommand: 'Database reset command',
  driveSetupCommand: 'Test drive setup',
  driveStopCommand: 'Test drive teardown',
  driveEnv: 'Test drive environment',
}

/**
 * Keys preparation proposes from configuration WITHOUT executing them — they
 * describe the developer's own machine, which a throwaway sandbox cannot stand
 * in for. Surfaced so a proposed value is never mistaken for a measured one.
 */
export const HOST_ONLY_PREPARED = new Set([
  'devCommand',
  'dbResetCommand',
  'driveSetupCommand',
  'driveStopCommand',
  'driveEnv',
])

/** Coarse "3 days ago" for a finding's age. Exact enough to judge staleness by. */
export function relativeAge(ts: number, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - ts) / 1000))
  if (secs < 90) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 36) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * The one-line provenance note under a prepared field.
 *
 * The staleness half is the point: a value measured 200 commits ago is not
 * obviously wrong, which is exactly why it needs saying out loud — a test
 * baseline that has silently rotted gets trusted by every agent that reads it.
 * An unknown distance (rebased-away sha) says "unknown", never "fresh".
 */
export function describeFinding(f: {
  source: string
  establishedAt: number
  establishedSha?: string
  staleCommits?: number
  key: string
}): string {
  if (f.source === 'human') return `You set this ${relativeAge(f.establishedAt)}.`

  // A `session` value was established on the developer's own machine with them
  // present, so the host-only caveat does not apply to it — that caveat exists
  // because a container cannot execute those keys, and this one can.
  const how =
    f.source === 'session'
      ? 'Established in a conversation on this machine'
      : HOST_ONLY_PREPARED.has(f.key)
        ? 'Proposed by preparation from config (not executed)'
        : 'Established by preparation'
  const when = relativeAge(f.establishedAt)

  if (f.staleCommits === undefined) {
    return `${how} ${when}${f.establishedSha ? ' — age against main unknown' : ''}.`
  }
  if (f.staleCommits === 0) return `${how} ${when} — main has not moved since.`
  return `${how} ${when} — main has moved ${f.staleCommits} commit${f.staleCommits === 1 ? '' : 's'} since.`
}

/**
 * How many commits of drift before a finding is worth flagging rather than just
 * reporting. Under this, movement is normal churn; over it, a re-prepare is the
 * suggestion. A round number by design — there is no principled threshold, and
 * pretending otherwise would be false precision.
 */
export const STALE_COMMIT_THRESHOLD = 100

/** Whether a finding is stale enough to nudge about. Human values never are. */
export function isStale(f: { source: string; staleCommits?: number }): boolean {
  return f.source !== 'human' && (f.staleCommits ?? 0) >= STALE_COMMIT_THRESHOLD
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
  /** What preparation observed to justify this value, when it established it. */
  evidence?: string
  /** The repo has moved far enough since this was measured to be worth a nudge. */
  stale: boolean
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

/** The provenance a prepared field carries, when one has been established. */
export interface FindingLike {
  key: string
  source: string
  evidence?: string
  establishedAt: number
  establishedSha?: string
  staleCommits?: number
}

/**
 * Turn one resolved `settings.get` field into a render row. A `finding` (for
 * prepared fields) replaces the generic scope note with real provenance — who
 * established the value and how far the repo has moved since — because "where
 * did this come from" is the question that decides whether to trust it.
 */
export function describeField(field: SettingField, finding?: FindingLike): SettingRow {
  const meta = metaFor(field.key)
  const gitDetected = GIT_DETECTED.has(field.key)
  const readOnly = !field.editable || gitDetected
  const overridden = field.source === 'project'

  let note: string | null = null
  if (field.source === 'env') {
    note = `Set by ${FIELD_ENV_VAR[field.key] ?? 'the environment'}`
  } else if (gitDetected) {
    note = 'Read-only — detected from git'
  } else if (finding && overridden) {
    note = describeFinding(finding)
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
    ...(finding?.evidence ? { evidence: finding.evidence } : {}),
    stale: finding ? isStale(finding) : false,
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
  // Not `.map(describeField)` — `describeField`'s optional second parameter
  // would bind to Array#map's index argument.
  return view.fields.filter((f) => !isStepModelKey(f.key)).map((f) => describeField(f))
}

/**
 * Rows for the This-project section — only fields a project can override.
 * `findings` (keyed by field key) attaches provenance to prepared fields.
 */
export function projectRows(
  view: SettingsView,
  findings: readonly FindingLike[] = [],
): SettingRow[] {
  const byKey = new Map(findings.map((f) => [f.key, f]))
  return view.fields
    .filter((f) => f.scope === 'project')
    .map((f) => describeField(f, byKey.get(f.key)))
}

/**
 * Per-step model rows for the Advanced section (issue #48). Only steps that are
 * actually SET (source `file`) are returned, sorted by the canonical step order
 * — sparse overrides, so an inheriting step stays hidden until added.
 */
export function stepModelRows(view: SettingsView): SettingRow[] {
  const set = view.fields.filter((f) => isStepModelKey(f.key) && f.source === 'file')
  return set
    .map((f) => describeField(f))
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
