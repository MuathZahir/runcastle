import type { FeatureListItem } from '../api'
import type { ThreadEntry } from '../chat-thread'
import { triageOf, type TriageKey } from './sidebar'

/**
 * The sidebar as a list of epics (docs/features/orchestrator-chats-become-epics):
 * each orchestrator chat is an epic, and the features it cut sit under it. Pure
 * ordering and wording over wire data; the component is `SidebarEpics`.
 */

/**
 * Who runs a feature nested under its epic (decision 10): its own epic's chat,
 * the human, or a different chat (named).
 */
export type EpicHolder = { kind: 'epic' } | { kind: 'you' } | { kind: 'chat'; title: string }

/** A feature in the epic list, with who runs it. */
export interface EpicFeature {
  feature: FeatureListItem
  holder: EpicHolder
}

/** One epic: its chat, what the chat asks about, and the features it cut that are in motion or up next. */
export interface Epic {
  chat: ThreadEntry
  /**
   * The feature the chat asks the human about, while its state is `waiting`
   * (decision 2); null when the question is about no one feature.
   */
  asksAbout: string | null
  features: EpicFeature[]
}

/** One group of the list, in display order: an epic, or the features with no epic (decision 7). */
export type EpicGroup =
  | { kind: 'epic'; epic: Epic; yellow: boolean }
  | { kind: 'other'; features: FeatureListItem[]; yellow: boolean }

/** The lanes an epic nests, in the order it nests them (decision 8); the rest are the shelves' (decision 9). */
const EPIC_LANES: readonly TriageKey[] = ['needsYou', 'agentWorking', 'inProgress', 'upNext']

/** Whether a feature sits under its epic: in motion or up next. Parked, shipped and archived ones are on the shelves. */
export function inEpic(f: FeatureListItem): boolean {
  return EPIC_LANES.includes(triageOf(f))
}

/** A feature needs the human: its own row wears the amber dot. */
export function featureIsYellow(f: FeatureListItem): boolean {
  return triageOf(f) === 'needsYou'
}

/** Something in the epic is yellow: its chat asks, or one of its features needs you (decision 8). */
export function epicIsYellow(epic: Pick<Epic, 'chat' | 'features'>): boolean {
  return epic.chat.state === 'waiting' || epic.features.some((x) => featureIsYellow(x.feature))
}

/** Inside an epic: needs you first, then agent working, in progress, up next; ties keep their order. */
export function orderInEpic<T>(items: readonly T[], featureOf: (x: T) => FeatureListItem): T[] {
  const rank = (x: T) => {
    const i = EPIC_LANES.indexOf(triageOf(featureOf(x)))
    return i < 0 ? EPIC_LANES.length : i
  }
  return items
    .map((x, i) => ({ x, i }))
    .sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i)
    .map(({ x }) => x)
}

/**
 * The list's groups (decision 8): epics with something yellow first, then the
 * rest, each group newest started first; "Other features" ends the group it
 * sorts into (decision 7). Each epic's features come in their own order, only
 * those in motion or up next, and an empty Other features group is left out.
 */
export function orderEpicList(epics: readonly Epic[], other: readonly FeatureListItem[] = []): EpicGroup[] {
  const byNewest = [...epics].sort((a, b) => b.chat.createdAt - a.chat.createdAt)
  const groups: EpicGroup[] = byNewest.map((e) => ({
    kind: 'epic',
    epic: { ...e, features: orderInEpic(e.features.filter((x) => inEpic(x.feature)), (x) => x.feature) },
    yellow: epicIsYellow(e),
  }))
  const loose = orderInEpic(other.filter(inEpic), (f) => f)
  const looseYellow = loose.some(featureIsYellow)
  const yellow = groups.filter((g) => g.yellow)
  const rest = groups.filter((g) => !g.yellow)
  const otherGroup: EpicGroup[] = loose.length > 0 ? [{ kind: 'other', features: loose, yellow: looseYellow }] : []
  return looseYellow ? [...yellow, ...otherGroup, ...rest] : [...yellow, ...rest, ...otherGroup]
}

/** "With <chat> · " at the head of a feature's words. */
const WITH_PREFIX = /^With (.+?) · /

/** First letter up: "asking you" → "Asking you". */
const capital = (s: string) => (s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s)

/**
 * A nested feature row's words (decision 10). Run by its own epic's chat, the
 * "With <chat> ·" part goes ("Agent working"), and its chat's question reads
 * "Question above": the epic row holds the one yellow thing to click. Run by
 * the human, "Yours · …", or "Asking above · <first line>" while it consults
 * its epic's chat; run by a different chat, "With <that chat> · …".
 */
export function nestedFeatureWords(words: string, holder: EpicHolder, epic: string): string {
  const rest = words.replace(WITH_PREFIX, '')
  if (holder.kind === 'epic') return rest.toLowerCase() === 'asking you' ? 'Question above' : capital(rest)
  if (holder.kind === 'you') {
    const consulting = `Asking ${epic} · `
    return words.startsWith(consulting) ? `Asking above · ${words.slice(consulting.length)}` : `Yours · ${rest}`
  }
  return `With ${holder.title} · ${rest}`
}

/**
 * A shelf row's words (decision 21): its epic's name in the quiet line. A
 * shipped or archived row's state is its shelf's name, so the epic stands
 * alone; a backlog row keeps what it says about starting.
 */
export function shelfFeatureWords(f: FeatureListItem, words: string, epic: string | null): string {
  if (!epic) return words
  if (f.status === 'shipped' || f.status === 'archived') return epic
  return `${epic} · ${words}`
}
