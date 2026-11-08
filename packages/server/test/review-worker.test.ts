import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature, ReviewFindingInput, WorkerRow } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolReportFinding, toolResolveFinding, toolReviewHandBack, toolStartReview } from '../src/mcp/server'
import { resetAgentSlotsForTests } from '../src/services/agent-slots'
import { listByFeature as listFindings, reportFinding } from '../src/services/review-findings'
import { reviewPackage, workerPass } from '../src/services/review-package'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import type { AgentHost } from '../src/threads/types'
import { setSandboxEngineForTests } from '../src/workers/engine'
import { type DriveTaken, type ReviewDriveHost, setReviewDriveHostForTests } from '../src/workers/review'
import {
  dropWorker,
  getWorker,
  landWorker,
  listWorkers,
  setReviewDriveRetryForTests,
  withWorkers,
  workerStallBounds,
  workerTurnSlot,
} from '../src/workers/service'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp, type FakeTurn } from './support/fake-acp-agent'
import { fakeEngine, initRepo, type FakeEngine } from './support/fake-workers'
import { promptsOf } from './support/thread-launch'

/**
 * The end-of-feature review as a Review worker (burns-become-workers decisions
 * 3–5): a drive review runs on the host while it holds the drive slot, a gates
 * review in a worker sandbox; both report findings against themselves and hand
 * back with the Review Package; a verify review is given only its findings.
 */

let ctx: AppCtx
let home: string
let restoreDataDir: () => void
let repo: string
let feature: Feature
let lead: string
let engine: FakeEngine
let host: AgentHost | undefined
let drive: FakeDrive

/** The human's machine as a drive review sees it: a drive slot the test hands out, and whether it can drive at all. */
interface FakeDrive extends ReviewDriveHost {
  /** What each ask for the slot answers, in turn; then it is taken. */
  answers: DriveTaken[]
  asks: number
  given: string[]
  canDrive: boolean
}

function fakeDrive(): FakeDrive {
  const d: FakeDrive = {
    answers: [],
    asks: 0,
    given: [],
    canDrive: true,
    withheld: () => (d.canDrive ? undefined : 'Drive was unavailable: no browser.'),
    take: async () => {
      d.asks++
      return d.answers.shift() ?? { ok: true }
    },
    give: async (_project, _feature, passId) => {
      d.given.push(passId)
    },
  }
  return d
}

beforeEach(async () => {
  home = tmpRepo()
  restoreDataDir = useDataDir(home)
  ctx = await makeTestCtx()
  repo = initRepo('work')
  feature = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'work' })
  lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: repo }).id
  markSessionLive(ctx, lead, { ccSessionId: `cc-${lead}` })
  markSessionEnded(ctx, lead)
  engine = fakeEngine()
  setSandboxEngineForTests(engine)
  drive = fakeDrive()
  setReviewDriveHostForTests(drive)
  setReviewDriveRetryForTests(5)
  resetAgentSlotsForTests()
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'test-token')
})

afterEach(async () => {
  await host?.stopAll('shutdown')
  host = undefined
  setAgentHostForTests(undefined)
  setSandboxEngineForTests(undefined)
  setReviewDriveHostForTests(undefined)
  setReviewDriveRetryForTests(undefined)
  vi.unstubAllEnvs()
  restoreDataDir()
  rmTemp(home)
  rmTemp(repo)
})

const leadSession = () => getSessionRow(ctx, lead)!
const review = (): WorkerRow | undefined => listWorkers(ctx, feature.id).find((w) => w.kind === 'review')

async function until(done: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms
  while (!done()) {
    if (Date.now() > deadline) throw new Error('never got there')
    await new Promise((r) => setTimeout(r, 5))
  }
}

function realHost(fake: FakeAcp): AgentHost {
  engine.transport = fake.transport
  host = createAgentHost({
    ctx,
    transport: withWorkers(ctx, fake.transport),
    launch: FAKE_LAUNCH,
    lifecycle: threadLifecycle(ctx),
    turnSlot: workerTurnSlot(ctx),
    stallBounds: workerStallBounds({ silenceMs: 60_000, commandMs: 60_000 }),
    readUsage: async () => ({}),
    idleMs: 60_000,
  })
  setAgentHostForTests(host)
  return host
}

