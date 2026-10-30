/**
 * The chat's three materials (the-chat-looks-the-part decision 16). Every
 * container in a thread is one of these, by what it is, never styled on its
 * own:
 *
 * - `RAISED` floats over the thread: where you type (the composer, a message
 *   being edited), what the agent waits on you for (an ask), what calls you
 *   (a notice card). The raised ground and one soft shadow.
 * - `WELL` sits in the thread: what was said and done — your message, the
 *   changes a turn made, a subagent's work. A see-through tint of the text
 *   colour and a hairline edge.
 * - `INSET` is code-shaped, inside one of the two: a command, its output, a
 *   diff, an attached image. The inset ground and a hairline, at the smaller
 *   radius so it nests.
 *
 * Raised and well both catch the same 1px highlight on their top edge, so they
 * read as one family. Each string is spelled whole so Tailwind can see it.
 */

/** Floats over the thread. */
export const RAISED =
  'rounded-lg bg-surface-raised shadow-[var(--elevation-popover),inset_0_1px_0_color-mix(in_oklab,var(--color-text)_6%,transparent)]'

/** Sits in the thread. */
export const WELL =
  'rounded-lg bg-fill-well shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-text)_5%,transparent),inset_0_0_0_1px_var(--color-border-subtle)]'

/** Code-shaped, inside a raised or well surface. */
export const INSET = 'rounded-md bg-surface-inset ring-1 ring-inset ring-border-subtle'
