import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  ModelStep,
  RuncastleConfig,
  SettingField,
  SettingsUpdateInput,
  SettingsView,
} from '@runcastle/core'
import {
  MODEL_STEPS,
  RuncastleConfig as RuncastleConfigSchema,
  foldLegacyModelConfig,
} from '@runcastle/core'
import { configPath } from '@runcastle/core/paths'
import * as z from 'zod'
import { eq } from 'drizzle-orm'
import type { AppCtx } from '../db/types'
import { projects } from '../db/schema'
import { InvalidInputError } from '../errors'
import { emitProject } from './events'
import { requireProjectById } from './repo'

/**
 * Settings backend (issue #46, SPEC §4). Two stores: global defaults in the
 * machine config file (`~/.runcastle/config.json`), per-project overrides
 * (model, sandbox, devCommand) on project rows. Resolution is `project ??
 * global`, with `env` always winning (it locks the field). A global write is
 * write-through: it persists to the config file AND refreshes the in-memory
 * `ctx.config` IN PLACE, so the next session launch (reads `ctx.config`) and the
 * next run (fresh `loadConfig()` off the file) both pick up the change without a
 * server restart — while in-flight work keeps the config snapshot it started
 * with. Every mutation emits a `settings.updated` event.
 */

/**
 * Global (non-project) settings writes are machine-wide and belong to no
 * project, but issue #44 requires every event to carry a project id. They emit
 * under this sentinel project id (their own timeline), leaving `featureId` null.
 */
const GLOBAL_EVENT_KEY = 'global'

/** Which override column a project-overridable field maps to. */
type ProjectColumn = 'model' | 'sandbox' | 'devCommand'

interface FieldDescriptor {
  key: string
  /** Global backing in the config file / schema; absent for project-only fields (devCommand). */
  configKey?: keyof RuncastleConfig
  /** Env var that, when set, wins and locks the field. */
  envVar?: string
  /** Project override column; absent for global-only fields (serverPort, …). */
  projectColumn?: ProjectColumn
  restartRequired: boolean
  /** Validates a written value; env strings are coerced first via `parseEnv`. */
  valueSchema: z.ZodType
  /** Coerce an env-var string to the field's value type (default: identity). */
  parseEnv: (raw: string) => unknown
}

const idEnv = (raw: string): unknown => raw

