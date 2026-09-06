export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

/**
 * Machine timestamps in agent-authored prose, rewritten for a human reader.
 *
 * Docs are written by agents, which stamp them the way a program does:
 * "Created: 2026-07-14T14:58:23.231Z". Nobody reads milliseconds, and the doc
 * peek was the surface where that showed (findings F10.9 / F18). Only whole
 * ISO-8601 instants are touched — a date on its own ("2026-07-14") is already
 * readable, and rewriting it would only move it across a timezone boundary.
 *
 * `format` is injected so the substitution is testable without depending on the
 * runner's locale or zone.
 */
const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/g

export function humanizeTimestamps(text: string, format: (ts: number) => string = fmtDateTime): string {
  return text.replace(ISO_INSTANT, (match) => {
    const ms = Date.parse(match)
    return Number.isNaN(ms) ? match : format(ms)
  })
}

/** Trim a prefixed id (`feat_x1y2...`) to a short, readable tail. */
export function shortId(id: string): string {
  const i = id.indexOf('_')
  const tail = i >= 0 ? id.slice(i + 1) : id
  return tail.length > 8 ? tail.slice(0, 8) : tail
}

/** Short git sha (first 7 chars). */
export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

/**
 * Decimal byte units, matching what the container engines print — a cache the
 * engine calls 2.4GB must not read as 2.2GB here just because we divided by
 * 1024. One decimal only below ten of a unit, so sizes stay glanceable.
 */
const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const

/** A byte count as a short human size: `0 B`, `940 MB`, `2.4 GB`, `12 GB`. */
export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const unit = Math.min(Math.floor(Math.log10(bytes) / 3), BYTE_UNITS.length - 1)
  const value = bytes / 1000 ** unit
  return `${value.toFixed(unit > 0 && value < 10 ? 1 : 0)} ${BYTE_UNITS[unit]}`
}

/** Compact relative time: `now`, `12s`, `4m`, `3h`, `2d`. */
export function relTime(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 5) return 'now'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

/**
 * {@link relTime} as a phrase that reads in a sentence: `just now`, `12s ago`,
 * `2h ago`. The bare unit needs the suffix wherever it stands in prose, and the
 * "now" case cannot take one — "now ago" is not English.
 */
export function relAgo(ts: number, now: number = Date.now()): string {
  const text = relTime(ts, now)
  return text === 'now' ? 'just now' : `${text} ago`
}

// A player position as a clock (`0:07`, `1:04:12`) is `fmtClock` in
// @runcastle/core — the promoted ticket's context paragraph renders the same
// walkthrough moment server-side, and the two copies had drifted.

/** Elapsed duration between two epochs as `1m 04s` / `12s` / `1h 03m`. */
export function fmtDuration(from: number, to: number): string {
  const total = Math.max(0, Math.floor((to - from) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}
