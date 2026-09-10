import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Feature,
  Project,
  RuncastleConfig,
  Ticket,
  WorkflowCtx,
  WorkflowDef,
} from '@runcastle/core'
import { newId } from '@runcastle/core'
import { runs } from '../src/db/schema'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { renderRunMcpConfig } from '../src/launcher/artifacts'
import { createNativePtySession } from '../src/pty/pty'
import { getFeatureRow, listRunsByFeature } from '../src/services/repo'
import {
  __resetTestDriveState,
  activeDriveInfo,
  createFeatureBranch,
  releaseReviewDrive,
  reviewDrive,
} from '../src/services/git'
import { checkGate } from '../src/services/gates'
import { openProject } from '../src/services/projects'
import { listAfter } from '../src/services/events'
import { overrideGate } from '../src/services/gates'
import { listByFeature, storeTickets } from '../src/services/tickets'
import { AUTO_FIX_CAP } from '../src/services/review-findings'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { workflowRegistry } from '../src/workflows/registry'
import {
  AGENT_BROWSER_BIN,
  buildDriveAvailability,
  buildDriveInstructions,
  buildGateNotes,
  executeReviewTicket,
  findOnPath,
  inheritedReviewMode,
  renderReviewPrompt,
  reviewTemplatePath,
  shouldStopAfterDigest,
} from '../src/workflows/review-ticket'
import type { BurnDeps, TicketOutcome } from '../src/workflows/ticket-burner'
import { buildBurnAgent, buildLapDigestsBlock, burnRun } from '../src/workflows/ticket-burner'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Per-kind execution in the burn (improve-workflow seam 2): a review ticket
 * runs LAST, host-side, against the integrated feature branch — and its outcome
 * obeys the advisory bargain, where finding bugs is success and only "could not
 * review" is failure.
 *
 * The scheduling half is driven through `burnRun` with a fake
 * `executeTicketRun`, the way `ticket-burner.test.ts` does — sandcastle is the
 * boundary, not the subject. The executor's own half is exercised where it can
 * be observed without spawning an agent: the artifacts it hands the agent, and
 * the failure it reaches before any agent exists.
 */

const project: Project = { id: 'proj_1', name: 'test', repoPath: '/repo' }

const feature: Feature = {
  id: 'feat_1',
  projectId: 'proj_1',
  slug: 'demo',
  title: 'Demo',
  oneLiner: 'x',
  mapped: false,
  phase: 'implementation',
  branch: 'feature/demo',
  baseBranch: 'main',
  status: 'active',
  createdAt: 0,
}

function ticket(seq: number, over: Partial<Ticket> = {}): Ticket {
  return {
    id: `tkt_${seq}`,
    featureId: feature.id,
    seq,
    title: `Ticket ${seq}`,
    goal: 'g',
    context: 'c',
    acceptanceCriteria: ['a'],
    seams: ['s'],
    blockedBy: [],
    kind: 'implementation',
    status: 'pending',
    commits: [],
    ...over,
  }
}

const review = (seq: number, over: Partial<Ticket> = {}): Ticket =>
  ticket(seq, { kind: 'review', title: `Review ${seq}`, ...over })

function makeCtx(tickets: Ticket[]) {
  const ctx: WorkflowCtx = {
    runId: 'run_1',
    project,
    feature,
    tickets,
    emitEvent: () => {},
    updateTicket: (id, patch) => {
      const t = tickets.find((x) => x.id === id)
      if (t) Object.assign(t, patch)
    },
    resolveWaypoint: () => {},
    signal: new AbortController().signal,
  }
  return ctx
}

/**
 * A boundary that records the order tickets reached it and holds each one until
 * released, so "did the review wait?" is observable rather than inferred from a
 * lucky interleaving.
 */
