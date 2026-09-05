import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { laneBands, laneFacts, soloRetrySeq, verdictStrip } from '../src/lib/feature-ui/run'
import type { LaneBandTicket } from '../src/lib/feature-ui/run'
import { RunHeader } from '../src/components/run/RunHeader'
import { Lane } from '../src/components/run/Lane'
import type { LaneRow } from '../src/components/run/Lane'
import { RunLanes } from '../src/components/run/RunLanes'

/**
 * The run view rebuilt lanes-first (decisions #10–#14, #16). Rendered to static
 * markup rather than driven through a DOM, exactly as `lap-sections.test.ts` and
 * `review-findings.test.ts` do: the lane and the header take everything they
 * show as props — the tRPC reads all live in `RunBody` — so their whole
 * behaviour is the markup they emit per state.
 */

/** A ticket as both the bands and the lane read it. `Ticket` satisfies both. */
type RunTicket = LaneRow & LaneBandTicket

const row = (over: Partial<RunTicket> & { seq: number }): RunTicket => ({
  id: `t${over.seq}`,
  title: 'wire the settings pane',
  kind: 'implementation',
  status: 'pending',
  commits: [],
  ...over,
})

const laneHtml = (props: Partial<Parameters<typeof Lane>[0]> & { ticket: LaneRow }) =>
  renderToStaticMarkup(
    createElement(Lane, {
      featureBranch: 'feature/demo',
      readonly: false,
      expanded: false,
      onToggle: () => {},
      ...props,
    }),
  )

describe('laneBands', () => {
  it('bands a mid-run fix wave under the review lane and the verification after it', () => {
    const bands = laneBands([
      row({ seq: 1 }),
      row({ seq: 2, kind: 'review' }),
      row({ seq: 3, originFindingId: 'fnd_1' }),
      row({ seq: 4, originFindingId: 'fnd_2' }),
      row({ seq: 5, kind: 'review', passKind: 'verification' }),
    ])
    expect(bands.map((b) => b.kind)).toEqual(['plain', 'review-fixes', 'verification'])
    expect(bands[0].rows.map((r) => r.seq)).toEqual([1, 2])
    expect(bands[1].title).toBe('Review fixes')
    expect(bands[1].rows.map((r) => r.seq)).toEqual([3, 4])
    expect(bands[2].title).toBe('Verifying 2 fixes — recording a fresh walkthrough')
  })

  /**
   * A ticket promoted from an earlier lap's triage carries the same
   * `originFindingId` marker but was emitted BEFORE this run's review — it is
   * ordinary work burning alongside the rest, not part of the wave.
   */
  it('leaves a fix ticket that predates the review lane among the ordinary lanes', () => {
    const bands = laneBands([
      row({ seq: 1, originFindingId: 'fnd_old' }),
      row({ seq: 2, kind: 'review' }),
    ])
    expect(bands).toHaveLength(1)
    expect(bands[0].rows.map((r) => r.seq)).toEqual([1, 2])
  })

  it('counts the implementation lanes when a verification follows a burn with no review', () => {
    const bands = laneBands([row({ seq: 1 }), row({ seq: 2, kind: 'review', passKind: 'verification' })])
    expect(bands[1].title).toBe('Verifying 1 fixes — recording a fresh walkthrough')
  })

  it('returns one plain band for an ordinary burn', () => {
    expect(laneBands([row({ seq: 2 }), row({ seq: 1 })])).toEqual([
      { kind: 'plain', rows: [expect.objectContaining({ seq: 1 }), expect.objectContaining({ seq: 2 })] },
    ])
  })
})

