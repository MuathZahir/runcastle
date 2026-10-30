import { describe, expect, it } from 'vitest'
import type { EventRow } from '@runcastle/core'
import { reviewDriveDenial } from '../src/lib/feature-ui'

/**
 * The derivation that decides whether a review drive's dirty-tree refusal is
 * still standing on the chat's notice strip: a pure function over the feed.
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
