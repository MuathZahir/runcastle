import * as z from 'zod'

/**
 * Runtime configuration schema. This module is PURE — no IO and no `node:`
 * imports — so it is safe to include in the browser-facing core barrel
 * (`index.ts`). The file-reading loader (`loadConfig`) lives in `./config-load`,
 * which pulls in `node:fs` + `./paths` and is therefore node-only; import it
 * directly via `@runcastle/core/config-load`, never through the barrel.
 */

/**
 * The pipeline steps a model can be chosen for (issue #48). Each interactive
 * session kind (`chat`, `project`) and each AFK agent
 * (`implement`, `review`) plus the scripted `smoke` maps to one step.
 *
 * `review` is the Review worker's model: the worker a feature lead starts with
 * `start_review` (first reviews and verify reviews alike) when the lead names no
 * model. It is a step of its own because a review is chosen for judgement at a
 * price, not for the chat's flagship: unset, it falls to the runtime's
 * {@link RUNTIME_DEFAULT_MODELS} review default, never to the global model.
 */
export const MODEL_STEPS = [
  'chat',
  'implement',
  'review',
  'prepare',
  'project',
  'smoke',
] as const
export const ModelStep = z.enum(MODEL_STEPS)
export type ModelStep = z.infer<typeof ModelStep>

/**
 * The agent runtimes a model can run on. Runtime is a property of the MODEL, not
 * a separate knob: whichever model wins the {@link resolveModel} chain decides
 * which CLI a session or burn launches.
 */
export const AGENT_RUNTIMES = ['claude-code', 'codex'] as const
export const AgentRuntime = z.enum(AGENT_RUNTIMES)
export type AgentRuntime = z.infer<typeof AgentRuntime>

/**
 * The runtime a model id with no roster entry runs on. Every model was a Claude
 * model before Codex support existed, so a bare id stored by an older runcastle
 * — or typed as free text without a declared runtime — must keep launching
 * Claude Code. Never infer a runtime from the id string: pattern matching fails
 * silently on proxies, local models, and unguessable future ids, and the failure
 * mode is launching the wrong CLI.
 */
export const DEFAULT_RUNTIME: AgentRuntime = 'claude-code'

/** One model offered in the settings UI's model dropdowns. */
export const ModelEntry = z.object({
  id: z.string().min(1),
  runtime: AgentRuntime,
  /**
   * Free-text use-case note ("opus 5 — UI/UX", "gpt-5.6-sol — mechanical
   * refactors"). Optional, and the opt-in for per-ticket model assignment: only
   * annotated entries are offered to the agent that stamps a model on a ticket.
   */
  note: z.string().optional(),
})
export type ModelEntry = z.infer<typeof ModelEntry>

/** A runtime's curated flagship, cheap/smoke and review defaults. */
export interface ModelDefaultPair {
  flagship: string
  smoke: string
  /** The Review worker's model when the `review` step is unset. */
  review: string
}

/**
 * The curated default pair per runtime, so onboarding can seed the global
 * default and smoke models from whichever runtime the operator actually authed
 * — hardcoded Claude defaults are dead values for a Codex-only user. Thereafter
 * they are ordinary settings values, not magic that keeps re-deciding.
 */
export const RUNTIME_DEFAULT_MODELS: Record<AgentRuntime, ModelDefaultPair> = {
  'claude-code': { flagship: 'claude-opus-5', smoke: 'claude-haiku-4-5', review: 'claude-sonnet-5-5' },
  codex: { flagship: 'gpt-5.6-sol', smoke: 'gpt-5.6-luna', review: 'gpt-5.6-terra' },
}