describe('laneFacts', () => {
  it('dates a lane from its first event and remembers whether the agent ever spoke', () => {
    const facts = laneFacts([
      { type: 'burn.setup', ticketId: 't1', ts: 100 },
      { type: 'ticket.burning', ticketId: 't1', ts: 120 },
      { type: 'burn.text', ticketId: 't1', ts: 140 },
      { type: 'burn.setup', ticketId: 't2', ts: 105 },
      { type: 'ticket.failed', ticketId: 't2', ts: 106 },
      { type: 'run.started', ts: 90 },
    ])
    expect(facts.get('t1')).toEqual({ hadOutput: true, startedAt: 100 })
    expect(facts.get('t2')).toEqual({ hadOutput: false, startedAt: 105 })
    expect(facts.size).toBe(2)
  })
})

describe('soloRetrySeq', () => {
  const t = (id: string, seq: number, status: string) => ({ id, seq, status })

  it('names the one lane a per-ticket retry is running', () => {
    const tickets = [t('t1', 1, 'done'), t('t2', 4, 'burning')]
    const events = [{ type: 'ticket.retry', ticketId: 't2', ts: 1 }]
    expect(soloRetrySeq(tickets, events)).toBe(4)
  })

  it('stays quiet for an ordinary burn winding down to its last lane', () => {
    const tickets = [t('t1', 1, 'done'), t('t2', 2, 'burning')]
    expect(soloRetrySeq(tickets, [{ type: 'ticket.burning', ticketId: 't2', ts: 1 }])).toBeUndefined()
  })
})

describe('Lane', () => {
  it('reads a stopped lane as set aside rather than failed, and keeps both retries', () => {
    const html = laneHtml({
      ticket: row({ seq: 3, status: 'failed', error: 'stopped by user' }),
      onRetry: () => {},
      onRetryFresh: () => {},
      onWaive: () => {},
    })
    expect(html).toContain('stopped')
    expect(html).not.toContain('text-danger')
    expect(html).toContain('Retry')
    expect(html).toContain('Retry fresh')
    expect(html).toContain('Waive')
  })

  it('paints a real failure red and opens on its verdict', () => {
    const ticket = row({ seq: 3, status: 'failed', error: 'agent made no commits' })
    const html = laneHtml({ ticket, expanded: true, onRetry: () => {} })
    expect(html).toContain('text-danger')
    expect(html).toContain(verdictStrip({ seq: 3, status: 'failed', error: 'agent made no commits' })!.text)
  })

  /**
   * Decision 16(c): a lane that died before the agent ever spoke is a sandbox
   * that never started, and reads differently from an agent that failed —
   * the raw engine error behind a disclosure, with a hint when the cause is one
   * we recognise.
   */
  it('treats a launch death as its own state, with the raw error behind a disclosure', () => {
    const html = laneHtml({
      ticket: row({
        seq: 2,
        status: 'failed',
        error: 'docker: mount failed — path too long on Windows',
      }),
      hadOutput: false,
      expanded: true,
    })
    expect(html).toContain('launch failed')
    expect(html).toContain('The agent sandbox never started.')
    expect(html).toContain('A long Windows path may have prevented the sandbox mount.')
    expect(html).toContain('<details')
    expect(html).toContain('path too long on Windows')
  })

  it('mutes a waived lane and stops offering it work', () => {
    const html = laneHtml({ ticket: row({ seq: 5, status: 'cancelled' }), onRetry: () => {} })
    expect(html).toContain('set aside')
    expect(html).not.toContain('Waive')
    expect(html).not.toContain('Retry fresh')
  })

  it('gives a burning lane a live pulse and its elapsed time', () => {
    const html = laneHtml({
      ticket: row({ seq: 1, status: 'burning' }),
      elapsed: '2m 04s',
      onStop: () => {},
    })
    expect(html).toContain('animate-')
    expect(html).toContain('2m 04s')
    expect(html).toContain('Stop ticket')
  })

  it('chips the first commit of a done lane', () => {
    const html = laneHtml({
      ticket: row({ seq: 1, status: 'done', commits: ['0123456789abcdef', 'fedcba9876543210'] }),
    })
    expect(html).toContain('0123456')
    expect(html).not.toContain('fedcba9')
  })

  it('badges the review lane, the verification pass and the runtime the lane burns on', () => {
    const review = laneHtml({ ticket: row({ seq: 2, kind: 'review' }) })
    expect(review).toContain('review')

    const verify = laneHtml({ ticket: row({ seq: 3, kind: 'review', passKind: 'verification' }) })
    expect(verify).toContain('verification')

    const codex = laneHtml({
      ticket: row({ seq: 1 }),
      model: { id: 'gpt-5-codex', runtime: 'codex', runtimeLabel: 'Codex' },
    })
    expect(codex).toContain('gpt-5-codex')
    expect(codex).toContain('Codex')
  })

  it('names the defect a fix lane exists for', () => {
    const html = laneHtml({
      ticket: row({ seq: 4, originFindingId: 'fnd_1' }),
      defectTitle: 'the save drops the edited value',
    })
    expect(html).toContain('the save drops the edited value')
  })

  it('offers no action at all in the read-only record', () => {
    const html = laneHtml({
      ticket: row({ seq: 3, status: 'failed', error: 'boom' }),
      readonly: true,
      onRetry: () => {},
      onWaive: () => {},
    })
    expect(html).not.toContain('Retry')
    expect(html).not.toContain('Waive')
  })
})

