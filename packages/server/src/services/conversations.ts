import {
  type AgentRuntime,
  DEFAULT_RUNTIME,
  type SessionKind,
  type SessionRow,
  type SessionStatus,
} from '@runcastle/core'
import type { AppCtx } from '../db/types'
import {
  clearSessionTitle,
  getSessionRow,
  kickoffLineFor,
  projectSessions,
  promptMatchesKickoff,
  setSessionTitle,
} from '../launcher/sessions'
import { readTranscript, type SessionTranscript, type TranscriptTurn } from './transcripts'

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
 * and the runtime records it as a `user` turn — indistinguishable, on disk, from
 * something the human typed. It is not: nobody wrote "Proceed with your task:
 * invoke the /runcastle:project skill…", so neither the title nor the transcript
 * may attribute it to them. Recognised with the same comparison the kickoff's own
 * delivery confirmation uses, which is why a RESUMED conversation's re-sent
 * kickoff is caught too — the resume framing is a prefix around the same line,
 * and {@link promptMatchesKickoff} compares on the line's own opening.
 *
 * `runtime` is not optional, and that is the point: each adapter SPELLS the
 * kickoff its own way (`/runcastle:project` against `$project`), so a matcher
 * given the wrong runtime silently keeps the line and names the conversation
 * after it.
 *
 * Filtered here, server-side, so the one matcher serves every surface and the
 * title and the transcript can never disagree about who said the first thing.
 */
function withoutKickoff(
  turns: TranscriptTurn[],
  kind: SessionKind,
  runtime: AgentRuntime,
): TranscriptTurn[] {
  const kickoff = kickoffLineFor(kind, undefined, runtime)
  return turns.filter((turn) => !(turn.role === 'user' && promptMatchesKickoff(kickoff, turn.text)))
}

/** How the runtime records a turn the human abandoned half-way through. */
const INTERRUPTED = '[Request interrupted by user]'

/**
 * What a `user` turn actually contributes to a name, or null for one that
 * contributes nothing (decision 5).
 *
 * The first `user` turn on disk is routinely not the first thing the human
 * *said*: a slash command is recorded as `<command-name>/clear</command-name>…`,
 * an abandoned turn as {@link INTERRUPTED}, and a pasted screenshot as an
 * `[Image #n]` token. On the runcastle project those three had named 15 of 19
 * conversations. None of them is a sentence anyone typed to describe the work,
 * so a turn made only of them is skipped and the search moves on.
 */
function saidText(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed.startsWith('<command-name>')) return null
  if (trimmed === INTERRUPTED) return null
  return trimmed.replace(/\[Image #\d+\]/g, ' ').trim() || null
}

/** The human's first real line of a conversation, as a title (see {@link saidText}). */
export function deriveTitle(turns: TranscriptTurn[], runtime: AgentRuntime): string | null {
  for (const turn of withoutKickoff(turns, 'project', runtime)) {
    if (turn.role !== 'user') continue
    const said = saidText(turn.text)
    if (said) return elide(said)
  }
  return null
}

/** Collapse to one line and cut to {@link TITLE_MAX}, marking the cut. */
function elide(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= TITLE_MAX) return line
  return `${line.slice(0, TITLE_MAX).trimEnd()}…`
}

/** What a conversation with nothing said in it yet is called. */
const UNTITLED = 'Untitled'

/**
 * A cached title from before {@link deriveTitle} learned what a human turn is,
 * or null for one worth keeping.
 *
 * The derivation is a pure function of the transcript, so fixing it fixes every
 * name — except the ones already written to the `title` column, which no amount
 * of fixing can reach. These two openings are what the junk looked like on the
 * runcastle project: a slash command's own markup, and the bracketed tokens of
 * an interruption or an image paste. Nothing anyone types starts that way.
 */
function junkTitle(title: string): boolean {
  return title.startsWith('<command-name>') || title.startsWith('[')
}

/**
 * The sessions of one Claude Code conversation, newest first — see
 * {@link listProjectConversations} for why a conversation is more than one row.
 */
type ConversationGroup = SessionRow[]

