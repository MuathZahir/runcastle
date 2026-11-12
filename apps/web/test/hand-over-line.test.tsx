// @vitest-environment happy-dom
import { foldThread, type ThreadEvent, type ThreadEventBody } from '@runcastle/core'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatThread } from '../src/components/chat/thread/ChatThread'

/**
 * The runcastle hand-over line in a feature's chat (one-place-to-answer
 * decision 13): when an epic-run feature becomes the human's because its lead
 * waited on them, the server writes one quiet notice into the lead's log at
 * that point; it draws as runcastle's line, above the lead's question, and is
 * not the agent's words. A typed take writes none (the server's tests cover
 * that), so a log without it shows no such line.
 */

const LINE = 'This is yours now: it needed you. Payments carries on with the rest of the batch.'
const QUESTION = 'Which currency should totals show when a team spans two countries?'

function log(bodies: ThreadEventBody[]): ThreadEvent[] {
  return bodies.map((body, i) => ({ ...body, i, at: 1_000 + i }) as ThreadEvent)
}

const turn = (withLine: boolean): ThreadEventBody[] => [
  { type: 'prompt', id: 'p1', text: '[runcastle] plan this feature', source: 'runcastle' },
  { type: 'turn_started' },
  { type: 'agent_text', messageId: 'm1', text: 'The brief leaves the currency open.' },
  ...(withLine ? [{ type: 'notice' as const, text: LINE }] : []),
  { type: 'agent_text', messageId: 'm2', text: QUESTION },
  { type: 'turn_ended', reason: 'end_turn' },
]

afterEach(cleanup)

describe('the hand-over line in the feature chat', () => {
  it('shows after a needs-you release, above the lead’s question', () => {
    const { container } = render(<ChatThread items={foldThread(log(turn(true))).items} state="idle" footer={null} />)
    expect(screen.getByText(LINE)).toBeTruthy()
    const text = container.textContent ?? ''
    expect(text.indexOf(LINE)).toBeGreaterThan(-1)
    expect(text.indexOf(LINE)).toBeLessThan(text.indexOf(QUESTION))
  })

  it('is absent when the log has no release (a typed take writes none)', () => {
    render(<ChatThread items={foldThread(log(turn(false))).items} state="idle" footer={null} />)
    expect(screen.queryByText(/This is yours now/)).toBeNull()
    expect(screen.getByText(QUESTION)).toBeTruthy()
  })
})