const DESCRIPTORS: FieldDescriptor[] = [
  {
    key: 'serverPort',
    configKey: 'serverPort',
    envVar: 'RUNCASTLE_SERVER_PORT',
    restartRequired: true,
    valueSchema: z.number().int().positive(),
    parseEnv: (raw) => Number(raw),
  },
  {
    key: 'model',
    configKey: 'model',
    envVar: 'RUNCASTLE_MODEL',
    projectColumn: 'model',
    restartRequired: false,
    valueSchema: z.string().min(1),
    parseEnv: idEnv,
  },
  {
    key: 'sandbox',
    configKey: 'sandbox',
    envVar: 'RUNCASTLE_SANDBOX',
    projectColumn: 'sandbox',
    restartRequired: false,
    valueSchema: z.enum(['docker', 'podman', 'noSandbox']),
    parseEnv: idEnv,
  },
  {
    key: 'sandboxImage',
    configKey: 'sandboxImage',
    envVar: 'RUNCASTLE_SANDBOX_IMAGE',
    restartRequired: false,
    valueSchema: z.string().min(1),
    parseEnv: idEnv,
  },
  {
    key: 'burnConcurrency',
    configKey: 'burnConcurrency',
    envVar: 'RUNCASTLE_BURN_CONCURRENCY',
    restartRequired: false,
    valueSchema: z.number().int().min(1).max(8),
    parseEnv: (raw) => Number(raw),
  },
  {
    key: 'burnMaxIterations',
    configKey: 'burnMaxIterations',
    envVar: 'RUNCASTLE_BURN_MAX_ITERATIONS',
    restartRequired: false,
    valueSchema: z.number().int().min(1).max(10),
    parseEnv: (raw) => Number(raw),
  },
  {
    key: 'burnAttempts',
    configKey: 'burnAttempts',
    envVar: 'RUNCASTLE_BURN_ATTEMPTS',
    restartRequired: false,
    valueSchema: z.number().int().min(1).max(5),
    parseEnv: (raw) => Number(raw),
  },
  {
    key: 'burnConflictAttempts',
    configKey: 'burnConflictAttempts',
    envVar: 'RUNCASTLE_BURN_CONFLICT_ATTEMPTS',
    restartRequired: false,
    valueSchema: z.number().int().min(0).max(3),
    parseEnv: (raw) => Number(raw),
  },
  {
    key: 'burnCpus',
    configKey: 'burnCpus',
    envVar: 'RUNCASTLE_BURN_CPUS',
    restartRequired: false,
    valueSchema: z.number().positive().max(256),
    parseEnv: (raw) => Number(raw),
  },
  {
    key: 'setupCommand',
    configKey: 'setupCommand',
    envVar: 'RUNCASTLE_SETUP_COMMAND',
    restartRequired: false,
    valueSchema: z.string().min(1),
    parseEnv: idEnv,
  },
  {
    key: 'verifyCommands',
    configKey: 'verifyCommands',
    envVar: 'RUNCASTLE_VERIFY_COMMANDS',
    restartRequired: false,
    valueSchema: z.string().min(1),
    parseEnv: idEnv,
  },
  {
    key: 'knownFailures',
    configKey: 'knownFailures',
    envVar: 'RUNCASTLE_KNOWN_FAILURES',
    restartRequired: false,
    valueSchema: z.string().min(1),
    parseEnv: idEnv,
  },
  {
    key: 'mainBranch',
    configKey: 'mainBranch',
    envVar: 'RUNCASTLE_MAIN_BRANCH',
    restartRequired: false,
    valueSchema: z.string().min(1),
    parseEnv: idEnv,
  },
  {
    key: 'devCommand',
    projectColumn: 'devCommand',
    restartRequired: false,
    valueSchema: z.string().min(1),
    parseEnv: idEnv,
  },
]

const DEFAULTS = RuncastleConfigSchema.parse({})

export interface SettingsIO {
  /** Env source (default `process.env`); tests inject a fake map. */
  env?: Record<string, string | undefined>
  /** Config-file path (default `~/.runcastle/config.json`); tests inject a temp file. */
  configFile?: string
}

/**
 * Read the raw config JSON, folding the legacy `smokeModel` key into
 * `stepModels.smoke` (issue #48) so both the settings VIEW and a write-through
 * (which reads-modifies-writes this shape) see the new shape — the next write
 * therefore drops `smokeModel` and persists `stepModels`.
 */