/**
 * The project's conversations, newest first — ONE row per Claude Code
 * conversation (decision 4).
 *
 * A conversation is not a session row. Reopening one relaunches the CLI with
 * `--resume`, which keeps the Claude Code session id and gets us a second row of
 * the same thread, so the rows are grouped on `ccSessionId`: dated by the first
 * launch, statused by the latest session (which is the one still live, if any),
 * and identified by that latest session — `id` goes back to `talkToProject` as
 * `resumeSessionId`, and resuming a conversation means resuming where it got to.
 * A row with no `ccSessionId` was never picked up by the CLI: nothing to read
 * and nothing to resume, so it is not a conversation and is not listed.
 *
 * Titles are derived here rather than at launch — the transcript does not exist
 * when the row is inserted, and what the conversation turns out to be about is
 * the human's first message, which lands later still. It is derived from the
 * conversation's EARLIEST transcript (its real first words) and cached on that
 * row: it can never change (the first message is the first message), and
 * re-reading every transcript on every poll of a live list is exactly the cost
 * the column exists to avoid. A conversation with no title yet falls back to
 * {@link UNTITLED} and is NOT cached — the transcript may still gain one.
 *
 * The one write in a read path, and deliberately eventless (SPEC §12 asks every
 * mutating service function to emit): caching a name the same call already
 * returned changes nothing a client could observe, so an event would be a
 * timeline entry per row per poll saying nothing happened. Clearing a
 * {@link junkTitle} is the same write from the other side.
 */
export function listProjectConversations(ctx: AppCtx, projectId: string): ProjectConversation[] {
  return groupByConversation(projectSessions(ctx, projectId, 'project')).map((group) => {
    const [latest] = group
    const earliest = group[group.length - 1]
    const stamps = group.map((s) => s.createdAt).filter((at): at is number => at !== undefined)
    return {
      id: latest.id,
      title: conversationTitle(ctx, earliest),
      createdAt: stamps.length ? Math.min(...stamps) : null,
      status: latest.status,
      // Every listed conversation has a Claude Code session behind it; the field
      // stays because the client still reads it.
      resumable: true,
    }
  })
}

/**
 * The listable sessions of `projectId`, grouped into conversations — newest
 * conversation first, and newest session first within each.
 *
 * Order comes from {@link projectSessions} (insertion order, reversed) and is
 * carried by the `Map`, so a reopened conversation sorts by the reopen: the list
 * reads as "what I was last talking about", not "what I once started".
 */
function groupByConversation(rows: SessionRow[]): ConversationGroup[] {
  const groups = new Map<string, ConversationGroup>()
  for (const row of rows) {
    if (!row.ccSessionId) continue
    const group = groups.get(row.ccSessionId)
    if (group) group.push(row)
    else groups.set(row.ccSessionId, [row])
  }
  return [...groups.values()]
}

/** The conversation's cached name, derived and cached now if it has none worth having. */
function conversationTitle(ctx: AppCtx, earliest: SessionRow): string {
  const cached = earliest.title
  if (cached && !junkTitle(cached)) return cached
  const runtime = earliest.runtime ?? DEFAULT_RUNTIME
  const derived = deriveTitle(readTranscript(earliest.transcriptPath, runtime).turns, runtime)
  if (derived) setSessionTitle(ctx, earliest.id, derived)
  else if (cached) clearSessionTitle(ctx, earliest.id)
  return derived ?? UNTITLED
}

/** A conversation's transcript, and the runtime whose voice the pane is labelling. */
export interface ConversationTranscript extends SessionTranscript {
  /** Whose assistant bubbles these are; {@link DEFAULT_RUNTIME} for a row written before the column. */
  runtime: AgentRuntime
}

/**
 * One conversation's turns, for the read-only transcript pane.
 *
 * Empty for an unknown session and for a transcript that is no longer on disk —
 * transcripts belong to the CLI and can be cleared or tidied away, and a
 * conversation whose record is gone is a thing to render as empty, not an error
 * to throw at someone who only clicked "view transcript". A transcript that IS
 * there in a format we cannot read comes back `unavailable` (decision 10) — a
 * different sentence for the pane, and still not an error.
 *
 * What comes back is what was *said*: the launcher's kickoff lines are dropped
 * ({@link withoutKickoff}), so the pane never opens with a "You" bubble carrying
 * a sentence the human did not type.
 */
export function conversationTranscript(ctx: AppCtx, sessionId: string): ConversationTranscript {
  const session = getSessionRow(ctx, sessionId)
  if (!session) return { status: 'ok', turns: [], runtime: DEFAULT_RUNTIME }
  const runtime = session.runtime ?? DEFAULT_RUNTIME
  const transcript = readTranscript(session.transcriptPath, runtime)
  return {
    status: transcript.status,
    turns: withoutKickoff(transcript.turns, session.kind, runtime),
    runtime,
  }
}
