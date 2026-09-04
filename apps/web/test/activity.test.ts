import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { activityLine, eventLevel, isLapDivider, stripMarkdown } from '../src/lib/activity'

/**
 * Findings F10.5 / F18 — the activity feed leaked agent internals (`Bash cd
 * /home/agent/repo && git add…`) and rendered raw `##` markdown as plain text,
 * then truncated both with no way to see the rest.
 */

const ev = (over: Partial<EventRow>): Pick<EventRow, 'type' | 'message' | 'data'> => ({
  type: 'feature.created',
  message: 'created',
  data: null,
  ...over,
})

describe('stripMarkdown', () => {
  it('drops heading markers', () => {
    expect(stripMarkdown('## What I did')).toBe('What I did')
    expect(stripMarkdown('###### deep')).toBe('deep')
  })

  it('unwraps emphasis, code spans and links', () => {
    expect(stripMarkdown('**done** with `bun test`')).toBe('done with bun test')
    expect(stripMarkdown('see [the spec](docs/spec.md)')).toBe('see the spec')
    expect(stripMarkdown('~~cancelled~~')).toBe('cancelled')
    expect(stripMarkdown('a *little* thing')).toBe('a little thing')
  })

  it('drops list and quote markers but keeps the item', () => {
    expect(stripMarkdown('- first\n- second')).toBe('first\nsecond')
    expect(stripMarkdown('1. first')).toBe('first')
    expect(stripMarkdown('> quoted')).toBe('quoted')
  })

  it('leaves prose with no markdown in it alone', () => {
    expect(stripMarkdown('merged feature/x into main')).toBe('merged feature/x into main')
  })

  it('does not eat an underscore inside an identifier', () => {
    expect(stripMarkdown('run_id and ticket_id')).toBe('run_id and ticket_id')
  })
})

describe('activityLine', () => {
  it('summarizes a tool call by its tool, not its payload', () => {
    const line = activityLine(
      ev({
        type: 'burn.tool',
        message: 'Bash cd /home/agent/repo && git add -A && git commit -m "wip"',
        data: { name: 'Bash', args: 'cd /home/agent/repo && git add -A && git commit -m "wip"' },
      }),
    )
    expect(line.summary.startsWith('Bash')).toBe(true)
    expect(line.summary.length).toBeLessThanOrEqual(80)
    expect(line.detail).toContain('git commit')
  })

  it('names a tool that was called with nothing', () => {
    const line = activityLine(ev({ type: 'burn.tool', message: 'Read', data: { name: 'Read' } }))
    expect(line.summary).toBe('Read')
    expect(line.detail).toBeNull()
  })

  it('falls back to one line when a tool event carries no structured payload', () => {
    const line = activityLine(
      ev({ type: 'burn.tool', message: 'Bash something\nand more', data: null }),
    )
    expect(line.summary).toBe('Bash something')
    expect(line.detail).toBe('Bash something\nand more')
  })

  it('renders agent prose as plain text, not markdown source', () => {
    const line = activityLine(
      ev({ type: 'burn.text', message: '## Plan\n\nWrite the **test** first.' }),
    )
    expect(line.summary).toBe('Plan')
    expect(line.summary).not.toContain('#')
    expect(line.detail).toBe('Plan\n\nWrite the test first.')
  })

  it('offers no expansion for a message that already fits', () => {
    expect(activityLine(ev({ message: 'feature archived' }))).toEqual({
      summary: 'feature archived',
      detail: null,
    })
  })

  it('keeps the whole message available when the summary truncates it', () => {
    const long = 'x'.repeat(400)
    const line = activityLine(ev({ message: long }))
    expect(line.summary.endsWith('…')).toBe(true)
    expect(line.detail).toBe(long)
  })

  it('never renders an empty row', () => {
    expect(activityLine(ev({ type: 'phase.advanced', message: '' })).summary).toBe('Phase advanced')
  })
})

/**
 * Decision 5 — an Activity row is a sentence, always. The feed still carried
 * rows like `feature.created (feature/kickoff-probe ← main)`: the event's own
 * type slug, printed as the human-facing summary, with the facts stuffed into a
 * parenthesis after it (F10.5 / F18 residue).
 */
