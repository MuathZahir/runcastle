import type { FeatureListItem } from '../api'
import type { ThreadEntry } from '../chat-thread'
import { triageOf, type TriageKey } from './sidebar'
import { askingAboutLine } from '../sidebar-threads'

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
  if (holder.kind === 'epic') return rest.trim().toLowerCase() === 'asking you' ? 'Question above' : capital(rest)
  if (holder.kind === 'you') {
    const consulting = `Asking ${epic} · `
    return words.toLowerCase().startsWith(consulting.toLowerCase())
      ? `Asking above · ${words.slice(consulting.length)}`
      : `Yours · ${rest}`
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

/**
 * Who runs a feature, as its row under `epicId` says it (decision 10): the
 * epic's own chat, the human (no holding chat), or another chat, named.
 */
export function epicHolder(
  f: Pick<FeatureListItem, 'heldBy'>,
  epicId: string | null,
  chats: readonly ThreadEntry[],
): EpicHolder {
  if (!f.heldBy) return { kind: 'you' }
  if (f.heldBy === epicId) return { kind: 'epic' }
  return { kind: 'chat', title: chats.find((t) => t.id === f.heldBy)?.title ?? 'another chat' }
}

/**
 * What a waiting chat asks about, for its epic row's "Asking about <feature>"
 * (decision 11): the first feature it names, then "+N" for the rest. Null when
 * the chat is not waiting or its question names no feature it can find, and the
 * row reads "Asking you". The words and the "+N" rule are the owner feature's
 * (`askingAboutLine`, over the chat list's `askingAbout`), less its "Asking
 * about " head, which the epic row writes.
 */
export function asksAboutOf(chat: ThreadEntry, features: readonly FeatureListItem[]): string | null {
  if (chat.state !== 'waiting') return null
  return askingAboutLine(chat, features)?.replace(/^Asking about /, '') ?? null
}

/**
 * The epic list's input from wire data (decisions 4–7, 16): every orchestrator
 * chat `listed` says is listed becomes an epic with the features it cut
 * (`chatId`) that are in motion or up next, each with who runs it. A feature
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
    asksAbout: asksAboutOf(chat, features),
    features: moving
      .filter((f) => f.chatId === chat.id)
      .map((feature) => ({ feature, holder: epicHolder(feature, chat.id, chats) })),
  }))
  const other = moving.filter((f) => !f.chatId || !ids.has(f.chatId))
  return { epics, other }
}

/** A shelf row's epic: its origin chat's name, when the chat list holds it (decision 21). */
export function epicNameOf(f: Pick<FeatureListItem, 'chatId'>, chats: readonly ThreadEntry[]): string | null {
  if (!f.chatId) return null
  return chats.find((t) => t.id === f.chatId && t.role === 'project')?.title ?? null
}

/**
 * How a feature header's trail opens (decision 15, as the orchestrator changed
 * it): `owner`, no epic, so the owner control stands alone; `one`, the epic's
 * chat owns it (or takes it after the plan), so the epic and the owner are one
 * crumb ("◆ Payment System · you merge ▾"); `two`, the human or a different
 * chat owns it, so both show ("◆ Payment System › Yours ▾").
 */
export function epicOwnerJoin(
  epicId: string | null,
  owner: { owner: { kind: 'you' | 'chat' }; holderId?: string; chatId?: string },
): 'owner' | 'one' | 'two' {
  if (!epicId) return 'owner'
  if (owner.owner.kind !== 'chat') return 'two'
  return (owner.holderId ?? owner.chatId) === epicId ? 'one' : 'two'
}
