import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type ClassifiedStory, StoriesManifest } from '@runcastle/core'
import { STORIES_MANIFEST, featureStoriesDir } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'

/**
 * The feature page's "UI states" section model (decision 12): the feature's
 * stories manifest, with frame URLs on the stories port built here from config
 * so the browser never hardcodes it. Read-only — no event of its own; the
 * review pass that writes the manifest emits.
 */

/** A feature id as `newId('feat')` mints it; anything else never reaches the data dir. */
export const FEATURE_ID_PATTERN = /^feat_[A-Za-z0-9_-]+$/

/** How much of a failed build's log the section shows: its tail. */
export const UI_STATES_LOG_LINES = 200

export interface UiStatesStory {
  id: string
  title: string
  name: string
  /** This feature's build of the story, framed alone. */
  frameUrl: string
  /** The branch point's build of the same story; only for a changed story whose base built. */
  baseFrameUrl: string | null
}

export interface UiStatesModel {
  status: StoriesManifest['status']
  reason: string | null
  /** The build log's last {@link UI_STATES_LOG_LINES} lines, for `failed` and `couldnt_run`. */
  log: string | null
  commit: string
  baseCommit: string | null
  base: StoriesManifest['base']
  lap: number
  builtAt: number
  changed: UiStatesStory[]
  new: UiStatesStory[]
  affected: UiStatesStory[]
}

function readManifest(featureId: string): StoriesManifest | null {
  if (!FEATURE_ID_PATTERN.test(featureId)) return null
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(featureStoriesDir(featureId), STORIES_MANIFEST), 'utf8'),
    )
    const parsed = StoriesManifest.safeParse(raw)
    return parsed.success && parsed.data.featureId === featureId ? parsed.data : null
  } catch {
    return null
  }
}

function readLogTail(featureId: string, file: string | undefined): string | null {
  if (!file || file.includes('/') || file.includes('\\')) return null
  try {
    const lines = readFileSync(join(featureStoriesDir(featureId), file), 'utf8')
      .replace(/\s+$/, '')
      .split(/\r?\n/)
    return lines.slice(-UI_STATES_LOG_LINES).join('\n')
  } catch {
    return null
  }
}

/** A feature's section model, or null when it has no readable manifest. */
export function uiStates(ctx: AppCtx, featureId: string): UiStatesModel | null {
  const manifest = readManifest(featureId)
  if (!manifest) return null
  const origin = `http://localhost:${ctx.config.storiesPort}`
  const frame = (dir: string, storyId: string): string =>
    `${origin}/${dir}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`
  const baseDir =
    manifest.base === 'built' && manifest.baseCommit ? `base/${manifest.baseCommit}` : null
  const toStory = (s: ClassifiedStory): UiStatesStory => ({
    id: s.id,
    title: s.title,
    name: s.name,
    frameUrl: frame(`features/${featureId}`, s.id),
    baseFrameUrl: s.kind === 'changed' && baseDir ? frame(baseDir, s.id) : null,
  })
  const ofKind = (kind: ClassifiedStory['kind']): UiStatesStory[] =>
    manifest.stories.filter((s) => s.kind === kind).map(toStory)
  const showsLog = manifest.status === 'failed' || manifest.status === 'couldnt_run'
  return {
    status: manifest.status,
    reason: manifest.reason ?? null,
    log: showsLog ? readLogTail(featureId, manifest.log) : null,
    commit: manifest.commit,
    baseCommit: manifest.baseCommit,
    base: manifest.base,
    lap: manifest.lap,
    builtAt: manifest.builtAt,
    changed: ofKind('changed'),
    new: ofKind('new'),
    affected: ofKind('affected'),
  }
}
