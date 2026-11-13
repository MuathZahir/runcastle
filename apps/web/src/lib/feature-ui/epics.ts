import type { FeatureListItem } from '../api'
import type { ThreadEntry } from '../chat-thread'
import { triageOf, type TriageKey } from './sidebar'
import type { EpicColor, EpicIconId } from '../epic-look'
import { relTime } from '../format'

/**
 * The sidebar as a list of epics (docs/features/orchestrator-chats-become-epics):
 * each orchestrator chat is an epic, and the features it cut sit under it. Pure
 * ordering and wording over wire data; the component is `SidebarEpics`.
 */

/** A feature in the epic list. */
export interface EpicFeature {
  feature: FeatureListItem
  /** Locked to its epic's autopilot run (epics-on-autopilot): its needs go to the epic, never to its own row. */
  locked?: boolean
}

/** One epic: its chat, and the features it cut that are in motion or up next. */
export interface Epic {
  chat: ThreadEntry
  features: EpicFeature[]
  /** Its colour (epics-that-look-alive decision 2); blue until the server stores one. */
  color?: EpicColor | null
  /** Its icon id (decision 1); the default chat bubble while unset. */
  icon?: EpicIconId | null
  /** How many of its features shipped (decision 4): the slim row's "3 shipped". */
  shipped?: number
  /** It runs its features by itself (epics-on-autopilot): the card wears the autopilot look. */
  autopilot?: boolean
}

/** One group of the list, in display order: an epic, or the features with no epic (decision 7). */
export type EpicGroup =
  | { kind: 'epic'; epic: Epic; yellow: boolean }
  | { kind: 'other'; features: FeatureListItem[]; yellow: boolean }

/** The lanes an epic nests, in the order it nests them (decision 8); the rest are the shelves' (decision 9). */
const EPIC_LANES: readonly TriageKey[] = ['needsYou', 'working', 'idle', 'upNext']

/** Whether a feature sits under its epic: in motion or up next. Parked, shipped and archived ones are on the shelves. */
export function inEpic(f: FeatureListItem): boolean {
  return EPIC_LANES.includes(triageOf(f))
}

/** A feature needs the human: its own row wears the amber dot. */
export function featureIsYellow(f: FeatureListItem): boolean {
  return triageOf(f) === 'needsYou'
}

/** Something in the epic is yellow: its chat needs you, or one of its features does (decision 8). */
export function epicIsYellow(epic: Pick<Epic, 'chat' | 'features'>): boolean {
  // A locked feature's needs are its epic's (epics-on-autopilot decision 17): only the chat's own counts for it.
  return !!epic.chat.need || epic.features.some((x) => !x.locked && featureIsYellow(x.feature))
}

/** Inside an epic: needs you first, then working, idle, up next; ties keep their order. */
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
 * The list's groups (decision 8): epics with something yellow first, then those
 * in motion, then idle ones (epics-that-look-alive decision 8), each group newest
 * started first; "Other features" ends the yellow group or the in-motion one
 * (decision 7), so it never sits among idle epics. Each epic's features come in their own order, only
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
  const idle = (g: EpicGroup) => g.kind === 'epic' && epicIsIdle(g.epic)
  const yellow = groups.filter((g) => g.yellow)
  const busy = groups.filter((g) => !g.yellow && !idle(g))
  const resting = groups.filter((g) => !g.yellow && idle(g))
  const otherGroup: EpicGroup[] = loose.length > 0 ? [{ kind: 'other', features: loose, yellow: looseYellow }] : []
  return looseYellow
    ? [...yellow, ...otherGroup, ...busy, ...resting]
    : [...yellow, ...busy, ...otherGroup, ...resting]
}

/**
 * An epic at rest (epics-that-look-alive decision 4): its chat neither works
 * nor asks, and nothing it cut is in motion or up next. It draws as a slim row.
 * Pass the epic as `orderEpicList` returns it (its features already filtered).
 */
export function epicIsIdle(epic: Pick<Epic, 'chat' | 'features'>): boolean {
  return epic.chat.state !== 'working' && !epic.chat.need && epic.features.length === 0
}

/**
 * The slim row's quiet facts (decision 4): what it shipped and when its chat
 * was last active, "3 shipped · 2h"; a fresh epic with nothing shipped says
 * only "2h".
 */
export function idleEpicFacts(epic: Pick<Epic, 'chat' | 'shipped'>, now: number = Date.now()): string {
  const ago = relTime(epic.chat.updatedAt, now)
  return epic.shipped && epic.shipped > 0 ? `${epic.shipped} shipped · ${ago}` : ago
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

/**
 * The epic list's input from wire data (decisions 4–7, 16): every orchestrator
 * chat `listed` says is listed becomes an epic with the features it cut
 * (`chatId`) that are in motion or up next. A feature
 * with no origin chat, or one not listed as an epic, goes to "Other features".
 */
export function epicsFrom(
  chats: readonly ThreadEntry[],
  features: readonly FeatureListItem[],
  listed: (chat: ThreadEntry) => boolean,
): { epics: Epic[]; other: FeatureListItem[] } {
  const epicChats = chats.filter((t) => t.role === 'project' && listed(t))
  const ids = new Set(epicChats.map((t) => t.id))
  const moving = features.filter(inEpic)
  const epics = epicChats.map((chat) => ({
    chat,
    // Locked to its epic's autopilot (epics-on-autopilot decision 14): the server says so on the feature.
    features: moving.filter((f) => f.chatId === chat.id).map((feature) => ({ feature, locked: !!feature.autopilot })),
    color: chat.color ?? null,
    icon: chat.icon ?? null,
    // The list carries shipped features for the Shipped shelf, so the count needs no server read.
    shipped: features.filter((f) => f.status === 'shipped' && f.chatId === chat.id).length,
    autopilot: !!chat.autopilot,
  }))
  const other = moving.filter((f) => !f.chatId || !ids.has(f.chatId))
  return { epics, other }
}

/** A shelf row's epic: its origin chat's name, when the chat list holds it (decision 21). */
export function epicNameOf(f: Pick<FeatureListItem, 'chatId'>, chats: readonly ThreadEntry[]): string | null {
  if (!f.chatId) return null
  return chats.find((t) => t.id === f.chatId && t.role === 'project')?.title ?? null
}
