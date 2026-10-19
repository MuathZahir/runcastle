import { z } from 'zod'

/**
 * A feature's UI states as stories (features-show-their-ui-states-as-stories).
 * The committed `.runcastle/stories.json` contract, the Storybook build output
 * runcastle reads, the pure match from a feature's changed files to the
 * stories it touched (decision 7), and the records written beside each build.
 * IO-free: callers read the files and hand the text or parsed JSON in.
 */

/** Repo-relative path of the contract; its presence on a branch means "has stories" (decision 3). */
export const STORIES_CONFIG_REL = '.runcastle/stories.json'

/** The one placeholder in `build`: where the static catalogue is written. */
export const STORIES_OUT_PLACEHOLDER = '{out}'

export const StoriesConfig = z.object({
  build: z
    .string()
    .trim()
    .min(1)
    .refine((b) => b.includes(STORIES_OUT_PLACEHOLDER), {
      message: `build must contain ${STORIES_OUT_PLACEHOLDER}`,
    }),
})
export type StoriesConfig = z.infer<typeof StoriesConfig>

/** The parsed contract, or null for anything that means "no stories": bad JSON, no build, no `{out}`. */
export function parseStoriesConfig(text: string): StoriesConfig | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = StoriesConfig.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** The build command with every `{out}` replaced by the double-quoted output path. */
export function renderStoriesBuildCommand(cfg: StoriesConfig, outPath: string): string {
  return cfg.build.split(STORIES_OUT_PLACEHOLDER).join(`"${outPath}"`)
}

// ---------------------------------------------------------------------------
// Storybook build output (tolerant: unknown keys pass through)
// ---------------------------------------------------------------------------

export const StoryIndexEntry = z
  .object({
    id: z.string(),
    title: z.string(),
    name: z.string(),
    importPath: z.string(),
    type: z.enum(['story', 'docs']),
    tags: z.array(z.string()).optional(),
  })
  .passthrough()
export type StoryIndexEntry = z.infer<typeof StoryIndexEntry>

/** `<out>/index.json`: every story and docs entry, keyed by id. */
export const StoryIndex = z
  .object({
    v: z.number(),
    entries: z.record(z.string(), StoryIndexEntry),
  })
  .passthrough()
export type StoryIndex = z.infer<typeof StoryIndex>

export const PreviewStatsModule = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string(),
    /** The modules that IMPORT `name`. */
    reasons: z.array(z.object({ moduleName: z.string() }).passthrough()).optional(),
  })
  .passthrough()
export type PreviewStatsModule = z.infer<typeof PreviewStatsModule>

/** `<out>/preview-stats.json` (`storybook build --stats-json`): the build's import list. */
export const PreviewStats = z
  .object({
    modules: z.array(PreviewStatsModule),
  })
  .passthrough()
export type PreviewStats = z.infer<typeof PreviewStats>

/**
 * One module path in the form changed files use: repo-relative, forward
 * slashes, no leading `./`, no Vite `?query` suffix.
 */
export function normaliseStoryPath(path: string): string {
  let p = path.replace(/\\/g, '/')
  const q = p.indexOf('?')
  if (q !== -1) p = p.slice(0, q)
  while (p.startsWith('./')) p = p.slice(2)
  return p
}

/** Where page stories live: a whole page at an address, the only stories the map shows. */
export const PAGE_STORIES_DIR = '.runcastle/stories/pages/'

/** Whether a story file is a page story, by its path alone. */
export function isPageStory(importPath: string): boolean {
  return normaliseStoryPath(importPath).startsWith(PAGE_STORIES_DIR)
}

/** Whether a module path is a dependency rather than repo code. */
export const isNodeModule = (path: string): boolean => /(^|\/)node_modules\//.test(path)

// ---------------------------------------------------------------------------
// Classifying a feature's stories (decision 7)
// ---------------------------------------------------------------------------

/**
 * The base catalogue at the feature's branch point: `none` = the base had no
 * `stories.json` (every match is new), `failed` = it did but did not build
 * (kinds stay changed/affected), `built` = ids absent from its index are new.
 */
export type StoriesBase =
  | { status: 'none' }
  | { status: 'failed' }
  | { status: 'built'; index: StoryIndex }

export const StoryKind = z.enum(['changed', 'new', 'affected'])
export type StoryKind = z.infer<typeof StoryKind>

export const ClassifiedStory = z.object({
  id: z.string(),
  title: z.string(),
  name: z.string(),
  importPath: z.string(),
  kind: StoryKind,
  /** Import hops from the nearest changed file to the story file (0 = the story file changed). */
  distance: z.number().int().nonnegative(),
})
export type ClassifiedStory = z.infer<typeof ClassifiedStory>

export interface ClassifyFeatureStoriesInput {
  changedFiles: string[]
  index: StoryIndex
  stats: PreviewStats
  base: StoriesBase
}