/**
 * The curated model list surfaced by the settings UI (issue #48). Lives in core
 * so server and web share one source of truth (web's hardcoded constant is
 * retired). Any model id not in this list is still accepted as free text — with
 * an explicitly declared runtime, stored in the config's `models` roster.
 *
 * The `[1m]` suffix is a Claude Code model-id modifier that opts the session
 * into the 1M-token context window; a bare id runs at the model's default
 * window. It is NOT part of the Anthropic API model id — it is consumed by the
 * CLI's `--model` flag, which is the only place runcastle uses these ids. Two
 * caveats, both verified against the CLI:
 *   - `[1m]` on a model without a 1M tier (e.g. Haiku 4.5) fails the launch
 *     with `400 The long context beta is not yet available for this
 *     subscription`, so no 1M entry is offered for it.
 *   - some plans meter 1M separately and fail with `Usage credits required for
 *     1M context`, which is why the default below stays on a bare id.
 */
export const CURATED_MODELS: readonly ModelEntry[] = [
  { id: 'claude-opus-5', runtime: 'claude-code' },
  { id: 'claude-opus-5[1m]', runtime: 'claude-code' },
  { id: 'claude-sonnet-5', runtime: 'claude-code' },
  { id: 'claude-sonnet-5-5', runtime: 'claude-code' },
  { id: 'claude-sonnet-5[1m]', runtime: 'claude-code' },
  { id: 'claude-fable-5', runtime: 'claude-code' },
  { id: 'claude-fable-5[1m]', runtime: 'claude-code' },
  { id: 'claude-opus-4-8', runtime: 'claude-code' },
  { id: 'claude-haiku-4-5', runtime: 'claude-code' },
  { id: 'gpt-5.6-sol', runtime: 'codex' },
  { id: 'gpt-5.6-terra', runtime: 'codex' },
  { id: 'gpt-5.6-luna', runtime: 'codex' },
]

/** Cheap default for the scripted smoke so an end-to-end run stays inexpensive. */
const DEFAULT_SMOKE_MODEL = RUNTIME_DEFAULT_MODELS[DEFAULT_RUNTIME].smoke

/** Model steps retired with mapped ideation (ADR-0012), ignored on load. */
const RETIRED_MODEL_STEPS = ['waypoint', 'converge', 'research'] as const

/**
 * Read-compat for the legacy `smokeModel` field (issue #48): fold it into
 * `stepModels.smoke` unless that step is already set explicitly, then drop the
 * legacy key so it never lingers on the parsed shape. The next settings write
 * therefore persists the new `stepModels` shape.
 *
 * It also drops the `stepModels` keys of steps that no longer exist. Mapped
 * ideation was retired (ADR-0012) and took the `waypoint`, `converge` and
 * `research` steps with it, but a config written before then may still name
 * them. `stepModels` rejects unknown keys, so an upgraded install would
 * otherwise fail to boot; the stale keys are ignored instead.
 */
export const foldLegacyModelConfig = (raw: unknown): unknown => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const obj = { ...(raw as Record<string, unknown>) }
  const existing =
    typeof obj.stepModels === 'object' && obj.stepModels !== null && !Array.isArray(obj.stepModels)
      ? { ...(obj.stepModels as Record<string, unknown>) }
      : undefined
  if (existing) {
    for (const step of RETIRED_MODEL_STEPS) delete existing[step]
    obj.stepModels = existing
  }
  const legacy = obj.smokeModel
  if (typeof legacy === 'string' && legacy.length > 0 && existing?.smoke === undefined) {
    obj.stepModels = { ...existing, smoke: legacy }
  }
  delete obj.smokeModel
  return obj
}

/** Memory each worker is given room for by the default (one-number-for-how-many-build-at-once decision 4). */
export const GB_PER_WORKER = 4
/** The default's floor and ceiling (decision 4). */
export const DEFAULT_WORKERS_AT_ONCE_MIN = 2
export const DEFAULT_WORKERS_AT_ONCE_MAX = 8
/** The most a user may set (decision 6). */
export const WORKERS_AT_ONCE_MAX = 16
const GIB = 1024 ** 3

