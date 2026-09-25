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
  drive: undefined as { featureId: string; state: string; dryRun: boolean; holderLabel: string } | undefined,
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
        agenticReview: { useMutation: mutation },
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
  reviewMode: null,
  reviewVerdict: null,
  reviewVerdictReason: null,
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

const LIVE_CHAT = {
  id: 'ses_1',
  featureId: 'feat_1',
  lap: 1,
  kind: 'chat',
  status: 'live',
  createdAt: 1,
} as unknown as FeatureFull['sessions'][number]

/** A review drive the human's own uncommitted files refused. */
const DENIED: EventRow = {
  id: 7,
  projectId: 'proj_1',
  featureId: 'feat_1',
  ts: 1_760_000_000_000,
  type: 'reviewdrive.denied',
  message: 'review drive denied — 1 uncommitted file(s) in the working tree: src/App.tsx',
  data: { code: 'dirty', dirtyFiles: ['src/App.tsx'] },
}

/** Every button of a variant on the page, by its label (icons stripped). */
const buttonsOf = (html: string, variant: string): string[] =>
  [...html.matchAll(/<button[^>]*data-variant="([a-z]+)"[^>]*>(.*?)<\/button>/g)]
    .filter((m) => m[1] === variant)
    .map((m) => m[2]!.replace(/<[^>]+>/g, '').trim())
/** The primary is the next-step bar's (DESIGN.md: one per view) — never a body band's. */
const primaryButtons = (html: string): string[] => buttonsOf(html, 'primary')
/** The hairline button a notice's action takes. */
const secondaryButtons = (html: string): string[] => buttonsOf(html, 'secondary')

