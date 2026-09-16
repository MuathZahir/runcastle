import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { EventRow, ReviewFinding, TestNote } from '@runcastle/core'
import type { FeatureFull } from '../src/lib/api'
import type { ReviewArtifacts } from '../src/lib/reviews'
import { full } from './fixtures'

/**
 * The arrival band matrix (decision 8), over the four states the approved
 * prototype pins: open work, a stale session, a walkthrough, and all clear.
 *
 * Which bands mount in which state IS the design here — the page's whole
 * complaint was that it led with a terminal, an empty 16:9 box and a wall of
 * prose — so the assertions are about presence and absence, not about the
 * anatomy of any one band (each of those has its own test). Tier 1: the bands
 * are composed by `ReviewBody` itself, so what is measured is the orchestrator's
 * own composition rather than a second copy of it assembled here.
 */
const state = vi.hoisted(() => ({
  notes: [] as TestNote[],
  findings: [] as ReviewFinding[],
  openDefects: [] as ReviewFinding[],
  carriedFindings: [] as ReviewFinding[],
  summary: undefined as { found: number; fixed: number; open: number; observations: number } | undefined,
  recordings: [] as ReviewArtifacts[],
  drive: undefined as { featureId: string; state: string; dryRun: boolean } | undefined,
  driveInstructions: undefined as string | undefined,
  events: [] as EventRow[],
}))

vi.mock('../src/lib/live', () => ({ useLivePoll: () => false as const, useLiveStatus: () => 'live' }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('../src/lib/events', () => ({ useEventLog: () => state.events }))
vi.mock('../src/lib/reviews', async (original) => ({
  ...(await original<typeof import('../src/lib/reviews')>()),
  useReviewArtifacts: () => ({ data: state.recordings }),
}))
vi.mock('../src/trpc', () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })
  return {
    trpc: {
      useUtils: () => ({
        notes: { list: { invalidate: vi.fn() } },
        findings: { listByFeature: { invalidate: vi.fn() } },
        feature: { get: { invalidate: vi.fn() }, list: { invalidate: vi.fn() }, driveInfo: { invalidate: vi.fn() } },
        events: { invalidate: vi.fn() },
      }),
      ticket: { retry: { useMutation: mutation } },
      notes: {
        add: { useMutation: mutation },
        edit: { useMutation: mutation },
        remove: { useMutation: mutation },
        toggle: { useMutation: mutation },
        reopen: { useMutation: mutation },
        list: { useQuery: () => ({ data: state.notes }) },
      },
      findings: {
        dismiss: { useMutation: mutation },
        reopen: { useMutation: mutation },
        listByFeature: {
          useQuery: () => ({
            data: {
              findings: state.findings,
              openDefects: state.openDefects,
              carriedFindings: state.carriedFindings,
              summary: state.summary,
            },
          }),
        },
      },
      docs: { read: { useQuery: () => ({ data: undefined }) } },
      project: {
        prep: { useQuery: () => ({ data: { findings: [] } }) },
        list: {
          useQuery: () => ({
            data: [{ id: 'proj_1', driveInstructions: state.driveInstructions }],
          }),
        },
      },
      feature: {
        commitCount: { useQuery: () => ({ data: { count: 3 } }) },
        driveInfo: { useQuery: () => ({ data: state.drive }) },
        testDrive: { useMutation: mutation },
        fixDrive: { useMutation: mutation },
        endSession: { useMutation: mutation },
      },
    },
  }
})

const { ReviewBody } = await import('../src/components/bodies/ReviewBody')

const RECORDING: ReviewArtifacts = {
  ticketId: 'tkt_review',
  seq: 4,
  lap: 1,
  passKind: 'review',
  reviewedCommit: 'abc1234def',
  completedAt: 1000,
  landedSince: 0,
  hasVideo: true,
  videoUrl: '/api/reviews/ticket/tkt_review/walkthrough.webm',
}

const NOTE: TestNote = {
  id: 'note_1',
  featureId: 'feat_1',
  lap: 1,
  text: 'the spilled-at column shows raw epoch millis',
  status: 'open',
  author: 'human',
  createdAt: 10,
  updatedAt: 10,
} as TestNote

const DEFECT = {
  id: 'find_1',
  featureId: 'feat_1',
  lap: 1,
  reviewTicketId: 'tkt_review',
  kind: 'defect',
  severity: 'high',
  title: 'the repaired read path is never called',
  location: 'DLQController.java:88',
  citation: 'spec.md §Retention',
  detail: 'the endpoint builds its own map, so the operator still sees husks',
  reproStep: 'GET /api/dlq/entries after a spill',
  status: 'open',
  openReason: null,
  failureReason: null,
  fixTicketId: null,
  createdAt: 20,
} as ReviewFinding

