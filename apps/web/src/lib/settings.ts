import {
  AGENT_RUNTIMES,
  CURATED_MODELS,
  MODEL_STEPS,
  ModelEntry,
  modelEntryFor,
  modelRoster,
} from '@runcastle/core'
import type { AgentRuntime, ModelStep } from '@runcastle/core'
import type { SettingField, SettingsView } from './api'
import {
  describeFinding,
  isStale,
  isVerifiable,
  relativeAge,
  type FindingLike,
} from './prep-findings'

/**
 * Settings presentation logic. `settings.get` returns the per-field
 * value/source/editable contract; these pure helpers turn it into everything the
 * settings dialog renders — which page a field belongs on, its label /
 * placeholder / tooltip, the chips that say where a value came from, the model
 * roster and per-step tables, and the filter — so every component stays a thin
 * view over this module.
 *
 * Prepared-field provenance lives in `./prep-findings`, which this module reads
 * and never writes to.
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
}

/** How each runtime is named to a human. */
export const RUNTIME_LABEL: Record<AgentRuntime, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
}

// ---------------------------------------------------------------------------
// Where a setting lives
// ---------------------------------------------------------------------------

/**
 * The dialog's four task pages (decision 3). Cut by what the human came to do,
 * not by the config file's global/project split — that split is expressed inside
 * "This project" by a source chip, never by a page.
 */
export type SettingsPage = 'general' | 'models' | 'burns' | 'project'

/** A section within a page. */
export type SettingsGroup =
  | 'server'
  | 'sessions'
  | 'default'
  | 'width'
  | 'model'
  | 'commands'
  | 'chat'

/** Each page's groups in render order; `pageRows` sorts its rows by it. */
const PAGE_GROUPS: Record<SettingsPage, readonly SettingsGroup[]> = {
  general: ['server', 'sessions'],
  models: ['default'],
  burns: ['width'],
  project: ['model', 'commands', 'chat'],
}

/**
 * Somewhere in settings: a page, and optionally a field (a setting key, or a
 * doctor probe id on the Burns checklist) to scroll to and highlight. Anything
 * that points at settings — the titlebar, the palette, an error message — hands
 * one of these over so the human lands on the row rather than on the dialog.
 */
export interface SettingsLocation {
  page: SettingsPage
  field?: string
}

// ---------------------------------------------------------------------------
// The model roster
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Per-step models
// ---------------------------------------------------------------------------

/** `stepModels.<step>` is the key convention for a per-step override (issue #48). */
const STEP_PREFIX = 'stepModels.'
export function isStepModelKey(key: string): boolean {
  return key.startsWith(STEP_PREFIX)
}
export function stepOf(key: string): string {
  return key.slice(STEP_PREFIX.length)
}

/**
 * Which half of the pipeline a step belongs to — the Models page groups them,
 * because "you are in the terminal" and "this runs while you are away" are
 * different spending decisions.
 */
export type StepGroup = 'sessions' | 'unattended'

/**
 * Every model step in display order, with the name and the one-line description
 * that make the eleven step names self-explanatory without help text
 * (decision 15). `revisit` and `project` used to render as raw keys.
 */
const STEP_META: readonly {
  step: ModelStep
  label: string
  description: string
  group: StepGroup
}[] = [
  // Sessions — you are in the terminal.
  { step: 'ideation', label: 'Ideation', group: 'sessions', description: 'Grills you and writes the spec' },
  { step: 'qa', label: 'Q&A', group: 'sessions', description: 'Answers questions about a feature' },
  { step: 'waypoint', label: 'Waypoint', group: 'sessions', description: 'Works one waypoint of a mapped feature' },
  { step: 'converge', label: 'Converge', group: 'sessions', description: 'Folds a map back into one spec' },
  { step: 'revisit', label: 'Revisit', group: 'sessions', description: 'Reopens a feature after test-drive notes' },
  { step: 'project', label: 'Project chat', group: 'sessions', description: 'The project-level conversation' },
  // Unattended — burns and scripted runs.
  { step: 'research', label: 'Research', group: 'unattended', description: 'Reads the repo before a burn' },
  { step: 'implement', label: 'Implement', group: 'unattended', description: 'Burns a ticket in the sandbox' },
  { step: 'review', label: 'Review', group: 'unattended', description: 'Reads the finished branch' },
  { step: 'prepare', label: 'Prepare', group: 'unattended', description: 'Measures setup, verify and baseline' },
  { step: 'smoke', label: 'Smoke', group: 'unattended', description: 'Cheap scripted end-to-end check' },
]

