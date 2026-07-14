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
