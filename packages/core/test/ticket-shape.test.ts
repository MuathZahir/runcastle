import { describe, expect, it } from 'vitest'
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

const ticket = (label: string, over: Partial<{ goal: string; context: string }> = {}) => ({
  label,
  goal: 'Warn about thin ticket contexts on the burn card.',
  context: thickContext,
  ...over,
})

const codes = (tickets: Parameters<typeof ticketShapeWarnings>[0]) =>
  ticketShapeWarnings(tickets).map((w) => w.code)

describe('ticketShapeWarnings', () => {
  it('says nothing about a well-formed batch', () => {
    expect(ticketShapeWarnings([ticket('#1'), ticket('#2'), ticket('#3')])).toEqual([])
  })

  it('flags a context that is only the goal said again, and names the ticket', () => {
    const [warning, ...rest] = ticketShapeWarnings([
      ticket('#2', { goal: 'Ship the thing.', context: 'Ship the thing.' }),
    ])
    expect(rest).toEqual([])
    expect(warning.code).toBe('goal-is-context')
    expect(warning.message).toContain('#2')
    expect(warning.message).toContain('repeats its goal as its context')
  })

  it('flags a thin context with its length, not as well as the degenerate one', () => {
    const thin = ticketShapeWarnings([ticket('#1', { context: 'See the goal, plus some.' })])
    expect(thin.map((w) => w.code)).toEqual(['thin-context'])
    expect(thin[0].message).toContain('#1')
    expect(thin[0].message).toContain('24-character context')
    expect(thin[0].message).toContain(String(THIN_TICKET_CONTEXT_CHARS))

    // The sharper diagnosis wins: a degenerate ticket is not also reported thin.
    expect(codes([ticket('#1', { goal: 'Do it.', context: 'Do it.' })])).toEqual([
      'goal-is-context',
    ])
  })

  it('takes a context just over the floor as thick enough', () => {
    const justOver = 'x'.repeat(THIN_TICKET_CONTEXT_CHARS)
    expect(codes([ticket('#1', { context: justOver })])).toEqual([])
  })

  it('flags a long context that reads like a pasted document', () => {
    const pasted = `## Background\n\n${'the pasted wall of prose. '.repeat(70)}`
    expect(pasted.length).toBeGreaterThan(PASTED_DOCUMENT_CHARS)
    const warnings = ticketShapeWarnings([ticket('#4', { context: pasted })])
    expect(warnings.map((w) => w.code)).toEqual(['pasted-document'])
    expect(warnings[0].message).toContain('#4')
    expect(warnings[0].message).toContain('pasted')
  })

  it('takes a long single paragraph that ends like a sentence as the ticket own prose', () => {
    const own = `${'this ticket genuinely has a lot to say about the seam it touches. '.repeat(30)}`
    expect(own.length).toBeGreaterThan(PASTED_DOCUMENT_CHARS)
    expect(codes([ticket('#1', { context: own.trim() })])).toEqual([])
  })

  it('flags a blob that simply stops mid-word', () => {
    const truncated = `${'a sentence that keeps going and going and going. '.repeat(32)}and then it stop`
    expect(codes([ticket('#5', { context: truncated })])).toEqual(['pasted-document'])
  })

  it('reports the degenerate import as a batch, before the per-ticket lines', () => {
    const batch = Array.from({ length: DEGENERATE_BATCH_TICKETS + 1 }, (_, i) =>
      ticket(`#${i + 1}`, { goal: `Change number ${i + 1}.`, context: `Change number ${i + 1}.` }),
    )
    const warnings = ticketShapeWarnings(batch)
    expect(warnings[0].code).toBe('degenerate-batch')
    expect(warnings[0].message).toContain(`${DEGENERATE_BATCH_TICKETS + 1} tickets`)
    expect(warnings[0].message).toContain('#1, #2')
    expect(warnings.slice(1).map((w) => w.code)).toEqual(batch.map(() => 'goal-is-context'))
  })

  it('leaves a batch at the budget to its per-ticket warnings alone', () => {
    const batch = Array.from({ length: DEGENERATE_BATCH_TICKETS }, (_, i) =>
      ticket(`#${i + 1}`, { goal: `Change ${i + 1}.`, context: `Change ${i + 1}.` }),
    )
    expect(codes(batch)).not.toContain('degenerate-batch')
  })

  it('reads an empty context as the thinnest context there is, not as a repeat of an empty goal', () => {
    expect(codes([ticket('#1', { context: '', goal: '' })])).toEqual(['thin-context'])
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
      ticket(`#${i + 1}`, { goal: `Change ${i + 1}.`, context: `Change ${i + 1}.` }),
    )
    const line = ticketShapeWarningLine(ticketShapeWarnings(batch))
    expect(line).toContain('8 tickets')
    expect(line).toContain('#1 repeats its goal')
    expect(line).toContain('#2 repeats its goal')
    expect(line).toContain('(+6 more like this.)')
    expect(line).not.toContain('#4 repeats its goal')
  })
})
