import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  groupMap,
  MAP_UNGROUPED,
  MainCatalogueAttempt,
  MainCatalogueRecord,
  PROJECT_ID_PATTERN,
  STORIES_CONFIG_REL,
  StoryIndex,
  touchesCatalogue,
  type MapGroup,
  type MapHistoryEntry,
  type MapModel,
} from '@runcastle/core'
import {
  MAIN_CATALOGUE_ATTEMPT,
  MAIN_CATALOGUE_RECORD,
  mainStoriesAttemptDir,
  mainStoriesDir,
} from '@runcastle/core/paths'
import { and, eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import type { AppCtx } from '../db/types'
import { features } from '../db/schema'
import { detectMainBranch, fileExistsAt } from './git'
import { parseHttpRequest } from './http-request'
import { requireProjectById } from './repo'
import { callFileOf, listScenarios } from './scenarios'
import { UI_STATES_LOG_LINES } from './ui-states'

/**
 * The map of stories and scenarios (decisions 3–6): one project's product
 * groups at main's tip, each with its UI states from main's catalogue, its
 * scenarios and calls, and a history line per entry. Read-only — no event of
 * its own; the builds and merges that change what it reads emit. History is
 * computed once per main commit and cached here, never walked per open.
 */

/** `git log` format for one history line: sha, commit time (s) and subject. */
export const MAP_HISTORY_FORMAT = '%H%x1f%ct%x1f%s'

/** git's default `--no-ff` merge subject, as git.ts `mergeFeature` leaves it. */
const FEATURE_MERGE = /^Merge branch 'feature\/([^']+)'/

/**
 * One {@link MAP_HISTORY_FORMAT} line as an uncredited history entry, with the
 * merged feature's slug when it is a feature merge; null for a malformed line.
 */
export function parseMapHistoryLine(line: string): MapHistoryEntry | null {
  const [commit, seconds, ...rest] = line.split('\x1f')
  const at = Number(seconds) * 1000
  if (!commit || !Number.isFinite(at)) return null
  const subject = rest.join('\x1f')
  const slug = FEATURE_MERGE.exec(subject)?.[1]
  return { commit, at, subject, ...(slug ? { featureSlug: slug } : {}) }
}

/**
 * Name each feature-merge entry's feature by its title, looked up by slug in
 * the project. An unknown slug keeps the slug alone.
 */
export function creditMapHistory(
  ctx: AppCtx,
  projectId: string,
  entries: MapHistoryEntry[],
): MapHistoryEntry[] {
  const known = new Map<string, { id: string; title: string } | null>()
  const lookup = (slug: string) => {
    if (!known.has(slug)) {
      const row = ctx.db
        .select({ id: features.id, title: features.title })
        .from(features)
        .where(and(eq(features.projectId, projectId), eq(features.slug, slug)))
        .get()
      known.set(slug, row ?? null)
    }
    return known.get(slug) ?? null
  }
  return entries.map((entry) => {
    const feature = entry.featureSlug ? lookup(entry.featureSlug) : null
    return feature ? { ...entry, featureId: feature.id, featureTitle: feature.title } : entry
  })
}