const OBSERVATION = {
  ...DEFECT,
  id: 'find_2',
  kind: 'observation',
  title: 'the verify gate could not run: no local Maven',
  detail: 'this repo’s suite runs inside a Docker maven image',
} as ReviewFinding

/** What lap 1 parked instead of answering, as the lap-2 page has it. */
const CARRIED = {
  ...DEFECT,
  id: 'find_3',
  title: 'the husk rows keep their retired ids',
  status: 'carried',
  carriedLap: 2,
  resolutionNote: 'lap 2 rewrites the purge, which decides these rows',
} as ReviewFinding

const DIGEST =
  'Lap 1: DLQ spill retention landed · 1 defect found, 0 fixed in-run · Drive mode\n\n' +
  'The cap bounds rows for currently-registered callbacks; retired ids are left to the age purge.'

const REVIEW_TICKET = {
  id: 'tkt_review',
  seq: 4,
  lap: 1,
  title: 'review the lap',
  kind: 'review',
  status: 'done',
  digest: DIGEST,
} as unknown as FeatureFull['tickets'][number]

const LIVE_IDEATION = {
  id: 'ses_1',
  featureId: 'feat_1',
  lap: 1,
  kind: 'ideation',
  status: 'live',
  createdAt: 1,
} as unknown as FeatureFull['sessions'][number]

/** The feature as each prototype state has it, plus what the queries answer. */
function render(
  over: {
    sessions?: FeatureFull['sessions']
    notes?: TestNote[]
    findings?: ReviewFinding[]
    openDefects?: ReviewFinding[]
    carriedFindings?: ReviewFinding[]
    recordings?: ReviewArtifacts[]
    drive?: { featureId: string; state: string; dryRun: boolean }
    /** The server's own counts, where the point is that they are not the rows'. */
    summary?: { found: number; fixed: number; open: number; observations: number }
    tickets?: FeatureFull['tickets']
    readonly?: boolean
    driveInstructions?: string
    events?: EventRow[]
    runs?: FeatureFull['runs']
    phase?: FeatureFull['feature']['phase']
  } = {},
): string {
  state.notes = over.notes ?? []
  state.findings = over.findings ?? []
  state.openDefects = over.openDefects ?? []
  state.carriedFindings = over.carriedFindings ?? []
  state.summary = over.summary ?? { found: state.findings.filter((f) => f.kind === 'defect').length, fixed: 0, open: state.openDefects.length, observations: state.findings.filter((f) => f.kind === 'observation').length }
  state.recordings = over.recordings ?? []
  state.drive = over.drive
  state.driveInstructions = over.driveInstructions
  state.events = over.events ?? []
  const feature = full({ id: 'feat_1', phase: over.phase ?? 'review' })
  return renderToStaticMarkup(
    createElement(ReviewBody, {
      full: {
        ...feature,
        feature: { ...feature.feature, lap: 1 },
        tickets: over.tickets ?? [REVIEW_TICKET],
        sessions: over.sessions ?? [],
        runs: over.runs ?? [],
      },
      driving: null,
      conflict: null,
      readonly: over.readonly ?? false,
      onViewPhase: () => undefined,
    }),
  )
}

/** State 1 of the prototype: open work, no walkthrough — the common arrival. */
const openWork = () =>
  render({ notes: [NOTE], findings: [DEFECT, OBSERVATION], openDefects: [DEFECT] })

