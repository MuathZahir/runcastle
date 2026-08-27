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
 * session kind (`ideation`/`qa`/`waypoint`/`converge`) and each AFK agent
 * (`research`, `implement`) plus the scripted `smoke` maps to one step. `review`
 * is intentionally RESERVED and undefined — the review workflow does not yet
 * exist, so it is never exposed as an override.
 */
export const MODEL_STEPS = [
  'ideation',
  'qa',
  'waypoint',
  'converge',
  'revisit',
  'research',
  'implement',
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

/** A runtime's curated flagship + cheap/smoke pair. */
export interface ModelDefaultPair {
  flagship: string
  smoke: string
}

/**
 * The curated default pair per runtime, so onboarding can seed the global
 * default and smoke models from whichever runtime the operator actually authed
 * — hardcoded Claude defaults are dead values for a Codex-only user. Thereafter
 * they are ordinary settings values, not magic that keeps re-deciding.
 */
export const RUNTIME_DEFAULT_MODELS: Record<AgentRuntime, ModelDefaultPair> = {
  'claude-code': { flagship: 'claude-opus-5', smoke: 'claude-haiku-4-5' },
  codex: { flagship: 'gpt-5.6-sol', smoke: 'gpt-5.6-luna' },
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

/**
 * Read-compat for the legacy `smokeModel` field (issue #48): fold it into
 * `stepModels.smoke` unless that step is already set explicitly, then drop the
 * legacy key so it never lingers on the parsed shape. The next settings write
 * therefore persists the new `stepModels` shape.
 */
export const foldLegacyModelConfig = (raw: unknown): unknown => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const obj = { ...(raw as Record<string, unknown>) }
  const legacy = obj.smokeModel
  if (typeof legacy === 'string' && legacy.length > 0) {
    const existing =
      typeof obj.stepModels === 'object' && obj.stepModels !== null && !Array.isArray(obj.stepModels)
        ? (obj.stepModels as Record<string, unknown>)
        : {}
    if (existing.smoke === undefined) obj.stepModels = { ...existing, smoke: legacy }
  }
  delete obj.smokeModel
  return obj
}

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
    sandbox: z.enum(['docker', 'podman', 'noSandbox']).default('docker'),
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
     * Docker image name for the sandcastle burner sandbox (B3 / SPEC §8). When
     * unset, runcastle uses {@link DEFAULT_SANDBOX_IMAGE} everywhere — build,
     * doctor probe, and burn — via {@link resolveSandboxImage}; it does NOT let
     * sandcastle fall back to its own `sandcastle:<repo-dir-name>` derivation,
     * which would look up a differently-named image than the one we built. The
     * demo image is tagged `sandcastle:runcastle-demo`. Applies to `docker` and
     * `podman`; ignored for `noSandbox`.
     */
    sandboxImage: z.string().optional(),
    /**
     * Max tickets the burner works in parallel per run (M2, SPEC §8). Each
     * concurrent ticket is one full AFK agent (its own container under a
     * container sandbox), so this is a cost/resource knob as much as a speed
     * knob — capped at 8. Dependency order (`blockedBy`) is always honoured
     * regardless of the width.
     *
     * Width is not free beyond the token cost: every concurrent agent runs the
     * target repo's dependency install and test suite, each of which fans out
     * to its own worker pool sized from the visible CPU count. Real burn logs
     * show the setup hook stretching from ~70s at width 1 to ~500s with four
     * tickets live, and test runners OOM-ing inside the sandbox. {@link
     * burnCpus} bounds the CPU side of that; the memory side is bounded only by
     * the container runtime's own VM limit, so lower this if suites die.
     *
     * Default: 3, or 1 on ≤8 logical CPUs. The schema cannot count cores (core
     * is IO-free), so the `.default(3)` below is only the floor a raw
     * `parse({})` sees; the host-aware value an operator actually gets is
     * applied by `loadConfig` via {@link resolveDefaultBurnConcurrency}.
     */
    burnConcurrency: z.number().int().min(1).max(8).default(3),
    /**
     * Per-container CPU ceiling for burn sandboxes (`docker run --cpus`), or
     * unset for today's unconstrained behaviour. Fractional values are allowed.
     *
     * This exists because N concurrent containers each see the HOST's full core
     * count and size their install/test worker pools from it, so width N
     * oversubscribes the box N-fold and every agent's commands slow down
     * together. Setting this to roughly `cores / burnConcurrency` keeps each
     * agent's wall-clock predictable. Container sandboxes only — `noSandbox`
     * runs on the host, where there is no container to constrain.
     *
     * There is deliberately no matching memory ceiling: sandcastle's provider
     * options do not expose `--memory`, and a hard cap would convert today's
     * host-level pressure into a certain in-container OOM kill of the agent
     * process. Bound memory by lowering {@link burnConcurrency} instead.
     */
    burnCpus: z.number().positive().max(256).optional(),
    /**
     * Install the burn guard — a Claude Code `PreToolUse` hook inside each burn
     * sandbox that denies a few things the burner prompt already forbids (git
     * stash, overriding test-runner concurrency, rewriting files through
     * interpreter heredocs).
     *
     * On by default because prompt rules measurably did not hold on their own.
     * Set `false` to fall back to prompt-only guidance — worth doing if a rule
     * ever misfires, since a false deny in an unattended agent costs turns.
     * Container sandboxes only: under `noSandbox` the agent runs on the host,
     * where writing `~/.claude/settings.json` would clobber the human's own.
     */
    burnGuard: z.boolean().default(true),
    /**
     * Max agent iterations per ticket burn (sandcastle `maxIterations`). Each
     * iteration is one fresh non-interactive `claude --print` invocation against
     * the same worktree, so an agent that ends its turn prematurely (print mode
     * has no background-task notifications) is picked up by the next iteration
     * instead of failing the ticket. The burner prompt's
     * `<promise>COMPLETE</promise>` signal stops the loop early once a ticket is
     * actually done, so raising this does not make successful burns slower.
     */
    burnMaxIterations: z.number().int().min(1).max(10).default(3),
    /**
     * Max sandcastle attempts per ticket per run. Distinct from
     * `burnMaxIterations` (turns WITHIN one healthy agent process): an attempt
     * is a whole `run()` — when the agent process dies on a transient
     * infrastructure error (API stream drop, network, overload/rate-limit,
     * idle timeout), the burner starts a fresh attempt on a new temp branch
     * BASED ON the failed attempt's branch, so commits already made are never
     * lost, and tells the agent to continue rather than start over. Fatal
     * errors (auth, unknown model, merge conflicts, agent-reported BLOCKED)
     * never retry.
     */
    burnAttempts: z.number().int().min(1).max(5).default(3),
    /**
     * Max in-loop conflict-RESOLVER passes per landing. When a ticket's branch
     * conflicts with the feature branch (its siblings landed first and touched
     * the same files), the burner does not hand the human a git command: it
     * runs one more agent on that branch — same ticket, same feature docs, plus
     * the conflicting paths and the sibling commits it is reconciling against —
     * which merges the feature branch IN, resolves, and commits, turning the
     * landing into a fast-forward. A pass is repeated only when the feature tip
     * moves again mid-resolve. `0` disables it: conflicts go straight to the
     * human (the pre-resolver behaviour).
     */
    burnConflictAttempts: z.number().int().min(0).max(3).default(2),
    /**
     * Command run inside the burner sandbox before the agent starts (sandcastle
     * `sandbox.onSandboxReady`), overriding lockfile-based detection. Leave
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
     * Where the burn agent's working tree lives (ADR-0005). `mounted` keeps the
     * agent in sandcastle's bind-mounted worktree; `isolated` clones it onto the
     * container's native filesystem and syncs commits back via a post-commit
     * hook — the fix for Docker Desktop's per-file mount translation tax, which
     * makes small-file-heavy tools (pnpm, tsc, jest) 10–60x slower on
     * Windows/macOS hosts. `auto` picks `isolated` on win32/darwin and `mounted`
     * on Linux (where the bind mount is native and free). Ignored for
     * `noSandbox` (no container, nothing to isolate).
     */
    burnWorkspace: z.enum(['auto', 'mounted', 'isolated']).default('auto'),
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
 * The sandcastle image tag to build/probe/run: the project's explicit
 * `sandboxImage` when set, else {@link DEFAULT_SANDBOX_IMAGE}. Pure.
 */
export function resolveSandboxImage(config: Pick<RuncastleConfig, 'sandboxImage'>): string {
  return config.sandboxImage ?? DEFAULT_SANDBOX_IMAGE
}

/**
 * At or below this many logical CPUs a host is too small to burn wide, and the
 * default width drops to 1. Eight is the line because a 6C/12T box — the audited
 * machine — sits under it while a 16-thread workstation sits above.
 */
const SMALL_HOST_LOGICAL_CPUS = 8

/**
 * The `burnConcurrency` an operator who set nothing gets on a host with
 * `logicalCpus` cores: 1 at or below {@link SMALL_HOST_LOGICAL_CPUS}, else 3.
 * Pure — the caller supplies the count, because core may not import `node:os`;
 * `loadConfig` is where the host is actually asked.
 *
 * Three was a flat default until the 2026-08-27 audit on a 6C/12T host. Each
 * concurrent burn sizes its install and test worker pools from the FULL visible
 * core count, so width 3 oversubscribes a small box threefold and every agent's
 * commands slow down together. The cost is not only wall-clock: a known set of
 * frontend suites goes red under that contention and green in isolation, and six
 * burns spent tickets re-triaging flakes the width had manufactured.
 *
 * A count that is not a positive number (a runtime with no answer) is read as a
 * small host — the conservative width is the right answer to not knowing.
 */
export function resolveDefaultBurnConcurrency(logicalCpus: number): number {
  return Number.isFinite(logicalCpus) && logicalCpus > SMALL_HOST_LOGICAL_CPUS ? 3 : 1
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
 * `runOverride ?? project.model ?? stepModels[step] ?? global.model`, so a
 * scripted/smoke run override wins over a per-project override, which wins over
 * a global per-step override, which wins over the global default.
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
}

/** What a config knows about models: its own roster, or none. */
export type ModelRosterConfig = { models?: readonly ModelEntry[] }

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

/** Every model the UI offers: {@link CURATED_MODELS} with the operator's roster over it. */
export function modelRoster(config: ModelRosterConfig): ModelEntry[] {
  return mergeModelEntries(CURATED_MODELS, config.models ?? [])
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
  const id = runOverride ?? project?.model ?? config.stepModels[step] ?? config.model
  return modelEntryFor(id, config)
}