const STEP_LABEL: Record<string, string> = Object.fromEntries(
  STEP_META.map((s) => [s.step, s.label]),
)
export const STEP_KEYS: string[] = MODEL_STEPS.map((s) => `${STEP_PREFIX}${s}`)

// ---------------------------------------------------------------------------
// Field metadata
// ---------------------------------------------------------------------------

export type ControlKind = 'text' | 'number' | 'select' | 'textarea'

interface FieldMeta {
  label: string
  /** The full explanation, shown on demand behind the row's ⓘ (decision 5). */
  tooltip: string
  control: ControlKind
  /** Where the field renders when it is a machine-wide value. */
  page: SettingsPage
  group: SettingsGroup
  /** Example value shown in the empty control. */
  placeholder?: string
  /** The one short line shown always, where the label alone is ambiguous. */
  shortHelp?: string
  /** What the number counts, printed beside a numeric input. */
  unit?: string
  options?: string[]
  /**
   * Human wording for an option whose stored value is a config identifier.
   * `noSandbox` and `inherit` are what the file holds; they are not what a
   * dropdown should read out (findings F17.7).
   */
  optionLabels?: Record<string, string>
}

const FIELD_META: Record<string, FieldMeta> = {
  serverPort: {
    label: 'Server port',
    tooltip:
      'The port the runcastle server listens on. Changing it takes effect at the next server restart.',
    control: 'number',
    page: 'general',
    group: 'server',
  },
  model: {
    label: 'Default model',
    tooltip:
      'Runs every step that has no model of its own below — and every project that has not set one.',
    control: 'select',
    page: 'models',
    group: 'default',
  },
  sandbox: {
    label: 'Sandbox',
    tooltip:
      'Where launched sessions and burns run. A Docker container isolates them from this machine; “no sandbox” runs them directly on it.',
    control: 'select',
    page: 'general',
    group: 'sessions',
    options: ['docker', 'noSandbox'],
    optionLabels: {
      docker: 'Docker container (isolated)',
      noSandbox: 'No sandbox — run directly on this machine',
    },
  },
  sandboxImage: {
    label: 'Sandbox image',
    tooltip:
      'The Docker image sessions and burns are sandboxed in. Leave blank to use sandcastle:runcastle, the image “Build image” on the Burns page produces.',
    control: 'text',
    page: 'general',
    group: 'sessions',
    placeholder: 'sandcastle:runcastle',
  },
  sessionMcp: {
    label: 'MCP servers in sessions',
    tooltip:
      'Inherit mine — sessions see your own MCP servers (user, project and plugin) alongside runcastle’s. runcastle only — sessions see runcastle’s server and nothing else; use it for a reproducible tool surface or to keep a heavy personal MCP set out of the context window.',
    control: 'select',
    page: 'general',
    group: 'sessions',
    options: ['inherit', 'runcastleOnly'],
    optionLabels: {
      inherit: 'Inherit mine — my servers alongside runcastle’s',
      runcastleOnly: 'runcastle only — nothing else',
    },
  },
  burnConcurrency: {
    label: 'Concurrency',
    tooltip:
      'Tickets burned in parallel per run (1–8). Each is a full agent with its own container, sizing its install and test workers from the whole core count — lower it if suites die under load.',
    control: 'number',
    page: 'burns',
    group: 'width',
    unit: 'tickets at once',
  },
  burnMaxIterations: {
    label: 'Iterations per attempt',
    tooltip:
      'Turns one healthy burn agent may take before it is stopped (1–10). A ticket that finishes early stops the loop itself.',
    control: 'number',
    page: 'burns',
    group: 'width',
    shortHelp: 'Distinct from attempts: an attempt restarts an agent that crashed.',
    unit: 'turns',
  },
  burnAttempts: {
    label: 'Attempts per ticket',
    tooltip:
      'Fresh agent attempts per ticket per run (1–5). A transient crash — API drop, network, rate limit — retries with committed work preserved; auth errors and conflicts never retry.',
    control: 'number',
    page: 'burns',
    group: 'width',
    unit: 'attempts',
  },
  burnConflictAttempts: {
    label: 'Conflict resolver passes',
    tooltip:
      'Agent passes spent resolving a ticket’s landing conflict before asking you (0–3). 0 sends every conflict straight to you.',
    control: 'number',
    page: 'burns',
    group: 'width',
    unit: 'passes before asking you',
  },
  burnCpus: {
    label: 'CPU limit per burn',
    tooltip:
      'CPU ceiling per burn container (--cpus). Blank leaves it unconstrained. Roughly cores ÷ concurrency keeps parallel tickets from oversubscribing the machine.',
    control: 'number',
    page: 'burns',
    group: 'width',
    placeholder: 'unlimited',
    unit: 'cores',
  },
  // The five keys with a global twin render ONCE, on "This project", where a
  // source chip says whether the value came from here or from the global
  // default (decision 7) — the old surface listed each of them twice.
  setupCommand: {
    label: 'Setup',
    tooltip:
      'Takes a clean checkout to a buildable state inside the burn sandbox — dependency install plus any codegen. Blank auto-detects from the lockfile.',
    control: 'text',
    page: 'project',
    group: 'commands',
    placeholder: 'e.g. pnpm install --frozen-lockfile && pnpm prisma:generate',
  },
  verifyCommands: {
    label: 'Verify',
    tooltip:
      'The exact typecheck / test / lint commands a burn agent runs, one per line. Rendered verbatim into the agent’s prompt; runcastle never runs them itself.',
    control: 'textarea',
    page: 'project',
    group: 'commands',
    placeholder: 'one per line, e.g.\npnpm --filter @acme/web test',
  },
  knownFailures: {
    label: 'Known failing tests',
    tooltip:
      'Tests already red on main — a count plus suite names is enough. Saves every burn agent a full pre-work run to establish its own baseline.',
    control: 'textarea',
    page: 'project',
    group: 'commands',
    placeholder: 'e.g. 2 failing: dev-pane.test.ts (Windows only)',
  },
  devCommand: {
    label: 'Dev server',
    tooltip:
      'Starts this project’s dev server for a test drive. The URL it prints becomes the “Open app” link.',
    control: 'text',
    page: 'project',
    group: 'commands',
    placeholder: 'e.g. pnpm dev',
  },
  driveSetupCommand: {
    label: 'Before a test drive',
    tooltip:
      'Runs on your machine before the dev server starts a test drive — bring up services, apply schema. A failure is reported, never fatal.',
    control: 'text',
    page: 'project',
    group: 'commands',
    placeholder: 'e.g. docker compose up -d && pnpm db:migrate',
  },
  driveStopCommand: {
    label: 'After a test drive',
    tooltip:
      'Runs when a test drive stops, while the feature branch is still checked out — stop services, drop the branch database.',
    control: 'text',
    page: 'project',
    group: 'commands',
    placeholder: 'e.g. docker compose down',
  },
  dbResetCommand: {
    label: 'Reset dev database',
    tooltip:
      'Rebuilds the dev database from the migrations in the working tree. Offered — never run automatically — after a test drive whose branch carried migrations this one does not have.',
    control: 'text',
    page: 'project',
    group: 'commands',
    placeholder: 'e.g. pnpm db:reset',
  },
  sessionBranch: {
    label: 'Commits land on',
    tooltip:
      'The branch the project chat’s commits (charter, ADRs) land on when its terminal closes. Blank uses the repo’s detected main line; a pick takes effect at the next chat you open.',
    control: 'text',
    page: 'project',
    group: 'chat',
    placeholder: 'main (detected)',
  },
}

