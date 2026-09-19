import type { Phase } from '@runcastle/core'
import type { NextAction } from './types'

/**
 * The feature's one door to its one conversation (decision 8) — the same object
 * on every bar, so the button sits in the same place with the same word in all
 * four states.
 *
 * It is a CONSTANT on purpose. The three doors it replaces were each worded for
 * where they stood ("Start session", "Revisit", "Ask a question") and two states
 * had no door at all: during a burn every terminal was refused, and review's
 * only road to an agent was Rethink, which bumped the lap. A door that moves and
 * renames itself per state is a door the human has to find again, so this one
 * never reworded and never disabled — not while a session is live (review-
 * arrival decision 4), and not while a run holds the branch, which is the whole
 * refusal this feature deletes.
 *
 * Resolvers put it FIRST in `secondary`, which is the only position that stays
 * put as the rest of a bar's verbs come and go. Where talking is genuinely the
 * next step — planning or an empty build ledger with nothing live — the resolver
 * promotes it to the primary with its own resume-aware wording instead, and then
 * omits it here rather than rendering the same door twice.
 */
export const CHAT_ACTION: NextAction = { label: 'Chat', kind: 'chat' }

/**
 * The phase view the Chat door has to pin for the conversation to be on screen,
 * or null when the body already up renders it (decision 12).
 *
 * Planning, building and shipped each render the session panel in their own
 * body, so the door lands in the terminal without moving the human anywhere.
 * Review renders no terminal at all (review-arrival decision 5) — it is the one
 * page whose door has nowhere to land, so it travels to planning, the same
 * destination the review page's live-session line already offers as Open.
 *
 * This is what makes the door's second click legible: the server answers a
 * click on a live chat with that session rather than a refusal, and without a
 * pin the review page would show nothing at all for it.
 */
export function chatTerminalPhase(viewing: Phase): Phase | null {
  return viewing === 'review' ? 'planning' : null
}
