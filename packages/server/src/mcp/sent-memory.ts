import { createHash } from 'node:crypto'

/**
 * What each conversation has already been sent (`tools-and-skills-say-less`
 * decisions 1, 6, 7, 16): per runcastle session, the hash of every doc a read
 * tool sent in full, and how far `read_feature_chat` has read each feature's
 * chat. A repeat read uses it to send a stub, or only what is new, instead of
 * resending what is still in the conversation.
 *
 * In-process only, never persisted: a server restart empties it, which costs one
 * full reply per session and nothing else. It is cleared when a session's
 * SessionStart hook says its conversation lost its context (any source but
 * `resume`). A caller with no session (a worker under a run header) never
 * touches it and always gets full replies.
 */

/** How far a thread has read one feature's chat. */
export interface ChatReadPosition {
  transcriptPath: string
  /** Quotable turns of that transcript already covered by a read. */
  turnCount: number
  /** Entries of `shown` already returned. */
  shownCount: number
  /** Entries of `reviewShots` already returned. */
  reviewShotCount: number
}

interface SessionMemory {
  /** doc key → sha of the content last sent in full. */
  docs: Map<string, string>
  /** featureId → read position of that feature's chat. */
  chats: Map<string, ChatReadPosition>
}

const memory = new Map<string, SessionMemory>()

function memoryOf(sessionId: string): SessionMemory {
  let held = memory.get(sessionId)
  if (!held) {
    held = { docs: new Map(), chats: new Map() }
    memory.set(sessionId, held)
  }
  return held
}

/** The key the project charter is remembered under. */
export const CHARTER_DOC_KEY = 'project:CONTEXT.md'

/** The key a feature doc is remembered under: one doc of one feature. */
export function featureDocKey(featureId: string, relPath: string): string {
  return `feature:${featureId}:${relPath}`
}

/** The content hash a stub carries and the memory compares. */
export function contentSha(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/** The sha this session was last sent for `key`, if any. */
export function sentSha(sessionId: string, key: string): string | undefined {
  return memory.get(sessionId)?.docs.get(key)
}

export function recordSent(sessionId: string, key: string, sha: string): void {
  memoryOf(sessionId).docs.set(key, sha)
}

export function chatReadPosition(sessionId: string, featureId: string): ChatReadPosition | undefined {
  return memory.get(sessionId)?.chats.get(featureId)
}

export function recordChatRead(sessionId: string, featureId: string, position: ChatReadPosition): void {
  memoryOf(sessionId).chats.set(featureId, position)
}

/** Forget everything a session was sent — its conversation no longer holds it. */
export function clearSentMemory(sessionId: string): void {
  memory.delete(sessionId)
}

/**
 * Clear on a SessionStart whose source means the conversation lost its context:
 * everything but a plain `resume` (startup, clear, compact, fork, or none given).
 */
export function clearSentMemoryOnStart(sessionId: string, source: string | undefined): void {
  if (source !== 'resume') clearSentMemory(sessionId)
}

/** Tests share module state: wipe every session's memory. */
export function resetSentMemoryForTests(): void {
  memory.clear()
}
