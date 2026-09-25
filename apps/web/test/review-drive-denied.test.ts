import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { ReviewDriveDeniedCard } from '../src/components/review/ReviewDriveDeniedCard'
import { reviewDriveDenial } from '../src/lib/feature-ui'

/**
 * The banner a review drive's dirty-tree refusal raises, and the derivation
 * that decides whether it is still standing. Tier 1: the banner's whole
 * behaviour is the words and the controls it puts on the page, and the
 * lifecycle behind it is a pure function over the feed.
 */
const event = (over: Partial<EventRow> = {}): EventRow => ({
  id: 1,
  projectId: 'proj_1',
  featureId: 'feat_1',
  ts: 1_760_000_000_000,
  type: 'reviewdrive.denied',
  message: 'review drive denied — 2 uncommitted file(s) in the working tree: a.ts, b.ts',
  data: { code: 'dirty', dirtyFiles: ['a.ts', 'b.ts'] },
  ...over,
})

describe('reviewDriveDenial', () => {
  it('reads the dirty files, the moment and the server’s own sentence off the denial', () => {
    expect(reviewDriveDenial([event()])).toEqual({
      eventId: 1,
      at: 1_760_000_000_000,
      dirtyFiles: ['a.ts', 'b.ts'],
      message: event().message,
    })
  })

  it('is null when the feed holds no denial at all', () => {
    expect(reviewDriveDenial([event({ type: 'testdrive.stopped' })])).toBeNull()
  })

  /** Decision 7: the banner is a prompt, not a record — the timeline is the record. */
  it.each(['ticket.retry', 'burn.started', 'feature.shipped'])(
    'comes down once %s says the denial has been answered',
    (type) => {
      expect(reviewDriveDenial([event(), event({ id: 2, type, ts: 1_760_000_001_000 })])).toBeNull()
    },
  )

  it('comes back up when a later denial follows the burn that cleared it', () => {
    const denials = [
      event(),
      event({ id: 2, type: 'ticket.retry', ts: 1_760_000_001_000 }),
      event({ id: 3, ts: 1_760_000_002_000, data: { code: 'dirty', dirtyFiles: ['c.ts'] } }),
    ]
    expect(reviewDriveDenial(denials)).toMatchObject({
      eventId: 3,
      at: 1_760_000_002_000,
      dirtyFiles: ['c.ts'],
    })
  })

  /** An event whose payload did not survive still raises the banner. */
  it('survives a denial carrying no file list', () => {
    expect(reviewDriveDenial([event({ data: undefined })])?.dirtyFiles).toEqual([])
  })

  /**
   * The run list is the other half of the same clearing rule, read the way the
   * server reads retry eligibility: a burn that started after the denial has
   * answered it, whether or not its own events have reached this feed.
   */
  describe('against the run list', () => {
    const run = (startedAt: number) => ({ startedAt })

    it('stands while it is the latest word on the latest run', () => {
      expect(reviewDriveDenial([event()], [run(1_759_000_000_000)])).not.toBeNull()
    })

    it('clears once a retry burn started after it', () => {
      const runs = [run(1_759_000_000_000), run(1_760_000_001_000)]
      expect(reviewDriveDenial([event()], runs)).toBeNull()
    })

    it('reads the feed alone when there are no runs to read', () => {
      expect(reviewDriveDenial([event()], [])).not.toBeNull()
    })
  })

  /**
   * Dismissal is the human waving away ONE denial (decision 7) — so it is keyed
   * on the event id, and the next denial is a new id that speaks up again.
   */
  describe('dismissal is keyed on the event id', () => {
    it('hides the denial the human waved away', () => {
      expect(reviewDriveDenial([event()], [], 1)).toBeNull()
    })

    it('speaks up again on a NEW denial, which is a new id', () => {
      const again = event({ id: 2, ts: 1_760_000_002_000 })
      expect(reviewDriveDenial([event(), again], [], 1)?.eventId).toBe(2)
    })
  })
})