const text = (t: FakeTurn) => t.prompt.map((b) => (b.type === 'text' ? b.text : '')).join('')

const defect = (title: string): ReviewFindingInput => ({
  kind: 'defect',
  severity: 'high',
  title,
  location: 'Settings › Theme',
  citation: 'spec.md: the theme persists',
  detail: 'It did not persist.',
  reproStep: 'Pick dark, reload.',
})

/** A review agent: on its assignment it does `work`, then ends its turn; every other turn (the lead's) just ends. */
function reviewer(work: (w: WorkerRow) => Promise<void> | void): FakeAcp {
  return createFakeAcp({
    turn: async (t) => {
      if (!/^# (Review this feature|Verify these fixes)/m.test(text(t))) return
      await work(review()!)
      await t.say('Handed back.')
    },
  })
}

const leadPackages = () => promptsOf(lead).filter((p) => p.display && 'reviewPackage' in p.display)

describe('a drive review', () => {
  it('waits queued for the drive slot, runs on the host in the checkout, and gives the slot back at handback with its Review Package', async () => {
    drive.answers = [{ ok: false, retriable: true, reason: 'A test drive of feature/work is running — stop it first' }]
    realHost(
      reviewer((w) => {
        const session = getSessionRow(ctx, w.id)!
        toolReportFinding(ctx, { session }, defect('The theme does not persist'))
        toolReviewHandBack(ctx, session, { summary: 'Drive review: the theme picker works but forgets · 1 defect\n\nThe long account.' })
      }),
    )

    const started = await toolStartReview(ctx, leadSession(), {})
    expect(started).toMatchObject({ mode: 'drive', status: 'queued' })
    await until(() => review()?.status === 'handed-back')

    const w = review()!
    expect(drive.asks).toBe(2)
    expect(drive.given).toEqual([w.id])
    // No sandbox, no branch: its thread runs in the project's own checkout.
    expect(engine.created).toEqual([])
    expect(w.container).toBeNull()
    expect(getSessionRow(ctx, w.id)?.worktreePath).toBe(repo)
    expect(promptsOf(w.id)[0]?.text).toContain('# Review this feature')

    const [finding] = listFindings(ctx, feature.id)
    expect(finding).toMatchObject({ reviewWorkerId: w.id, reviewTicketId: null, fixTicketId: null, title: 'The theme does not persist' })

    expect(leadPackages()).toEqual([expect.objectContaining({ display: { reviewPackage: { workerId: w.id, label: 'Review' } } })])
    expect(leadPackages()[0]?.text).toContain(`The theme does not persist (${finding!.id})`)
    const pack = await reviewPackage(ctx, workerPass(w), feature, repo)
    expect(pack).toMatchObject({ ticketId: w.id, seq: null, verdict: 'Drive review: the theme picker works but forgets · 1 defect' })
    expect(pack.findings.map((f) => f.id)).toEqual([finding!.id])

    // The lead closes it as it closes any finding.
    toolResolveFinding(ctx, leadSession(), { findingId: finding!.id, disposition: 'addressed', note: 'Fixed in abc1234.' })
    expect(listFindings(ctx, feature.id)[0]).toMatchObject({ status: 'fixed', resolvedBy: 'session' })

    // A review lands nothing, and no longer takes findings once it handed back.
    await expect(landWorker(ctx, w.id)).rejects.toBeInstanceOf(GateError)
    expect(() => toolReportFinding(ctx, { session: getSessionRow(ctx, w.id)! }, defect('Late'))).toThrow(GateError)
  })

  it('gives the slot back when it is dropped or stopped, and fails when the drive cannot start', async () => {
    realHost(reviewer(() => {}))
    const { workerId } = await toolStartReview(ctx, leadSession(), {})
    await until(() => getWorker(ctx, workerId)?.status === 'needs-you')
    await dropWorker(ctx, workerId)
    expect(drive.given).toContain(workerId)

    // Stopped mid-turn, it gives the drive back too.
    let reviewing = false
    await host!.stopAll('shutdown')
    realHost(
      createFakeAcp({
        turn: async (t) => {
          if (!/^# Review this feature/m.test(text(t))) return
          reviewing = true
          await t.cancelled
          return 'cancelled' as const
        },
      }),
    )
    const stopped = await toolStartReview(ctx, leadSession(), {})
    await until(() => reviewing)
    await host!.cancel(stopped.workerId)
    await until(() => drive.given.includes(stopped.workerId))

    drive.answers = [{ ok: false, retriable: false, reason: 'uncommitted files: notes.txt' }]
    const second = await toolStartReview(ctx, leadSession(), {})
    expect(getWorker(ctx, second.workerId)).toMatchObject({ status: 'failed', failure: expect.stringContaining('uncommitted files') })
    expect(drive.given).toContain(second.workerId)
  })
})

describe('a gates review', () => {
  it('runs in a worker sandbox on the feature branch, reports findings through the relay, and hands back its package', async () => {
    drive.canDrive = false
    realHost(
      reviewer(async (w) => {
        await engine.processes[0]!.tools('report_finding', defect('The typecheck fails'))
        engine.handbacks.set(w.id, { summary: 'Gates review: typecheck red · 1 defect', at: Date.now() })
      }),
    )

    const started = await toolStartReview(ctx, leadSession(), {})
    expect(started.mode).toBe('gates')
    await until(() => review()?.status === 'handed-back')

    const w = review()!
    expect(engine.created).toEqual([expect.objectContaining({ featureBranch: 'feature/work', baseBranch: 'main' })])
    expect(engine.launches[0]?.session.mcpServers[0]).toMatchObject({ env: expect.arrayContaining([{ name: 'RUNCASTLE_WORKER_REVIEW', value: '1' }]) })
    expect(listFindings(ctx, feature.id)).toEqual([expect.objectContaining({ reviewWorkerId: w.id, title: 'The typecheck fails' })])
    expect(leadPackages()).toHaveLength(1)
    expect(drive.asks).toBe(0)
  })

  it('is what a lead that asks for one gets, and a drive is refused where this machine cannot drive', async () => {
    realHost(reviewer(() => {}))
    expect((await toolStartReview(ctx, leadSession(), { mode: 'gates' })).mode).toBe('gates')
    drive.canDrive = false
    await expect(toolStartReview(ctx, leadSession(), { mode: 'drive' })).rejects.toBeInstanceOf(GateError)
  })
})

describe('a verify review', () => {
  it('is given only the findings and fix commits it was handed', async () => {
    realHost(reviewer(() => {}))
    // The first review's findings, two of them.
    const first = await toolStartReview(ctx, leadSession(), { mode: 'gates' })
    const firstRow = getWorker(ctx, first.workerId)!
    const fixed = reportFinding(ctx, { featureId: feature.id, reviewWorker: firstRow, input: defect('The theme does not persist') }).finding
    reportFinding(ctx, { featureId: feature.id, reviewWorker: firstRow, input: defect('The header overflows') })

    const verify = await toolStartReview(ctx, leadSession(), {
      mode: 'gates',
      verify: { findingIds: [fixed.id], commits: ['abc1234 fix: persist the theme'] },
    })
    const assignment = promptsOf(verify.workerId)[0]?.text ?? ''
    expect(getWorker(ctx, verify.workerId)?.label).toBe('Review: verify')
    expect(assignment).toContain('# Verify these fixes')
    expect(assignment).toContain('The theme does not persist')
    expect(assignment).toContain('abc1234 fix: persist the theme')
    expect(assignment).not.toContain('The header overflows')

    await expect(toolStartReview(ctx, leadSession(), { verify: { findingIds: ['finding_nope'], commits: [] } })).rejects.toThrow(/no finding finding_nope/)
  })
})
