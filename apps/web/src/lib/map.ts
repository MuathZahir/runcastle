import type { MapGroup, MapHistoryEntry, MapModel, MapState } from '@runcastle/core'

/**
 * The map's words (the-map-of-stories-and-scenarios): a group's tally, a
 * history entry's credit and date, and which of the overview's empty
 * situations a model is in. Pure, so the pages only lay them out.
 */

const count = (n: number, one: string, many: string): string | null =>
  n === 0 ? null : `${n} ${n === 1 ? one : many}`

/** `6 states · 2 ways in · 1 call` — only the parts a place has. States count every page's states. */
export function mapTally(group: MapGroup): string {
  const states = group.pages.reduce((n, p) => n + p.states.length, 0)
  const calls = group.scenarios.filter((s) => s.call).length
  return [
    count(states, 'state', 'states'),
    count(group.scenarios.length, 'way in', 'ways in'),
    count(calls, 'call', 'calls'),
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

/** One step of a page's flow: a numbered state and its variants, or one unnumbered state. */
export interface MapStep {
  step: number | null
  states: MapState[]
}

/**
 * A page's states as steps, in their order: states that share a step number
 * are one step and its variants (decision 4); each unnumbered state stands alone.
 */
export function mapSteps(states: MapState[]): MapStep[] {
  const steps: MapStep[] = []
  for (const state of states) {
    const last = steps.at(-1)
    if (last && state.step !== null && last.step === state.step) last.states.push(state)
    else steps.push({ step: state.step, states: [state] })
  }
  return steps
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
 * What a history line says an entry's change was (the map shows every page and
 * its states, decision 8): a component or scenario's change, or — for a page
 * story, whose history covers its story file alone — its stories' update.
 * A page never reads "Changed by".
 */
export type HistoryKind = 'change' | 'stories'

export function historyWords(kind: HistoryKind): { by: string; onMain: string } {
  return kind === 'stories'
    ? { by: 'Stories updated by', onMain: 'Stories updated on main' }
    : { by: 'Changed by', onMain: 'Changed on main' }
}

/**
 * What is missing from the map (decision 7), each said once beside its groups:
 * - `neither`: no groups and no stories set up — one empty state with both doors, alone;
 * - `no-stories`: scenarios but no stories set up;
 * - `no-pages`: stories set up and main's catalogue built, but no page stories in it;
 * - `no-scenarios`: stories set up but no ways in.
 */
export type MapGap = 'neither' | 'no-stories' | 'no-pages' | 'no-scenarios'

export function mapGaps(model: MapModel): MapGap[] {
  if (!model.storiesSetUp) return [model.groups.length === 0 ? 'neither' : 'no-stories']
  const gaps: MapGap[] = []
  if (model.catalogue.state === 'built' && model.groups.every((g) => g.pages.length === 0)) gaps.push('no-pages')
  if (!model.groups.some((g) => g.scenarios.length > 0)) gaps.push('no-scenarios')
  return gaps
}
