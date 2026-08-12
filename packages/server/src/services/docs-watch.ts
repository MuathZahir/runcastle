import { type FSWatcher, watch } from 'node:fs'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { emit } from './events'
import { featureDocsDir } from './feature-docs'
import { projectForFeature } from './repo'

/**
 * Watches a feature's `docs/features/<slug>/` directory while a session is
 * working in it, and turns every write into a `docs.changed` event.
 *
 * Doc writes were the event system's largest deaf spot: the talk agent would
 * write `spec.md` and nothing entered the pipe, so the document query — which
 * has no poll interval of its own — only refreshed on remount. Watching the
 * directory catches EVERY writer (the agent, a human hand-edit, a git checkout
 * at a phase boundary) rather than just the ones that route through a service.
 *
 * The event goes through the ordinary choke point (`events.emit`), so it
 * publishes on the live bus and reaches browsers over SSE like anything else —
 * where the client's invalidation allowlist already covers `docs.read`.
 *
 * Nothing here may ever break a session: a missing directory, a watcher error,
 * a feature deleted out from under an armed timer are all logged and swallowed
 * (the same posture as `hook-client`). A stale doc is a far smaller failure
 * than a dead terminal.
 */

/**
 * Trailing debounce window. Agents write docs in bursts and editors fire
 * several fs events per save, so one save must cost one event, not five.
 */
export const DOCS_WATCH_DEBOUNCE_MS = 300

interface DocsWatch {
  watcher: FSWatcher
  /** The armed trailing-debounce timer, if a change is pending. */
  timer: ReturnType<typeof setTimeout> | undefined
  /** Filenames seen since the last flush — named in the event's message. */
  changed: Set<string>
}

/**
 * Keyed by feature id: the watcher belongs to the docs directory, and the
 * one-live-session guard means a feature has at most one session working in it.
 * Re-registering is therefore a no-op rather than a second watcher on the same
 * directory (which would double every event).
 */
const watches = new Map<string, DocsWatch>()

/**
 * Begin watching a feature's docs directory. Idempotent — a second start for
 * the same feature keeps the existing watcher.
 */
export function startDocsWatch(ctx: AppCtx, feature: Feature): void {
  if (watches.has(feature.id)) return
  try {
    const dir = featureDocsDir(projectForFeature(ctx, feature), feature)
    // The docs dir is flat (brief/decisions/spec/map.md), so a single
    // non-recursive watch covers it — no dependency, no subtree walk.
    const watcher = watch(dir, { persistent: false }, (_event, filename) => {
      noteDocsChange(ctx, feature.id, typeof filename === 'string' ? filename : null)
    })
    watcher.on('error', (err) => {
      console.error(`docs watcher failed for feature ${feature.id}`, err)
      stopDocsWatch(feature.id)
    })
    watches.set(feature.id, { watcher, timer: undefined, changed: new Set() })
  } catch (err) {
    // Most often the directory does not exist yet (a worktree checked out
    // before its docs landed). Not watching is the correct degradation.
    console.error(`docs watcher could not start for feature ${feature.id}`, err)
  }
}

/**
 * Stop watching a feature's docs and release the OS handle. Closing matters
 * beyond tidiness: Windows holds a lock on a watched directory, which would
 * block the worktree removal that follows a merge.
 */
export function stopDocsWatch(featureId: string): void {
  const entry = watches.get(featureId)
  if (!entry) return
  watches.delete(featureId)
  // A pending flush is dropped with the watcher: the session it belonged to is
  // gone, so nothing should still be emitting on its behalf.
  if (entry.timer) clearTimeout(entry.timer)
  try {
    entry.watcher.close()
  } catch (err) {
    console.error(`docs watcher failed to close for feature ${featureId}`, err)
  }
}

/** Release every watcher — server shutdown, and test isolation. */
export function stopAllDocsWatch(): void {
  for (const featureId of [...watches.keys()]) stopDocsWatch(featureId)
}

/** Number of live watchers — for tests and the health endpoint. */
export function docsWatchCount(): number {
  return watches.size
}

/** Record a filesystem change and (re)arm the trailing debounce. */
function noteDocsChange(ctx: AppCtx, featureId: string, filename: string | null): void {
  const entry = watches.get(featureId)
  if (!entry) return
  // Editors and agents leave swap/temp files beside the docs; only the docs
  // themselves are worth waking the UI for. A platform that reports no
  // filename at all still counts — it just cannot be named.
  if (filename !== null && !filename.endsWith('.md')) return
  if (filename) entry.changed.add(filename)
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => emitDocsChanged(ctx, featureId), DOCS_WATCH_DEBOUNCE_MS)
}

function emitDocsChanged(ctx: AppCtx, featureId: string): void {
  const entry = watches.get(featureId)
  if (!entry) return
  entry.timer = undefined
  const files = [...entry.changed].sort()
  entry.changed.clear()
  try {
    emit(ctx, featureId, {
      type: 'docs.changed',
      message: files.length > 0 ? `docs changed: ${files.join(', ')}` : 'docs changed',
      data: { files },
    })
  } catch (err) {
    // The feature was deleted (or its db closed) while the timer was armed.
    // This runs on a bare timer callback, where a throw is an unhandled
    // rejection that takes the server with it.
    console.error(`docs watcher failed to emit for feature ${featureId}`, err)
  }
}