describe('the review page’s arrival bands', () => {
  it('opens on state and open work — no stage, no placeholder, no terminal', () => {
    const html = openWork()
    // The bands that are there.
    expect(html).toContain('checks passed')
    expect(html).toContain('>Test drive<')
    expect(html).toContain('Lap 1: DLQ spill retention landed')
    expect(html).toContain('the repaired read path is never called')
    expect(html).toContain('the spilled-at column shows raw epoch millis')
    expect(html).toContain('Full account —')
    // And the ones that are not.
    expect(html).not.toContain('id="evidence-stage"')
    expect(html).not.toContain('No walkthrough yet')
    expect(html).not.toContain('session still live')
  })

  /** Decision 8: the lap account is ONE line — the rest of the digest is not here. */
  it('lifts the digest’s first line out and leaves the account behind the disclosure', () => {
    const html = openWork()
    expect(html).toContain('Lap 1: DLQ spill retention landed · 1 defect found, 0 fixed in-run')
    expect(html.indexOf('Lap 1: DLQ spill')).toBeLessThan(html.indexOf('Full account'))
    // The long account renders once, and only inside the disclosure.
    expect(html.indexOf('The cap bounds rows')).toBeGreaterThan(html.indexOf('Full account'))
  })

  /** Decisions 2 and 8: an observation is one line in the disclosure and nothing else. */
  it('keeps observations inside the disclosure, with no count on arrival', () => {
    const html = openWork()
    expect(html).toContain('Observations (1)')
    expect(html.indexOf('the verify gate could not run')).toBeGreaterThan(html.indexOf('Full account'))
    expect(html).not.toContain('1 observation ·')
    expect(html).not.toContain('defects found ·')
  })

  /** State 2: a lap-1 ideation session is still live. */
  it('states a live session as one alert line instead of mounting its terminal', () => {
    const html = render({
      sessions: [LIVE_IDEATION],
      notes: [NOTE],
      findings: [DEFECT],
      openDefects: [DEFECT],
    })
    expect(html).toContain('Ideation session still live from lap 1')
    expect(html).toContain('>Open<')
    expect(html).toContain('End session')
    // The line replaces the panel — no terminal renders on this page at all.
    expect(html).not.toContain('grill-term')
  })

  it('says nothing at all about a session that has already ended', () => {
    const html = render({ sessions: [{ ...LIVE_IDEATION, status: 'ended' }] })
    expect(html).not.toContain('session still live')
  })

  /** State 3: the agent recorded a walkthrough — only now is there a stage. */
  it('mounts the evidence stage for a recording, and for a live drive', () => {
    const walkthrough = render({ recordings: [RECORDING] })
    expect(walkthrough).toContain('id="evidence-stage"')
    // The state line is the same line it is in every other state — a recording
    // does not take the way to your own drive away.
    expect(walkthrough).toContain('>Test drive<')

    const driving = render({ drive: { featureId: 'feat_1', state: 'serving', dryRun: false } })
    expect(driving).toContain('id="evidence-stage"')
    // ...except while a drive is up, which the stage itself is there to stop.
    expect(driving).not.toContain('>Test drive<')
    // A drive of some OTHER feature is not this page's evidence.
    expect(
      render({ drive: { featureId: 'feat_9', state: 'serving', dryRun: false } }),
    ).not.toContain('id="evidence-stage"')
  })

  /** State 4: nothing open — the page still leads with state and the account. */
  it('leads with the same bands when nothing is open', () => {
    const html = render({})
    expect(html).toContain('Nothing needs attention')
    expect(html).toContain('Lap 1: DLQ spill retention landed')
    expect(html).not.toContain('id="evidence-stage"')
  })

  /** Decision 8: the work already dealt with is in the disclosure, not on arrival. */
  it('files handled work into the disclosure and names it in the summary', () => {
    const html = render({ notes: [{ ...NOTE, id: 'note_9', status: 'done', text: 'already handled' }] })
    expect(html).toContain('Full account — digest · carried')
    expect(html).toContain('Carried, quick-fixed and handled')
    expect(html.indexOf('already handled')).toBeGreaterThan(html.indexOf('Full account'))
    expect(html).toContain('Nothing needs attention')
  })

  /**
   * Decisions #5: the figures on the page are the server's, scoped to this lap.
   * Handed an earlier lap's finding among the rows, the review row and the
   * counts line still report what THIS lap's pass found — the all-laps count is
   * the inflated "N still open" that sent the human back through Iterate.
   */
  it('reports the counts the server sends for this lap, never the rows it holds', () => {
    const html = render({
      findings: [DEFECT, OBSERVATION, { ...DEFECT, id: 'find_9', lap: 0, title: 'from an earlier lap' }],
      openDefects: [DEFECT],
      summary: { found: 1, fixed: 0, open: 1, observations: 1 },
      // No digest, so the counts line is what the lap says for itself.
      tickets: [{ ...REVIEW_TICKET, digest: undefined }] as FeatureFull['tickets'],
    })
    expect(html).toContain('2 findings')
    expect(html).not.toContain('3 findings')
    expect(html).toContain('1 defect found · 1 still open')
  })

  /**
   * Decisions #5: what a lap parked is a band of its own, between the open work
   * and the disclosure — visible as the next lap's agenda, and out of the tally
   * the human reads "is there anything left?" off.
   */
  it('gives what a lap carried its own band, outside the open count', () => {
    const html = render({
      findings: [DEFECT, CARRIED],
      openDefects: [DEFECT],
      carriedFindings: [CARRIED],
    })
    expect(html).toContain('Carried, still open')
    expect(html).toContain('captured lap 1, carried into lap 2')
    expect(html).toContain('lap 2 rewrites the purge, which decides these rows')
    // The human's two verbs, and only the human's.
    expect(html).toContain('>Reopen<')
    // The rail's tally still counts one defect, not two.
    expect(html).toContain('1 open')
    // In the main column the band sits between the lap's account and the
    // disclosure; the open work it used to follow is the rail now (decision 2).
    const carriedAt = html.indexOf('Carried, still open')
    expect(carriedAt).toBeGreaterThan(html.indexOf('Lap 1: DLQ spill'))
    expect(carriedAt).toBeLessThan(html.indexOf('Full account'))
  })

  // A disclosure that opens on emptiness is worse than no disclosure.
  it('renders no disclosure at all when nobody wrote anything', () => {
    expect(render({ tickets: [] as FeatureFull['tickets'] })).not.toContain('Full account')
  })

  /**
   * Decision 5: a review drive refused over the human's own uncommitted files
   * is a banner in the alert slot at the moment it happens — the digest that
   * used to be the only account of it is read long afterwards.
   */
  describe('a review drive refused over a dirty tree', () => {
    const DENIED: EventRow = {
      id: 7,
      projectId: 'proj_1',
      featureId: 'feat_1',
      ts: 1_760_000_000_000,
      type: 'reviewdrive.denied',
      message: 'review drive denied — 1 uncommitted file(s) in the working tree: src/App.tsx',
      data: { code: 'dirty', dirtyFiles: ['src/App.tsx'] },
    }
    const RUN = (startedAt: number): FeatureFull['runs'][number] => ({
      id: `run_${startedAt}`,
      featureId: 'feat_1',
      workflow: 'ticket-burner',
      status: 'succeeded',
      startedAt,
    })

    it('raises a banner naming the files, with the way to re-burn the review', () => {
      const html = render({ events: [DENIED] })
      expect(html).toContain('Review couldn’t drive')
      expect(html).toContain('src/App.tsx')
      expect(html).toContain('Retry review')
    })

    it('says nothing when no drive was ever refused', () => {
      expect(openWork()).not.toContain('Review couldn’t drive')
    })

    /** Decision 7: the retry burn starting is what takes the prompt back down. */
    it('comes down once the retry burn has started', () => {
      const retried: EventRow = { ...DENIED, id: 8, type: 'ticket.retry', message: 'retrying ticket 4' }
      expect(render({ events: [DENIED, retried] })).not.toContain('Review couldn’t drive')
    })

    /** The other half of decision 7's clearing rule: a run that started after
     *  the denial has answered it too, whether or not its events have landed on
     *  this feed yet — the same read the server's retry eligibility makes. */
    it('stands while the denial is the latest word on the latest run', () => {
      const html = render({ events: [DENIED], runs: [RUN(DENIED.ts - 1_000)] })
      expect(html).toContain('Review couldn’t drive')
    })

    it('comes down once a burn has started after the denial', () => {
      const runs = [RUN(DENIED.ts - 1_000), RUN(DENIED.ts + 1_000)]
      expect(render({ events: [DENIED], runs })).not.toContain('Review couldn’t drive')
    })

    /** The review body also mounts to LOOK BACK at review on a feature that has
     *  moved on — history, where there is nothing left to act on (decision 7). */
    it('does not render outside the review phase', () => {
      expect(render({ events: [DENIED], phase: 'shipped' })).not.toContain('Review couldn’t drive')
    })

    /** Decision 33a: history has no live verbs, this banner's retry included. */
    it('renders no banner at all on a readonly view', () => {
      expect(render({ events: [DENIED], readonly: true })).not.toContain('Review couldn’t drive')
    })
  })

  /** Decision 33a: history has no live verbs anywhere, the alert line included. */
  it('offers no live control on a readonly view', () => {
    const html = render({ sessions: [LIVE_IDEATION], readonly: true })
    expect(html).not.toContain('session still live')
    expect(html).not.toContain('>Test drive<')
  })
})

