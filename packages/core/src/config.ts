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
  'research',
  'implement',
  'smoke',
] as const
export const ModelStep = z.enum(MODEL_STEPS)
export type ModelStep = z.infer<typeof ModelStep>

/** A model offered in the settings UI's Default-model dropdown. */
export interface CuratedModel {
  id: string
  label: string
}

/**
 * The curated model list surfaced by the settings UI (issue #48). Lives in core
 * so server and web share one source of truth (web's hardcoded constant is
 * retired). Any model id not in this list is still accepted as free text.
 */
export const CURATED_MODELS: readonly CuratedModel[] = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-fable-5', label: 'Fable 5' },
]

/** Cheap default for the scripted smoke so an end-to-end run stays inexpensive. */
const DEFAULT_SMOKE_MODEL = 'claude-haiku-4-5-20251001'

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
    /** Default model every step inherits unless overridden (issue #48). */
    model: z.string().default('claude-opus-4-8'),
    /**
     * Sparse per-step model overrides (issue #48). Global-only; a step absent
     * here inherits the default `model`. Seeds `smoke` with a cheap model.
     */
    stepModels: z.partialRecord(ModelStep, z.string()).default({ smoke: DEFAULT_SMOKE_MODEL }),
    sandbox: z.enum(['docker', 'podman', 'noSandbox']).default('docker'),
    mainBranch: z.string().default('main'),
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
     */
    burnConcurrency: z.number().int().min(1).max(8).default(3),
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
 * Resolve the model for one pipeline step (issue #48). Pure: the chain is
 * `runOverride ?? stepModels[step] ?? project.model ?? global.model`, so a
 * scripted/smoke run override wins over a per-step override, which wins over a
 * per-project override, which wins over the global default.
 */
export function resolveModel(
  step: ModelStep,
  config: Pick<RuncastleConfig, 'model' | 'stepModels'>,
  project?: { model?: string | null } | null,
  runOverride?: string | null,
): string {
  return runOverride ?? config.stepModels[step] ?? project?.model ?? config.model
}