function gatedExecute(outcomes: Record<number, TicketOutcome> = {}) {
  const started: number[] = []
  const gates = new Map<number, () => void>()
  const execute = (_c: WorkflowCtx, t: Ticket): Promise<TicketOutcome> => {
    started.push(t.seq)
    return new Promise<TicketOutcome>((resolve) => {
      gates.set(t.seq, () => resolve(outcomes[t.seq] ?? { status: 'done', commits: ['sha'] }))
    })
  }
  /** Let seq finish, then yield the microtask queue so the scheduler reacts. */
  const release = async (seq: number): Promise<void> => {
    gates.get(seq)?.()
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  return { execute, started, release }
}

function deps(execute: BurnDeps['executeTicketRun'], concurrency = 4): BurnDeps {
  return {
    config: { sandbox: 'docker' } as RuncastleConfig,
    hasAuthToken: true,
    concurrency,
    executeTicketRun: execute,
  }
}

describe('a review ticket is scheduled behind every implementation ticket', () => {
  it('waits for them all, even at a concurrency that could run it beside them', async () => {
    const tickets = [ticket(1), ticket(2), review(3, { blockedBy: [1, 2] })]
    const { execute, started, release } = gatedExecute()

    const run = burnRun(makeCtx(tickets), deps(execute))
    await Promise.resolve()

    // Both implementation tickets are in flight; the review is not.
    expect(started).toEqual([1, 2])
    await release(1)
    expect(started).toEqual([1, 2])
    await release(2)
    expect(started).toEqual([1, 2, 3])

    await release(3)
    expect((await run).status).toBe('succeeded')
  })

  it('waits even when the ticket was emitted without the blocking edges', async () => {
    // The precondition is the burner's, not the emitting session's: a review
    // ticket with no `blockedBy` at all still runs last.
    const tickets = [ticket(1), review(2)]
    const { execute, started, release } = gatedExecute()

    const run = burnRun(makeCtx(tickets), deps(execute))
    await Promise.resolve()

    expect(started).toEqual([1])
    await release(1)
    expect(started).toEqual([1, 2])

    await release(2)
    await run
  })

  it('does not hold implementation tickets behind each other', async () => {
    // The gate is one-way — the review waits for the others, not the reverse.
    const tickets = [ticket(1), ticket(2), review(3)]
    const { execute, started, release } = gatedExecute()

    const run = burnRun(makeCtx(tickets), deps(execute))
    await Promise.resolve()

    expect(started).toEqual([1, 2])
    await release(1)
    await release(2)
    await release(3)
    await run
  })
})

describe('a review ticket waits for a whole feature', () => {
  it('stays pending when an implementation ticket failed, and the run ends failed', async () => {
    const tickets = [ticket(1), ticket(2), review(3, { blockedBy: [1, 2] })]
    const { execute, started, release } = gatedExecute({ 1: { status: 'failed', error: 'boom' } })

    const run = burnRun(makeCtx(tickets), deps(execute))
    await Promise.resolve()

    expect(started).toEqual([1, 2])
    await release(1)
    await release(2)

    // Never started, never cascaded to failed: the next burn picks it up once
    // the human has retried or cancelled ticket 1 (decision 2).
    expect(started).toEqual([1, 2])
    expect(tickets[2]).toMatchObject({ status: 'pending' })
    const result = await run
    expect(result.status).toBe('failed')
    expect(result.summary).toContain('review deferred')
  })

  it('defers even when the review was emitted without the blocking edges', async () => {
    // The gate is the burner's, read off the run's own tickets — a review with
    // no `blockedBy` at all still waits for what failed.
    const tickets = [ticket(1), review(2)]
    const { execute, started, release } = gatedExecute({ 1: { status: 'failed', error: 'boom' } })

    const run = burnRun(makeCtx(tickets), deps(execute))
    await Promise.resolve()
    await release(1)

    expect(started).toEqual([1])
    expect(tickets[1]).toMatchObject({ status: 'pending' })
    expect((await run).status).toBe('failed')
  })

  it('runs beside a cancelled implementation ticket as long as one landed', async () => {
    const tickets = [ticket(1), ticket(2, { status: 'cancelled' }), review(3, { blockedBy: [1, 2] })]
    const { execute, started, release } = gatedExecute()

    const run = burnRun(makeCtx(tickets), deps(execute))
    await Promise.resolve()
    await release(1)

    expect(started).toEqual([1, 3])
    await release(3)
    expect((await run).status).toBe('succeeded')
  })

  it('is cancelled with a reason when every implementation ticket was cancelled', async () => {
    // Nothing landed, so there is nothing to review — and nothing failed
    // either, so the run is not a failure (decision 6).
    const tickets = [
      ticket(1, { status: 'cancelled' }),
      ticket(2, { status: 'cancelled' }),
      review(3, { blockedBy: [1, 2] }),
    ]
    const { execute, started } = gatedExecute()

    const result = await burnRun(makeCtx(tickets), deps(execute))

    expect(started).toEqual([])
    expect(tickets[2]).toMatchObject({
      status: 'cancelled',
      error: 'nothing landed — every implementation ticket in the run was cancelled',
    })
    expect(result).toMatchObject({ status: 'succeeded' })
  })

  it('leaves the cascade alone for an implementation ticket with the same blocker', async () => {
    const tickets = [ticket(1), ticket(2, { blockedBy: [1] }), review(3, { blockedBy: [1] })]
    const { execute, started, release } = gatedExecute({ 1: { status: 'failed', error: 'boom' } })

    const run = burnRun(makeCtx(tickets), deps(execute))
    await Promise.resolve()
    await release(1)

    // 2 cascades to failed; 3 defers, and neither of them ran.
    expect(started).toEqual([1])
    expect(tickets[1]).toMatchObject({ status: 'failed', error: 'blocked by failed ticket 1' })
    expect(tickets[2]).toMatchObject({ status: 'pending' })
    await run
  })

  it('still cascades on a blocker that is not in the run at all', async () => {
    // A missing blocker is a malformed graph, not a ticket that tried and
    // failed — that cascades whatever the kind, and there is no re-burn that
    // could resolve it.
    const tickets = [review(2, { blockedBy: [9] })]
    const { execute, started } = gatedExecute()

    await burnRun(makeCtx(tickets), deps(execute))

    expect(started).toEqual([])
    expect(tickets[0]).toMatchObject({ status: 'failed', error: 'blocked by missing ticket 9' })
  })
})

describe("a review ticket's account reaches the run digest", () => {
  it('carries its digest like any done ticket', async () => {
    const tickets = [ticket(1), review(2, { blockedBy: [1] })]
    const execute = async (_c: WorkflowCtx, t: Ticket): Promise<TicketOutcome> => ({
      status: 'done',
      commits: t.seq === 1 ? ['sha'] : [],
      digest: t.seq === 1 ? 'built the thing' : 'walked the settings flow; 2 findings',
    })

    const result = await burnRun(makeCtx(tickets), deps(execute))

    expect(result.status).toBe('succeeded')
    expect(result.digest).toContain('## ticket 2 — Review 2')
    expect(result.digest).toContain('walked the settings flow; 2 findings')
  })

  it('carries the reason it could not run, and stores it on the ticket', async () => {
    const tickets = [ticket(1), review(2, { blockedBy: [1] })]
    const execute = async (_c: WorkflowCtx, t: Ticket): Promise<TicketOutcome> =>
      t.seq === 1
        ? { status: 'done', commits: ['sha'] }
        : {
            status: 'failed',
            error: 'ticket 2: Review could not run: the dev URL never appeared',
            digest: '**Review could not run: the dev URL never appeared**',
          }

    const result = await burnRun(makeCtx(tickets), deps(execute))

    expect(result.status).toBe('failed')
    expect(result.digest).toContain('Review could not run: the dev URL never appeared')
    expect(tickets[1]).toMatchObject({
      status: 'failed',
      digest: '**Review could not run: the dev URL never appeared**',
    })
  })
})

describe('what the review agent is handed', () => {
  const config = { serverPort: 4512, sandbox: 'docker' } as RuncastleConfig

  it('identifies itself to the MCP server by its run, not by a session', () => {
    expect(renderRunMcpConfig('run_abc', config)).toEqual({
      mcpServers: {
        runcastle: {
          type: 'http',
          url: 'http://localhost:4512/mcp',
          headers: { 'X-Runcastle-Run': 'run_abc' },
        },
      },
    })
  })

  it('reaches that config through the print command, and runs on the host', () => {
    // `config.sandbox` is docker — the review agent still gets the host build,
    // because the app it reviews only exists out here.
    const agent = buildBurnAgent(
      config,
      'sk-token',
      { id: 'claude-opus-5', runtime: 'claude-code' },
      {
        onHost: true,
        mcp: {
          path: '/tmp/reviews/tkt_9/mcp.json',
          config: {
            mcpServers: {
              runcastle: {
                type: 'http',
                url: 'http://127.0.0.1:4512/mcp',
                headers: { 'X-Runcastle-Run': 'run_1' },
              },
            },
          },
        },
      },
    )

    const { command } = agent.buildPrintCommand({
      prompt: 'review it',
      dangerouslySkipPermissions: false,
    })
    expect(command).toContain('--mcp-config "/tmp/reviews/tkt_9/mcp.json"')
    // The host build's markers: the host env passes through, and permissions
    // are bypassed so the agent can actually call its tools.
    expect(agent.env.PATH).toBe(process.env.PATH)
    expect(command).toContain('--permission-mode bypassPermissions')
  })

  it('gets a prompt with every placeholder filled', () => {
    const prompt = renderReviewPrompt(readFileSync(reviewTemplatePath(), 'utf8'), {
      TICKET_JSON: '{"seq":3}',
      FEATURE_BRIEF: 'Demo feature',
      DOCS_DIGEST: 'the docs',
      LAP_DIGESTS: buildLapDigestsBlock([
        { seq: 1, title: 'Add the ledger', digest: 'Built it. Surprises: the API lied.' },
      ]),
      FEATURE_BRANCH: 'feature/demo',
      BASE_BRANCH: 'main',
      DRIVE_AVAILABILITY: buildDriveAvailability('/usr/bin/agent-browser', 'bun dev'),
      DRIVE_INSTRUCTIONS: buildDriveInstructions('Drive the sample project at /tmp/sample.'),
      GATE_NOTES: buildGateNotes({ verifyCommands: 'bun run typecheck' }),
      DIGEST_PATH: '/data/reviews/tkt_3/DIGEST.md',
      BLOCKED_PATH: '/data/reviews/tkt_3/BLOCKED.md',
      WALKTHROUGH_PATH: '/data/reviews/tkt_3/walkthrough.webm',
      LANDED_FIXES: '',
      VERIFIES_PASS: '',
      AUTO_FIX_CAP: String(AUTO_FIX_CAP),
    })

    expect(prompt).not.toContain('{{')
    // The correctness fix: the diff is pinned to the two refs it was handed,
    // never to HEAD — which is still the base branch when step 1 runs.
    expect(prompt).toContain('git diff main...feature/demo')
    expect(prompt).toContain('git log main...feature/demo --oneline')
    expect(prompt).not.toMatch(/\.\.\.HEAD/)
    expect(prompt).not.toContain('symbolic-ref')
    // The implementers' own accounts, which the reviewer used to be told did
    // not exist.
    expect(prompt).toContain('ticket 1 — Add the ledger')
    expect(prompt).toContain('the API lied')
    expect(prompt).not.toMatch(/only agent in the burn that can answer/)
    // The two wires and the report paths are the contract with the burner.
    expect(prompt).toContain('review_drive')
    expect(prompt).toContain('report_finding')
    expect(prompt).toContain('/data/reviews/tkt_3/DIGEST.md')
    expect(prompt).toContain('/data/reviews/tkt_3/BLOCKED.md')
    // The recording is aimed at the file the artifact routes serve, and is
    // stopped in the same cleanup that stops the drive.
    expect(prompt).toContain('agent-browser record start /data/reviews/tkt_3/walkthrough.webm')
    expect(prompt).toContain('agent-browser record stop')
    // Gates mode runs the project's own commands rather than guessing at them.
    expect(prompt).toContain('bun run typecheck')
    // And Drive mode is told how this particular app wants to be driven.
    expect(prompt).toContain('Drive the sample project at /tmp/sample.')
  })

  /**
   * The findings channel (decisions 1, 2, 8): typed reports the run can act on,
   * not prose in the human's own notes ledger — and no closing summary note,
   * because the digest IS the summary and observations render under it.
   */
  it('sends every finding through report_finding, typed, worst first', () => {
    const template = readFileSync(reviewTemplatePath(), 'utf8')

    expect(template).toContain('mcp__runcastle__report_finding')
    expect(template).not.toContain('add_test_note')
    expect(template).not.toMatch(/summary note/i)

    // What separates the two kinds: the outcome, not the acceptance criteria —
    // and which way to fall when unsure.
    expect(template).toMatch(/`defect` when the human's problem is not actually solved/i)
    expect(template).toMatch(/even when every acceptance criterion passes/i)
    expect(template).toMatch(/`observation` is everything else/i)
    expect(template).toMatch(/unsure whether the human's problem is solved → defect/i)
    expect(template).not.toMatch(/unsure → observation/i)
    // The narrowed bucket still has its mandated paths: a drive that would not
    // start, a gate that could not run, a half-built feature.
    expect(template).toMatch(/report an observation saying the drive could not start/i)
    expect(template).toMatch(/A gate you could not run at all is an observation/i)
    expect(template).toMatch(/report that as an observation/i)
    // The severity scale, and that it never gates.
    expect(template).toMatch(/severity is `high` when an acceptance criterion is unmet/i)
    expect(template).toContain('"high" | "medium" | "low"')
    // Order decides what the cap reaches.
    expect(template).toMatch(/report defects highest severity first/i)
    expect(template).toContain('{{AUTO_FIX_CAP}}')
  })

  it('renders the verification variant with its landed fixes, prior pass, and cap', () => {
    const verification = review(4, { passKind: 'verification' })
    const prompt = renderReviewPrompt(verification, {
      TICKET_JSON: '{"seq":4}', FEATURE_BRIEF: 'Demo', DOCS_DIGEST: 'docs', LAP_DIGESTS: 'digests',
      FEATURE_BRANCH: 'feature/demo', BASE_BRANCH: 'main',
      DRIVE_AVAILABILITY: buildDriveAvailability('/browser', 'bun dev', 'drive'),
      DRIVE_INSTRUCTIONS: buildDriveInstructions('Log in as demo@example.com.'),
      GATE_NOTES: buildGateNotes({ verifyCommands: 'bun test' }), DIGEST_PATH: '/digest',
      BLOCKED_PATH: '/blocked', WALKTHROUGH_PATH: '/walkthrough.webm',
      LANDED_FIXES: '#2 Fix save — repro: click Save', VERIFIES_PASS: '#1 · Drive mode',
      AUTO_FIX_CAP: String(AUTO_FIX_CAP),
    })
    expect(prompt).not.toContain('{{')
    expect(prompt).toContain('Log in as demo@example.com.')
    expect(prompt).toContain('#2 Fix save — repro: click Save')
    expect(prompt).toContain('#1 · Drive mode')
    expect(prompt).toContain(`auto-fix cap is ${AUTO_FIX_CAP}`)
    expect(prompt).toContain('verification pass')
  })

  /**
   * Sandcastle matches the completion signal against the agent's accumulated
   * stdout, so a marker written into DIGEST.md signals nothing: the iteration
   * loop re-runs the same pass from the top — observed three times over, a full
   * test suite and a re-report of every finding each time. The rule the
   * implement and review templates carry has to be here too.
   */
  it('makes the verification pass signal completion in its message, never in the digest', () => {
    const template = readFileSync(reviewTemplatePath({ passKind: 'verification' }), 'utf8')

    expect(template).toMatch(
      /\*\*Signal completion\.\*\* Print exactly `<promise>COMPLETE<\/promise>` as the last line of your final message/,
    )
    // Whichever way the pass ended — clean, with findings, or blocked.
    expect(template).toMatch(/could not run it at all/i)
    // Never the file: the old wording tacked the marker onto the digest-writing
    // paragraph, where it read as "end the digest with it".
    expect(template).not.toMatch(/End with `<promise>COMPLETE<\/promise>`/)
    expect(template).toMatch(/no `<promise>` markers inside the digest/i)
  })

  it('tells the agent where the recording is optional and where it is not', () => {
    const template = readFileSync(reviewTemplatePath(), 'utf8')

    // A recording failure is never a review failure (decision 8), and a
    // partially-failed feature is stated in the closing summary note
    // (decision 9).
    expect(template).toContain('A recording failure never fails the review.')
    expect(template).toMatch(/partially-built feature/)
  })

  it('forbids improvising an environment when the drive will not start', () => {
    const template = readFileSync(reviewTemplatePath(), 'utf8')

    // A drive that refuses leaves the agent with the diff and the repo's own
    // verify commands — never a worktree it built and installed for itself,
    // which was the most expensive single act observed in any review.
    expect(template).toContain('Never build your own environment')
    expect(template).toContain('could not drive: <reason>')
    expect(template).toMatch(/[Dd]o not create a worktree/)
    expect(template).toMatch(/No worktrees, no dependency installs/)
    expect(template).toMatch(/verify commands/)
  })

  it('makes the agent pick one mode and forbids running both', () => {
    const template = readFileSync(reviewTemplatePath(), 'utf8')

    // The whole point of the split: the reviews that did exactly one delivered,
    // and the ones that attempted both ran long or died with nothing.
    expect(template).toContain('**One mode, never both.**')
    expect(template).toContain('**Never run both modes.**')
    // The choice is step 1, before any tool call — not something discovered
    // partway through a drive that has already switched the human's checkout.
    expect(template).toMatch(/### 1\. Choose your mode — before anything else/)
    expect(template).toMatch(/### 2a\. Drive mode/)
    expect(template).toMatch(/### 2b\. Gates mode/)
    // Drive mode stops at the walk; it does not go on to read the diff.
    expect(template).toContain('Do not read the diff afterwards')
    // A refused drive falls back rather than sinking the review.
    expect(template).toContain('switch to Gates mode')
    // The digest leads with one standalone line — mode, lap, what landed and
    // the counts — because the review page renders that line alone as the lap
    // account and keeps the rest behind a disclosure.
    expect(template).toContain('**Open with one short line naming the mode**')
    expect(template).toContain(
      'Lap <N>: <what landed, in the language of the product> · <X> defects found, <Y> fixed in-run · <Drive|Gates> mode',
    )
    expect(template).toMatch(/renders it alone as the lap account/)
    expect(template).not.toMatch(/renders it verbatim as the first thing they read/)
    // The superseded contract — "code review always, drive additionally" — is
    // gone, not merely deprioritised.
    expect(template).not.toContain('A code review — always')
    expect(template).not.toContain('Never skip the code review.')
  })
})

describe('the mode the review is handed', () => {
  it('inherits Drive only when the verified pass left a recording on disk', () => {
    expect(inheritedReviewMode('review_1', () => true)).toBe('drive')
    expect(inheritedReviewMode('review_1', () => false)).toBe('gates')
    expect(inheritedReviewMode(undefined, () => true)).toBe('gates')
  })
  it('states both inherited verification modes without offering a choice', () => {
    expect(buildDriveAvailability(undefined, undefined, 'drive')).toContain('Inherited mode: **Drive**')
    expect(buildDriveAvailability('/browser', 'bun dev', 'gates')).toContain('Inherited mode: **Gates**')
  })
  it('opens Drive mode when the browser and a dev command are both there', () => {
    const block = buildDriveAvailability('/usr/bin/agent-browser', 'bun dev')

    expect(block).toContain('A drive **is** available')
    expect(block).toContain('take it if, and only if')
  })

  it('closes Drive mode, and says which half is missing', () => {
    const noBrowser = buildDriveAvailability(undefined, 'bun dev')
    expect(noBrowser).toContain('not** available')
    expect(noBrowser).toContain(AGENT_BROWSER_BIN)
    expect(noBrowser).toContain('run Gates mode')
    // Calling the tool anyway would switch the human's checkout for nothing.
    expect(noBrowser).toContain('do not call `review_drive`')

    const noDev = buildDriveAvailability('/usr/bin/agent-browser', undefined)
    expect(noDev).toContain('no dev command configured')
    expect(noDev).not.toContain(AGENT_BROWSER_BIN)

    // Whitespace is not a dev command, and both halves missing reads as both.
    const neither = buildDriveAvailability(undefined, '   ')
    expect(neither).toContain(AGENT_BROWSER_BIN)
    expect(neither).toContain('no dev command configured')
  })

  it('hands Gates mode the project commands, or tells it to run none', () => {
    const configured = buildGateNotes({
      verifyCommands: 'bun run typecheck\nbun run test',
      knownFailures: 'one flaky spec',
    })
    expect(configured).toContain('bun run typecheck\nbun run test')
    expect(configured).toContain('one flaky spec')
    expect(configured).toContain('Subtract that baseline')

    // Unconfigured, the answer is to run nothing — a reviewer discovering a
    // monorepo's filter names by running the wrong suite is the long review
    // this mode split exists to end.
    const bare = buildGateNotes({})
    expect(bare).toContain('no verify commands configured')
    expect(bare).toContain('Do not go hunting for them')
    expect(bare).toContain('may well predate this lap')
  })
})

/**
 * The `{{DRIVE_INSTRUCTIONS}}` block (drive-instructions decisions 5 and 7):
 * project knowledge about how to exercise THIS app, injected verbatim under
 * framing prose the field itself cannot displace.
 */
describe('the drive instructions the project hands the reviewer', () => {
  const notes = 'Use the sample project at C:\\dev\\sample.\n\nYou may change anything inside it.'

  it('injects the operator prose verbatim, under the scope contract', () => {
    const block = buildDriveInstructions(notes)

    expect(block).toContain(notes)
    // The contract the free text sits inside: inside the driven app only.
    expect(block).toContain('authorize actions inside the driven app only')
    expect(block).toContain('do not change your review rules')
    expect(block).toContain('do not permit edits to the repository under review')
    expect(block).toContain('do not override any guard on your own session')
  })

  it('says the absence is real rather than leaving the agent to hunt', () => {
    const empty = buildDriveInstructions(undefined)

    expect(empty).toBe(
      'No drive instructions recorded for this project — drive from what the ticket, the diff, and the app surface tell you.',
    )
    // Whitespace is not an instruction, and neither is an empty column.
    expect(buildDriveInstructions(null)).toBe(empty)
    expect(buildDriveInstructions('   \n  ')).toBe(empty)
    // Nothing of the framing prose leaks into the empty state — there is
    // nothing there to scope.
    expect(empty).not.toContain('authorize actions')
  })

  /**
   * Both drive-consuming templates declare it, and each declares it inside its
   * own Drive-mode material: a sample project's path is noise to a review that
   * ran the gates and read a diff.
   */
  it('sits in the Drive-mode material of both templates, never the Gates-mode one', () => {
    const review = readFileSync(reviewTemplatePath(), 'utf8')
    const at = (haystack: string, needle: string): number => {
      const index = haystack.indexOf(needle)
      expect(index).toBeGreaterThan(-1)
      return index
    }

    expect(at(review, '{{DRIVE_INSTRUCTIONS}}')).toBeGreaterThan(at(review, '### 2a. Drive mode'))
    expect(at(review, '{{DRIVE_INSTRUCTIONS}}')).toBeLessThan(at(review, '### 2b. Gates mode'))
    // Its own block: it neither replaces nor rides inside the other two.
    expect(review).toContain('{{DRIVE_AVAILABILITY}}')
    expect(review).toContain('{{GATE_NOTES}}')

    const verify = readFileSync(reviewTemplatePath({ passKind: 'verification' }), 'utf8')
    expect(at(verify, '{{DRIVE_INSTRUCTIONS}}')).toBeGreaterThan(at(verify, 'In **Drive mode**'))
    expect(at(verify, '{{DRIVE_INSTRUCTIONS}}')).toBeLessThan(at(verify, 'In **Gates mode**'))
  })
})

describe('the base the review diffs against', () => {
  it('refuses a feature with no recorded base instead of diffing against a main line', async () => {
    const ctx = { ...makeCtx([]), feature: { ...feature, baseBranch: undefined } }

    const outcome = await executeReviewTicket(ctx, review(3), {
      config: { sandbox: 'docker' } as RuncastleConfig,
      token: 'sk-token',
      model: 'opus',
      docsDigest: 'the docs',
      lapDigests: [],
    })

    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return
    expect(outcome.error).toContain('no recorded base branch')
    expect(outcome.error).toContain('feature/demo')
  })
})

describe('the agent-browser probe', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rc-path-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('finds a binary on PATH and misses one that is not there', () => {
    writeFileSync(join(dir, 'agent-browser'), '#!/bin/sh\n')

    expect(findOnPath('agent-browser', { PATH: dir }, 'linux')).toBe(join(dir, 'agent-browser'))
    expect(findOnPath('nope-not-here', { PATH: dir }, 'linux')).toBeUndefined()
    expect(findOnPath('agent-browser', { PATH: '' }, 'linux')).toBeUndefined()
  })

  it('needs a PATHEXT suffix on Windows', () => {
    // Spelled as PATHEXT spells it, because this assertion runs on a
    // case-SENSITIVE filesystem where Windows' own is not.
    writeFileSync(join(dir, 'agent-browser.CMD'), 'echo\n')

    expect(findOnPath('agent-browser', { PATH: dir, PATHEXT: '.EXE;.CMD' }, 'win32')).toBe(
      join(dir, 'agent-browser.CMD'),
    )
    // The bare name is not executable there, and is all there is anywhere else.
    expect(findOnPath('agent-browser', { PATH: dir }, 'linux')).toBeUndefined()
  })

  it('turns a missing CLI into the mode, not into a failed review', () => {
    const original = process.env.PATH
    process.env.PATH = dir // empty — no agent-browser here
    try {
      // What the probe now feeds: the block that closes Drive mode. It used to
      // fail the whole ticket here, which withheld Gates mode — a review that
      // needs no browser at all — because the browser was missing.
      const block = buildDriveAvailability(findOnPath(AGENT_BROWSER_BIN), 'bun dev')

      expect(block).toContain('not** available')
      expect(block).toContain('run Gates mode')
      expect(block).not.toContain('could not run')
    } finally {
      process.env.PATH = original
    }
  })
})

describe('a pass that already delivered is not re-derived', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rc-digest-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('stops the loop from iteration 2 on, once the digest is on disk', () => {
    // The signal the agent should have printed is missing, so sandcastle has
    // started the same prompt over. The digest says it already finished.
    expect(shouldStopAfterDigest(2, '/review/DIGEST.md', () => true)).toBe(true)
    expect(shouldStopAfterDigest(5, '/review/DIGEST.md', () => true)).toBe(true)
    // Nothing delivered yet: the iteration is the retry it is meant to be.
    expect(shouldStopAfterDigest(2, '/review/DIGEST.md', () => false)).toBe(false)
  })

  it('never stops the first iteration, and does not go to disk to decide it', () => {
    let looked = false
    expect(
      shouldStopAfterDigest(1, '/review/DIGEST.md', () => {
        looked = true
        return true
      }),
    ).toBe(false)
    // Every text chunk of the pass that matters comes through here.
    expect(looked).toBe(false)
  })

  it('reads a real digest off disk when nothing is injected', () => {
    const digestPath = join(dir, 'DIGEST.md')

    expect(shouldStopAfterDigest(2, digestPath)).toBe(false)
    writeFileSync(digestPath, '# what the review found\n')
    expect(shouldStopAfterDigest(2, digestPath)).toBe(true)
  })
})

// --- the drive is released on both paths ------------------------------------

function ptyAvailable(): boolean {
  try {
    const p = createNativePtySession('/bin/sh', ['-c', 'true'], { cwd: process.cwd(), env: process.env })
    p.kill()
    return true
  } catch {
    return false
  }
}
const PTY = process.platform !== 'win32' && ptyAvailable()

describe.skipIf(!PTY)('releasing the drive a review agent left behind', () => {
  let ctx: AppCtx
  let repo: string
  let proj: Project
  let feat: Feature
  const dirs: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repo = mkdtempSync(join(tmpdir(), 'rc-release-'))
    dirs.push(repo)
    const g = simpleGit(repo)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.addConfig('core.autocrlf', 'false')
    writeFileSync(join(repo, 'README.md'), 'base\n')
    await g.add(['README.md'])
    await g.commit('initial commit')
    proj = await openProject(ctx, repo)
    feat = seedFeature(ctx, proj.id, { slug: 'reviewed', phase: 'implementation' })
    await createFeatureBranch(proj, feat.slug, 'main')
    ctx.db
      .insert(runs)
      .values({
        id: newId('run'),
        featureId: feat.id,
        workflow: 'ticket-burner',
        status: 'running',
        startedAt: Date.now(),
      })
      .run()
  })

  afterEach(() => {
    __resetTestDriveState()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  const branch = async (): Promise<string> =>
    (await simpleGit(repo).revparse(['--abbrev-ref', 'HEAD'])).trim()

  it('puts the checkout back when the agent died holding the slot', async () => {
    expect((await reviewDrive(ctx, proj, feat, 'start')).ok).toBe(true)
    expect(await branch()).toBe('feature/reviewed')

    await releaseReviewDrive()

    expect(await branch()).toBe('main')
    expect(activeDriveInfo()).toBeNull()
  })

  it('is a no-op when the agent already stopped what it started', async () => {
    await reviewDrive(ctx, proj, feat, 'start')
    await reviewDrive(ctx, proj, feat, 'stop')

    await releaseReviewDrive()

    expect(await branch()).toBe('main')
    expect(activeDriveInfo()).toBeNull()
  })

  it('is a no-op when no review drive was ever started', async () => {
    await expect(releaseReviewDrive()).resolves.toBeUndefined()
    expect(await branch()).toBe('main')
  })
})

// --- the run finalizer, with a review ticket in the batch --------------------

describe('a run containing a review ticket still lands the feature in review', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let original: WorkflowDef | undefined

  /** The real scheduler over a fake boundary, registered as the burner. */
  const burner: WorkflowDef = {
    id: 'ticket-burner',
    run: (wctx) =>
      burnRun(
        wctx,
        deps(async (_c, t) => ({
          status: 'done',
          commits: t.kind === 'review' ? [] : ['sha'],
          digest: t.kind === 'review' ? 'reviewed the app: 1 finding' : 'implemented it',
        })),
      ),
  }

  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', burner)
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
  })

  it('auto-advances on G4 and keeps the review digest in the run digest', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'tickets' }).id
    storeTickets(ctx, featureId, [
      { title: 'build it', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] },
      {
        title: 'review it',
        goal: 'g',
        context: 'c',
        acceptanceCriteria: ['a'],
        seams: ['s'],
        blockedBy: [1],
        kind: 'review',
      },
    ])

    await caller.feature.burn({ featureId })
    for (let i = 0; i < 200 && getFeatureRow(ctx, featureId).phase !== 'review'; i++) {
      await new Promise((r) => setTimeout(r, 5))
    }

    expect(getFeatureRow(ctx, featureId).phase).toBe('review')
    // A review ticket lands `done` with no commits — its deliverable is notes.
    const reviewTicket = listByFeature(ctx, featureId).find((t) => t.kind === 'review')
    expect(reviewTicket).toMatchObject({ status: 'done', commits: [] })
    const run = listRunsByFeature(ctx, featureId)[0]
    expect(run?.digest).toContain('reviewed the app: 1 finding')
  })

  it('appends, admits, and completes one verification when landed work had no review', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'tickets', lap: 2 }).id
    storeTickets(ctx, featureId, [{
      title: 'quick fix', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [],
    }])
    // A review-less lap only reaches the burner through the G3 override — which
    // is exactly the state the verification mint exists to catch, so the human
    // who waived the gate still gets the landed work looked at.
    overrideGate(ctx, featureId, 'G3', 'shipping this fix without a review ticket')

    await caller.feature.burn({ featureId })
    for (let i = 0; i < 200 && getFeatureRow(ctx, featureId).phase !== 'review'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    const stored = listByFeature(ctx, featureId)
    expect(stored).toHaveLength(2)
    expect(stored[1]).toMatchObject({
      kind: 'review', passKind: 'verification', status: 'done', lap: 2,
      title: 'Verify the fixes that landed',
    })
    expect(stored[1].context).toContain('#1 quick fix')
    const eventTypes = listAfter(ctx, featureId).map((event) => event.type)
    expect(eventTypes).toContain('ticket.verification_minted')
    expect(eventTypes.filter((type) => type === 'ticket.verification_minted')).toHaveLength(1)
  })
})