const DENIAL = {
  eventId: 1,
  at: 1_760_000_000_000,
  dirtyFiles: ['a.ts', 'b.ts'],
  message: 'review drive denied — 2 uncommitted file(s) in the working tree: a.ts, b.ts',
}

const render = (props: Partial<Parameters<typeof ReviewDriveDeniedCard>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(ReviewDriveDeniedCard, {
      denial: DENIAL,
      readonly: false,
      primary: true,
      busy: false,
      refusal: null,
      onReview: () => undefined,
      onDismiss: () => undefined,
      ...props,
    }),
  )

describe('ReviewDriveDeniedCard', () => {
  it('says the drive was refused, names the files, and offers another pass', () => {
    const html = render()
    expect(html).toContain('Review couldn’t drive')
    expect(html).toContain('a.ts')
    expect(html).toContain('b.ts')
    expect(html).toContain('Agentic review')
    expect(html).toContain('Dismiss')
  })

  /** A red panel with no date reads as "right now" (as ConflictCard's does). */
  it('says when the drive was refused', () => {
    expect(render()).toContain('denied ')
  })

  it('says what the review delivered instead, so the banner is not a failure report', () => {
    expect(render()).toContain('repo-only')
  })

  /** Decision 33a: a history view offers no live control. */
  it('renders nothing at all under readonly', () => {
    expect(render({ readonly: true })).toBe('')
  })

  /** The review did not fail — it fell back — so this is the accent notice
   *  with an amber glyph, not the conflict notice's red ground. */
  it('reads as a warning rather than a failure', () => {
    const html = render()
    expect(html).toContain('bg-accent-subtle')
    expect(html).toContain('text-warning')
    expect(html).not.toContain('bg-danger-subtle')
  })

  it('falls back to the server’s sentence when the event carried no file list', () => {
    expect(render({ denial: { ...DENIAL, dirtyFiles: [] } })).toContain('uncommitted file(s)')
  })

  /** The refusal the endpoint hands back names what is STILL in the way, and it
   *  belongs in the banner rather than a toast that fades off that list. */
  it('renders the refusal verbatim, in the banner', () => {
    const refusal =
      'the working tree is still dirty — the review drive would be denied again. Commit or ' +
      'discard 1 file(s) first: a.ts'
    expect(render({ refusal })).toContain('discard 1 file(s) first: a.ts')
  })

  it('says nothing about a refusal until one has been handed back', () => {
    expect(render()).not.toContain('still dirty')
  })

  it('holds the mint shut while one is starting', () => {
    const html = render({ busy: true })
    expect(html).toContain('disabled')
    expect(html).toContain('Starting…')
  })

  /** Decision 7: the denied pass stays in the trail, and the action mints a
   *  fresh one — so the banner never claims to resume the reviewer it refused. */
  it('offers a fresh pass rather than a retry of the refused one', () => {
    const html = render()
    expect(html).toContain('a fresh pass is minted for this lap')
    expect(html).not.toContain('Retry review')
  })

  /** The mint needs no ticket, so the action is there whatever this lap ran —
   *  the old retry went missing on a lap that had emitted no review ticket. */
  it('offers the action whatever review tickets this lap emitted', () => {
    const html = render()
    expect(html).toContain('Agentic review')
    expect(html).toContain('Dismiss')
  })

  /** One primary per view, and it is the next-step bar's: the mint is a
   *  hairline button at most, and steps down to ghost when another notice on
   *  the page is carrying the same verb. */
  it('steps its mint down to ghost when it is not the page’s primary', () => {
    const ghost = render({ primary: false })
    expect(ghost).toContain('Agentic review')
    expect(ghost).toContain('data-variant="ghost"')
    expect(render()).toContain('data-variant="secondary"')
    expect(render()).not.toContain('data-variant="primary"')
  })
})