/**
 * The two panes (decision 2, revising decision 18's band order): a main column
 * of bands, and the notes rail beside it at all times.
 *
 * The complaint the rail answers is a layout one — the open-work band sat below
 * the fold, so annotating during a drive scrolled the stage out of view — and
 * the seam that can answer it is this one: which pane each band renders into.
 * Tier 1, for the same reason the matrix above is: what is measured is
 * `ReviewBody`'s own composition rather than a second copy assembled here.
 */
describe('the review page’s two panes', () => {
  /** The markup either side of the rail, which is the page's last element. */
  function panes(html: string): { column: string; rail: string } {
    const at = html.indexOf('<aside')
    expect(at).toBeGreaterThan(-1)
    return { column: html.slice(0, at), rail: html.slice(at) }
  }

  it('renders the open work and the note composer in the rail, not below the stage', () => {
    const { column, rail } = panes(openWork())

    expect(rail).toContain('id="open-work"')
    expect(rail).toContain('What still needs attention')
    expect(rail).toContain('the spilled-at column shows raw epoch millis')
    expect(rail).toContain('the repaired read path is never called')
    // The composer rides in the rail with the rows it writes.
    expect(rail).toContain('what did you just see?')

    // And none of it is left in the column.
    expect(column).not.toContain('id="open-work"')
    expect(column).not.toContain('What still needs attention')
    expect(column).not.toContain('what did you just see?')
  })

  /** Decision 2: no collapse toggle and no breakpoints — the rail is always there. */
  it('keeps the rail whatever the page is holding', () => {
    const states = {
      'nothing open': render({}),
      'a walkthrough': render({ recordings: [RECORDING] }),
      history: render({ readonly: true, notes: [NOTE] }),
    }
    for (const [state, html] of Object.entries(states)) {
      expect.soft(panes(html).rail, state).toContain('id="open-work"')
      expect.soft(panes(html).rail, state).toContain('w-(--notes-rail-w)')
    }
    // History still has no live control in it, the composer included (33a).
    expect(states.history).not.toContain('what did you just see?')
  })

  /** The rail's width is one token, dragged through the machinery every rail uses. */
  it('sizes the rail off --notes-rail-w, at the default until a drag says otherwise', () => {
    const { rail } = panes(openWork())
    expect(rail).toContain('w-(--notes-rail-w)')
    expect(rail).toContain('--notes-rail-w:360px')
    expect(rail).toContain('Resize the notes rail')
  })

  /** Neither pane may move the other — the whole point of the layout. */
  it('gives each pane a scroller of its own', () => {
    const { column, rail } = panes(openWork())
    expect(column).toContain('overflow-y-auto')
    expect(rail).toContain('overflow-y-auto')
  })

  /** Everything decision 18 put in the column is still in it, in its order. */
  it('preserves the main column’s band order', () => {
    const html = render({
      sessions: [LIVE_IDEATION],
      recordings: [RECORDING],
      findings: [DEFECT, CARRIED],
      openDefects: [DEFECT],
      carriedFindings: [CARRIED],
      driveInstructions: 'Drive the sample project at ./examples/demo.',
    })
    const bands = [
      'Ideation session still live from lap 1',
      'id="evidence-stage"',
      'checks passed',
      'How to drive this app',
      'Lap 1: DLQ spill retention landed',
      'Carried, still open',
      'Full account',
    ]
    const at = bands.map((band) => panes(html).column.indexOf(band))
    expect(at.filter((i) => i < 0)).toEqual([])
    expect(at).toEqual([...at].sort((a, b) => a - b))
  })
})