describe('activityLine — no event type slug is ever the summary', () => {
  it('states a created feature as a sentence, off the payload', () => {
    const line = activityLine(
      ev({
        type: 'feature.created',
        message: 'feature.created (feature/x ← main)',
        data: { slug: 'x', branch: 'feature/x', baseBranch: 'main', branchReady: true },
      }),
    )
    expect(line.summary).toBe('Feature created on branch feature/x, from main')
    expect(line.detail).toBeNull()
  })

  it('says a draft has no branch yet rather than naming one that is not cut', () => {
    const line = activityLine(
      ev({
        type: 'feature.created',
        message: 'feature.created (draft — feature/x not cut yet)',
        data: { slug: 'x', branch: 'feature/x', branchReady: false, draft: true },
      }),
    )
    expect(line.summary).toBe('Feature created as a draft — feature/x is not cut yet')
  })

  it('says a branch is still being cut when the feature is not a draft', () => {
    const line = activityLine(
      ev({
        type: 'feature.created',
        message: 'feature.created (branch pending)',
        data: { slug: 'x', branch: 'feature/x', branchReady: false, draft: false },
      }),
    )
    expect(line.summary).toBe('Feature created — branch feature/x is still being cut')
  })

  it('humanizes the slug off the front of any message that leads with it', () => {
    // The same event as written before the payload carried the branch — the
    // fallback every other slug-led message lands on.
    expect(
      activityLine(ev({ type: 'feature.created', message: 'feature.created (branch pending)' }))
        .summary,
    ).toBe('Feature created — branch pending')
    expect(
      activityLine(ev({ type: 'session.pty_exited', message: 'session.pty_exited: code 1' }))
        .summary,
    ).toBe('Session pty exited — code 1')
  })

  it('leaves a message that does not lead with its slug alone', () => {
    expect(activityLine(ev({ type: 'feature.archived', message: 'feature x archived' }))).toEqual({
      summary: 'feature x archived',
      detail: null,
    })
  })

  it('names a tool event that carries neither payload nor message', () => {
    expect(activityLine(ev({ type: 'burn.tool', message: '', data: null })).summary).toBe(
      'Burn tool',
    )
  })
})

/**
 * REPORT 1.5 — the run stream matched `/finished/` against the event TYPE, so
 * `run.finished` painted green whatever the burn actually did, while the desktop
 * notification read the same event's payload and said "Burn failed".
 */
describe('eventLevel', () => {
  it('reads a failed burn off the payload, not the type keyword', () => {
    expect(
      eventLevel(
        ev({
          type: 'run.finished',
          message: 'run failed: ticket 2 never landed',
          data: { status: 'failed', summary: 'ticket 2 never landed' },
        }),
      ),
    ).toBe('error')
  })

  it('paints a cancelled burn as an outcome to notice too', () => {
    expect(
      eventLevel(ev({ type: 'run.finished', data: { status: 'cancelled', summary: 'stopped' } })),
    ).toBe('error')
  })

  it('still paints a succeeded burn green', () => {
    expect(
      eventLevel(ev({ type: 'run.finished', data: { status: 'succeeded', summary: 'all done' } })),
    ).toBe('ok')
  })

  it('falls back to the type keywords for events that carry no status', () => {
    expect(eventLevel(ev({ type: 'burn.started' }))).toBe('active')
    expect(eventLevel(ev({ type: 'ticket.failed' }))).toBe('error')
    expect(eventLevel(ev({ type: 'feature.shipped' }))).toBe('ok')
    expect(eventLevel(ev({ type: 'session.launched' }))).toBe('active')
    expect(eventLevel(ev({ type: 'feature.created' }))).toBe('info')
  })

  it('keeps in-loop conflict resolution readable as progress', () => {
    expect(eventLevel(ev({ type: 'merge.conflict.resolving' }))).toBe('active')
    expect(eventLevel(ev({ type: 'merge.conflict.resolved' }))).toBe('ok')
    expect(eventLevel(ev({ type: 'merge.conflict' }))).toBe('error')
  })

  it('falls back rather than guessing when a run.finished carries no payload', () => {
    expect(eventLevel(ev({ type: 'run.finished', data: null }))).toBe('ok')
  })

  /**
   * Ticket 4 / decisions.md #6 — an abandoned lap read as neutral `info`: the
   * keyword scan knows "fail" and "cancel" but not "abort", so the one event that
   * says a lap never happened was the quietest line in the feed.
   */
  it('reads a started lap as progress and an aborted one as a failure', () => {
    expect(eventLevel(ev({ type: 'lap.started' }))).toBe('active')
    expect(eventLevel(ev({ type: 'lap.aborted' }))).toBe('error')
  })
})

/**
 * Ticket 4 / decisions.md #6 — the feed renders a lap start as a divider across
 * the timeline rather than one more row, because it is the boundary every row
 * around it belongs to one side of.
 */
describe('isLapDivider', () => {
  it('is the lap start and nothing else', () => {
    expect(isLapDivider('lap.started')).toBe(true)
    expect(isLapDivider('lap.aborted')).toBe(false)
    expect(isLapDivider('phase.advanced')).toBe(false)
  })

  it('leaves the divider a readable line to render', () => {
    expect(activityLine(ev({ type: 'lap.started', message: 'rethink — lap 2' })).summary).toBe(
      'rethink — lap 2',
    )
  })
})