describe('RunLanes', () => {
  const render = (tickets: (RunTicket & { lap: number })[], currentLap: number) =>
    renderToStaticMarkup(
      createElement(RunLanes<RunTicket & { lap: number }>, {
        tickets,
        currentLap,
        lane: (t) => createElement('span', { key: t.id }, `#${t.seq}`),
      }),
    )

  it('indents the review-fix wave under its band header and the verification after it', () => {
    const html = render(
      [
        { ...row({ seq: 1 }), lap: 1 },
        { ...row({ seq: 2, kind: 'review' }), lap: 1 },
        { ...row({ seq: 3, originFindingId: 'fnd_1' }), lap: 1 },
        { ...row({ seq: 4, kind: 'review', passKind: 'verification' }), lap: 1 },
      ],
      1,
    )
    expect(html).toContain('Review fixes')
    expect(html).toContain('Verifying 1 fixes — recording a fresh walkthrough')
    expect(html.indexOf('Review fixes')).toBeLessThan(html.indexOf('#3'))
    expect(html.indexOf('#3')).toBeLessThan(html.indexOf('Verifying 1 fixes'))
  })

  /**
   * A Burn burns every pending ticket across laps (decision #28a), so a lap-2
   * run legitimately carries lap-1 leftovers — unlabelled, they read as this
   * lap's work.
   */
  it('divides the lanes by lap once the ledger spans laps', () => {
    const spanning = render(
      [
        { ...row({ seq: 1 }), lap: 1 },
        { ...row({ seq: 2 }), lap: 2 },
      ],
      2,
    )
    expect(spanning).toContain('Lap 1')
    expect(spanning).toContain('Lap 2')
    expect(spanning).toContain('1 lane')

    // A feature that never iterated gets no lap ceremony at all (ADR-0010 §4).
    expect(render([{ ...row({ seq: 1 }), lap: 1 }], 1)).not.toContain('Lap 1')
  })
})

describe('RunHeader', () => {
  it('leads with the honest counts and the elapsed clock', () => {
    const html = renderToStaticMarkup(
      createElement(RunHeader, {
        headline: 'Burning 3 tickets · +2 fixes from review · 2 done · 1 stopped',
        elapsed: '4m 10s',
        burning: 1,
        onCancelRun: () => {},
      }),
    )
    expect(html).toContain('Burning 3 tickets · +2 fixes from review · 2 done · 1 stopped')
    expect(html).toContain('4m 10s')
    expect(html).toContain('Cancel run')
  })

  it('drops the cancel control when nothing is running', () => {
    const html = renderToStaticMarkup(
      createElement(RunHeader, { headline: 'Burning 1 ticket · 1 done', elapsed: '1m', burning: 0 }),
    )
    expect(html).not.toContain('Cancel run')
  })
})
