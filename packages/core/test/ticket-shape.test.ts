import { describe, expect, it } from 'vitest'
import type { TicketKind } from '../src/schemas'
import {
  DEGENERATE_BATCH_TICKETS,
  DOCS_DIGEST_WARN_BYTES,
  PASTED_DOCUMENT_CHARS,
  THIN_TICKET_CONTEXT_CHARS,
  docsDigestSizeWarning,
  ticketShapeWarningLine,
  ticketShapeWarnings,
} from '../src/ticket-shape'

/** A context long enough to pass the thin rule, and written as one paragraph. */
const thickContext =
  'The burn card reads `resolveImplementation` in apps/web/src/lib/feature-ui/next-step, and the ' +
  'warnings come from core so the door and the card share one source of wording. Follow the ' +
  'existing `note` field on NextStep rather than inventing a second copy line, and leave the ' +
  'primary action alone — it must stay enabled.'

const ticket = (
  seq: number,
  over: Partial<{ goal: string; context: string; kind: TicketKind }> = {},
) => ({
  seq,
  goal: 'Warn about thin ticket contexts on the burn card.',
  context: thickContext,
  kind: 'implementation' as TicketKind,
  ...over,
})

const codes = (tickets: Parameters<typeof ticketShapeWarnings>[0]) =>
  ticketShapeWarnings(tickets).map((w) => w.code)