/**
 * How to drive this app, under the state line that carries the Test drive
 * control (drive-instructions, decision 6). The knowledge serves a human drive
 * exactly as it serves the review agent's, and showing it where drives happen is
 * what closes the loop: instructions that fail are read at the moment they fail,
 * one click from the settings field that fixes them.
 */
describe('the review page’s drive instructions', () => {
  const INSTRUCTIONS =
    'Drive the sample project at ./examples/demo — change anything in it.\n' +
    'Tell a session agent “this is a test, advance now” to reach a later phase.'

  it('renders what the project recorded, with the scope note and the way to edit it', () => {
    const html = render({ driveInstructions: INSTRUCTIONS })

    expect(html).toContain('How to drive this app')
    expect(html).toContain('Drive the sample project at ./examples/demo')
    expect(html).toContain('advance now')
    // The standing permission is scoped by prose the field cannot displace
    // (decision 7) — it is read here by a human about to act on it.
    expect(html).toContain('Applies inside the app under test only')
    // Read-only: the value renders as prose that keeps its line breaks, never
    // as a control — the one place it is edited is the settings field.
    expect(html).toContain('Edit in settings')
    expect(html).toContain('<p class="m-0 text-sm whitespace-pre-wrap text-text-2">Drive the')
  })

  it('is not there at all for a project that has recorded none', () => {
    for (const html of [render({}), render({ driveInstructions: '  \n ' })]) {
      expect(html).not.toContain('How to drive this app')
      expect(html).not.toContain('Applies inside the app under test only')
      expect(html).not.toContain('Edit in settings')
    }
  })
})