/** The feature as each prototype state has it, plus what the queries answer. */
function render(
  over: {
    sessions?: FeatureFull['sessions']
    notes?: TestNote[]
    findings?: ReviewFinding[]
    openDefects?: ReviewFinding[]
    carriedFindings?: ReviewFinding[]
    recordings?: ReviewArtifacts[]
    drive?: { featureId: string; state: string; dryRun: boolean; holderLabel: string }
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
    expect(html).toContain('>Checks<')
    // Test drive is the next-step bar's (it is not repeated beside the facts).
    expect(html).not.toContain('Test drive</button>')
    expect(html).toContain('DLQ spill retention landed')
    expect(html).toContain('the repaired read path is never called')
    expect(html).toContain('the spilled-at column shows raw epoch millis')
    expect(html).toContain('Full account')
    // And the ones that are not.
    expect(html).not.toContain('id="evidence-stage"')
    expect(html).not.toContain('No walkthrough yet')
    expect(html).not.toContain('session still live')
  })

  /** Decision 8: the lap account is ONE line — the rest of the digest is not here. */
  it('lifts the digest’s first line out and leaves the account behind the disclosure', () => {
    const html = openWork()
    expect(html).toContain('DLQ spill retention landed<')
    expect(html.indexOf('DLQ spill retention landed')).toBeLessThan(html.indexOf('Full account'))
    // The long account renders once, and only inside the disclosure.
    expect(html.indexOf('The cap bounds rows')).toBeGreaterThan(html.indexOf('Full account'))
  })

  /** Decisions 2 and 8: an observation is one line in the disclosure and nothing else. */
  it('keeps observations inside the disclosure, with no count on arrival', () => {
    const html = openWork()
    expect(html).toMatch(/Observations<\/span><span[^>]*>1</)
    expect(html.indexOf('the verify gate could not run')).toBeGreaterThan(html.indexOf('Full account'))
    expect(html).not.toContain('1 observation ·')
    expect(html).not.toContain('defects found ·')
  })

  /** State 2: the feature's lap-1 chat is still live. */
  it('states a live session as one alert line instead of mounting its terminal', () => {
    const html = render({
      sessions: [LIVE_CHAT],
      notes: [NOTE],
      findings: [DEFECT],
      openDefects: [DEFECT],
    })
    expect(html).toContain('Chat session still live from lap 1')
    expect(html).toContain('Open</button>')
    expect(html).toContain('End session')
    // The line replaces the panel — no terminal renders on this page at all.
    expect(html).not.toContain('grill-term')
  })

  it('says nothing at all about a session that has already ended', () => {
    const html = render({ sessions: [{ ...LIVE_CHAT, status: 'ended' }] })
    expect(html).not.toContain('session still live')
  })

  /** State 3: the agent recorded a walkthrough — only now is there a stage. */
  it('mounts the evidence stage for a recording, and for a live drive', () => {
    const walkthrough = render({ recordings: [RECORDING] })
    expect(walkthrough).toContain('id="evidence-stage"')
    // The drive door is the next-step bar's, in every state — never repeated here.
    expect(walkthrough).not.toContain('Test drive</button>')

    const driving = render({ drive: { featureId: 'feat_1', state: 'serving', dryRun: false, holderLabel: 'a test drive of feature/greetings' } })
    expect(driving).toContain('id="evidence-stage"')
    // ...except while a drive is up, which the stage itself is there to stop.
    expect(driving).not.toContain('Test drive</button>')
    // A drive of some OTHER feature is not this page's evidence.
    expect(
      render({ drive: { featureId: 'feat_9', state: 'serving', dryRun: false, holderLabel: 'a test drive of feature/other' } }),
    ).not.toContain('id="evidence-stage"')
  })

  /** State 4: nothing open — the page still leads with state and the account. */
  it('leads with the same bands when nothing is open', () => {
    const html = render({})
    expect(html).toContain('Nothing needs attention')
    expect(html).toContain('DLQ spill retention landed')
    expect(html).not.toContain('id="evidence-stage"')
  })

  /** Decision 8: the work already dealt with is in the disclosure, not on arrival. */
  it('files handled work into the disclosure and names it in the summary', () => {
    const html = render({ notes: [{ ...NOTE, id: 'note_9', status: 'done', text: 'already handled' }] })
    expect(html).toMatch(/Full account<\/span><span[^>]*>digest · carried</)
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
    // The open work's tally still counts one defect, not two.
    expect(html).toContain('1 open')
    // The band sits between the open work and the laps: the next lap's agenda
    // before the history it came out of.
    const carriedAt = html.indexOf('Carried, still open')
    expect(carriedAt).toBeGreaterThan(html.indexOf('id="open-work"'))
    expect(carriedAt).toBeLessThan(html.indexOf('id="lap-trail"'))
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
    const RUN = (startedAt: number): FeatureFull['runs'][number] => ({
      id: `run_${startedAt}`,
      featureId: 'feat_1',
      workflow: 'ticket-burner',
      status: 'succeeded',
      startedAt,
    })

    it('raises a banner naming the files, with the way to run another review', () => {
      const html = render({ events: [DENIED] })
      expect(html).toContain('Review couldn’t drive')
      expect(html).toContain('src/App.tsx')
      expect(html).toContain('Agentic review')
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
    const html = render({ sessions: [LIVE_CHAT], readonly: true })
    expect(html).not.toContain('session still live')
    expect(html).not.toContain('Test drive</button>')
  })

  /**
   * The lap that verified nothing (review-as-a-lap-trail decision 5). The post
   * mortem's own case: the run says succeeded, no defect is open, and the pass
   * that produced that silence could not attach a browser. It has to arrive as
   * the page's top line, and it may not block anything.
   */
  describe('a current lap whose review verified nothing', () => {
    const UNVERIFIED: ReviewArtifacts = {
      ...RECORDING,
      hasVideo: false,
      videoUrl: null,
      reviewMode: 'drive',
      reviewVerdict: 'unverified',
      reviewVerdictReason: 'no browser could be attached',
    }
    const UNVERIFIED_TICKET = {
      ...REVIEW_TICKET,
      digest:
        'Lap 1 · drive mode · DRIVE FAILED · nothing verified — no browser could be attached\n\n' +
        'All acceptance criteria remain honestly unverified.',
    } as FeatureFull['tickets'][number]

    const arrival = (over: Parameters<typeof render>[0] = {}) =>
      render({ recordings: [UNVERIFIED], tickets: [UNVERIFIED_TICKET], ...over })

    it('leads the page with "nothing verified this lap", above the stage', () => {
      const html = arrival()
      expect(html).toContain('Nothing verified this lap')
      expect(html.indexOf('Nothing verified this lap')).toBeLessThan(html.indexOf('>Checks<'))
    })

    /** Runcastle's own words — the agent's prose stays in the Full account. */
    it('states the templated line and the declared reason, never the agent’s prose', () => {
      const html = arrival()
      const banner = html.slice(0, html.indexOf('>Checks<'))
      expect(banner).toContain('Lap 1 · drive mode · DRIVE FAILED · nothing verified')
      expect(banner).not.toContain('All acceptance criteria remain honestly unverified')
    })

    /** Decision 5: the banner's action slot favours another review pass. */
    it('offers the Agentic review mint as the banner’s action', () => {
      const banner = arrival().slice(0, arrival().indexOf('>Checks<'))
      expect(banner).toContain('Agentic review')
    })

    /**
     * DESIGN.md: one primary per view, and it is the next-step bar's — no band
     * in the body claims one. Both notices can be up at once — a pass denied its
     * drive over a dirty tree that then leaves no parseable declaration block
     * lands unverified while the denial is still showing — and both mints are
     * the same verb, so only the loud notice's keeps its hairline and the
     * denial's steps down to ghost.
     */
    it('keeps one hairline mint when the denied-drive notice is up beside it', () => {
      const html = arrival({ events: [DENIED] })
      expect(html).toContain('Review couldn’t drive')
      expect(html).toContain('Nothing verified this lap')
      expect(primaryButtons(html)).toEqual([])
      const notices = html.slice(0, html.indexOf('>Checks<'))
      expect(secondaryButtons(notices).filter((label) => label === 'Agentic review')).toHaveLength(1)
      // And it is this notice's: the denial above it steps down.
      expect(secondaryButtons(html.slice(0, html.indexOf('Nothing verified this lap')))).toEqual([])
    })

    /** With no unverified lap the denial's mint keeps its hairline. */
    it('leaves the denied-drive notice its hairline mint when nothing is unverified', () => {
      const html = render({ events: [DENIED] })
      expect(html).toContain('Review couldn’t drive')
      const notices = html.slice(0, html.indexOf('>Checks<'))
      expect(secondaryButtons(notices).filter((label) => label === 'Agentic review')).toHaveLength(1)
      expect(primaryButtons(html)).toEqual([])
    })

    it('says nothing when the lap’s pass verified something', () => {
      const html = render({
        recordings: [{ ...UNVERIFIED, reviewVerdict: 'verified', reviewVerdictReason: null }],
      })
      expect(html).not.toContain('Nothing verified this lap')
    })

    /** An earlier lap's silence is history — the trail carries it, not the top
     *  line, which is about the lap the human is standing in. */
    it('says nothing when the unverified pass belongs to an earlier lap', () => {
      expect(arrival({ recordings: [{ ...UNVERIFIED, lap: 0 }] })).not.toContain(
        'Nothing verified this lap',
      )
    })

    it('renders no banner at all on a readonly view', () => {
      expect(arrival({ readonly: true })).not.toContain('Nothing verified this lap')
    })
  })

  /**
   * The lap trail (decisions 4–5) — the history band the page grew, rendered
   * from the same per-pass feed the stage plays from.
   */
  describe('the lap trail band', () => {
    it('opens on the lap’s account, above the full-account disclosure', () => {
      const html = render({ recordings: [RECORDING] })
      expect(html).toContain('id="lap-trail"')
      expect(html.indexOf('DLQ spill retention landed')).toBeGreaterThan(html.indexOf('id="lap-trail"'))
      expect(html.indexOf('id="lap-trail"')).toBeLessThan(html.indexOf('Full account'))
    })

    it('is not there at all before anything was reviewed or burned', () => {
      expect(render({ tickets: [] as FeatureFull['tickets'] })).not.toContain('id="lap-trail"')
    })
  })

  /**
   * The Agentic review control (decision 6): present in every state of the
   * page, disabled with its reason while a burn holds the feature.
   */
  describe('the Agentic review control', () => {
    const RUNNING = [
      {
        id: 'run_1',
        featureId: 'feat_1',
        workflow: 'ticket-burner',
        status: 'running',
        startedAt: 10,
      },
    ] as unknown as FeatureFull['runs']

    it('is on the page in every state, drive up or not', () => {
      for (const html of [
        render({}),
        openWork(),
        render({ recordings: [RECORDING] }),
        render({ drive: { featureId: 'feat_1', state: 'serving', dryRun: false, holderLabel: 'a test drive of feature/greetings' } }),
      ]) {
        expect.soft(html).toContain('Agentic review</button>')
      }
    })

    it('is disabled with its reason while a burn is running', () => {
      const html = render({ runs: RUNNING })
      expect(html).toContain('title="a burn is running"')
    })

    it('is absent from a history view, which acts on nothing', () => {
      expect(render({ readonly: true })).not.toContain('Agentic review')
    })
  })
})

