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