/** Main's first-parent changes to `files` up to `tip`, newest first, uncredited. */
export async function mapHistoryOf(
  repoPath: string,
  tip: string,
  files: string[],
): Promise<MapHistoryEntry[]> {
  try {
    const out = await simpleGit(repoPath).raw([
      'log', '--first-parent', `--format=${MAP_HISTORY_FORMAT}`, tip, '--', ...files,
    ])
    return out
      .split(/\r?\n/)
      .filter((l) => l !== '')
      .map(parseMapHistoryLine)
      .filter((e): e is MapHistoryEntry => e !== null)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Main's catalogue, as stored
// ---------------------------------------------------------------------------

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

interface StoredCatalogue {
  record: MainCatalogueRecord | null
  index: StoryIndex | null
  attempt: MainCatalogueAttempt | null
}

function readCatalogue(projectId: string): StoredCatalogue {
  if (!PROJECT_ID_PATTERN.test(projectId)) return { record: null, index: null, attempt: null }
  const dir = mainStoriesDir(projectId)
  const record = MainCatalogueRecord.safeParse(readJson(join(dir, MAIN_CATALOGUE_RECORD)))
  const index = StoryIndex.safeParse(readJson(join(dir, 'index.json')))
  const attempt = MainCatalogueAttempt.safeParse(
    readJson(join(mainStoriesAttemptDir(projectId), MAIN_CATALOGUE_ATTEMPT)),
  )
  return {
    record: record.success && record.data.projectId === projectId ? record.data : null,
    index: index.success ? index.data : null,
    attempt: attempt.success ? attempt.data : null,
  }
}

/** The attempt log's last {@link UI_STATES_LOG_LINES} lines, or '' when unreadable. */
function attemptLogTail(projectId: string, file: string | undefined): string {
  if (!file || file.includes('/') || file.includes('\\')) return ''
  try {
    const lines = readFileSync(join(mainStoriesAttemptDir(projectId), file), 'utf8')
      .replace(/\s+$/, '')
      .split(/\r?\n/)
    return lines.slice(-UI_STATES_LOG_LINES).join('\n')
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Caches, by main's tip
// ---------------------------------------------------------------------------

// Each holds one project's latest answer only: a new tip replaces the last.

/** "Main has moved since", per project, for (tip, catalogue commit). */
const staleCache = new Map<string, { key: string; stale: boolean }>()

interface ScenarioFacts {
  history: MapHistoryEntry[]
  requestLine?: string
}

/** Scenario history and call request lines, per project, for its tip. */
const scenarioCache = new Map<string, { tip: string; facts: Map<string, ScenarioFacts> }>()

async function isStale(
  repoPath: string,
  projectId: string,
  tip: string,
  record: MainCatalogueRecord,
): Promise<boolean> {
  const key = `${tip}\0${record.commit}`
  const cached = staleCache.get(projectId)
  if (cached?.key === key) return cached.stale
  let stale: boolean
  try {
    const out = await simpleGit(repoPath).raw(['diff', '--name-only', record.commit, tip])
    stale = touchesCatalogue(out.split(/\r?\n/).filter((l) => l !== ''), record.dependsOn)
  } catch {
    // The catalogue's commit is gone from the repo: nothing says it still matches.
    stale = true
  }
  staleCache.set(projectId, { key, stale })
  return stale
}

/** `METHOD target` of a call file at `tip`, or undefined when it does not parse. */
async function requestLineAt(repoPath: string, tip: string, file: string): Promise<string | undefined> {
  try {
    const parsed = parseHttpRequest(await simpleGit(repoPath).show([`${tip}:${file}`]))
    return parsed.ok ? `${parsed.request.method} ${parsed.request.target}` : undefined
  } catch {
    return undefined
  }
}

async function scenarioFacts(
  repoPath: string,
  projectId: string,
  tip: string,
  scenarios: { file: string; hasCall: boolean }[],
): Promise<Map<string, ScenarioFacts>> {
  const cached = scenarioCache.get(projectId)
  if (cached?.tip === tip) return cached.facts
  const facts = new Map<string, ScenarioFacts>()
  for (const s of scenarios) {
    const callFile = callFileOf(s.file)
    const history = await mapHistoryOf(repoPath, tip, s.hasCall ? [s.file, callFile] : [s.file])
    const requestLine = s.hasCall ? await requestLineAt(repoPath, tip, callFile) : undefined
    facts.set(s.file, { history, ...(requestLine !== undefined ? { requestLine } : {}) })
  }
  scenarioCache.set(projectId, { tip, facts })
  return facts
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

const EMPTY_MODEL: MapModel = {
  storiesSetUp: false,
  catalogue: { state: 'not_set_up', stale: false, building: false },
  groups: [],
}

/** One project's map at main's tip (spec, "Server and web shape"). */
export async function mapModel(ctx: AppCtx, projectId: string): Promise<MapModel> {
  const repo = requireProjectById(ctx, projectId).repoPath
  const main = await detectMainBranch(repo)
  let tip: string
  try {
    tip = (await simpleGit(repo).revparse([`${main}^{commit}`])).trim()
  } catch {
    return EMPTY_MODEL // an unborn main has nothing to map
  }

  const storiesSetUp = await fileExistsAt(repo, tip, STORIES_CONFIG_REL)
  const scenarios = await listScenarios(repo, { ref: tip })
  const stored = readCatalogue(projectId)
  const built = storiesSetUp && stored.record !== null && stored.index !== null
  const record = built ? stored.record : null
  const attempt = storiesSetUp ? stored.attempt : null

  const failed = attempt && (attempt.status === 'failed' || attempt.status === 'couldnt_run')
  const catalogue: MapModel['catalogue'] = {
    state: !storiesSetUp ? 'not_set_up' : built ? 'built' : 'never_built',
    ...(record ? { commit: record.commit, builtAt: record.builtAt } : {}),
    stale: record ? await isStale(repo, projectId, tip, record) : false,
    building: attempt?.status === 'building',
    ...(failed
      ? {
          failure: {
            ...(attempt.reason !== undefined ? { reason: attempt.reason } : {}),
            log: attemptLogTail(projectId, attempt.log),
            at: attempt.finishedAt ?? attempt.startedAt,
          },
        }
      : {}),
  }

  const facts = await scenarioFacts(repo, projectId, tip, scenarios)
  const origin = `http://localhost:${ctx.config.storiesPort}`
  const frame = (storyId: string): string =>
    `${origin}/main/${projectId}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`

  const skeletons = groupMap({
    stories: built && stored.index ? Object.values(stored.index.entries) : [],
    scenarios,
  })
  const groups: MapGroup[] = skeletons.map((g) => ({
    id: g.id,
    name: g.name,
    ...(g.parentId ? { parentId: g.parentId } : {}),
    components: g.components.map((c) => ({
      importPath: c.importPath,
      name: c.name,
      history: creditMapHistory(ctx, projectId, record?.storyHistory[c.importPath] ?? []),
      states: c.states.map((s) => ({ ...s, frameUrl: frame(s.id) })),
    })),
    scenarios: g.scenarios.map((s) => {
      const fact = facts.get(s.file)
      return {
        file: s.file,
        name: s.name,
        history: creditMapHistory(ctx, projectId, fact?.history ?? []),
        ...(s.hasCall
          ? {
              call: {
                file: callFileOf(s.file),
                ...(fact?.requestLine !== undefined ? { requestLine: fact.requestLine } : {}),
              },
            }
          : {}),
      }
    }),
  }))

  return { storiesSetUp, catalogue, groups }
}

/**
 * The display names of main's product groups in map order, for a planner or a
 * scenario session to name a new story or scenario after (decision 4). Level two
 * reads `Parent › Child`; Ungrouped is left out. Cheaper than {@link mapModel}:
 * it reads main's stored story index and main's scenario paths, computes no
 * history, and never builds.
 */
export async function mapGroupNames(ctx: AppCtx, projectId: string): Promise<string[]> {
  const repo = requireProjectById(ctx, projectId).repoPath
  const main = await detectMainBranch(repo)
  let tip: string
  try {
    tip = (await simpleGit(repo).revparse([`${main}^{commit}`])).trim()
  } catch {
    return []
  }
  const storiesSetUp = await fileExistsAt(repo, tip, STORIES_CONFIG_REL)
  const stored = readCatalogue(projectId)
  const built = storiesSetUp && stored.record !== null && stored.index !== null
  const skeletons = groupMap({
    stories: built && stored.index ? Object.values(stored.index.entries) : [],
    scenarios: await listScenarios(repo, { ref: tip }),
  })
  const names = new Map(skeletons.map((g) => [g.id, g.name]))
  return skeletons
    .filter((g) => g.id !== MAP_UNGROUPED)
    .map((g) => (g.parentId ? `${names.get(g.parentId) ?? ''} › ${g.name}` : g.name))
}
