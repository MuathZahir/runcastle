import type { MapGroup, MapHistoryEntry, MapModel } from '@runcastle/core'

/**
 * The map's words (the-map-of-stories-and-scenarios): a group's tally, a
 * history entry's credit and date, and which of the overview's empty
 * situations a model is in. Pure, so the pages only lay them out.
 */

const count = (n: number, one: string, many: string): string | null =>
  n === 0 ? null : `${n} ${n === 1 ? one : many}`

/** `4 UI states · 2 ways in · 1 call` — only the parts a group has. UI states count every state. */
export function mapTally(group: MapGroup): string {
  const states = group.pages.reduce((n, p) => n + p.states.length, 0)
  const calls = group.scenarios.filter((s) => s.call).length
  return [
    count(states, 'UI state', 'UI states'),
    count(group.scenarios.length, 'way in', 'ways in'),
    count(calls, 'call', 'calls'),
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

/** A history entry's day, as `Oct 12`. */
export function historyDay(at: number): string {
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const SUBJECT_START = 40

/** The start of a direct commit's subject, cut at a word near {@link SUBJECT_START} characters. */
export function subjectStart(subject: string): string {
  const s = subject.trim()
  if (s.length <= SUBJECT_START) return s
  const cut = s.slice(0, SUBJECT_START)
  const space = cut.lastIndexOf(' ')
  return `${(space > SUBJECT_START / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Who an entry credits: a feature by title (or its slug, when unknown), else main. */
export type HistoryCredit =
  | { kind: 'feature'; title: string; featureId?: string }
  | { kind: 'main'; subject: string }

export function historyCredit(entry: MapHistoryEntry): HistoryCredit {
  const title = entry.featureTitle ?? entry.featureSlug
  if (title) return { kind: 'feature', title, ...(entry.featureId ? { featureId: entry.featureId } : {}) }
  return { kind: 'main', subject: subjectStart(entry.subject) }
}

/**
 * Which empty situation the overview is in (decision 7), beside its groups:
 * - `neither`: no groups and no stories set up — one empty state with both doors;
 * - `no-stories`: scenarios but no stories set up;
 * - `no-scenarios`: stories set up but no ways in;
 * - `none`: nothing missing.
 */
export type MapGap = 'neither' | 'no-stories' | 'no-scenarios' | 'none'

export function mapGap(model: MapModel): MapGap {
  if (!model.storiesSetUp) return model.groups.length === 0 ? 'neither' : 'no-stories'
  return model.groups.some((g) => g.scenarios.length > 0) ? 'none' : 'no-scenarios'
}
