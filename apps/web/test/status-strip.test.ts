import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LapStory, StatusStrip } from '../src/components/review/StatusStrip'
import { lapChip } from '../src/lib/feature-ui'

/**
 * The status facts (decisions 18b, 19, 27a) — the returning human's TL;DR, as a
 * property list rather than a row of pills (DESIGN.md: facts are text).
 *
 * Tier 1: the whole of the band's behaviour is which facts it states, in which
 * order, with which words. It is rendered over the REAL derivations, because
 * the questions worth asking here — does the review row stamp its freshness,
 * does the ticket count leave the review ticket out — are answered by the list
 * and `statusProperties` together.
 */
describe('StatusStrip', () => {
  const ticket = (over: Partial<{ kind: 'implementation' | 'review'; status: string; lap: number }> = {}) => ({
    kind: 'implementation' as const,
    status: 'done',
    lap: 2,
    ...over,
  })

  const render = (props: Partial<Parameters<typeof StatusStrip>[0]> = {}): string =>
    renderToStaticMarkup(
      createElement(StatusStrip, {
        artifact: { lap: 2 },
        outcome: { kind: 'verified', mode: 'gates' },
        currentLap: 2,
        landedSince: 0,
        tickets: [ticket(), ticket({ status: 'failed' })],
        runState: 'succeeded',
        ...props,
      }),
    )

  it('is a property list, not a row of pills', () => {
    const html = render()
    expect(html).toContain('<dl')
    expect(html).not.toContain('rounded-pill')
  })

  /** simplify-the-pages decisions 3, 4, 6a: each row owns its facts, once. */
  it('leads with the review verdict and freshness, then tickets, test drive and the burn', () => {
    const html = render({ driveLap: null })
    const order = ['>Review<', '>Verified<', 'gates mode · this build', '>Tickets<', '>Test drive<', '>Burn<', 'Succeeded']
    let cursor = -1
    for (const fragment of order) {
      const at = html.indexOf(fragment)
      expect(at, fragment).toBeGreaterThan(cursor)
      cursor = at
    }
    expect(html).not.toContain('>Checks<')
    expect(html).not.toContain('>Laps<')
  })

  it('stamps evidence that predates the current build as stale, with what landed since', () => {
    const html = render({ artifact: { lap: 1 }, landedSince: 5 })
    expect(html).toContain('Verified 1 lap ago')
    expect(html).toContain('5 landed since')
  })

  /** Decision 19b: the review row's limiting case subsumes "no review ran this lap". */
  it('renders no review at all as the review row’s own state rather than a buried row', () => {
    expect(render({ artifact: null })).toContain('Not reviewed yet')
  })

  it('says a verification pass is running over evidence that predates it', () => {
    const html = render({ verification: { state: 'running' } })
    expect(html).toContain('Verification running')
    expect(html).toContain('the evidence below predates it')
  })

  it('carries the reason a verification could not run', () => {
    const html = render({ verification: { state: 'failed', reason: 'sandbox died' } })
    expect(html).toContain('Verification could not run')
    expect(html).toContain('sandbox died')
  })

  /**
   * Walk §B dead end 3: the review ticket was counted among the lap's delivered
   * work, so a lap that landed one feature ticket read as having landed two.
   */
  it('never counts the review ticket as landed work', () => {
    const rows = [ticket(), ticket({ kind: 'review', status: 'done' })]
    expect(render({ tickets: rows })).toContain('1 of 1 landed')
  })

  /** simplify-the-pages decision 2: a waived ticket leaves the total. */
  it('counts a cancelled ticket as waived rather than as landed or failed', () => {
    const rows = [ticket(), ticket({ status: 'cancelled' })]
    const html = render({ tickets: rows })
    expect(html).toContain('1 of 1 landed')
    expect(html).toContain('1 waived')
  })

  /** Decision 4: with Check details gone, a failed ticket is loud on its own row. */
  it('says a failed ticket on the Tickets row', () => {
    expect(render()).toContain('1 failed')
  })

  it('folds the unverified-drive caveat into the Test drive row as a sub-note', () => {
    const html = render({ unverifiedKeys: ['devCommand'], driveLap: null })
    expect(html).toContain('>Test drive<')
    expect(html).toContain('1 check unverified in drive')
    expect(html).toContain('never proven by a dry run')
  })

  it('says a drive of this feature is running', () => {
    expect(render({ driving: true, driveLap: null })).toContain('Running')
  })

  /**
   * The Agentic review control (review-as-a-lap-trail decision 6), beside the
   * drive the human would take themselves.
   */
  describe('the Agentic review control', () => {
    it('sits beside Test drive, after it', () => {
      const html = render({
        testDrive: { onStart: () => undefined },
        agenticReview: { onStart: () => undefined },
      })
      expect(html).toContain('Test drive</button>')
      expect(html).toContain('Agentic review</button>')
      expect(html.indexOf('Test drive</button>')).toBeLessThan(html.indexOf('Agentic review</button>'))
    })

    it('is never the page’s primary — that is the next-step bar’s', () => {
      const html = render({
        testDrive: { onStart: () => undefined },
        agenticReview: { onStart: () => undefined },
      })
      expect(html).not.toContain('data-variant="primary"')
    })

    /** A drive at the wheel takes Test drive away; asking for a review is
     *  never about what the drive is doing. */
    it('is offered with no Test drive control beside it', () => {
      const html = render({ agenticReview: { onStart: () => undefined } })
      expect(html).toContain('Agentic review</button>')
      expect(html).not.toContain('Test drive</button>')
    })

    /** One burn at a time is the server's rule, so the button says so rather
     *  than dead-ending on the click. */
    it('is disabled with its reason while a burn is running', () => {
      const html = render({
        agenticReview: { onStart: () => undefined, blocked: 'a burn is running' },
      })
      expect(html).toContain('title="a burn is running"')
      expect(html).toContain('disabled')
    })

    it('is absent where the page acts on nothing at all', () => {
      expect(render({ shipped: true })).not.toContain('Agentic review')
    })
  })

  /**
   * The shipped record's own list (decision 33a): the drive is a statement
   * rather than an instruction, and the burn is history the page leaves out.
   */
  describe('on a shipped feature', () => {
    it('leaves the burn and the laps out', () => {
      const html = render({ shipped: true })
      expect(html).not.toContain('>Laps<')
      expect(html).not.toContain('>Burn<')
    })

    it('states the lap the drive was taken in', () => {
      expect(render({ shipped: true, driveLap: 2 })).toContain('Lap 2')
    })

    it('says so when the branch was never driven, and why when nothing was recorded', () => {
      const html = render({ shipped: true, driveLap: null, noWalkthrough: true })
      expect(html).toContain('Not run')
      expect(html).toContain('the review reported without driving')
    })

    /** Decision 6b: the stage appears when there is a walkthrough; no row says there is none. */
    it('states no Walkthrough row for a drive that recorded nothing', () => {
      const html = render({ shipped: true, driveLap: 2, noWalkthrough: true })
      expect(html).not.toContain('Walkthrough')
      expect(html).not.toContain('None recorded')
    })
  })
})

