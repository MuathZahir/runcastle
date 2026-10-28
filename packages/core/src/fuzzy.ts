/**
 * The composer's `@` and `/` ranking (chat-as-web-components ticket 17): a
 * small fuzzy finder. A candidate matches when every character of the query
 * appears in it in order, case-insensitive; matches rank by how they match —
 * a prefix, then a match at a word's start, then anywhere in one run, then
 * scattered (consecutive and word-start characters first) — and, at equal
 * rank, the shorter candidate first.
 */

/** How far apart the match tiers are: a tier's bonuses never reach the next one. */
const TIER = 1000
const MAX_BONUS = TIER / 2 - 1

/** A word starts at the text's start, after a separator, or at a camelCase hump. */
function wordStart(text: string, i: number): boolean {
  if (i === 0) return true
  const prev = text[i - 1]
  if (/[\s/\\._\-:@]/.test(prev)) return true
  return /[a-z0-9]/.test(prev) && /[A-Z]/.test(text[i])
}

/** How well `query` matches `text`, higher better; null when it does not match. An empty query matches everything equally. */
export function fuzzyScore(text: string, query: string): number | null {
  const q = query.toLowerCase()
  if (!q) return 0
  const t = text.toLowerCase()
  if (t.startsWith(q)) return 4 * TIER
  for (let at = t.indexOf(q); at >= 0; at = t.indexOf(q, at + 1)) {
    if (wordStart(text, at)) return 3 * TIER
  }
  if (t.includes(q)) return 2 * TIER
  const bonus = scatteredBonus(text, t, q)
  return bonus === null ? null : TIER + Math.min(bonus, MAX_BONUS)
}

/**
 * The best placement of `q`'s letters in `t`, in order: 10 for each letter at a
 * word's start and 10 for each that follows the one before. `best[j]` is the
 * best bonus with the current letter at `j`; null when the letters are not all there.
 */
function scatteredBonus(text: string, t: string, q: string): number | null {
  const NONE = -1
  let best: number[] = []
  for (let i = 0; i < q.length; i++) {
    const next = new Array<number>(t.length).fill(NONE)
    let before = i === 0 ? 0 : NONE
    for (let j = 0; j < t.length; j++) {
      if (t[j] === q[i]) {
        const own = wordStart(text, j) ? 10 : 0
        const run = i > 0 && j > 0 && best[j - 1] !== NONE ? best[j - 1] + 10 : NONE
        const from = Math.max(before, run)
        if (from !== NONE) next[j] = from + own
      }
      if (i > 0 && best[j] !== NONE) before = Math.max(before, best[j])
    }
    best = next
  }
  const top = Math.max(NONE, ...best)
  return top === NONE ? null : top
}

/** `items` matching `query`, best first, at most `limit`; `score` rates one item (null: no match). */
export function rankBy<T>(items: readonly T[], score: (item: T) => number | null, label: (item: T) => string, limit = Infinity): T[] {
  return items
    .flatMap((item) => {
      const s = score(item)
      return s === null ? [] : [{ item, s, l: label(item) }]
    })
    .sort((a, b) => b.s - a.s || a.l.length - b.l.length || a.l.localeCompare(b.l))
    .slice(0, limit)
    .map((r) => r.item)
}

/** A path's score: its file name's match counts for more than the same match elsewhere in the path. */
export function pathScore(path: string, query: string): number | null {
  const whole = fuzzyScore(path, query)
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const own = fuzzyScore(name, query)
  if (own === null) return whole
  return Math.max(whole ?? 0, own + TIER / 2)
}

/** The paths matching `query` for `@`, best first. */
export function rankPaths(paths: readonly string[], query: string, limit = Infinity): string[] {
  return rankBy(paths, (p) => pathScore(p, query), (p) => p, limit)
}

/** The names matching `query` for `/`: prefix matches first, then word starts, then fuzzy. */
export function rankNames<T>(items: readonly T[], name: (item: T) => string, query: string, limit = Infinity): T[] {
  return rankBy(items, (item) => fuzzyScore(name(item), query), name, limit)
}