/**
 * One document, no permanent rail (DESIGN.md: one aside, opened on demand;
 * "What still needs attention" only when there is something). The open work is
 * a section of the page — rows under a heading, with the composer — and the
 * notes become the one aside only while the stage has the window (see
 * `stage-expand.test.tsx`).
 */
describe('the review page as one document', () => {
  it('renders no aside at all in the page flow', () => {
    for (const html of [openWork(), render({}), render({ recordings: [RECORDING] })]) {
      expect.soft(html).not.toContain('<aside')
      expect.soft(html).not.toContain('w-(--notes-rail-w)')
    }
  })

  it('makes the open work a section with its rows and the composer', () => {
    const html = openWork()
    expect(html).toContain('id="open-work"')
    expect(html).toMatch(/<h2[^>]*>Needs attention<\/h2>/)
    expect(html).toContain('the spilled-at column shows raw epoch millis')
    expect(html).toContain('the repaired read path is never called')
    expect(html).toContain('what did you just see?')
  })

  /** Nothing open: the heading steps down, and a live page keeps only the composer. */
  it('keeps no "needs attention" heading when nothing needs any', () => {
    const html = render({})
    expect(html).not.toMatch(/<h2[^>]*>Needs attention<\/h2>/)
    expect(html).toContain('what did you just see?')
  })

  /** History with nothing left open has nothing to say here at all (33a). */
  it('renders no open-work section on an empty history view', () => {
    const html = render({ readonly: true })
    expect(html).not.toContain('id="open-work"')
    expect(html).not.toContain('what did you just see?')
  })

  it('keeps the rows but drops the composer on a history view', () => {
    const html = render({ readonly: true, notes: [NOTE] })
    expect(html).toContain('id="open-work"')
    expect(html).not.toContain('what did you just see?')
  })

  /** The page, top to bottom: notices, state, stage, open work, carried, laps, the closed text. */
  it('keeps its band order', () => {
    const html = render({
      sessions: [LIVE_CHAT],
      recordings: [RECORDING],
      findings: [DEFECT, CARRIED],
      openDefects: [DEFECT],
      carriedFindings: [CARRIED],
      driveInstructions: 'Drive the sample project at ./examples/demo.',
    })
    const bands = [
      'Chat session still live from lap 1',
      '>Checks<',
      'id="evidence-stage"',
      'id="open-work"',
      'Carried, still open',
      'id="lap-trail"',
      'DLQ spill retention landed',
      'How to drive this app',
      'Full account',
    ]
    const at = bands.map((band) => html.indexOf(band))
    expect(at.filter((i) => i < 0)).toEqual([])
    expect(at).toEqual([...at].sort((a, b) => a - b))
  })

  it('draws no bordered card around a band', () => {
    expect(openWork()).not.toContain('rounded-lg border')
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
    // Read-only, and read once: rendered prose inside a closed disclosure,
    // never a control — the one place it is edited is the settings field.
    expect(html).toContain('Edit in settings')
    const at = html.indexOf('How to drive this app')
    const details = html.lastIndexOf('<details', at)
    expect(details).toBeGreaterThan(-1)
    expect(html.slice(details, at)).not.toContain('open=""')
  })

  it('is not there at all for a project that has recorded none', () => {
    for (const html of [render({}), render({ driveInstructions: '  \n ' })]) {
      expect(html).not.toContain('How to drive this app')
      expect(html).not.toContain('Applies inside the app under test only')
      expect(html).not.toContain('Edit in settings')
    }
  })
})