export const RuncastleConfig = z.preprocess(
  foldLegacyModelConfig,
  z.object({
    serverPort: z.number().default(4512),
    /**
     * Default model every step inherits unless overridden (issue #48). A bare
     * id, not `claude-opus-5[1m]`: 1M context is metered separately on some
     * plans, so a 1M default would fail the very first launch for those
     * operators. Pick a `(1M context)` entry in settings to opt in.
     */
    model: z.string().default(RUNTIME_DEFAULT_MODELS[DEFAULT_RUNTIME].flagship),
    /**
     * Sparse per-step model overrides (issue #48). Global-only; a step absent
     * here inherits the default `model`. Seeds `smoke` with a cheap model.
     */
    stepModels: z.partialRecord(ModelStep, z.string()).default({ smoke: DEFAULT_SMOKE_MODEL }),
    /**
     * The operator's own model roster, merged OVER {@link CURATED_MODELS} by id.
     * This is where the settings UI writes a free-text model id together with
     * the runtime the operator declared for it and an optional use-case note,
     * and where annotating a curated entry with a note lands.
     */
    models: z.array(ModelEntry).default([]),
    // `.catch`, not `.default`: an old config file may still carry the retired
    // `noSandbox` value, and it must load (as docker) rather than fail to parse.
    sandbox: z.enum(['docker', 'podman']).catch('docker'),
    /**
     * Whether a launched terminal also sees the human's OWN MCP servers.
     *
     * `inherit` (default) passes runcastle's `mcp.json` via `--mcp-config` and
     * stops there, so Claude Code merges it with every other MCP source it
     * normally loads — user `~/.claude.json`, the target repo's `.mcp.json`,
     * and any servers contributed by the human's installed plugins.
     *
     * `runcastleOnly` additionally passes `--strict-mcp-config`, documented as
     * *"Only use MCP servers from --mcp-config, ignoring all other MCP
     * configurations"*. That word "all" is total: it drops the human's own
     * connections AND their plugins' servers, which is why it is no longer the
     * default. Sessions are the human's working terminal, not a hermetic
     * sandbox — the burn sandbox is where hermeticity belongs. Choose
     * `runcastleOnly` when you want a session's tool surface to be exactly
     * reproducible, or to keep a heavy personal MCP set out of the context
     * window.
     */
    sessionMcp: z.enum(['inherit', 'runcastleOnly']).default('inherit'),
    /**
     * The usage ping: the boot update check that also counts this install as
     * active (a random install ID, the version, the platform). `on` pings, `off`
     * asks npm for the update banner instead. Unset counts as `on`: the ping is
     * on by default and nobody is asked (the-orchestrator-prepares-the-project
     * decision 16). `DO_NOT_TRACK` beats either value.
     */
    usageSignal: z.enum(['on', 'off']).optional(),
    /**
     * Carry on when the usage limit resets (agents-are-woken-only-when-it-matters
     * decision 25): `on` wakes every chat the provider's usage limit stopped once,
     * at the reset the runtime reports. `off` by default, so nobody's weekly
     * limit is spent without their say.
     */
    carryOnAfterLimit: z.enum(['on', 'off']).default('off'),
    /**
     * Machine-wide Docker image name for the sandcastle burner sandbox (B3 /
     * SPEC §8) — the fallback under a project's own `sandboxImage`, which beats
     * it (see {@link resolveSandboxImage} for the full order). When neither is
     * set, runcastle uses {@link DEFAULT_SANDBOX_IMAGE} everywhere — build,
     * doctor probe, and burn — via {@link resolveSandboxImage}; it does NOT let
     * sandcastle fall back to its own `sandcastle:<repo-dir-name>` derivation,
     * which would look up a differently-named image than the one we built. The
     * demo image is tagged `sandcastle:runcastle-demo`. Applies to `docker` and
     * `podman`; ignored for `noSandbox`.
     */
    sandboxImage: z.string().optional(),
    /**
     * How many workers and reviews may be mid-turn at once, across every project
     * on the machine (one-number-for-how-many-build-at-once decision 1). Settings
     * calls it "Workers and reviews at once". Leads, the orchestrator and epics
     * never count (decision 2); a worker counts only while it works (decision 5).
     * The key keeps its old name so a value someone already set is kept.
     *
     * Default: one per 4 GB of the machine's memory, between 2 and 8 (decision
     * 4). The schema cannot read memory (core is IO-free), so the `.default(2)`
     * below is only what a raw `parse({})` sees; the host-aware value an operator
     * actually gets is applied by `loadConfig` via
     * {@link resolveDefaultWorkersAtOnce}. A user may set up to 16 (decision 6).
     */
    burnConcurrency: z.number().int().min(1).max(WORKERS_AT_ONCE_MAX).default(DEFAULT_WORKERS_AT_ONCE_MIN),
    /**
     * Per-container CPU ceiling for burn sandboxes (`docker run --cpus`), or
     * unset for today's unconstrained behaviour. Fractional values are allowed.
     *
     * This exists because N concurrent containers each see the HOST's full core
     * count and size their install/test worker pools from it, so width N
     * oversubscribes the box N-fold and every agent's commands slow down
     * together. Setting this to roughly `cores / burnConcurrency` keeps each
     * agent's wall-clock predictable. Applies to every worker sandbox.
     *
     * There is deliberately no matching memory ceiling: a hard cap would convert
     * host-level pressure into a certain in-container OOM kill of the agent
     * process. Bound memory by lowering {@link burnConcurrency} instead.
     */
    burnCpus: z.number().positive().max(256).optional(),
    /**
     * Install the burn guard — a Claude Code `PreToolUse` hook inside each
     * worker sandbox that denies a few things the working rules already forbid
     * (git stash, overriding test-runner concurrency, rewriting files through
     * interpreter heredocs).
     *
     * On by default because prompt rules measurably did not hold on their own.
     * Set `false` to fall back to prompt-only guidance — worth doing if a rule
     * ever misfires, since a false deny in an unattended agent costs turns.
     */
    burnGuard: z.boolean().default(true),
    /**
     * Command run inside the worker sandbox before the agent starts,
     * overriding lockfile-based detection. Leave
     * unset to auto-detect from the target repo (`packageManager` field, then
     * lockfiles — a root install covers JS workspaces/monorepos). Set it for
     * non-JS projects or bespoke bootstraps (e.g. `make deps`).
     *
     * Also the place to pre-warm generated artifacts. Burn measurements put
     * ~51 minutes across 204 calls into build/codegen steps that are the same
     * boilerplate every ticket — agents discovering mid-run that they need a
     * contracts build or an ORM client generated. Chaining those here runs them
     * once per sandbox, before the agent starts, e.g.
     * `corepack pnpm install --frozen-lockfile && pnpm contracts:build && pnpm prisma:generate`.
     * Note that overriding this replaces install detection entirely, so the
     * install command must be included explicitly.
     */
    setupCommand: z.string().optional(),
    /**
     * The exact commands a burn agent should use to verify its work — typecheck,
     * unit tests, lint — one per line, free text, rendered verbatim into the
     * burner prompt's verification section.
     *
     * Unset means the agent derives them from the repo, which real burn logs
     * show is expensive in exactly one way: it guesses workspace filter names.
     * A single ticket burned two full monorepo suite runs discovering that
     * `--filter helix-frontend` and `--filter helix` were both wrong. One line
     * here (`pnpm --filter @acme/web test`) removes that class of waste for
     * every ticket of every feature.
     */
    verifyCommands: z.string().optional(),
    /**
     * Tests already failing on the target repo's main branch, free text (a count
     * plus the suite names is enough), rendered into the burner prompt.
     *
     * Burn agents must distinguish their own breakage from the repo's existing
     * breakage, and with nothing to go on every one of them re-derives it the
     * only way available: run the whole suite before touching anything, then
     * again after. Stating the baseline here retires the pre-work run — the
     * single most repeated expensive command in the logs.
     */
    knownFailures: z.string().optional(),
    /**
     * Whether worker sandboxes share a persistent per-project cache volume.
     * `volume` (default) mounts one Docker/Podman named volume per project
     * holding the package-manager store and one persistent checkout per
     * concurrency slot, so install, `.tsbuildinfo`, the test runner's cache and
     * turbo's cache survive between workers. `off` is a fresh clone and a cold
     * install every time.
     *
     * Config-file + env only — an escape hatch, not a setting the overlay
     * offers. Go through {@link resolveBurnCacheMode} rather than reading this
     * field.
     */
    burnCache: z.enum(['volume', 'off']).default('volume'),
  }),
)
export type RuncastleConfig = z.infer<typeof RuncastleConfig>

