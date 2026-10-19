import { z } from 'zod'
import {
  isNodeModule,
  normaliseStoryPath,
  type PreviewStats,
  type StoryIndex,
  type StoryIndexEntry,
} from './stories'

/**
 * The map of stories and scenarios (the-map-of-stories-and-scenarios): the
 * product groups built from story titles and scenario paths (decision 4), the
 * "does this diff touch the catalogue" test main's catalogue is promoted and
 * judged stale by (decision 5), and the records and model the map is read
 * through. IO-free: callers list the files and hand them in.
 */

/** Group id of the last group, for single-segment titles and top-level scenarios. */
export const MAP_UNGROUPED = '~ungrouped'
export const MAP_UNGROUPED_NAME = 'Ungrouped'

/** Where scenarios live in a project repo; mirrors the server's `SCENARIOS_DIR`. */
const SCENARIOS_DIR = '.runcastle/scenarios'
const HTTP_EXTENSION = '.http'

/** How many levels the map's tree goes; anything deeper folds into the last. */
const MAX_LEVELS = 2

/**
 * The loose key two group names match on: case ignored, and every run of
 * spaces, hyphens and underscores one separator. `Feature page` and
 * `feature-page` both give `feature-page`. Nothing fuzzier.
 */
export function mapNameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** `expired-coupon` → `Expired coupon`: separators to spaces, first letter up. */
function readable(segment: string): string {
  const spaced = segment.replace(/[-_]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** A file name without its last extension (`expired-coupon.ts` → `expired-coupon`). */
function stem(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

// ---------------------------------------------------------------------------
// Grouping (decision 4)
// ---------------------------------------------------------------------------

export interface MapComponentSkeleton {
  /** The story file, normalised (repo-relative, no `./`). */
  importPath: string
  /** The title's last segment. */
  name: string
  /** The file's states, in index order. */
  states: { id: string; name: string }[]
}

export interface MapScenarioSkeleton {
  file: string
  name: string
  /** A same-path `.http` sits beside it: the group's call. */
  hasCall: boolean
}

export interface MapGroupSkeleton {
  /** Name keys joined by `/` (`checkout/coupons`), or {@link MAP_UNGROUPED}. */
  id: string
  /** This level's display name (`Coupons`, not `Checkout › Coupons`). */
  name: string
  parentId?: string
  components: MapComponentSkeleton[]
  scenarios: MapScenarioSkeleton[]
}

export interface GroupMapInput {
  /** Index entries; anything but `type === 'story'` is ignored. */
  stories: StoryIndexEntry[]
  scenarios: { file: string; hasCall: boolean }[]
}

interface GroupBuild {
  id: string
  /** The story title's spelling, which wins over the scenario folder's. */
  storyName?: string
  scenarioName?: string
  parentId?: string
  components: Map<string, MapComponentSkeleton>
  scenarios: MapScenarioSkeleton[]
}

/** A group path's segments as `{ key, name }`, folded to {@link MAX_LEVELS}. */
type GroupPath = { name: string; key: string }[]

function foldPath(names: string[]): GroupPath {
  return names
    .slice(0, MAX_LEVELS)
    .map((name) => ({ name: name.trim(), key: mapNameKey(name) }))
    .filter((s) => s.key !== '')
}

/** The scenario's folders under `scenarios/`, or null for a file that is not a scenario. */
function scenarioFolders(file: string): string[] | null {
  if (!file.startsWith(`${SCENARIOS_DIR}/`) || file.endsWith(HTTP_EXTENSION)) return null
  const segments = file.slice(SCENARIOS_DIR.length + 1).split('/')
  if (segments.some((s) => s === '' || s.startsWith('_') || s.startsWith('.'))) return null
  if (readable(stem(segments[segments.length - 1] ?? '')) === '') return null
  return segments.slice(0, -1)
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/**
 * The map's groups from story titles and scenario paths, flat and ordered
 * parent-before-children: top-level groups alphabetically by display name,
 * each followed by its children alphabetically, Ungrouped last. Names that do
 * not match under {@link mapNameKey} stay two groups — the map never guesses a
 * merge. A second-level group implies its parent, entries or not.
 */
export function groupMap(input: GroupMapInput): MapGroupSkeleton[] {
  const groups = new Map<string, GroupBuild>()

  /** The group a path lands in, creating it (and its parent) on the way. */
  const groupAt = (path: GroupPath, source: 'story' | 'scenario'): GroupBuild => {
    if (path.length === 0) {
      let ungrouped = groups.get(MAP_UNGROUPED)
      if (!ungrouped) {
        ungrouped = { id: MAP_UNGROUPED, components: new Map(), scenarios: [] }
        groups.set(MAP_UNGROUPED, ungrouped)
      }
      return ungrouped
    }
    let parentId: string | undefined
    let group: GroupBuild | undefined
    for (const segment of path) {
      const id = parentId ? `${parentId}/${segment.key}` : segment.key
      group = groups.get(id)
      if (!group) {
        group = { id, components: new Map(), scenarios: [], ...(parentId ? { parentId } : {}) }
        groups.set(id, group)
      }
      if (source === 'story') group.storyName ??= segment.name
      else group.scenarioName ??= readable(segment.name)
      parentId = id
    }
    return group as GroupBuild
  }

  for (const entry of input.stories) {
    if (entry.type !== 'story') continue
    const segments = entry.title.split('/')
    const component = (segments[segments.length - 1] ?? '').trim()
    const group = groupAt(foldPath(segments.slice(0, -1)), 'story')
    const importPath = normaliseStoryPath(entry.importPath)
    let skeleton = group.components.get(importPath)
    if (!skeleton) {
      skeleton = { importPath, name: component, states: [] }
      group.components.set(importPath, skeleton)
    }
    skeleton.states.push({ id: entry.id, name: entry.name })
  }

  for (const scenario of input.scenarios) {
    const folders = scenarioFolders(scenario.file)
    if (!folders) continue
    const group = groupAt(foldPath(folders), 'scenario')
    const base = scenario.file.slice(scenario.file.lastIndexOf('/') + 1)
    group.scenarios.push({ file: scenario.file, name: readable(stem(base)), hasCall: scenario.hasCall })
  }

  const finished = (g: GroupBuild): MapGroupSkeleton => ({
    id: g.id,
    name: g.id === MAP_UNGROUPED ? MAP_UNGROUPED_NAME : (g.storyName ?? g.scenarioName ?? g.id),
    ...(g.parentId ? { parentId: g.parentId } : {}),
    components: [...g.components.values()].sort(byName),
    scenarios: [...g.scenarios].sort((a, b) => byName(a, b) || (a.file < b.file ? -1 : 1)),
  })
  const all = [...groups.values()].filter((g) => g.id !== MAP_UNGROUPED).map(finished)
  const ordered: MapGroupSkeleton[] = []
  for (const top of all.filter((g) => !g.parentId).sort(byName)) {
    ordered.push(top, ...all.filter((g) => g.parentId === top.id).sort(byName))
  }
  const ungrouped = groups.get(MAP_UNGROUPED)
  if (ungrouped) ordered.push(finished(ungrouped))
  return ordered
}

// ---------------------------------------------------------------------------
// What main's catalogue depends on (decision 5)
// ---------------------------------------------------------------------------

const RUNCASTLE_DIR = '.runcastle/'

/**
 * Whether a diff touches the catalogue: any changed file it depends on, or
 * anything under `.runcastle/` outside the scenarios (the stories set-up lives
 * there). A docs-only commit never does — that is why this is not tree equality.
 */
export function touchesCatalogue(changed: string[], dependsOn: string[]): boolean {
  const depends = new Set(dependsOn.map(normaliseStoryPath))
  return changed.some((file) => {
    const p = normaliseStoryPath(file)
    return (
      depends.has(p) || (p.startsWith(RUNCASTLE_DIR) && !p.startsWith(`${SCENARIOS_DIR}/`))
    )
  })
}

/**
 * Every repo file a build read: the index's story files plus each module in
 * its import graph, normalised, `node_modules` dropped. Sorted, no repeats.
 */
export function catalogueDependsOn(index: StoryIndex, stats: PreviewStats): string[] {
  const files = new Set<string>()
  for (const entry of Object.values(index.entries)) files.add(normaliseStoryPath(entry.importPath))
  for (const mod of stats.modules) files.add(normaliseStoryPath(mod.name))
  return [...files].filter((p) => p !== '' && !isNodeModule(p)).sort()
}

/**
 * The files too widely shared to say anything about one story's history: those
 * reached by more than a quarter of all story files and by at least 3 of them,
 * and the hubs — files more than one story reaches that 3 or more modules
 * import directly, like a barrel. On a small catalogue a barrel reached by two
 * stories passes the quarter rule, yet re-exports the project's changelog. A
 * file a story imports directly is the component it shows, never a hub.
 * `reach` maps a repo file to the story files whose import set holds it;
 * `importers` maps it to the modules importing it directly. A story file is
 * never shared. History only — the catalogue's dependency set (staleness,
 * promotion) keeps the full graph, since a theme change does change every frame.
 */
export function sharedStoryFiles(
  reach: Map<string, Set<string>>,
  storyCount: number,
  importers: Map<string, Set<string>>,
): Set<string> {
  const isStory = (file: string): boolean => reach.get(file)?.has(file) ?? false
  const shared = new Set<string>()
  for (const [file, stories] of reach) {
    if (isStory(file)) continue
    const by = [...(importers.get(file) ?? [])]
    const wide = stories.size >= 3 && stories.size > storyCount / 4
    const hub = stories.size >= 2 && by.length >= 3 && !by.some(isStory)
    if (wide || hub) shared.add(file)
  }
  return shared
}

// ---------------------------------------------------------------------------
// Records and the model
// ---------------------------------------------------------------------------

/** One change to an entry on main's first-parent line, credited to a feature when merged. */
export const MapHistoryEntry = z.object({
  commit: z.string(),
  /** Commit time, ms. */
  at: z.number(),
  subject: z.string(),
  featureSlug: z.string().optional(),
  featureId: z.string().optional(),
  featureTitle: z.string().optional(),
})
export type MapHistoryEntry = z.infer<typeof MapHistoryEntry>

/** `main.json` beside main's current good catalogue. */
export const MainCatalogueRecord = z.object({
  projectId: z.string(),
  commit: z.string(),
  builtAt: z.number(),
  source: z.enum(['promoted', 'built']),
  /** The feature whose review build was promoted, for `source: 'promoted'`. */
  featureId: z.string().optional(),
  dependsOn: z.array(z.string()),
  /** Keyed by normalised importPath, newest first. */
  storyHistory: z.record(z.string(), z.array(MapHistoryEntry)),
})
export type MainCatalogueRecord = z.infer<typeof MainCatalogueRecord>

/** `attempt.json`: the latest build of main, in flight or failed. */
export const MainCatalogueAttempt = z.object({
  commit: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  status: z.enum(['building', 'failed', 'couldnt_run']),
  reason: z.string().optional(),
  /** File name inside the attempt dir, e.g. `build.log`. */
  log: z.string().optional(),
})
export type MainCatalogueAttempt = z.infer<typeof MainCatalogueAttempt>

export const MapComponent = z.object({
  importPath: z.string(),
  name: z.string(),
  history: z.array(MapHistoryEntry),
  states: z.array(z.object({ id: z.string(), name: z.string(), frameUrl: z.string() })),
})
export type MapComponent = z.infer<typeof MapComponent>

export const MapScenario = z.object({
  file: z.string(),
  name: z.string(),
  history: z.array(MapHistoryEntry),
  call: z.object({ file: z.string(), requestLine: z.string().optional() }).optional(),
})
export type MapScenario = z.infer<typeof MapScenario>

export const MapGroup = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().optional(),
  components: z.array(MapComponent),
  scenarios: z.array(MapScenario),
})
export type MapGroup = z.infer<typeof MapGroup>

export const MapCatalogueState = z.enum(['not_set_up', 'never_built', 'built'])
export type MapCatalogueState = z.infer<typeof MapCatalogueState>

/** What the map renders: one project's groups at main, and main's catalogue status. */
export const MapModel = z.object({
  storiesSetUp: z.boolean(),
  catalogue: z.object({
    state: MapCatalogueState,
    commit: z.string().optional(),
    builtAt: z.number().optional(),
    /** A file the catalogue depends on changed between its commit and main's tip. */
    stale: z.boolean(),
    building: z.boolean(),
    failure: z.object({ reason: z.string().optional(), log: z.string(), at: z.number() }).optional(),
  }),
  /** Flat, parent-before-children. */
  groups: z.array(MapGroup),
})
export type MapModel = z.infer<typeof MapModel>
