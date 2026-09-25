import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { EventRow } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import type { ReviewArtifacts } from '../src/lib/reviews'

/**
 * The shipped record (decisions 32c and 33). Tier 1: what this body decides is
 * which account it renders — the hero and its doc link, the final walkthrough on
 * a read-only stage, the strip's statement of what shipped, and one row per
 * question ever asked, including the ones whose transcript was never captured.
 *
 * The provider boundary is stubbed and nothing else: the reads this body makes
 * are its inputs, not its behaviour.
 */
const event = (id: number, type: string): EventRow => ({
  id,
  projectId: 'prj_1',
  featureId: 'ftr_1',
  ts: id * 10,
  type,
  message: type,
})

/** A drive in lap 1, a lap 2 with its own drive, then the merge. */
const SHIPPED_FEED: EventRow[] = [
  event(1, 'testdrive.started'),
  event(2, 'lap.started'),
  event(3, 'testdrive.started'),
  event(4, 'feature.shipped'),
]

/** What `useEventLog` hands the body — swapped per test by {@link render}. */
let feed: EventRow[] = SHIPPED_FEED

const RECORDINGS: ReviewArtifacts[] = [
  {
    ticketId: 'tkt_review_1',
    seq: 3,
    lap: 1,
    passKind: 'review',
    reviewMode: null,
    reviewVerdict: null,
    reviewVerdictReason: null,
    reviewedCommit: 'aaa1111bbb',
    completedAt: 100,
    landedSince: 2,
    hasVideo: true,
    videoUrl: '/api/reviews/ticket/tkt_review_1/walkthrough.webm',
  },
  {
    ticketId: 'tkt_review_2',
    seq: 9,
    lap: 2,
    passKind: 'verification',
    reviewMode: null,
    reviewVerdict: null,
    reviewVerdictReason: null,
    reviewedCommit: 'ccc2222ddd',
    completedAt: 200,
    landedSince: 0,
    hasVideo: true,
    videoUrl: '/api/reviews/ticket/tkt_review_2/walkthrough.webm',
  },
]

/** What `useReviewArtifacts` hands the body — emptied by {@link renderUnrecorded}. */
let artifacts: ReviewArtifacts[] = RECORDINGS

vi.mock('../src/lib/events', () => ({ useEventLog: () => feed }))
vi.mock('../src/lib/reviews', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/reviews')>()),
  useReviewArtifacts: () => ({ data: artifacts }),
}))
vi.mock('../src/trpc', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    trpc: {
      useUtils: () => ({ notes: { list: { invalidate: vi.fn() } }, feature: {}, events: {} }),
      notes: { add: { useMutation: mutation }, list: { useQuery: () => ({ data: [] }) } },
      findings: { listByFeature: { useQuery: () => ({ data: { findings: [] } }) } },
      docs: { read: { useQuery: () => ({ data: undefined }) } },
      project: { list: { useQuery: () => ({ data: [] }) } },
      feature: { testDrive: { useMutation: mutation }, fixDrive: { useMutation: mutation } },
    },
  }
})
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))

const { ShippedBody } = await import('../src/components/bodies/ShippedBody')

const session = (over: Partial<FeatureFull['sessions'][number]> = {}) =>
  ({
    id: 'ses_1',
    featureId: 'ftr_1',
    kind: 'chat',
    status: 'ended',
    awaitingInput: false,
    worktreePath: '/tmp/wt',
    ccSessionId: 'cc_1',
    title: 'Why does the drive need a dev command?',
    createdAt: 1,
    ...over,
  }) as FeatureFull['sessions'][number]

const full = (over: Partial<FeatureFull> = {}): FeatureFull =>
  ({
    feature: {
      id: 'ftr_1',
      projectId: 'prj_1',
      slug: 'greetings-pages',
      title: 'Greetings pages',
      oneLiner: 'pages that greet',
      mapped: false,
      lap: 2,
      phase: 'shipped',
      branch: 'feature/greetings-pages',
      status: 'shipped',
      createdAt: 1,
    },
    tickets: [],
    sessions: [session()],
    runs: [],
    docs: [
      { relPath: 'docs/features/greetings-pages/spec.md', title: 'planning' },
      { relPath: 'docs/features/greetings-pages/outcome.md', title: 'outcome' },
    ],
    gate: { id: 'G5', ok: true, reasons: [] },
    waypoints: [],
    frontierIds: [],
    ...over,
  }) as unknown as FeatureFull

