import type { FeatureFinish } from '@runcastle/core'
import type { FeatureOwner } from '../components/workspace/OwnerControl'

/** What a feature says about its owner (every-feature-has-one-owner): the holder, its chat and how far that chat takes it. */
export interface OwnedFeature {
  status: string
  /** The orchestrator thread that owns it; unset or null: the human. */
  heldBy?: string | null | undefined
  /** Its chat, the orchestrator thread it came from or was given to; null for a feature made with New feature. */
  chatId?: string | null | undefined
  finish?: FeatureFinish | undefined
}

/** What the owner control and the owner strip show for one feature. */
export interface OwnerReading {
  owner: FeatureOwner
  /** The chat's name, which its choices name; absent when the feature has no chat (the control does not open). */
  chatName?: string
  /** Its chat, when it has one. */
  chatId?: string
  /** Grilled with the human, its chat taking it at the plan yes: "Yours to plan · then <Chat>" (decision 14). */
  planning: boolean
  /** The thread that owns it now, when a chat does: the strip above the lead's composer, and its "Open <Chat>". */
  holderId?: string
  /** The owning chat is asking the human about this feature right now (decision 23): the strip says so. */
  asking: boolean
}

/** A thread-list entry as the owner reading needs it: its name, and the features it is asking the human about. */
export interface OwnerThread {
  id: string
  title: string
  askingAbout?: readonly string[] | undefined
}

/** The name a chat goes by before the thread list has it (or after it is gone from it). */
export const UNNAMED_CHAT = 'Unnamed epic'

/**
 * Read the owner off a feature (decisions 1, 11, 12, 14, 21): a chat owns it
 * while it is held; a human-owned feature whose finish is still a chat's is one
 * the human grills and its chat takes at the plan yes (the server sets finish
 * to `you` whenever the human takes a feature, so nothing else reads that way).
 * A feature with no chat is the human's and names none. The chat's name is the
 * thread list's, as the sidebar shows it.
 */
export function ownerReading(feature: OwnedFeature & { id?: string }, threads: readonly OwnerThread[]): OwnerReading {
  const nameOf = (id: string) => threads.find((t) => t.id === id)?.title || UNNAMED_CHAT
  const live = feature.status !== 'shipped'
  const holderId = live && feature.heldBy ? feature.heldBy : undefined
  const chatId = feature.chatId ?? holderId
  if (holderId) {
    const name = nameOf(holderId)
    const asking = !!feature.id && !!threads.find((t) => t.id === holderId)?.askingAbout?.includes(feature.id)
    return {
      owner: { kind: 'chat', name, finish: feature.finish === 'merge' ? 'merge' : 'show' },
      chatName: name,
      ...(chatId ? { chatId } : {}),
      planning: false,
      holderId,
      asking,
    }
  }
  if (!chatId) return { owner: { kind: 'you' }, planning: false, asking: false }
  const chatName = nameOf(chatId)
  const finish = feature.finish ?? 'you'
  if (live && finish !== 'you') {
    return { owner: { kind: 'chat', name: chatName, finish }, chatName, chatId, planning: true, asking: false }
  }
  return { owner: { kind: 'you' }, chatName, chatId, planning: false, asking: false }
}