// --- the verification mint vs. the one-review-ticket seatbelt ----------------

/**
 * The load-bearing placement constraint of the one-review-ticket seatbelt
 * (decisions 2 and 4): it lives at G3 and at the `emit_tickets` tool surface,
 * never in `storeTickets`, and it requires AT LEAST one review ticket rather
 * than exactly one. The burner's mid-run verification pass is why: it mints a
 * SECOND review ticket into a lap that already closed with one, straight through
 * the service, so an "exactly one" rule — or a check in `storeTickets` — would
 * refuse a state the machinery itself creates.
 */
describe('the burner mints its verification pass into a lap that already has a review', () => {
  let ctx: AppCtx
  let caller: ReturnType<ReturnType<typeof createCallerFactory<typeof appRouter>>>
  let original: WorkflowDef | undefined

  /**
   * The real scheduler over a fake boundary, where the lap's own review reports
   * one defect: it mints the fix ticket mid-run the way `report_finding` does,
   * so an implementation ticket lands AFTER the review and the run owes a
   * verification pass.
   */
  const burner: WorkflowDef = {
    id: 'ticket-burner',
    run: (wctx) =>
      burnRun(
        wctx,
        deps(async (workflowCtx, t) => {
          if (t.kind !== 'review') return { status: 'done', commits: ['sha'] }
          if (t.passKind !== 'verification') {
            // Unblocked: the ctx hook reads `blockedBy` as batch-relative, and
            // the review this ticket answers is already terminal anyway.
            workflowCtx.storeTickets?.([{
              title: 'fix the defect',
              goal: 'g',
              context: 'c',
              acceptanceCriteria: ['a'],
              seams: ['s'],
              blockedBy: [],
            }])
          }
          return { status: 'done', commits: [] }
        }, 1),
      ),
  }

  beforeEach(async () => {
    ctx = await makeTestCtx()
    caller = createCallerFactory(appRouter)(ctx)
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', burner)
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
  })

  it('stores the second review ticket untouched, and G3 still reads satisfied', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'tickets', lap: 2 }).id
    storeTickets(ctx, featureId, [
      { title: 'build it', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [] },
      {
        title: 'Review: the integrated change',
        goal: 'g',
        context: 'c',
        acceptanceCriteria: ['a'],
        seams: ['s'],
        blockedBy: [1],
        kind: 'review',
      },
    ])

    await caller.feature.burn({ featureId })
    for (let i = 0; i < 200 && getFeatureRow(ctx, featureId).phase !== 'review'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    const stored = listByFeature(ctx, featureId)
    expect(stored.map((t) => t.title)).toEqual([
      'build it',
      'Review: the integrated change',
      'fix the defect',
      'Verify the fixes that landed',
    ])
    // Stored verbatim: the mint's batch is neither refused nor coerced, even
    // though it never passes the tool surface that would otherwise see it.
    expect(stored[3]).toMatchObject({
      kind: 'review',
      passKind: 'verification',
      lap: 2,
      status: 'done',
      title: 'Verify the fixes that landed',
    })
    expect(stored[3].context).toContain('#3 fix the defect')
    expect(stored.filter((t) => t.kind === 'review')).toHaveLength(2)
    // Two review tickets on one lap is a state G3 must keep accepting.
    expect(checkGate(ctx, 'tickets-approved', getFeatureRow(ctx, featureId))).toEqual({
      satisfied: true,
    })
  })
})