/**
 * The image tag runcastle builds, probes, and burns against when a project
 * leaves `sandboxImage` unset. This MUST be an explicit constant rather than
 * letting sandcastle derive its own `sandcastle:<repo-dir-name>` default: the
 * build-image/doctor/setup paths already hard-coded `sandcastle:runcastle`, so
 * a run path that omits the name would look up a differently-named image and
 * fail with "Image not found locally". Everyone resolves through
 * {@link resolveSandboxImage} so the name can never drift again.
 */
export const DEFAULT_SANDBOX_IMAGE = 'sandcastle:runcastle'

/**
 * Whatever carries a project's own sandbox image — a `Project`, a raw row, or
 * nothing at all for the callers that run outside any project: the `runcastle
 * doctor` CLI, the burn cache probe, and the build-image/doctor flows, which
 * are machine-wide today and resolve to the global image.
 */
export type SandboxImageOwner = { sandboxImage?: string | null } | null | undefined

/**
 * The sandcastle image tag to build/probe/run, resolved in four layers:
 * project column → `RUNCASTLE_SANDBOX_IMAGE` → global config file →
 * {@link DEFAULT_SANDBOX_IMAGE}. Pure.
 *
 * The env layer is not a parameter here because it is already inside
 * `config.sandboxImage`: `loadConfig` folds `RUNCASTLE_SANDBOX_IMAGE` over the
 * config file, so the two middle layers arrive as one value with the env
 * variable already winning between them. What this function adds on top is the
 * project column, and it wins over both — the image a repo needs is a fact
 * about that repo, exactly as its setup command is (see
 * {@link resolvePreparedSettings}, which orders the same way).
 *
 * Every consumer — the build flow, the doctor probe, the per-run image
 * precheck, the burn itself and the cache slot stamp — resolves here, so the
 * name they agree on can never drift apart. Which of them hands over a project
 * is up to the caller: the burn and its containers do, and the machine-wide
 * flows named on {@link SandboxImageOwner} do not.
 *
 * Empty strings are treated as unset, the way a cleared settings field arrives.
 */
