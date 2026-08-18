import type { SessionKind, SessionStatus } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import {
  getSessionRow,
  kickoffLineFor,
  projectSessions,
  promptMatchesKickoff,
  setSessionTitle,
} from '../launcher/sessions'
import { readTranscript, type TranscriptTurn } from './transcripts'

/**
 * The project's conversations (decision 5) — the list behind the project
 * workspace, and the read-only transcript behind each ended row.
 *
 * The project chat used to be one endless conversation that reopening silently
 * resumed. It is a list now: every launch is a row, "New chat" is the default,
 * and resuming a particular past conversation is an explicit click. Which makes
 * one thing suddenly matter that never did before — a row has to be *nameable*,
 * because a list of nine "project session"s is not a list anyone can use.
 */

/** One row of the conversation list. */
export interface ProjectConversation {
  /** The session row's id — what `talkToProject`'s `resumeSessionId` takes. */
  id: string
  /** Derived from the first thing the human said (see {@link conversationTitle}). */
  title: string
  /** Null on the rows written before `sessions` carried a timestamp. */
  createdAt: number | null
  status: SessionStatus
  /** There is a Claude Code conversation behind this row for `--resume` to find. */
  resumable: boolean
}

/**
 * How long a derived title may be. Long enough for a recognisable sentence
 * fragment, short enough that a rail row never wraps.
 */
export const TITLE_MAX = 60

/**
 * A transcript with the launcher's kickoff lines taken out of it.
 *
 * Every runcastle terminal opens with a kickoff line typed in by the launcher,
 * and Claude Code records it as a `user` turn — indistinguishable, on disk, from
 * something the human typed. It is not: nobody wrote "Proceed with your task:
 * invoke the /runcastle:project skill…", so neither the title nor the transcript
 * may attribute it to them. Recognised with the same comparison the kickoff's own
 * delivery confirmation uses, which is why a RESUMED conversation's re-sent
 * kickoff is caught too — the resume framing is a prefix around the same line,
 * and {@link promptMatchesKickoff} compares on the line's own opening.
 *
 * Filtered here, server-side, so the one matcher serves every surface and the
 * title and the transcript can never disagree about who said the first thing.
 */
export function withoutKickoff(
  turns: TranscriptTurn[],
  kind: SessionKind = 'project',
): TranscriptTurn[] {
  const kickoff = kickoffLineFor(kind)
  return turns.filter((turn) => !(turn.role === 'user' && promptMatchesKickoff(kickoff, turn.text)))
}

/** The human's first line of a conversation, as a title (see {@link withoutKickoff}). */
export function deriveTitle(turns: TranscriptTurn[]): string | null {
  const first = withoutKickoff(turns).find((turn) => turn.role === 'user')
  return first ? elide(first.text) : null
}

/** Collapse to one line and cut to {@link TITLE_MAX}, marking the cut. */
function elide(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= TITLE_MAX) return line
  return `${line.slice(0, TITLE_MAX).trimEnd()}…`
}

/** What a conversation with nothing said in it yet is called. */
function untitled(createdAt: number | null): string {
  return createdAt ? `Chat from ${new Date(createdAt).toISOString().slice(0, 10)}` : 'Untitled chat'
}

/**
 * The project's conversations, newest first.
 *
 * Titles are derived here rather than at launch — the transcript does not exist
 * when the row is inserted, and what the conversation turns out to be about is
 * the human's first message, which lands later still. A derived title is cached
 * onto the row: it can never change (the first message is the first message),
 * and re-reading every transcript on every poll of a live list is exactly the
 * cost the column exists to avoid. A conversation with no title yet falls back
 * to its date and is NOT cached — the transcript may still gain one.
 *
 * The one write in a read path, and deliberately eventless (SPEC §12 asks every
 * mutating service function to emit): caching a name the same call already
 * returned changes nothing a client could observe, so an event would be a
 * timeline entry per row per poll saying nothing happened.
 */
export function listProjectConversations(ctx: AppCtx, projectId: string): ProjectConversation[] {
  return projectSessions(ctx, projectId, 'project').map((session) => {
    const createdAt = session.createdAt ?? null
    let title = session.title ?? null
    if (!title) {
      title = deriveTitle(readTranscript(session.transcriptPath))
      if (title) setSessionTitle(ctx, session.id, title)
    }
    return {
      id: session.id,
      title: title ?? untitled(createdAt),
      createdAt,
      status: session.status,
      resumable: !!session.ccSessionId,
    }
  })
}

/**
 * One conversation's turns, for the read-only transcript pane.
 *
 * Empty for an unknown session and for a transcript that is no longer on disk —
 * transcripts belong to Claude Code and can be cleared or tidied away, and a
 * conversation whose record is gone is a thing to render as empty, not an error
 * to throw at someone who only clicked "view transcript".
 *
 * What comes back is what was *said*: the launcher's kickoff lines are dropped
 * ({@link withoutKickoff}), so the pane never opens with a "You" bubble carrying
 * a sentence the human did not type.
 */
export function conversationTranscript(ctx: AppCtx, sessionId: string): TranscriptTurn[] {
  const session = getSessionRow(ctx, sessionId)
  if (!session) return []
  return withoutKickoff(readTranscript(session.transcriptPath), session.kind)
}
