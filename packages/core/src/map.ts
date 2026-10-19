import { z } from 'zod'
import {
  isNodeModule,
  isPageStory,
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

export interface MapStateSkeleton {
  id: string
  /** The story's name, with any title segments below the place prefixed (`Drive · Waiting`). */
  name: string
  /** The leading number of the story's name (`3 Coding agents` → 3), when it has one. */
  step: number | null
}

export interface MapPageSkeleton {
  /** The story file, normalised (repo-relative, no `./`). */
  importPath: string
  /** The file's states: by step, then index order. */
  states: MapStateSkeleton[]
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
  pages: MapPageSkeleton[]
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
  pages: Map<string, { importPath: string; states: (MapStateSkeleton & { variant: boolean })[] }>
  scenarios: MapScenarioSkeleton[]
}

const STEP = /^(\d+)\s+/
const VARIANT_SEPARATOR = ' · '

/** Order places by story file path, comparing digit runs as numbers (`2-x` before `10-x`). */
const byPath = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true })

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

/** Numbered states first by step, a step's variants after its plain state; else index order. */
const byStep = (
  a: { step: number | null; variant: boolean },
  b: { step: number | null; variant: boolean },
): number => {
  if (a.step === null || b.step === null) return (a.step === null ? 1 : 0) - (b.step === null ? 1 : 0)
  return a.step - b.step || Number(a.variant) - Number(b.variant)
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/**
 * The map's groups from page stories and scenario paths, flat and ordered
 * parent-before-children. Only page stories count ({@link isPageStory}); a page
 * story's group is its whole title folded to two levels, and deeper segments
 * prefix the state's name. Groups with pages come first, by their story files'
 * paths (numerically) with children after their parent; scenario-only groups
 * follow alphabetically, Ungrouped last. Names that do not match under
 * {@link mapNameKey} stay two groups — the map never guesses a merge. A
 * second-level group implies its parent, entries or not.
 */
export function groupMap(input: GroupMapInput): MapGroupSkeleton[] {
  const groups = new Map<string, GroupBuild>()

  /** The group a path lands in, creating it (and its parent) on the way. */
  const groupAt = (path: GroupPath, source: 'story' | 'scenario'): GroupBuild => {
    if (path.length === 0) {
      let ungrouped = groups.get(MAP_UNGROUPED)
      if (!ungrouped) {
        ungrouped = { id: MAP_UNGROUPED, pages: new Map(), scenarios: [] }
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
        group = { id, pages: new Map(), scenarios: [], ...(parentId ? { parentId } : {}) }
        groups.set(id, group)
      }
      if (source === 'story') group.storyName ??= segment.name
      else group.scenarioName ??= readable(segment.name)
      parentId = id
    }
    return group as GroupBuild
  }

  for (const entry of input.stories) {
    if (entry.type !== 'story' || !isPageStory(entry.importPath)) continue
    const segments = entry.title.split('/')
    const path = foldPath(segments)
    const group = groupAt(path, 'story')
    const below = segments.slice(MAX_LEVELS).map((s) => s.trim()).filter((s) => s !== '')
    const importPath = normaliseStoryPath(entry.importPath)
    let page = group.pages.get(importPath)
    if (!page) {
      page = { importPath, states: [] }
      group.pages.set(importPath, page)
    }
    const step = STEP.exec(entry.name)?.[1]
    page.states.push({
      id: entry.id,
      name: [...below, entry.name].join(VARIANT_SEPARATOR),
      step: step === undefined ? null : Number(step),
      variant: entry.name.includes(VARIANT_SEPARATOR),
    })
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
    pages: [...g.pages.values()]
      .sort((a, b) => byPath(a.importPath, b.importPath))
      .map((p) => ({
        importPath: p.importPath,
        states: [...p.states].sort(byStep).map(({ id, name, step }) => ({ id, name, step })),
      })),
    scenarios: [...g.scenarios].sort((a, b) => byName(a, b) || (a.file < b.file ? -1 : 1)),
  })
  const all = [...groups.values()].filter((g) => g.id !== MAP_UNGROUPED).map(finished)
  // A group's place in the app: its smallest story file path, own or a child's.
  const placeOf = new Map<string, string>()
  for (const g of all) {
    for (const page of g.pages) {
      for (const id of [g.id, g.parentId]) {
        if (id === undefined) continue
        const known = placeOf.get(id)
        if (known === undefined || byPath(page.importPath, known) < 0) placeOf.set(id, page.importPath)
      }
    }
  }
  /** Groups with a place first, by path; the rest alphabetically. */
  const byPlace = (a: MapGroupSkeleton, b: MapGroupSkeleton): number => {
    const pa = placeOf.get(a.id)
    const pb = placeOf.get(b.id)
    if (pa !== undefined && pb !== undefined) return byPath(pa, pb) || byName(a, b)
    if (pa !== undefined) return -1
    if (pb !== undefined) return 1
    return byName(a, b)
  }
  const ordered: MapGroupSkeleton[] = []
  for (const top of all.filter((g) => !g.parentId).sort(byPlace)) {
    ordered.push(top, ...all.filter((g) => g.parentId === top.id).sort(byPlace))
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

export const MapState = z.object({
  id: z.string(),
  name: z.string(),
  /** The leading number of the story's name, ordering a flow; null when unnumbered. */
  step: z.number().nullable(),
  frameUrl: z.string(),
})
export type MapState = z.infer<typeof MapState>

/** One page story file: its history covers the story file alone. */
export const MapPage = z.object({
  importPath: z.string(),
  history: z.array(MapHistoryEntry),
  states: z.array(MapState),
})
export type MapPage = z.infer<typeof MapPage>

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
  pages: z.array(MapPage),
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