export function resolveSandboxImage(
  config: Pick<RuncastleConfig, 'sandboxImage'>,
  project?: SandboxImageOwner,
): string {
  return project?.sandboxImage?.trim() || config.sandboxImage?.trim() || DEFAULT_SANDBOX_IMAGE
}

/**
 * The burn cache mode actually in force: the configured one (both sandbox
 * engines own named volumes). Pure; the single reader of `config.burnCache`.
 */
export function resolveBurnCacheMode(config: Pick<RuncastleConfig, 'burnCache'>): RuncastleConfig['burnCache'] {
  return config.burnCache
}

/**
 * The `burnConcurrency` an operator who set nothing gets on a host with
 * `totalMemBytes` of memory: one per {@link GB_PER_WORKER} GB, rounded down,
 * never below {@link DEFAULT_WORKERS_AT_ONCE_MIN} nor above
 * {@link DEFAULT_WORKERS_AT_ONCE_MAX} (one-number-for-how-many-build-at-once
 * decision 4). Pure: the caller supplies the figure, because core may not
 * import `node:os`; `loadConfig` is where the host is asked.
 *
 * Memory is the ceiling now that workers run on the host: measured on the
 * runcastle repo, an agent process holds 0.2–0.4 GB and a typecheck peaks at
 * 0.85 GB on top, with tests and a dev server adding bursts. 4 GB each leaves
 * room for the leads and the server. It replaced a default that counted CPU
 * cores and gave 1 on any machine with 8 or fewer.
 *
 * A figure that is not a positive number (a runtime with no answer) gets the
 * floor.
 */
