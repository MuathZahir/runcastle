import { lastHumanAt, type SessionRow, type ThreadEvent } from '@runcastle/core'
import { describe, expect, it } from 'vitest'
import { namesItsSubject, runtimeMayName, threadName } from '../src/threads/naming'

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

describe('other threads keep their naming', () => {
  it.each(['chat', 'side', 'prepare'] as const)('a briefed %s thread ignores the runtime title', (kind) => {
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
