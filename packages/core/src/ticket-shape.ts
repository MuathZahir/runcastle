/**
 * Whether a batch of tickets is SHAPED like something a coder can burn — pure,
 * IO-free (SPEC §1), and advisory by design.
 *
 * Nothing here ever refuses a ticket. A 14-ticket quick change was imported in
 * which every ticket had `title == goal == context == first acceptance
 * criterion`: 3.7–4.3 KB blobs truncated mid-word, no seams, dependencies
 * written as prose. The implement prompt's red→green discipline has nothing to
 * bite on in that shape — its whole first step is "read the files the context
 * names" — and the quick door had no validation at all, so the shape reached a
 * burn unremarked. The operator's call was warnings, not refusals: the human
 * typed those sentences on purpose and may burn them anyway.
 *
 * So this returns SENTENCES, one per thing worth fixing, each naming the ticket
 * it is about. Two surfaces render them from this one source of wording — the
 * quick door emits them onto the feature's timeline at creation, and the Burn
 * card shows them beside a Burn button that stays enabled — because a warning
 * the human meets twice in different words reads as two problems.
 */

import type { Ticket } from './schemas'

/** Below this, a context has nothing in it for a coder to test at. */
export const THIN_TICKET_CONTEXT_CHARS = 300

/** Above this, a ticket field is a document rather than a ticket's own prose. */
export const PASTED_DOCUMENT_CHARS = 1500

/**
 * More degenerate tickets than this in one batch is the quick-change door used
 * as an importer — work that size has a spec's worth of intent behind it, and
 * the door is explicitly for work too small to grill (decision 21).
 */
export const DEGENERATE_BATCH_TICKETS = 5

/**
 * The docs digest every coder in a burn is handed, in bytes, past which it is
 * worth saying out loud. The allowlist in `docs.ts` cut the pathological case
 * (97 KB of postmortem and triaged bug notes, re-sent per ticket per attempt);
 * this catches the canonical four growing back to the same size.
 */
export const DOCS_DIGEST_WARN_BYTES = 40_000

export type TicketShapeWarningCode =
  | 'goal-is-context'
  | 'thin-context'
  | 'pasted-document'
  | 'degenerate-batch'
  | 'oversized-docs-digest'

export interface TicketShapeWarning {
  /** Stable handle for the surfaces and their tests; never shown to a human. */
  code: TicketShapeWarningCode
  /** The whole warning as one sentence: what is wrong, and what to fix. */
  message: string
}

/**
 * The fields a shape check reads. A stored `Ticket` satisfies it, which is what
 * both surfaces pass — the timeline event is written after the rows are stored,
 * and the card reads the rows themselves, so every warning can name its ticket
 * by the `#seq` the human sees on the ledger.
 */
export type TicketShapeSubject = Pick<Ticket, 'seq' | 'goal' | 'context'>

/**
 * Every shape worth warning about in one batch, batch-level warning first.
 *
 * Deliberately not keyed on how the batch was created: the degenerate shape is
 * observable in the rows themselves (a quick change's tickets carry the typed
 * sentence as BOTH goal and context, by construction), so the same rules read
 * the same way at the door and on the card, with nothing inferred about
 * provenance in either place.
 */
export function ticketShapeWarnings(
  tickets: readonly TicketShapeSubject[],
): TicketShapeWarning[] {
  const out: TicketShapeWarning[] = []
  const degenerate = tickets.filter(goalRepeatsContext)
  if (degenerate.length > DEGENERATE_BATCH_TICKETS) {
    out.push({
      code: 'degenerate-batch',
      message:
        `${degenerate.length} tickets (${degenerate.map(named).join(', ')}) carry their goal as their context — ` +
        'that is the quick-change door used as an importer. Work this size deserves a session ' +
        `first: shape it into a feature with a spec, or cut the batch to ${DEGENERATE_BATCH_TICKETS} tickets or fewer.`,
    })
  }
  for (const ticket of tickets) {
    const context = ticket.context.trim()
    if (goalRepeatsContext(ticket)) {
      out.push({
        code: 'goal-is-context',
        message:
          `${named(ticket)} repeats its goal as its context — write a context that says where in ` +
          'the codebase the work is, which existing pattern to follow, and what it must not break.',
      })
    } else if (context.length < THIN_TICKET_CONTEXT_CHARS) {
      out.push({
        code: 'thin-context',
        message:
          `${named(ticket)} has a ${context.length}-character context — under ${THIN_TICKET_CONTEXT_CHARS} ` +
          'there is nothing for a coder to read before it writes: name the files, the existing ' +
          'pattern to follow, and the evidence that proves it done.',
      })
    }
    if (looksLikePastedDocument(context)) {
      out.push({
        code: 'pasted-document',
        message:
          `${named(ticket)} has a ${context.length}-character context that reads like a pasted ` +
          "document — keep the ticket's own goal, context and acceptance criteria, and point at " +
          'the doc for the rest.',
      })
    }
  }
  return out
}

/** The digest a burn is about to inject, when it is big enough to say so. */
export function docsDigestSizeWarning(bytes: number): TicketShapeWarning | null {
  if (bytes <= DOCS_DIGEST_WARN_BYTES) return null
  return {
    code: 'oversized-docs-digest',
    message:
      `the docs digest is ${bytes} bytes, over the ${DOCS_DIGEST_WARN_BYTES}-byte budget, and every ` +
      'ticket in this burn pays it — trim the feature docs, or move what only a ticket needs into ' +
      'that ticket.',
  }
}

/**
 * The warnings as one line for a card or an event message. A degenerate import
 * yields a warning per ticket and then some, so only the first few are spelled
 * out and the rest are counted — the surfaces have one line each, and a line
 * nobody can read to the end warns nobody.
 */
export function ticketShapeWarningLine(
  warnings: readonly TicketShapeWarning[],
  spelledOut = 3,
): string | undefined {
  if (warnings.length === 0) return undefined
  const shown = warnings.slice(0, spelledOut)
  const rest = warnings.length - shown.length
  return `${shown.map((w) => w.message).join(' ')}${rest > 0 ? ` (+${rest} more like this.)` : ''}`
}

/** How a warning names its ticket: the `#seq` the ledger and the events use. */
function named(ticket: TicketShapeSubject): string {
  return `#${ticket.seq}`
}

/** A context that is just the goal said again — the degenerate import's mark. */
function goalRepeatsContext(ticket: TicketShapeSubject): boolean {
  const context = ticket.context.trim()
  return context !== '' && context === ticket.goal.trim()
}

/**
 * Text long enough, and sectioned like a document, to be something pasted in
 * rather than written for this ticket: a markdown heading. A ticket's own
 * context is prose about one piece of work and never needs sections.
 *
 * Only the heading, deliberately. This also used to fire on a single bullet, a
 * single numbered line, three paragraphs, or a last character that happened to
 * be a letter ("truncated mid-word") — but the tickets skill demands a context
 * that names every file and pattern the ticket touches, which is exactly how a
 * good context gets long, listed and paragraphed, and ending without a full
 * stop is not truncation. Those four told a thorough session to cut the context
 * it had just been told to write, so they are gone.
 */
function looksLikePastedDocument(text: string): boolean {
  if (text.length <= PASTED_DOCUMENT_CHARS) return false
  return /^\s{0,3}#{1,6}\s/m.test(text) // ## a heading
}