describe('the run hands each ticket what its siblings already reported', () => {
  /**
   * The starving-consumers fix: `burnTickets` was already accumulating every
   * finished ticket's digest into an in-process array whose only consumer was
   * the run row, while an implementer was handed its blockers as bare integers
   * and the reviewer was told nobody could say what landed.
   */
  it('gives a later ticket the digests of the tickets that finished before it', async () => {
    const tickets = [ticket(1), ticket(2, { blockedBy: [1] }), review(3)]
    const seen = new Map<number, readonly { seq: number; title: string; digest: string }[]>()
    const gates = new Map<number, () => void>()
    const execute: BurnDeps['executeTicketRun'] = (_c, t, run) => {
      seen.set(t.seq, run.digests)
      return new Promise<TicketOutcome>((resolve) => {
        gates.set(t.seq, () =>
          resolve({ status: 'done', commits: ['sha'], digest: `digest of ${t.seq}` }),
        )
      })
    }
    const release = async (seq: number): Promise<void> => {
      gates.get(seq)?.()
      for (let i = 0; i < 20; i++) await Promise.resolve()
    }

    const run = burnRun(makeCtx(tickets), deps(execute, 1))
    await Promise.resolve()
    expect(seen.get(1)).toEqual([])

    await release(1)
    // Ticket 2 was blocked by 1, and now holds 1's own account of its work.
    expect(seen.get(2)).toEqual([{ seq: 1, title: 'Ticket 1', digest: 'digest of 1' }])

    await release(2)
    // The reviewer gets the whole lap, not a claim that nobody wrote one.
    expect(seen.get(3)?.map((d) => d.seq)).toEqual([1, 2])

    await release(3)
    await run
  })

  it('snapshots the digests, so a sibling landing mid-flight cannot mutate a live prompt', async () => {
    const tickets = [ticket(1), ticket(2)]
    const seen: (readonly { seq: number }[])[] = []
    const gates = new Map<number, () => void>()
    const execute: BurnDeps['executeTicketRun'] = (_c, t, run) => {
      seen.push(run.digests)
      return new Promise<TicketOutcome>((resolve) => {
        gates.set(t.seq, () => resolve({ status: 'done', commits: ['s'], digest: `d${t.seq}` }))
      })
    }
    const run = burnRun(makeCtx(tickets), deps(execute, 2))
    await Promise.resolve()
    gates.get(1)?.()
    for (let i = 0; i < 20; i++) await Promise.resolve()
    // Ticket 2 started before 1 finished — its array must still be the one it
    // was given, not a live view that grew under it.
    expect(seen[1]).toEqual([])
    gates.get(2)?.()
    await run
  })
})