/** Field order within a group — the order they are declared above. */
const FIELD_ORDER = Object.keys(FIELD_META)

/**
 * How the two keys that appear on BOTH a global page and "This project" read in
 * project scope. Everything else keeps one placement and one wording.
 */
const PROJECT_META: Record<string, Partial<FieldMeta>> = {
  model: {
    label: 'Model',
    tooltip:
      'A model set here runs every step of this project — it beats the global default and the per-step models.',
    page: 'project',
    group: 'model',
  },
  sandbox: { page: 'project', group: 'model' },
}

/**
 * The five keys a project can override that also have a global default. Only
 * these carry a `Global` / `This project` chip; a project-only key has no twin
 * to inherit from, so a chip would be answering a question nobody asked.
 */
const TWIN_KEYS = new Set(['model', 'sandbox', 'setupCommand', 'verifyCommands', 'knownFailures'])

/** Meta for a field, synthesising per-step model entries not in the static table. */
function metaFor(key: string, scope: SettingField['scope'] = 'global'): FieldMeta {
  if (isStepModelKey(key)) {
    const step = stepOf(key)
    const label = STEP_LABEL[step] ?? step
    return {
      label,
      tooltip: `Model for the ${label} step.`,
      control: 'select',
      page: 'models',
      group: 'default',
    }
  }
  const base = FIELD_META[key] ?? {
    label: key,
    tooltip: '',
    control: 'text' as const,
    page: 'general' as const,
    group: 'server' as const,
  }
  return scope === 'project' ? { ...base, ...PROJECT_META[key] } : base
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Where the value on screen came from, as a chip beside the control. */
export type SourceChip = 'global' | 'project' | 'env'

/** The provenance chip on a prepared field; clicking it opens the evidence. */
export interface ProvenanceChip {
  text: string
  tone: 'ok' | 'muted' | 'warn'
  evidence?: string
}

/** One field ready to render in the settings dialog. */
export interface SettingRow {
  key: string
  label: string
  /** The full explanation, behind the row's ⓘ. */
  tooltip: string
  /** The one short line shown always, where the label alone is ambiguous. */
  shortHelp?: string
  /** Example value for the empty control ('' when the label says enough). */
  placeholder: string
  /** What a numeric value counts, printed beside the input. */
  unit?: string
  /** Which page and section this row renders on, in this field's scope. */
  page: SettingsPage
  group: SettingsGroup
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
  /**
   * The inherited global value, for an unset project-scope field with a global
   * twin: the control renders EMPTY with this as its ghost placeholder (a select
   * as a first "Use global (<value>)" option), so what will actually run is on
   * screen without a second copy of the field (decision 7).
   */
  ghostValue?: string
  /** Where this value came from, as a chip. Absent when there is nothing to say. */
  sourceChip?: SourceChip
  /** Who established a prepared value, and the evidence behind the chip. */
  provenanceChip?: ProvenanceChip
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
 * is `0`: blanking "CPU limit per burn" — the documented way to unconstrain it —
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

/** Whether a field's value is a model id — the rows that offer the runtime groups. */
function isModelKey(key: string): boolean {
  return key === 'model' || isStepModelKey(key)
}

/**
 * What the number counts, and — for `burnConcurrency` alone — the width this
 * machine would burn at while nothing is set.
 *
 * That number is read off the field rather than recomputed: the web has no way
 * to count the host's cores, and the value the server sent for an unset field
 * already IS the default it resolved. Only worth saying while the field is
 * unset; once a width is chosen, the machine no longer decides.
 */
function unitFor(field: SettingField, meta: FieldMeta): string | undefined {
  if (meta.unit === undefined) return undefined
  if (field.key !== 'burnConcurrency' || field.source !== 'default') return meta.unit
  return `${meta.unit} · default on this machine: ${toDisplay(field.value)}`
}

/**
 * The inherited global value for an unset project-scope twin, or undefined.
 *
 * `env` is excluded deliberately: an env-locked field is not inheriting the
 * global default, it is overriding everything, and a ghost would read as "this
 * is what you would get" when it is not.
 */
function ghostValueFor(field: SettingField): string | undefined {
  if (field.scope !== 'project' || !TWIN_KEYS.has(field.key)) return undefined
  if (field.source !== 'file' && field.source !== 'default') return undefined
  return toDisplay(field.value) || undefined
}

/** Which of the three chips a row shows for where its value came from. */
function sourceChipFor(field: SettingField): SourceChip | undefined {
  if (field.source === 'env') return 'env'
  if (field.scope !== 'project' || !TWIN_KEYS.has(field.key)) return undefined
  return field.source === 'project' ? 'project' : 'global'
}

/**
 * The provenance chip for a prepared value — who established it, how long ago,
 * how far main has moved, and whether a dry run ever proved it. The evidence
 * that justified it rides along for the popover; it is never rendered inline
 * (decision 5), because it runs to thousands of words.
 */
function provenanceChipFor(f: FindingLike): ProvenanceChip {
  const who = f.source === 'human' ? 'You' : f.source === 'session' ? 'Set in a session' : 'Prepared'
  const parts = [who, relativeAge(f.establishedAt)]
  // Distance from main is meaningless for a value the human owns — nothing
  // measured it, so nothing about it has rotted.
  if (f.source !== 'human' && f.staleCommits) parts.push(`main +${f.staleCommits}`)
  const dryRun = isVerifiable(f.key)
    ? f.verifiedAt === undefined
      ? 'unverified'
      : `verified by a dry run ${relativeAge(f.verifiedAt)}`
    : null
  if (dryRun) parts.push(dryRun)
  return {
    text: parts.join(' · '),
    tone: isStale(f) ? 'warn' : dryRun === 'unverified' ? 'muted' : 'ok',
    ...(f.evidence ? { evidence: f.evidence } : {}),
  }
}

/**
 * Turn one resolved `settings.get` field into a render row. A `finding` (for
 * prepared fields) adds real provenance — who established the value and how far
 * the repo has moved since — because "where did this come from" is the question
 * that decides whether to trust it.
 */
export function describeField(
  field: SettingField,
  finding?: FindingLike,
  roster: readonly ModelEntry[] = CURATED_MODELS,
): SettingRow {
  const meta = metaFor(field.key, field.scope)
  const isModel = isModelKey(field.key)
  const readOnly = !field.editable
  const overridden = field.source === 'project'

  let note: string | null = null
  if (field.source === 'env') {
    note = `Set by ${FIELD_ENV_VAR[field.key] ?? 'the environment'}`
  } else if (finding && overridden) {
    note = describeFinding(finding)
  } else if (field.scope === 'project') {
    note = overridden ? 'Overridden for this project' : 'Inherited from global'
  }

  const unit = unitFor(field, meta)
  const ghostValue = ghostValueFor(field)
  const sourceChip = sourceChipFor(field)

  return {
    key: field.key,
    label: meta.label,
    tooltip: meta.tooltip,
    ...(meta.shortHelp ? { shortHelp: meta.shortHelp } : {}),
    placeholder: meta.placeholder ?? '',
    ...(unit ? { unit } : {}),
    page: meta.page,
    group: meta.group,
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
    ...(ghostValue ? { ghostValue } : {}),
    ...(sourceChip ? { sourceChip } : {}),
    ...(finding ? { provenanceChip: provenanceChipFor(finding) } : {}),
    ...(finding?.evidence ? { evidence: finding.evidence } : {}),
    stale: finding ? isStale(finding) : false,
    // The Default-model dropdown and each per-step override accept a roster
    // choice OR a free-text model id (issue #48).
    allowCustom: isModel,
  }
}

/** A field that renders as a row — not a per-step model, not the roster itself. */
function isRowKey(key: string): boolean {
  return !isStepModelKey(key) && key !== 'models'
}

/**
 * The rows of one page, in group order.
 *
 * `general` and `burns` are machine-wide and read the GLOBAL view; `project`
 * reads the project-scoped view and takes exactly the fields a project can
 * override. `models` has no rows — it renders the roster and per-step tables.
 */
export function pageRows(
  view: SettingsView,
  page: SettingsPage,
  findings: readonly FindingLike[] = [],
): SettingRow[] {
  const byKey = new Map(findings.map((f) => [f.key, f]))
  const roster = rosterFromView(view)
  const groups = PAGE_GROUPS[page]
  return view.fields
    .filter((f) => {
      if (!isRowKey(f.key)) return false
      return page === 'project'
        ? f.scope === 'project'
        : f.scope !== 'project' && metaFor(f.key).page === page
    })
    .map((f) => describeField(f, byKey.get(f.key), roster))
    .sort(
      (a, b) =>
        groups.indexOf(a.group) - groups.indexOf(b.group) ||
        FIELD_ORDER.indexOf(a.key) - FIELD_ORDER.indexOf(b.key),
    )
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
  return view.fields.filter((f) => isRowKey(f.key)).map((f) => describeField(f, undefined, roster))
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

// ---------------------------------------------------------------------------
// The Models page
// ---------------------------------------------------------------------------

/** The global default model as a display string ('' while unset). */
function defaultModelOf(view: SettingsView): string {
  return toDisplay(view.fields.find((f) => f.key === 'model')?.value)
}

/**
 * The model set for one step in the config file, or null when it follows the
 * default. Only a `file` source counts: an unset step reports the schema default
 * and must not shadow the default model.
 */
function ownStepModel(view: SettingsView, step: ModelStep): string | null {
  const f = view.fields.find((x) => x.key === `${STEP_PREFIX}${step}`)
  return f?.source === 'file' && typeof f.value === 'string' && f.value !== '' ? f.value : null
}

/** One line of the roster table (decision 15/16). */
export interface RosterRow {
  id: string
  runtime: AgentRuntime
  /** The use-case note; '' when the model has none and is not offered per ticket. */
  note: string
  /** The steps that resolve to this model — the "Used for" column. */
  usedFor: ModelStep[]
  isDefault: boolean
  /** The operator added this id themselves, so it can be removed again. */
  custom: boolean
}

/**
 * The roster table: every model this machine offers, with what it is used for.
 * Read off the GLOBAL view — the roster and the per-step map are machine-wide,
 * and a project's own model is called out separately (`projectModelWarning`).
 */
export function rosterRows(view: SettingsView): RosterRow[] {
  const defaultModel = defaultModelOf(view)
  const resolved = new Map(
    MODEL_STEPS.map((step) => [step, ownStepModel(view, step) ?? defaultModel] as const),
  )
  const curated = new Set(CURATED_MODELS.map((m) => m.id))
  return rosterFromView(view).map((m) => ({
    id: m.id,
    runtime: m.runtime,
    note: m.note ?? '',
    usedFor: MODEL_STEPS.filter((step) => resolved.get(step) === m.id),
    isDefault: m.id === defaultModel,
    custom: !curated.has(m.id),
  }))
}

/**
 * The roster rows worth showing by default: the default, anything a step uses,
 * anything annotated, and everything the operator added. A curated model nobody
 * has touched is noise — it collapses behind "show all" (spec, Models page).
 */
export function rosterVisibleRows(rows: readonly RosterRow[]): RosterRow[] {
  return rows.filter((r) => r.isDefault || r.usedFor.length > 0 || r.note !== '' || r.custom)
}

/** How many curated models "show all" would reveal. */
export function hiddenCuratedCount(rows: readonly RosterRow[]): number {
  return rows.length - rosterVisibleRows(rows).length
}

/** One line of the per-step table: all eleven steps, always (decision 15). */
export interface StepRow {
  step: ModelStep
  label: string
  description: string
  group: StepGroup
  /** The model set for this step, or null when it follows the default. */
  value: string | null
  /** What it will actually run — `value`, else the default model. */
  effectiveModel: string
  /** The runtime `effectiveModel` launches, never inferred from the id. */
  effectiveRuntime: AgentRuntime
}

/**
 * The per-step table, grouped Sessions then Unattended. Every step is listed
 * whether or not it is set: the old surface hid unset steps behind an "add an
 * override" picker, which made the whole per-step idea a two-step discovery.
 */
export function stepRows(view: SettingsView): StepRow[] {
  const config = { models: customModelsFromView(view) }
  const fallback = defaultModelOf(view)
  return STEP_META.map((meta) => {
    const value = ownStepModel(view, meta.step)
    const effectiveModel = value ?? fallback
    return {
      ...meta,
      value,
      effectiveModel,
      effectiveRuntime: modelEntryFor(effectiveModel, config).runtime,
    }
  })
}

/**
 * The model this project runs everything on, when it sets one — the amber line
 * above the per-step table saying those apply to other projects. Reads the
 * PROJECT-scoped view, where an override reports source `project`.
 */
export function projectModelWarning(view: SettingsView | undefined): string | null {
  const model = view?.fields.find((f) => f.key === 'model')
  if (model?.source !== 'project') return null
  return toDisplay(model.value) || null
}

// ---------------------------------------------------------------------------
// Filtering and deep links
// ---------------------------------------------------------------------------

/** Something the filter box can match: a row, a roster model, a step, a probe. */
export interface SearchableSetting {
  /** Stable id — a setting key, a model id, a step key, or a doctor probe id. */
  id: string
  page: SettingsPage
  /** Everything a query may match: label, key, tooltip, and anything else. */
  terms: readonly string[]
}

export interface SettingsFilter {
  /** Hits per page, shown beside each name in the rail. Zero for an empty query. */
  counts: Record<SettingsPage, number>
  /** The ids still on screen. Everything, for an empty query. */
  matches: Set<string>
}

/** What a settings row offers the filter box. */
export function rowSearchTerms(row: SettingRow): string[] {
  return [row.label, row.key, row.tooltip]
}

/**
 * Filter every page at once: a case-insensitive substring over each item's
 * terms. An empty query matches everything and counts nothing — the rail shows
 * no numbers until someone is actually searching.
 */
export function filterSettings(
  query: string,
  items: readonly SearchableSetting[],
): SettingsFilter {
  const counts: Record<SettingsPage, number> = { general: 0, models: 0, burns: 0, project: 0 }
  const needle = query.trim().toLowerCase()
  if (needle === '') return { counts, matches: new Set(items.map((i) => i.id)) }

  const matches = new Set<string>()
  for (const item of items) {
    if (!item.terms.some((t) => t.toLowerCase().includes(needle))) continue
    matches.add(item.id)
    counts[item.page] += 1
  }
  return { counts, matches }
}

/**
 * The settings location an error message points at, so "Settings → AFK burns
 * (Rebuild image)" can be a link that lands on the image row instead of an
 * instruction to go looking. Both the doctor's stale-image detail and the
 * burner's missing-binary message carry that wording.
 */
export function settingsLocationFromMessage(text: string): SettingsLocation | null {
  return /Settings\s*→\s*(AFK burns|Burns)/i.test(text)
    ? { page: 'burns', field: 'sandcastle-image' }
    : null
}