export function resolveDefaultWorkersAtOnce(totalMemBytes: number): number {
  if (!Number.isFinite(totalMemBytes) || totalMemBytes <= 0) return DEFAULT_WORKERS_AT_ONCE_MIN
  const byMemory = Math.floor(totalMemBytes / (GB_PER_WORKER * GIB))
  return Math.min(DEFAULT_WORKERS_AT_ONCE_MAX, Math.max(DEFAULT_WORKERS_AT_ONCE_MIN, byMemory))
}

/** Whole gigabytes in `bytes`, rounded to the nearest, as Settings names the machine's memory. */
export function memoryGb(bytes: number): number {
  return Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / GIB) : 0
}

/**
 * The three burn-facing prepared fields, resolved `project ?? global`. Pure.
 *
 * These live on `RuncastleConfig` for historical reasons (they landed before
 * multi-project), but every one of them describes a REPO — its install command,
 * its verify commands, which of its tests are already red. A machine-wide value
 * is wrong as soon as a second project is opened, so a project's own value
 * always wins; the global stays as the inherited fallback so an operator who
 * already set one keeps it.
 *
 * Empty strings are treated as unset: a cleared textarea in the settings UI
 * arrives as `''`, and `''` must inherit rather than mean "no commands".
 */
export function resolvePreparedSettings(
  config: Pick<RuncastleConfig, 'setupCommand' | 'verifyCommands' | 'knownFailures'>,
  project?: {
    setupCommand?: string | null
    verifyCommands?: string | null
    knownFailures?: string | null
  } | null,
): { setupCommand?: string; verifyCommands?: string; knownFailures?: string } {
  const pick = (a: string | null | undefined, b: string | undefined): string | undefined => {
    const own = a?.trim()
    if (own) return own
    const inherited = b?.trim()
    return inherited || undefined
  }
  return {
    setupCommand: pick(project?.setupCommand, config.setupCommand),
    verifyCommands: pick(project?.verifyCommands, config.verifyCommands),
    knownFailures: pick(project?.knownFailures, config.knownFailures),
  }
}

/**
 * Resolve the model for one pipeline step (issue #48). Pure: the chain is
 * `runOverride ?? project.model ?? stepModels[step] ?? stepDefaultModel(step)`,
 * so a scripted/smoke run override wins over a per-project override, which wins
 * over a global per-step override, which wins over the step's default: the
 * global model for every step but `review`, whose default is per runtime.
 *
 * The global values — `model` and the `stepModels` matrix — are the machine-wide
 * default setup; a project's own `model` is an explicit "this repo runs on that
 * model", so it beats them all. There is deliberately no per-project *per-step*
 * override: the single project `model` is the whole per-project surface.
 */
export function resolveModel(
  step: ModelStep,
  config: ModelConfig,
  project?: { model?: string | null } | null,
  runOverride?: string | null,
): string {
  return resolveModelEntry(step, config, project, runOverride).id
}

/**
 * The model config {@link resolveModel} and friends read. `models` is optional
 * so a caller holding only the two model fields (tests, and the settings view's
 * partial shapes) still typechecks; an absent roster simply means "curated only".
 */
export type ModelConfig = Pick<RuncastleConfig, 'model' | 'stepModels'> & {
  models?: readonly ModelEntry[]
  discovered: readonly ModelEntry[]
}

/** What a config knows about models: its own roster, or none. */
export type ModelRosterConfig = {
  models?: readonly ModelEntry[]
  discovered: readonly ModelEntry[]
}

/**
 * Upsert `overrides` into `base` by model id, preserving `base`'s order and
 * appending genuinely new entries. Pure — used both to merge an operator's
 * roster over the curated one and to add a single entry to that roster.
 */