const render = (over: Partial<FeatureFull> = {}, events = SHIPPED_FEED): string => {
  feed = events
  artifacts = RECORDINGS
  return renderToStaticMarkup(createElement(ShippedBody, { full: full(over) }))
}

/** The feature whose review reported without ever driving: no media to play. */
const renderUnrecorded = (): string => {
  feed = SHIPPED_FEED
  artifacts = []
  return renderToStaticMarkup(createElement(ShippedBody, { full: full() }))
}

describe('ShippedBody', () => {
  describe('the page top', () => {
    /**
     * DESIGN.md principle 5: the feature page's header and stepper already say
     * it shipped and when, so the body restates neither — no second band, no
     * centred hero.
     */
    it('never restates that the feature shipped', () => {
      const html = render()
      expect(html).not.toContain('Shipped to main')
      expect(html).not.toContain('text-center')
      expect(html).not.toContain('<h1')
    })

    it('links the outcome doc — the permanent record of what shipped', () => {
      expect(render()).toContain('Outcome doc')
    })

    it('offers no link before the merge has written the doc', () => {
      const html = render({
        docs: [{ relPath: 'docs/features/greetings-pages/spec.md', title: 'planning' }],
      } as unknown as Partial<FeatureFull>)
      expect(html).not.toContain('Outcome doc')
    })
  })

  describe('the evidence', () => {
    it('plays the latest completed pass as the record of what shipped', () => {
      const html = render()
      expect(html).toContain('/api/reviews/ticket/tkt_review_2/walkthrough.webm')
      expect(html).toContain('Verification walkthrough')
    })

    /**
     * The earlier-recordings popover is gone with the lap trail that replaced
     * it (review-as-a-lap-trail decision 4), and the trail is the review page's
     * band — so what a shipped record shows is the latest pass, named by the
     * lap it belongs to rather than by a list it is picked from.
     */
    it('names the lap the record on the stage belongs to', () => {
      const html = render()
      expect(html).toContain('Lap 2 · Verification walkthrough')
      expect(html).not.toContain('Earlier recordings')
    })

    /** Decision 33a: a history view never offers a live control. */
    it('offers no annotation and no drive from a shipped feature', () => {
      const html = render()
      expect(html).not.toContain('Annotate')
      expect(html).not.toContain('Open app')
    })

    /**
     * An unrecorded feature used to state that fact inside the same 16:9 stage a
     * recording plays in — a screen of dead space between the hero and the
     * chips, on a page where no drive can ever fill it.
     */
    it('says a walkthrough was never recorded as a quiet fact, not a stage', () => {
      const html = renderUnrecorded()
      expect(html).toContain('>Walkthrough<')
      expect(html).toContain('None recorded')
      expect(html).not.toContain('aspect-video')
      expect(html).not.toContain('evidence-stage')
    })

    it('keeps the full stage for the feature that has media to play', () => {
      expect(render()).toContain('aspect-video')
    })
  })

  describe('the facts', () => {
    it('states them as a property list: review, checks, test drive, tickets, laps', () => {
      const html = render()
      expect(html).toContain('<dl')
      for (const key of ['>Review<', '>Checks<', '>Test drive<', '>Tickets<', '>Laps<']) {
        expect(html).toContain(key)
      }
      expect(html).not.toContain('>Burn<')
    })

    /** Decision 33a: the read-only drive line is a statement, never an instruction. */
    it('states the test drive that was taken, and the lap it was taken in', () => {
      const html = render()
      expect(html).toContain('Taken')
      expect(html).toContain('lap 2')
    })

    it('says plainly when the branch was never driven', () => {
      const undriven = SHIPPED_FEED.filter((e) => e.type !== 'testdrive.started')
      expect(render({}, undriven)).toContain('Not run')
    })
  })

  /**
   * Decision 33b — the walk watched an ended Q&A conversation vanish on reload,
   * leaving no record that anything had ever been asked.
   */
  describe('the Q&A history', () => {
    it('lists a conversation by its opening question', () => {
      expect(render()).toContain('Why does the drive need a dev command?')
    })

    it('leaves a row for a session whose transcript was never captured', () => {
      const html = render({
        sessions: [session({ id: 'ses_2', ccSessionId: undefined, title: null, transcriptMissing: true })],
      } as unknown as Partial<FeatureFull>)
      expect(html).toContain('Session opened, nothing recorded')
    })

    it('says nothing at all when nobody ever asked', () => {
      const html = render({ sessions: [] } as unknown as Partial<FeatureFull>)
      expect(html).not.toContain('Questions asked')
    })
  })
})