const KIND_ORDER: Record<StoryKind, number> = { changed: 0, new: 1, affected: 2 }

/** Distance 0 or 1 is `changed`; 2 or more is `affected`. */
const CHANGED_MAX_DISTANCE = 1

/**
 * The stories a feature touched: BFS over the reverse import graph (imported
 * module → importer) from every changed file, so a story's distance is the
 * hops from the nearest changed file to its `importPath`. Unreachable stories
 * are not this feature's and are omitted; `docs` entries are ignored. Sorted
 * changed, new, affected, then by title and name.
 */
export function classifyFeatureStories(input: ClassifyFeatureStoriesInput): ClassifiedStory[] {
  const importers = new Map<string, Set<string>>()
  for (const mod of input.stats.modules) {
    const imported = normaliseStoryPath(mod.name)
    if (isNodeModule(imported)) continue
    for (const reason of mod.reasons ?? []) {
      const importer = normaliseStoryPath(reason.moduleName)
      if (isNodeModule(importer) || importer === imported) continue
      let set = importers.get(imported)
      if (!set) importers.set(imported, (set = new Set()))
      set.add(importer)
    }
  }

  const distance = new Map<string, number>()
  let frontier: string[] = []
  for (const file of input.changedFiles) {
    const p = normaliseStoryPath(file)
    if (distance.has(p)) continue
    distance.set(p, 0)
    frontier.push(p)
  }
  for (let d = 1; frontier.length > 0; d++) {
    const next: string[] = []
    for (const p of frontier) {
      for (const importer of importers.get(p) ?? []) {
        if (distance.has(importer)) continue
        distance.set(importer, d)
        next.push(importer)
      }
    }
    frontier = next
  }

  const baseIds =
    input.base.status === 'built' ? new Set(Object.keys(input.base.index.entries)) : null
  const stories: ClassifiedStory[] = []
  for (const entry of Object.values(input.index.entries)) {
    if (entry.type !== 'story') continue
    const d = distance.get(normaliseStoryPath(entry.importPath))
    if (d === undefined) continue
    const isNew = input.base.status === 'none' || (baseIds !== null && !baseIds.has(entry.id))
    stories.push({
      id: entry.id,
      title: entry.title,
      name: entry.name,
      importPath: entry.importPath,
      kind: isNew ? 'new' : d <= CHANGED_MAX_DISTANCE ? 'changed' : 'affected',
      distance: d,
    })
  }
  return stories.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.title.localeCompare(b.title) ||
      a.name.localeCompare(b.name),
  )
}

// ---------------------------------------------------------------------------
// Records written beside a build
// ---------------------------------------------------------------------------

export const StoriesBaseStatus = z.enum(['built', 'none', 'failed'])
export type StoriesBaseStatus = z.infer<typeof StoriesBaseStatus>

/**
 * `manifest.json` beside a feature's build: what the "UI states" section reads,
 * so no reader re-parses the stats file. One per feature, replaced every
 * review pass (decision 5).
 */
export const StoriesManifest = z.object({
  featureId: z.string(),
  commit: z.string(),
  baseCommit: z.string().nullable(),
  base: StoriesBaseStatus,
  lap: z.number().int(),
  reviewTicketId: z.string(),
  builtAt: z.number(),
  status: z.enum(['built', 'failed', 'couldnt_run']),
  reason: z.string().optional(),
  /** File name inside the build dir, e.g. `build.log`. */
  log: z.string().optional(),
  stories: z.array(ClassifiedStory),
})
export type StoriesManifest = z.infer<typeof StoriesManifest>

/**
 * The review pass's stories build, stored on the review ticket beside its
 * {@link ReviewGateRun} and rendered into the review prompts with it. Same
 * honest-failure shape: a failed build is a failed gate (decision 4), and
 * `couldnt_run` says why rather than showing nothing.
 */
export const StoriesBuildRecord = z.discriminatedUnion('status', [
  /** No `.runcastle/stories.json` on the branch: nothing was built. */
  z.object({ status: z.literal('none') }),
  z.object({
    status: z.literal('built'),
    commit: z.string(),
    baseCommit: z.string().nullable(),
    base: StoriesBaseStatus,
    counts: z.object({
      changed: z.number().int().nonnegative(),
      new: z.number().int().nonnegative(),
      affected: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    status: z.literal('failed'),
    commit: z.string(),
    exitCode: z.number().nullable(),
    log: z.string(),
  }),
  /** Sandbox unavailable, no host-side path to copy out from…; `log` is e.g. `run.log`. */
  z.object({
    status: z.literal('couldnt_run'),
    commit: z.string(),
    reason: z.string(),
    log: z.string().nullable(),
  }),
])
export type StoriesBuildRecord = z.infer<typeof StoriesBuildRecord>
