import {
  AGENT_RUNTIMES,
  CURATED_MODELS,
  DRIVE_LOOP_KEYS,
  MODEL_STEPS,
  ModelEntry,
  modelRoster,
} from '@runcastle/core'
import type { AgentRuntime, ModelStep } from '@runcastle/core'
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
  burnMaxIterations: 'RUNCASTLE_BURN_MAX_ITERATIONS',
  burnAttempts: 'RUNCASTLE_BURN_ATTEMPTS',
  burnConflictAttempts: 'RUNCASTLE_BURN_CONFLICT_ATTEMPTS',
  burnCpus: 'RUNCASTLE_BURN_CPUS',
  setupCommand: 'RUNCASTLE_SETUP_COMMAND',
  verifyCommands: 'RUNCASTLE_VERIFY_COMMANDS',
  knownFailures: 'RUNCASTLE_KNOWN_FAILURES',
  mainBranch: 'RUNCASTLE_MAIN_BRANCH',
}

/** How each runtime is named to a human. */
export const RUNTIME_LABEL: Record<AgentRuntime, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
}

/** One `<optgroup>` of the model dropdown: every model of a single runtime. */
export interface ModelOptionGroup {
  runtime: AgentRuntime
  label: string
  entries: ModelEntry[]
}

/**
 * The operator's OWN roster entries as stored in the global `models` setting —
 * what a roster write must be merged into, as distinct from the curated list it
 * is merged over. Malformed entries (a hand-edited config file) are dropped
 * rather than allowed to break the dropdown.
 */
export function customModelsFromView(view: SettingsView | undefined): ModelEntry[] {
  const raw = view?.fields.find((f) => f.key === 'models')?.value
  if (!Array.isArray(raw)) return []
  return raw.flatMap((e) => {
    const parsed = ModelEntry.safeParse(e)
    return parsed.success ? [parsed.data] : []
  })
}

/** Every model this view offers: the curated list with the operator's roster over it. */
export function rosterFromView(view: SettingsView | undefined): ModelEntry[] {
  return modelRoster({ models: customModelsFromView(view) })
}

/**
 * The dropdown's runtime groups, in the canonical runtime order. A runtime with
 * no models is left out entirely rather than rendered as an empty group.
 */
export function modelOptionGroups(roster: readonly ModelEntry[]): ModelOptionGroup[] {
  return AGENT_RUNTIMES.map((runtime) => ({
    runtime,
    label: RUNTIME_LABEL[runtime],
    entries: roster.filter((m) => m.runtime === runtime),
  })).filter((g) => g.entries.length > 0)
}

/** What the custom-model form commits: the entry to add, or the reason it cannot. */
export type CustomModelCommit = { entry: ModelEntry } | { error: string }

/**
 * Validate a free-text custom model id, its declared runtime, and its optional
 * use-case note. The runtime is REQUIRED and never inferred from the id: pattern
 * matching fails silently on proxies and unguessable future ids, and the failure
 * mode is launching the wrong CLI (decision 3).
 */
export function customModelCommit(id: string, runtime: string, note: string): CustomModelCommit {
  const trimmedId = id.trim()
  if (trimmedId === '') return { error: 'Enter a model id.' }
  if (!(AGENT_RUNTIMES as readonly string[]).includes(runtime)) {
    return { error: 'Choose which runtime this model runs on.' }
  }
  const trimmedNote = note.trim()
  return {
    entry: {
      id: trimmedId,
      runtime: runtime as AgentRuntime,
      ...(trimmedNote ? { note: trimmedNote } : {}),
    },
  }
}

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
  /**
   * Human wording for an option whose stored value is a config identifier.
   * `noSandbox` and `inherit` are what the file holds; they are not what a
   * dropdown should read out (findings F17.7).
   */
  optionLabels?: Record<string, string>
}