describe('LapStory', () => {
  const story = (props: Partial<Parameters<typeof LapStory>[0]> = {}): string =>
    renderToStaticMarkup(
      createElement(LapStory, {
        lap: lapChip([], { lap: 2, lapSessionRan: true }),
        laterLaps: 'A settings pane for the roster.',
        currentLap: 2,
        readonly: false,
        ...props,
      }),
    )

  /** Decision 27a: the past tense only once the lap's session has actually run. */
  it('tells the lap’s story in the tense the lap is actually in', () => {
    expect(story({ lap: lapChip([], { lap: 2, lapSessionRan: false }) })).toContain(
      'Lap 2 is open — its session will digest your notes',
    )
    // React escapes the apostrophe on the way into static markup.
    expect(story()).toContain('Lap 2&#x27;s session digested your notes')
  })

  it('states the planned next lap, and the way to start it', () => {
    const html = story()
    expect(html).toContain('The spec kept this out of lap 2 on purpose')
    expect(html).toContain('Start lap 3 from the next step')
    expect(html).toContain('A settings pane for the roster.')
  })

  it('states the deferred scope as history on a shipped feature', () => {
    const html = story({ readonly: true })
    expect(html).toContain('still deferred when this feature shipped')
    expect(html).not.toContain('Start lap 3 from the next step')
  })

  it('renders nothing when the spec deferred nothing', () => {
    expect(story({ laterLaps: null })).toBe('')
  })
})
