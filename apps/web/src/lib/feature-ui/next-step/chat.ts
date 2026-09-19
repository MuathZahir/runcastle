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
 *
 * What it opens is the panel docked beside the body (decision 16), so the door
 * is a toggle: it never travels to another phase's view to find a terminal, and
 * sending the panel away is not ending the conversation.
 */
export const CHAT_ACTION: NextAction = { label: 'Chat', kind: 'chat' }
