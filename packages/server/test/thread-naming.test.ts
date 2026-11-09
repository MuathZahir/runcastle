import { lastHumanAt, type SessionRow, type ThreadEvent } from '@runcastle/core'
import { describe, expect, it } from 'vitest'
import { givenNames, namesItsSubject, runtimeMayName, threadName } from '../src/threads/naming'

const row = (over: Partial<SessionRow> = {}): SessionRow =>
  ({ id: 'sess_1', kind: 'project', title: null, runtime: 'claude-code', ...over }) as SessionRow

let i = 0
const event = (body: Record<string, unknown>, at = 0): ThreadEvent => ({ i: i++, at, ...body }) as ThreadEvent
const human = (text: string, at = 0) => event({ type: 'prompt', id: `p${i}`, text, source: 'human' }, at)
const briefed = () => event({ type: 'briefed' })
const generated = (title: string) => event({ type: 'title', title })

describe('what an Orchestrator thread is called', () => {
  it('takes the runtime title after a briefing', () => {
    const events = [briefed(), human('can this run on a server?'), generated('Running Runcastle on a remote VPS')]
    expect(threadName(row(), events)).toBe('Running Runcastle on a remote VPS')
  })

  it.each(['Runcastle project session', 'Runcastle project skill', 'Project session invocation', 'Resume conversation prompt'])(
    'falls back to the first message over "%s"',
    (title) => {
      expect(threadName(row(), [briefed(), human('triage my notes'), generated(title)])).toBe('triage my notes')
    },
  )

  it('skips a title the host stored that only names the session', () => {
    const title = 'Runcastle project session'
    expect(threadName(row({ title }), [human('triage my notes'), generated(title)])).toBe('triage my notes')
  })

  it("keeps the human's rename over everything", () => {
    const events = [briefed(), human('hi'), generated('A good title'), event({ type: 'title', title: 'Mine', renamed: true })]
    expect(threadName(row(), events)).toBe('Mine')
  })

  it('keeps the first message until a title arrives', () => {
    expect(threadName(row(), [briefed(), human('triage my notes')])).toBe('triage my notes')
  })
})

describe("an epic's own name", () => {
  const epic = (title: string) => event({ type: 'title', title, by: 'orchestrator' })

  it("beats the runtime's generated title and the first message, before and after it", () => {
    expect(threadName(row(), [briefed(), human('pay with stripe?'), epic('Payment System')])).toBe('Payment System')
    const events = [briefed(), human('pay with stripe?'), epic('Payment System'), generated('Adding Stripe payments to checkout')]
    expect(threadName(row(), events)).toBe('Payment System')
  })

  it('beats a generated title the host stored on the row', () => {
    const title = 'Adding Stripe payments to checkout'
    expect(threadName(row({ title }), [human('pay?'), generated(title), epic('Payment System')])).toBe('Payment System')
  })

  it("loses to the human's rename, whichever came last", () => {
    const rename = () => event({ type: 'title', title: 'Money', renamed: true })
    expect(threadName(row(), [human('pay?'), epic('Payment System'), rename()])).toBe('Money')
    expect(threadName(row(), [human('pay?'), rename(), epic('Payment System')])).toBe('Money')
    expect(givenNames([human('pay?'), rename(), epic('Payment System')])).toEqual({ renamed: 'Money', epicName: 'Payment System' })
  })

  it('takes the latest of its names', () => {
    expect(threadName(row(), [human('pay?'), epic('Payments'), epic('Payment System')])).toBe('Payment System')
  })

  it("is the parent's, not a branch's", () => {
    const events = [human('pay?'), epic('Payment System'), event({ type: 'branched', from: 'Payment System' })]
    expect(givenNames(events)).toEqual({})
    expect(threadName(row(), events)).toBe('Branch of Payment System')
  })
})

describe('other threads keep their naming', () => {
  it.each(['chat', 'side'] as const)('a briefed %s thread ignores the runtime title', (kind) => {
    const events = [briefed(), human('fix the bay'), generated('Runcastle lead session')]
    expect(runtimeMayName(row({ kind }), events)).toBe(false)
    expect(threadName(row({ kind }), events)).toBe('fix the bay')
  })

  it('an unbriefed side thread takes it, whatever it says', () => {
    expect(threadName(row({ kind: 'side' }), [human('hi'), generated('Fixing the orchestrator skill')])).toBe(
      'Fixing the orchestrator skill',
    )
    expect(namesItsSubject(row({ kind: 'side' }), 'Runcastle project session')).toBe(true)
  })
})

describe('when the human last wrote', () => {
  it('is the newest of their own words', () => {
    expect(lastHumanAt([human('one', 10), human('two', 20), event({ type: 'agent_text', messageId: 'm', text: 'ok' }, 30)])).toBe(20)
  })

  it("does not count runcastle's prompts or hidden ones", () => {
    const runcastle = event({ type: 'prompt', id: 'r', text: 'news', source: 'runcastle' }, 40)
    const hidden = event({ type: 'prompt', id: 'h', text: '/compact', source: 'human', hidden: true }, 50)
    expect(lastHumanAt([human('one', 10), runcastle, hidden])).toBe(10)
  })

  it('is undefined when they never wrote', () => {
    expect(lastHumanAt([briefed()])).toBeUndefined()
  })
})