export function mergeModelEntries(
  base: readonly ModelEntry[],
  overrides: readonly ModelEntry[],
): ModelEntry[] {
  const byId = new Map(overrides.map((m) => [m.id, m]))
  const merged = base.map((m) => byId.get(m.id) ?? m)
  const seen = new Set(base.map((m) => m.id))
  return [...merged, ...overrides.filter((m) => !seen.has(m.id))]
}

/** Every model the UI offers: curated, then discovered, then the operator's roster. */
export function modelRoster(config: ModelRosterConfig): ModelEntry[] {
  // The field is required for typed callers, but tolerate older persisted/test
  // shapes crossing a runtime boundary during an upgrade.
  return mergeModelEntries(
    mergeModelEntries(CURATED_MODELS, config.discovered ?? []),
    config.models ?? [],
  )
}

/** Flatten a discovery snapshot to roster entries in canonical runtime order. */
export function discoveredEntries(
  snapshot: import('./schemas').DiscoverySnapshot,
): ModelEntry[] {
  return AGENT_RUNTIMES.flatMap((runtime) =>
    snapshot.sources[runtime].models.map(({ id }) => ({ id, runtime })),
  )
}

/**
 * The roster entry for a model id — the operator's declaration when there is
 * one, else the curated entry, else a {@link DEFAULT_RUNTIME} entry. Pure.
 */
export function modelEntryFor(id: string, config: ModelRosterConfig): ModelEntry {
  return modelRoster(config).find((m) => m.id === id) ?? { id, runtime: DEFAULT_RUNTIME }
}

/**
 * Every runtime some CONFIGURED model resolves to — the global default, every
 * per-step override, and whatever extra ids the caller holds (per-project
 * overrides, per-ticket assignments). Pure.
 *
 * This is what makes a runtime's readiness conditional: a host with no `codex`
 * binary is perfectly healthy until some model the operator actually configured
 * runs on Codex, at which point the missing CLI is a real, fixable error. Blank
 * ids are ignored (an unset override inherits rather than selecting a runtime),
 * and the result is ordered by {@link AGENT_RUNTIMES} so a report's runtime
 * sections never shuffle between calls.
 */
export function configuredRuntimes(
  config: ModelConfig,
  extraModelIds: readonly (string | null | undefined)[] = [],
): AgentRuntime[] {
  const ids = [config.model, ...Object.values(config.stepModels), ...extraModelIds]
  const found = new Set<AgentRuntime>()
  for (const id of ids) {
    if (id) found.add(modelEntryFor(id, config).runtime)
  }
  return AGENT_RUNTIMES.filter((r) => found.has(r))
}

/**
 * {@link resolveModel}'s chain, resolved all the way to the `{ id, runtime }`
 * pair a launch needs — the runtime a session or burn runs on is a property of
 * whichever model won the chain, never a knob of its own. Pure.
 */
export function resolveModelEntry(
  step: ModelStep,
  config: ModelConfig,
  project?: { model?: string | null } | null,
  runOverride?: string | null,
): ModelEntry {
  const id =
    runOverride ?? project?.model ?? config.stepModels[step] ?? stepDefaultModel(step, config)
  return modelEntryFor(id, config)
}

/**
 * The model a step falls to when nothing in its chain is set. Pure. Every step
 * but `review` inherits the global `model`; `review` takes the
 * {@link RUNTIME_DEFAULT_MODELS} review default of the runtime the global model
 * runs on, so a Codex-only install never gets a Claude reviewer. Computed at
 * resolve time rather than as a zod default, so a config file whose `stepModels`
 * object has no `review` key still gets it.
 */
export function stepDefaultModel(
  step: ModelStep,
  config: Pick<RuncastleConfig, 'model'> & ModelRosterConfig,
): string {
  if (step !== 'review') return config.model
  return RUNTIME_DEFAULT_MODELS[modelEntryFor(config.model, config).runtime].review
}