describe('ticketShapeWarnings', () => {
  it('says nothing about a well-formed batch', () => {
    expect(ticketShapeWarnings([ticket(1), ticket(2), ticket(3)])).toEqual([])
  })

  /**
   * The quick door writes the one sentence the human typed into BOTH goal and
   * context, so a per-ticket line for that shape fired on 100% of quick changes
   * — a careful one-liner included — and told the human to edit a field their
   * overlay does not have. Only the batch count says anything now.
   */
  it('says nothing about a lone ticket whose context is its goal again', () => {
    expect(ticketShapeWarnings([ticket(2, { goal: 'Ship the thing.', context: 'Ship the thing.' })])).toEqual([])
  })

  it('flags a thin context with its length', () => {
    const thin = ticketShapeWarnings([ticket(1, { context: 'See the goal, plus some.' })])
    expect(thin.map((w) => w.code)).toEqual(['thin-context'])
    expect(thin[0].message).toContain('#1')
    expect(thin[0].message).toContain('24-character context')
    expect(thin[0].message).toContain(String(THIN_TICKET_CONTEXT_CHARS))

    // A ticket with no second field is not a ticket with a short one: the quick
    // door's shape is not reported thin either.
    expect(codes([ticket(1, { goal: 'Do it.', context: 'Do it.' })])).toEqual([])
  })

  it('takes a context just over the floor as thick enough', () => {
    const justOver = 'x'.repeat(THIN_TICKET_CONTEXT_CHARS)
    expect(codes([ticket(1, { context: justOver })])).toEqual([])
  })

  it('flags a long context that reads like a pasted document', () => {
    const pasted = `## Background\n\n${'the pasted wall of prose. '.repeat(70)}`
    expect(pasted.length).toBeGreaterThan(PASTED_DOCUMENT_CHARS)
    const warnings = ticketShapeWarnings([ticket(4, { context: pasted })])
    expect(warnings.map((w) => w.code)).toEqual(['pasted-document'])
    expect(warnings[0].message).toContain('#4')
    expect(warnings[0].message).toContain('pasted')
  })

  it('takes a long single paragraph that ends like a sentence as the ticket own prose', () => {
    const own = `${'this ticket genuinely has a lot to say about the seam it touches. '.repeat(30)}`
    expect(own.length).toBeGreaterThan(PASTED_DOCUMENT_CHARS)
    expect(codes([ticket(1, { context: own.trim() })])).toEqual([])
  })

  it('takes a long context that lists the files it touches as the ticket own prose', () => {
    const listed = `${'x'.repeat(1600)}\n\n- packages/core/src/ticket-shape.ts`
    expect(codes([ticket(1, { context: listed })])).toEqual([])
    expect(codes([ticket(1, { context: `${'x'.repeat(1600)}\n\n1. run the repro` })])).toEqual([])
  })

  it('takes a long context written as three paragraphs as the ticket own prose', () => {
    const paragraphs = ['Location.', 'Citation.', 'x'.repeat(1600)].join('\n\n')
    expect(codes([ticket(1, { context: paragraphs })])).toEqual([])
  })

  it('does not read a context that ends without a full stop as a blob stopped mid-word', () => {
    const own = `${'a sentence that keeps going and going and going. '.repeat(32)}and then it stops`
    expect(own.length).toBeGreaterThan(PASTED_DOCUMENT_CHARS)
    expect(codes([ticket(5, { context: own })])).toEqual([])
  })

  it('reports the degenerate import as one batch line and nothing else', () => {
    const batch = Array.from({ length: DEGENERATE_BATCH_TICKETS + 1 }, (_, i) =>
      ticket(i + 1, { goal: `Change number ${i + 1}.`, context: `Change number ${i + 1}.` }),
    )
    const warnings = ticketShapeWarnings(batch)
    expect(warnings.map((w) => w.code)).toEqual(['degenerate-batch'])
    expect(warnings[0].message).toContain(`${DEGENERATE_BATCH_TICKETS + 1} tickets`)
    expect(warnings[0].message).toContain('#1, #2')
  })

  it('says nothing at all about a batch inside the door budget', () => {
    const batch = Array.from({ length: DEGENERATE_BATCH_TICKETS }, (_, i) =>
      ticket(i + 1, { goal: `Change ${i + 1}.`, context: `Change ${i + 1}.` }),
    )
    expect(codes(batch)).toEqual([])
  })

  it('reads an empty context as the thinnest context there is, not as a repeat of an empty goal', () => {
    expect(codes([ticket(1, { context: '', goal: '' })])).toEqual(['thin-context'])
  })

  /**
   * The review ticket is the pipeline's writing, not the human's, and the one
   * place the door and the card used to disagree: the door dropped it by
   * position and the card kept it, so a batch whose review ticket tripped a rule
   * was warned about in one surface and not the other.
   */
  it('says nothing about the review ticket, whose context is nobody typing thinly', () => {
    expect(codes([ticket(1), ticket(2, { kind: 'review', context: 'Review the lap.' })])).toEqual(
      [],
    )
    expect(
      codes([ticket(1), ticket(2, { kind: 'review', goal: 'Review it.', context: 'Review it.' })]),
    ).toEqual([])
  })

  it('still reads every implementation ticket beside a thin review ticket', () => {
    expect(
      codes([
        ticket(1, { context: 'It washes out.' }),
        ticket(2, { kind: 'review', context: 'Review the lap.' }),
      ]),
    ).toEqual(['thin-context'])
  })

  it('leaves the review ticket out of the batch tally too', () => {
    const batch = Array.from({ length: DEGENERATE_BATCH_TICKETS }, (_, i) =>
      ticket(i + 1, { goal: `Change ${i + 1}.`, context: `Change ${i + 1}.` }),
    )
    const review = ticket(DEGENERATE_BATCH_TICKETS + 1, {
      kind: 'review',
      goal: 'Review it.',
      context: 'Review it.',
    })
    expect(codes([...batch, review])).not.toContain('degenerate-batch')
  })
})

describe('docsDigestSizeWarning', () => {
  it('says nothing about a digest within the budget', () => {
    expect(docsDigestSizeWarning(0)).toBeNull()
    expect(docsDigestSizeWarning(DOCS_DIGEST_WARN_BYTES)).toBeNull()
  })

  it('names the size and the budget once the digest is over it', () => {
    const warning = docsDigestSizeWarning(97_000)
    expect(warning?.code).toBe('oversized-docs-digest')
    expect(warning?.message).toContain('97000 bytes')
    expect(warning?.message).toContain(String(DOCS_DIGEST_WARN_BYTES))
  })
})

describe('ticketShapeWarningLine', () => {
  it('is absent when there is nothing to warn about', () => {
    expect(ticketShapeWarningLine([])).toBeUndefined()
  })

  it('spells out the first few and counts the rest', () => {
    const batch = Array.from({ length: 8 }, (_, i) =>
      ticket(i + 1, { goal: `Change ${i + 1}.`, context: `Somewhere in the app.` }),
    )
    const line = ticketShapeWarningLine(ticketShapeWarnings(batch))
    expect(line).toContain('#1 has a 21-character context')
    expect(line).toContain('#3 has a 21-character context')
    expect(line).toContain('(+5 more like this.)')
    expect(line).not.toContain('#4 has a')
  })
})
