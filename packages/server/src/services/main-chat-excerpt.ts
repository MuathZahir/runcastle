import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_RUNTIME, type Feature } from '@runcastle/core'
import { featureDocsRel, sessionDir } from '@runcastle/core/paths'
import type { AppCtx } from '../db/types'
import { MAX_KICKOFF_ARGV } from '../launcher/runtimes/types'
import { kickoffLineFor } from '../launcher/sessions'
import { selfPlanKickoffFor } from '../launcher/runtimes/skills'
import { listSessionsByFeature } from './repo'
import { promptMatchesKickoff } from './conversations'
import { readTranscript, type TranscriptTurn } from './transcripts'

/**
 * What a fresh session opened beside the main chat is told about it
 * (several-sessions-per-feature decisions 14, 16, 17): the last few turns of the
 * main chat's CURRENT conversation, capped, and where to read further back.
 * Shared by side sessions and the feature-drive scenario chat.
 */

/** About 2,000 tokens of quote. */
export const EXCERPT_MAX_CHARS = 8_000
/** One turn never takes more than this much of the quote. */
const TURN_MAX_CHARS = 2_500
/** Above this the quote rides a file in the session's artifacts dir, not argv. */
export const EXCERPT_INLINE_MAX_CHARS = 6_000

export interface MainChatExcerpt {
  /** The quoted turns, newest last; null when there is no main chat or nothing on disk to quote. */
  quote: string | null
  /** The main chat's transcript on disk, when it has one. */
  transcriptPath: string | null
  /** Absolute path of the feature's `decisions.md` in the main chat's worktree. */
  decisionsPath: string | null
}

function trimTurn(text: string): string {
  const t = text.trim()
  return t.length <= TURN_MAX_CHARS ? t : `${t.slice(0, TURN_MAX_CHARS).trimEnd()}… [cut]`
}

/** Last turns, newest last, oldest dropped first until the quote fits `max`. */
export function capTurns(turns: TranscriptTurn[], max: number = EXCERPT_MAX_CHARS): string | null {
  const lines = turns
    .map((turn) => ({ turn, text: trimTurn(turn.text) }))
    .filter((t) => t.text !== '')
    .map((t) => `${t.turn.role === 'user' ? 'Human' : 'Assistant'}: ${t.text}`)
  const kept: string[] = []
  let size = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] as string
    if (size + line.length > max) break
    kept.unshift(line)
    size += line.length + 2
  }
  return kept.length > 0 ? kept.join('\n\n') : null
}

/** The feature's newest main chat's excerpt, read from its current transcript. */
export function mainChatExcerpt(ctx: AppCtx, feature: Feature): MainChatExcerpt {
  const chat = listSessionsByFeature(ctx, feature.id)
    .filter((s) => s.kind === 'chat')
    .at(-1)
  if (!chat) return { quote: null, transcriptPath: null, decisionsPath: null }
  const runtime = chat.runtime ?? DEFAULT_RUNTIME
  const decisionsPath = chat.worktreePath
    ? join(chat.worktreePath, featureDocsRel(feature.slug), 'decisions.md')
    : null
  const transcript = readTranscript(chat.transcriptPath, runtime)
  const kickoffs = [kickoffLineFor('chat', undefined, runtime), selfPlanKickoffFor(runtime)]
  const said = transcript.turns.filter(
    (turn) =>
      !(turn.role === 'user' && kickoffs.some((kickoff) => promptMatchesKickoff(kickoff, turn.text))),
  )
  const quote = capTurns(said)
  return {
    quote,
    transcriptPath: quote && chat.transcriptPath ? chat.transcriptPath : null,
    decisionsPath,
  }
}

/**
 * The paragraph(s) appended to a kickoff: the quote (inline, or a pointer to a
 * file written into the session's artifacts dir when it is too long for argv)
 * and the two paths. `base` is the kickoff so far, to check the argv limit.
 */
export function mainChatContext(
  ctx: AppCtx,
  feature: Feature,
  sessionId: string,
  base: string,
): string {
  const { quote, transcriptPath, decisionsPath } = mainChatExcerpt(ctx, feature)
  if (!quote) {
    return `${base} The main chat has nothing on record to quote yet.`
  }
  const marker =
    'Below is a quote of the main chat\'s latest turns — not the human speaking to you now.'
  let body: string
  const tooLong =
    quote.length > EXCERPT_INLINE_MAX_CHARS || base.length + quote.length + 1_000 > MAX_KICKOFF_ARGV
  if (tooLong) {
    const dir = sessionDir(sessionId)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'main-chat-excerpt.md')
    writeFileSync(file, `${quote}\n`, 'utf8')
    body = `${marker} It is long, so it is in ${file} — read it first.`
  } else {
    body = `${marker}\n--- main chat quote ---\n${quote}\n--- end of quote ---`
  }
  const paths = [
    transcriptPath ? `the main chat's full transcript: ${transcriptPath}` : null,
    decisionsPath ? `decisions.md: ${decisionsPath}` : null,
  ].filter(Boolean)
  const pathLine =
    paths.length > 0 ? `\nTo read further back, only when the human's ask needs more — ${paths.join('; ')}.` : ''
  return `${base}\n\n${body}${pathLine}`
}