const META: Record<string, FieldMeta> = {
  serverPort: {
    label: 'Server port',
    help: 'Port the runcastle server listens on.',
    control: 'number',
  },
  model: {
    label: 'Default model',
    help: "Model every step inherits, and the runtime it runs on. A project's own model wins over the per-step models below.",
    control: 'select',
  },
  sandbox: {
    label: 'Sandbox',
    help: 'Where launched sessions run.',
    control: 'select',
    options: ['docker', 'noSandbox'],
    optionLabels: {
      docker: 'Docker container (isolated)',
      noSandbox: 'No sandbox — run directly on this machine',
    },
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
    optionLabels: {
      inherit: 'Inherit mine — my servers alongside runcastle’s',
      runcastleOnly: 'runcastle only — nothing else',
    },
  },
  burnMaxIterations: {
    label: 'Burn iterations',
    help: 'Max turns a single burn agent takes within one healthy attempt (1–10) before it is stopped. Distinct from Burn attempts, which restarts a crashed agent.',
    control: 'number',
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
 * Whether a dry run can prove this key at all. Only the three drive-loop keys
 * have an observable a host drive produces; the rest carry no verification
 * wording anywhere, which reads as "unverifiable", not "failed" (decision 10).
 */
function isVerifiable(key: string): boolean {
  return (DRIVE_LOOP_KEYS as readonly string[]).includes(key)
}

/**
 * The verification badge for a finding — `null` for a key no dry run can prove.
 *
 * Deliberately independent of `source`: the stamp records that this exact value
 * was seen working by the real drive machinery, not who chose it, so a value the
 * human typed carries a badge exactly like one preparation measured.
 */
export function verificationBadge(
  f: { key: string; verifiedAt?: number },
  now = Date.now(),
): string | null {
  if (!isVerifiable(f.key)) return null
  return f.verifiedAt === undefined ? 'unverified' : `verified ${relativeAge(f.verifiedAt, now)}`
}

/**
 * The drive-loop keys a test drive is about to depend on that no dry run has
 * ever proven — what the next-step bar warns about (decision 7), in the canonical
 * key order so the sentence is stable between polls.
 *
 * A key with no finding row has no value, and a drive that runs nothing for it
 * has nothing to doubt: a checkout-only drive warns about nothing at all.
 */
export function unverifiedDriveKeys(
  findings: readonly { key: string; verifiedAt?: number }[],
): string[] {
  return DRIVE_LOOP_KEYS.filter((k) =>
    findings.some((f) => f.key === k && f.verifiedAt === undefined),
  )
}

/** Which halves of a test drive this project has actually configured. */
export interface DriveCapabilities {
  /** `driveSetupCommand` — run before the dev server starts. */
  setup: boolean
  /** `devCommand` — the dev pane, and the "Open app" URL sniffed out of it. */
  dev: boolean
  /** `driveStopCommand` — run on stop, while the feature branch is still checked out. */
  teardown: boolean
}

/**
 * What a test drive on this project will do, read off the settings view.
 *
 * Mirrors the emptiness checks the drive itself makes — a hook step returns
 * early on a blank command and the dev pane is spawned only when `devCommand`
 * is set — so the review page describes the drive the human is about to get
 * rather than the fully-prepared one we wish they had. `undefined` while the
 * settings query is in flight: unknown is not the same answer as "none".
 */
export function driveCapabilities(view: SettingsView | undefined): DriveCapabilities | undefined {
  if (!view) return undefined
  const set = (key: string): boolean => {
    const value = view.fields.find((f) => f.key === key)?.value
    return typeof value === 'string' && value.trim().length > 0
  }
  return {
    setup: set('driveSetupCommand'),
    dev: set('devCommand'),
    teardown: set('driveStopCommand'),
  }
}

/**
 * The one-line provenance note under a prepared field.
 *
 * The staleness half is the point: a value measured 200 commits ago is not
 * obviously wrong, which is exactly why it needs saying out loud — a test
 * baseline that has silently rotted gets trusted by every agent that reads it.
 * An unknown distance (rebased-away sha) says "unknown", never "fresh".
 *
 * A drive-loop key's note also carries its dry-run stamp, because settings is
 * where a human edits the value and any edit clears the stamp (decision 6) — the
 * place it goes away has to be the place it was visible.
 */
export function describeFinding(f: {
  source: string
  establishedAt: number
  establishedSha?: string
  staleCommits?: number
  verifiedAt?: number
  key: string
}): string {
  return `${provenanceNote(f)}${verificationNote(f)}`
}

/** The dry-run half of the note; empty for a key no dry run can prove. */
function verificationNote(f: { key: string; verifiedAt?: number }): string {
  if (!isVerifiable(f.key)) return ''
  return f.verifiedAt === undefined
    ? ' Unverified — never proven by a dry run.'
    : ` Verified ${relativeAge(f.verifiedAt)} by a dry run.`
}

/** Who established the value and how far the repo has moved since. */
function provenanceNote(f: {
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
  /** Human wording per option value; an option absent here renders verbatim. */
  optionLabels: Record<string, string>
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
  /** `options` grouped by runtime — model rows only, empty for every other control. */
  modelGroups: ModelOptionGroup[]
  /** What preparation observed to justify this value, when it established it. */
  evidence?: string
  /** The repo has moved far enough since this was measured to be worth a nudge. */
  stale: boolean
}

function toDisplay(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/**
 * What leaving a field commits: the value to write, or the inline error to show
 * instead of writing anything. `null` clears the setting.
 */
export type FieldCommit = { value: string | number | null } | { error: string }

/**
 * The value a settings field commits for what was typed into it.
 *
 * Numeric fields used to go through a bare `Number(trimmed)`, and `Number('')`
 * is `0`: blanking "Burn CPU limit" — the documented way to unconstrain it —
 * wrote a zero the server's `z.number().positive()` then rejected, and anything
 * non-numeric wrote `NaN`. A blank numeric field means "unset this"; anything
 * that is not a number is a question for the human, not a value to send.
 */
export function fieldCommit(control: ControlKind, raw: string): FieldCommit {
  const trimmed = raw.trim()
  if (control !== 'number') return { value: trimmed }
  if (trimmed === '') return { value: null }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return { error: 'Enter a number, or leave it blank to unset it.' }
  return { value: parsed }
}

/** Meta for a field, synthesising per-step model entries not in the static table. */
function metaFor(key: string): FieldMeta {
  if (isStepModelKey(key)) {
    const step = stepOf(key)
    return {
      label: STEP_LABEL[step] ?? step,
      help: `Model for the ${STEP_LABEL[step] ?? step} step.`,
      control: 'select',
    }
  }
  return META[key] ?? { label: key, help: '', control: 'text' as const }
}

/** Whether a field's value is a model id — the rows that offer the runtime groups. */
function isModelKey(key: string): boolean {
  return key === 'model' || isStepModelKey(key)
}

/** The provenance a prepared field carries, when one has been established. */
export interface FindingLike {
  key: string
  source: string
  evidence?: string
  establishedAt: number
  establishedSha?: string
  staleCommits?: number
  /** When a dry run last proved this value; drive-loop keys only (decision 10). */
  verifiedAt?: number
}

/**
 * Turn one resolved `settings.get` field into a render row. A `finding` (for
 * prepared fields) replaces the generic scope note with real provenance — who
 * established the value and how far the repo has moved since — because "where
 * did this come from" is the question that decides whether to trust it.
 */
export function describeField(
  field: SettingField,
  finding?: FindingLike,
  roster: readonly ModelEntry[] = CURATED_MODELS,
): SettingRow {
  const meta = metaFor(field.key)
  const isModel = isModelKey(field.key)
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
    // A model row's choices are the roster (curated + the operator's own), so a
    // custom id they added is a pick rather than something to retype.
    options: isModel ? roster.map((m) => m.id) : (meta.options ?? []),
    modelGroups: isModel ? modelOptionGroups(roster) : [],
    optionLabels: meta.optionLabels ?? {},
    readOnly,
    restartRequired: field.restartRequired,
    overridden,
    source: field.source,
    note,
    ...(finding?.evidence ? { evidence: finding.evidence } : {}),
    stale: finding ? isStale(finding) : false,
    // The Default-model dropdown and each per-step override accept a roster
    // choice OR a free-text model id (issue #48).
    allowCustom: isModel,
  }
}

/**
 * Rows for the Global section — the flat fields, EXCLUDING per-step model
 * overrides (those render in their own collapsed Advanced section, issue #48)
 * and the `models` roster, which is not a value with a control of its own: it
 * is the vocabulary the model dropdowns are built from.
 */
export function globalRows(view: SettingsView): SettingRow[] {
  const roster = rosterFromView(view)
  // Not `.map(describeField)` — `describeField`'s optional second parameter
  // would bind to Array#map's index argument.
  return view.fields
    .filter((f) => !isStepModelKey(f.key) && f.key !== 'models')
    .map((f) => describeField(f, undefined, roster))
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
  const roster = rosterFromView(view)
  return view.fields
    .filter((f) => f.scope === 'project')
    .map((f) => describeField(f, byKey.get(f.key), roster))
}

/**
 * Per-step model rows for the Advanced section (issue #48). Only steps that are
 * actually SET (source `file`) are returned, sorted by the canonical step order
 * — sparse overrides, so an inheriting step stays hidden until added.
 */
export function stepModelRows(view: SettingsView): SettingRow[] {
  const roster = rosterFromView(view)
  const set = view.fields.filter((f) => isStepModelKey(f.key) && f.source === 'file')
  return set
    .map((f) => describeField(f, undefined, roster))
    .sort((a, b) => STEP_KEYS.indexOf(a.key) - STEP_KEYS.indexOf(b.key))
}

/**
 * Which model a step will actually run, read off a project-scoped `settings.get`
 * view — the view-side mirror of core's `resolveModel`: the project's own model
 * wins, else a global per-step model, else the default model. Returns undefined
 * while the view is still loading.
 */
export function effectiveStepModel(
  view: SettingsView | undefined,
  step: ModelStep,
): string | undefined {
  const find = (key: string): SettingField | undefined => view?.fields.find((f) => f.key === key)
  const model = find('model')
  // A step model counts only when actually set in the config file; an unset one
  // reports the schema default and must not shadow the default model.
  const stepModel = find(`${STEP_PREFIX}${step}`)
  const chosen =
    (model?.source === 'project' ? model : undefined) ??
    (stepModel?.source === 'file' ? stepModel : undefined) ??
    model
  return typeof chosen?.value === 'string' ? chosen.value : undefined
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