function readRawConfig(configFile: string): Record<string, unknown> {
  if (!existsSync(configFile)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(configFile, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    return foldLegacyModelConfig(parsed) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** The `stepModels` sub-object from a raw config, or an empty map. */
function rawStepModels(fileRaw: Record<string, unknown>): Record<string, unknown> {
  const raw = fileRaw.stepModels
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

/**
 * The per-step model fields (issue #48), one per `ModelStep` (never `review`).
 * Global-only: a step present in the config file reports source `file`,
 * otherwise the schema default (only `smoke` has one) with source `default`.
 */
function stepModelFields(fileRaw: Record<string, unknown>): SettingField[] {
  const set = rawStepModels(fileRaw)
  return MODEL_STEPS.map((step) => {
    const base = { key: `stepModels.${step}`, restartRequired: false, scope: 'global' as const }
    const v = set[step]
    if (typeof v === 'string' && v !== '') {
      return { ...base, value: v, source: 'file' as const, editable: true }
    }
    return { ...base, value: DEFAULTS.stepModels[step] ?? null, source: 'default' as const, editable: true }
  })
}

/** The per-project override columns for one project (raw row, override-null = inherit). */
function projectOverrides(ctx: AppCtx, projectId: string): Record<ProjectColumn, string | null> {
  const row = ctx.db
    .select({ model: projects.model, sandbox: projects.sandbox, devCommand: projects.devCommand })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  return {
    model: row?.model ?? null,
    sandbox: row?.sandbox ?? null,
    devCommand: row?.devCommand ?? null,
  }
}

function resolveField(
  desc: FieldDescriptor,
  layers: {
    env: Record<string, string | undefined>
    fileRaw: Record<string, unknown>
    overrides: Record<ProjectColumn, string | null> | null
  },
): SettingField {
  const scoped = layers.overrides !== null
  const scope: SettingField['scope'] = scoped && desc.projectColumn ? 'project' : 'global'
  const base = { key: desc.key, restartRequired: desc.restartRequired, scope }

  // 1. env always wins and locks the field.
  if (desc.envVar) {
    const raw = layers.env[desc.envVar]
    if (raw !== undefined && raw !== '') {
      return { ...base, value: desc.parseEnv(raw), source: 'env', editable: false }
    }
  }

  // 2. per-project override.
  if (layers.overrides && desc.projectColumn) {
    const ov = layers.overrides[desc.projectColumn]
    if (ov !== null && ov !== '') {
      return { ...base, value: ov, source: 'project', editable: true }
    }
  }

  // 3. config-file value.
  if (desc.configKey && Object.prototype.hasOwnProperty.call(layers.fileRaw, desc.configKey)) {
    return { ...base, value: layers.fileRaw[desc.configKey], source: 'file', editable: true }
  }

  // 4. schema default (or null for a project-only field with no default).
  const value = desc.configKey ? (DEFAULTS[desc.configKey] ?? null) : null
  return { ...base, value, source: 'default', editable: true }
}

/**
 * Resolve the settings surface. Without `projectId` returns the global defaults
 * (project-only fields like devCommand are omitted); with a `projectId` returns
 * every field resolved `project ?? global`.
 */
export function getSettings(ctx: AppCtx, projectId?: string, io: SettingsIO = {}): SettingsView {
  const env = io.env ?? process.env
  const fileRaw = readRawConfig(io.configFile ?? configPath())
  const overrides = projectId !== undefined ? projectOverrides(ctx, projectId) : null

  const visible = DESCRIPTORS.filter((d) => projectId !== undefined || d.configKey !== undefined)
  const fields = visible.map((d) => resolveField(d, { env, fileRaw, overrides }))
  // Per-step model overrides (issue #48) are global-only, so they resolve the
  // same in both scopes — append them to whichever view was requested.
  return { projectId, fields: [...fields, ...stepModelFields(fileRaw)] }
}

/**
 * Write a setting. With `projectId` (and a project-overridable field) writes the
 * project override — a `null` value clears it; otherwise writes the global
 * default write-through (config file + in-place `ctx.config` refresh). Rejects
 * env-locked fields, unknown keys, and type-invalid values. Returns the resolved
 * field after the write.
 */
export function updateSettings(
  ctx: AppCtx,
  input: SettingsUpdateInput,
  io: SettingsIO = {},
): SettingField {
  const env = io.env ?? process.env
  const configFile = io.configFile ?? configPath()

  // Per-step model overrides (issue #48) are a global-only nested map, so they
  // bypass the flat DESCRIPTOR machinery.
  if (input.key.startsWith('stepModels.')) {
    return updateStepModel(ctx, input, configFile, io)
  }

  const desc = DESCRIPTORS.find((d) => d.key === input.key)
  if (!desc) throw new InvalidInputError(`unknown setting: ${input.key}`)

  // env always wins → the field is locked.
  if (desc.envVar) {
    const raw = env[desc.envVar]
    if (raw !== undefined && raw !== '') {
      throw new InvalidInputError(
        `${desc.key} is set by environment variable ${desc.envVar}; unset it to edit`,
      )
    }
  }

  const toProject = input.projectId !== undefined && desc.projectColumn !== undefined

  if (input.value === null) {
    if (!toProject) throw new InvalidInputError(`${desc.key} cannot be cleared`)
    const project = requireProjectById(ctx, input.projectId as string)
    ctx.db
      .update(projects)
      .set({ [desc.projectColumn as ProjectColumn]: null })
      .where(eq(projects.id, project.id))
      .run()
    emitProject(ctx, project.id, {
      type: 'settings.updated',
      message: `${desc.key} override cleared`,
      data: { key: desc.key, scope: 'project', value: null },
    })
    return field(getSettings(ctx, input.projectId, io), desc.key)
  }

  const parsed = desc.valueSchema.safeParse(input.value)
  if (!parsed.success) {
    throw new InvalidInputError(`invalid value for ${desc.key}: ${parsed.error.issues[0]?.message}`)
  }
  const value = parsed.data

  if (toProject) {
    const project = requireProjectById(ctx, input.projectId as string)
    ctx.db
      .update(projects)
      .set({ [desc.projectColumn as ProjectColumn]: String(value) })
      .where(eq(projects.id, project.id))
      .run()
    emitProject(ctx, project.id, {
      type: 'settings.updated',
      message: `${desc.key} override set to ${String(value)}`,
      data: { key: desc.key, scope: 'project', value },
    })
    return field(getSettings(ctx, input.projectId, io), desc.key)
  }

  // Global write. Project-only fields (devCommand) have no global store.
  if (!desc.configKey) {
    throw new InvalidInputError(`${desc.key} is a per-project setting; provide a projectId`)
  }
  writeGlobal(configFile, desc.configKey, value)
  // In-place refresh: `ctx.config` is the shared object the launcher reads at
  // each launch, so the next launch sees the new value with no restart.
  ;(ctx.config as Record<string, unknown>)[desc.configKey] = value
  emitProject(ctx, GLOBAL_EVENT_KEY, {
    type: 'settings.updated',
    message: `${desc.key} set to ${String(value)}`,
    data: { key: desc.key, scope: 'global', value },
  })
  return field(getSettings(ctx, input.projectId, io), desc.key)
}

/** Merge one key into the config file, preserving the rest. */
function writeGlobal(configFile: string, configKey: keyof RuncastleConfig, value: unknown): void {
  const raw = readRawConfig(configFile)
  raw[configKey] = value
  mkdirSync(dirname(configFile), { recursive: true })
  writeFileSync(configFile, `${JSON.stringify(raw, null, 2)}\n`)
}

/** Valid model steps as a set for O(1) membership checks. */
const STEP_SET = new Set<string>(MODEL_STEPS)

/**
 * Write (or clear, on `null`) one per-step model override (issue #48). Global
 * only, write-through: persists the nested `stepModels` map to the config file
 * (dropping any legacy `smokeModel`, since `readRawConfig` folds it) and
 * refreshes `ctx.config.stepModels` in place so the next launch/run sees it.
 */
function updateStepModel(
  ctx: AppCtx,
  input: SettingsUpdateInput,
  configFile: string,
  io: SettingsIO,
): SettingField {
  const step = input.key.slice('stepModels.'.length)
  if (!STEP_SET.has(step)) throw new InvalidInputError(`unknown model step: ${step}`)
  const modelStep = step as ModelStep

  let value: string | null = null
  if (input.value !== null) {
    const parsed = z.string().min(1).safeParse(input.value)
    if (!parsed.success) {
      throw new InvalidInputError(
        `invalid value for ${input.key}: ${parsed.error.issues[0]?.message}`,
      )
    }
    value = parsed.data
  }

  writeStepModel(configFile, modelStep, value)
  const stepModels = (ctx.config.stepModels ?? {}) as Record<string, string>
  if (value === null) delete stepModels[modelStep]
  else stepModels[modelStep] = value
  ;(ctx.config as Record<string, unknown>).stepModels = stepModels

  emitProject(ctx, GLOBAL_EVENT_KEY, {
    type: 'settings.updated',
    message: value === null ? `${input.key} override cleared` : `${input.key} set to ${value}`,
    data: { key: input.key, scope: 'global', value },
  })
  return field(getSettings(ctx, input.projectId, io), input.key)
}

/** Merge/clear one step in the config file's `stepModels` map, preserving the rest. */
function writeStepModel(configFile: string, step: ModelStep, value: string | null): void {
  const raw = readRawConfig(configFile)
  const stepModels = { ...rawStepModels(raw) }
  if (value === null) delete stepModels[step]
  else stepModels[step] = value
  raw.stepModels = stepModels
  mkdirSync(dirname(configFile), { recursive: true })
  writeFileSync(configFile, `${JSON.stringify(raw, null, 2)}\n`)
}

function field(view: SettingsView, key: string): SettingField {
  const f = view.fields.find((x) => x.key === key)
  if (!f) throw new InvalidInputError(`setting ${key} not visible in this scope`)
  return f
}
