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
import { openProject } from '../src/services/projects'
import { listAfter } from '../src/services/events'
import { listByFeature, storeTickets } from '../src/services/tickets'
import { AUTO_FIX_CAP } from '../src/services/review-findings'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { workflowRegistry } from '../src/workflows/registry'
import {
  AGENT_BROWSER_BIN,
  buildDriveAvailability,
  buildGateNotes,
  executeReviewTicket,
  findOnPath,
  inheritedReviewMode,
  renderReviewPrompt,
  reviewTemplatePath,
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

describe('a review ticket survives a failed implementation ticket', () => {
  it('starts once every blocker is terminal, failed ones included', async () => {
    const tickets = [ticket(1), ticket(2), review(3, { blockedBy: [1, 2] })]
    const { execute, started, release } = gatedExecute({ 1: { status: 'failed', error: 'boom' } })

    const run = burnRun(makeCtx(tickets), deps(execute))
    await Promise.resolve()

    expect(started).toEqual([1, 2])
    // Ticket 1 failed — the generic cascade would cancel the review here. It
    // waits instead, because ticket 2 is still burning.
    await release(1)
    expect(started).toEqual([1, 2])
    await release(2)
    expect(started).toEqual([1, 2, 3])

    await release(3)
    await run
    expect(tickets[2]).toMatchObject({ status: 'done' })
  })

  it('leaves the cascade alone for an implementation ticket with the same blocker', async () => {
    const tickets = [ticket(1), ticket(2, { blockedBy: [1] }), review(3, { blockedBy: [1] })]
    const { execute, started, release } = gatedExecute({ 1: { status: 'failed', error: 'boom' } })

    const run = burnRun(makeCtx(tickets), deps(execute))
    await Promise.resolve()
    await release(1)

    // 2 never ran; 3 did.
    expect(started).toEqual([1, 3])
    expect(tickets[1]).toMatchObject({ status: 'failed', error: 'blocked by failed ticket 1' })

    await release(3)
    await run
    expect(tickets[2]).toMatchObject({ status: 'done' })
  })

  it('still cascades on a blocker that is not in the run at all', async () => {
    // A missing blocker is a malformed graph, not a ticket that tried and
    // failed — the carve-out does not cover it, whatever the kind.
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

  it('names the implementation tickets that failed under it', async () => {
    const tickets = [ticket(1), ticket(2), review(3, { blockedBy: [1, 2] })]
    const execute = async (_c: WorkflowCtx, t: Ticket): Promise<TicketOutcome> =>
      t.seq === 1
        ? { status: 'failed', error: 'boom' }
        : { status: 'done', commits: [], digest: t.seq === 3 ? 'walked what shipped' : 'built it' }

    const result = await burnRun(makeCtx(tickets), deps(execute))

    expect(result.digest).toContain('Reviewed with failed implementation ticket(s): 1.')
    expect(result.digest).toContain('walked what shipped')
    // The annotation is the run's, not the agent's: the ticket keeps its words.
    expect(tickets[2].digest).toBe('walked what shipped')
  })

  it('says so off the run itself, even for a review with no edges that could not report', async () => {
    // Neither the declared edges nor the agent's own prose is the source: this
    // review was emitted without `blockedBy` and never got as far as a digest.
    const tickets = [ticket(1), review(2)]
    const execute = async (_c: WorkflowCtx, t: Ticket): Promise<TicketOutcome> =>
      t.seq === 1
        ? { status: 'failed', error: 'boom' }
        : { status: 'failed', error: 'ticket 2: Review could not run: the dev URL never appeared' }

    const result = await burnRun(makeCtx(tickets), deps(execute))

    expect(result.digest).toContain('Reviewed with failed implementation ticket(s): 1.')
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

    // What separates the two kinds, and which way to fall when unsure.
    expect(template).toMatch(/`defect` is what a fix ticket can act on/i)
    expect(template).toMatch(/`observation` is everything else/i)
    expect(template).toMatch(/unsure → observation/i)
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
      GATE_NOTES: buildGateNotes({ verifyCommands: 'bun test' }), DIGEST_PATH: '/digest',
      BLOCKED_PATH: '/blocked', WALKTHROUGH_PATH: '/walkthrough.webm',
      LANDED_FIXES: '#2 Fix save — repro: click Save', VERIFIES_PASS: '#1 · Drive mode',
      AUTO_FIX_CAP: String(AUTO_FIX_CAP),
    })
    expect(prompt).not.toContain('{{')
    expect(prompt).toContain('#2 Fix save — repro: click Save')
    expect(prompt).toContain('#1 · Drive mode')
    expect(prompt).toContain(`auto-fix cap is ${AUTO_FIX_CAP}`)
    expect(prompt).toContain('verification pass')
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
    // The digest leads with the mode, so the human knows what kind of look the
    // lap got before reading a word of the summary.
    expect(template).toContain('**Open with one short line naming the mode**')
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
