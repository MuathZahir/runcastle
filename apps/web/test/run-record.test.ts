import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { runHeadline, transcriptBlocks } from '../src/lib/feature-ui/run'
import { Lane } from '../src/components/run/Lane'
import type { LaneRow } from '../src/components/run/Lane'
import { LaneDigest } from '../src/components/run/LaneDigest'
import { RunHeader } from '../src/components/run/RunHeader'
import { RunPicker } from '../src/components/run/RunPicker'
import type { RunOption } from '../src/components/run/RunPicker'

/**
 * The run record (decision #15b) and the transcript hygiene that survives into
 * it (decision #13a–b), as static markup — the same tier as `run-lanes.test.ts`,
 * because every one of these components takes what it shows as a prop.
 *
 * What the record has to get right is honesty about time: it renders lanes that
 * finished, over a run that ended, with a transcript the server no longer holds.
 */

const run = (over: Partial<RunOption> & { id: string }): RunOption => ({
  status: 'succeeded',
  startedAt: Date.now() - 3_600_000,
  endedAt: Date.now() - 3_000_000,
  lap: 1,
  ticketIds: ['t1', 't2'],
  ...over,
})

const laneRow = (over: Partial<LaneRow> = {}): LaneRow => ({
  id: 't1',
  seq: 1,
  title: 'wire the settings pane',
  kind: 'implementation',
  status: 'done',
  commits: ['0123456789abcdef'],
  ...over,
})

describe('RunPicker', () => {
  it('counts the feature runs and names each by age, state, lap and lane count', () => {
    const html = renderToStaticMarkup(
      createElement(RunPicker, {
        runs: [
          run({ id: 'r3', lap: 2, ticketIds: ['t9'] }),
          run({ id: 'r2', status: 'failed' }),
          run({ id: 'r1', status: 'cancelled' }),
        ],
        selectedId: 'r3',
        latestId: 'r3',
        onPick: () => {},
      }),
    )
    expect(html).toContain('3 runs')
    expect(html).toContain('Lap 2 · 1 lane')
    expect(html).toContain('Lap 1 · 2 lanes')
    expect(html).toContain('failed')
    expect(html).toContain('cancelled')
    expect(html).toContain('latest')
  })

  it('renders nothing at all until the feature has burned once', () => {
    const html = renderToStaticMarkup(
      createElement(RunPicker, { runs: [], selectedId: null, latestId: null, onPick: () => {} }),
    )
    expect(html).toBe('')
  })
})

describe('RunHeader in record mode', () => {
  const record = (over: Partial<Parameters<typeof RunHeader>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(RunHeader, {
        headline: 'Burned 2 tickets · 2 done',
        elapsed: '6m 02s',
        status: 'succeeded' as const,
        burning: 0,
        runs: [run({ id: 'r1' }), run({ id: 'r2' })],
        selectedRunId: 'r1',
        latestRunId: 'r2',
        onPickRun: () => {},
        onBackToLatest: () => {},
        ...over,
      }),
    )

  it('names the run as history and offers the way back to the latest', () => {
    const html = record()
    expect(html).toContain('Past run')
    expect(html).toContain('Back to latest')
    expect(html).toContain('succeeded')
    expect(html).not.toContain('Cancel run')
  })

  it('is the ordinary run header again once the latest run is back on screen', () => {
    const html = record({ onBackToLatest: undefined, selectedRunId: 'r2' })
    expect(html).toContain('>Run<')
    expect(html).not.toContain('Back to latest')
    // The counter stays either way — history is reachable from the live view too.
    expect(html).toContain('2 runs')
  })

  /**
   * The header used to say "Burning N tickets" whatever the run had done, which
   * over a record's settled lanes is the same lie the redesign removes elsewhere.
   */
  it('speaks in the past tense over a run that has stopped', () => {
    const tickets = [
      { seq: 1, status: 'done' },
      { seq: 2, status: 'failed', error: 'agent made no commits' },
    ]
    expect(runHeadline(tickets, { status: 'succeeded' })).toBe(
      'Burned 2 tickets · 1 done · 1 failed',
    )
    expect(runHeadline(tickets, { status: 'running' })).toBe(
      'Burning 2 tickets · 1 done · 1 failed',
    )
  })
})

describe('a record lane', () => {
  it('renders terminal, with no controls and the burner own account of the ticket', () => {
    const html = renderToStaticMarkup(
      createElement(
        Lane,
        {
          ticket: laneRow({ status: 'failed', error: 'agent made no commits' }),
          featureBranch: 'feature/demo',
          readonly: true,
          expanded: true,
          onToggle: () => {},
          duration: '3m 20s',
        },
        createElement(LaneDigest, { digest: '## What was done\n\nSplit the pane in two.' }),
      ),
    )
    expect(html).toContain('failed')
    expect(html).toContain('3m 20s')
    // The verdict still explains the failure; nothing offers to act on it.
    expect(html).toContain('none did')
    expect(html).not.toContain('Retry')
    expect(html).not.toContain('Waive')
    expect(html).toContain('What this ticket produced')
    expect(html).toContain('Split the pane in two.')
  })

  it('shows no digest disclosure for a lane whose burner wrote none', () => {
    expect(renderToStaticMarkup(createElement(LaneDigest, {}))).toBe('')
    expect(renderToStaticMarkup(createElement(LaneDigest, { digest: '   ' }))).toBe('')
  })
})

/**
 * Decision #13(a–b). The burner's wire protocol was the agent's last words on
 * screen and tool lines spoke in container paths, neither of which means
 * anything to the human reading the lane.
 */
describe('transcript hygiene', () => {
  it('swallows the completion marker and reports it as UI instead', () => {
    const { blocks, completed } = transcriptBlocks([
      { kind: 'text', text: 'Committed the fix.\n\n' },
      { kind: 'text', text: '<promise>COMPLETE</promise>' },
    ])
    expect(completed).toBe(true)
    expect(blocks).toEqual([{ kind: 'text', text: 'Committed the fix.' }])
    expect(JSON.stringify(blocks)).not.toContain('promise')
  })

  it('drops a text block that was nothing but the marker, and reports nothing without one', () => {
    expect(transcriptBlocks([{ kind: 'text', text: '<promise>COMPLETE</promise>' }])).toEqual({
      blocks: [],
      completed: true,
    })
    expect(transcriptBlocks([{ kind: 'text', text: 'still going' }]).completed).toBe(false)
  })

  it('rewrites sandbox paths in a tool line without losing the prose around them', () => {
    const { blocks } = transcriptBlocks([
      {
        kind: 'tool',
        name: 'Edit',
        text: 'editing /home/agent/cache/slots/1/repo/src/App.tsx  and\n/home/agent/cache/slots/1/repo/test/app.test.ts',
      },
    ])
    expect(blocks).toEqual([
      { kind: 'tool', name: 'Edit', args: 'editing src/App.tsx and test/app.test.ts' },
    ])
  })

  it('merges the stream arbitrary text slices into one prose block', () => {
    const { blocks } = transcriptBlocks([
      { kind: 'text', text: 'I read the ' },
      { kind: 'text', text: 'spec first.' },
      { kind: 'tool', name: 'Read', text: 'docs/SPEC.md' },
    ])
    expect(blocks).toEqual([
      { kind: 'text', text: 'I read the spec first.' },
      { kind: 'tool', name: 'Read', args: 'docs/SPEC.md' },
    ])
  })
})
