import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkflowDef } from '@runcastle/core'
import { newId } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import type { SimpleGit } from 'simple-git'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { runs } from '../src/db/schema'
import { GateError } from '../src/errors'
import { listAfter } from '../src/services/events'
import { retryTicket } from '../src/services/features'
import { findPreservedTicketBranch, listTicketAttemptBranches } from '../src/services/git'
import { getTicket, listByFeature, storeTickets, updateTicket } from '../src/services/tickets'
import {
  RunHaltedAbort,
  buildRetryNotes,
  classifyTicketRunError,
  delayUnlessAborted,
  haltTicketRun,
  missingAgentBinaryMessage,
  retryDelayMs,
  stopTicketRun,
  ticketStopReason,
} from '../src/workflows/ticket-burner'
import { workflowRegistry } from '../src/workflows/registry'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Burn robustness (attempt chaining): the transient-error classifier and retry
 * prompt notes that drive in-run auto-retry, plus the per-ticket manual retry
 * service (`retryTicket`) behind `trpc ticket.retry`.
 */

describe('classifyTicketRunError', () => {
  it.each([
    ['codex', 'codex exited with code 127', 'sandcastle:runcastle-demo'],
    ['claude-code', '/bin/sh: claude: command not found', 'sandcastle:claude-demo'],
  ] as const)('fails fast when the %s binary is absent from the image', (runtime, error, image) => {
    // Run-fatal, not ticket-fatal: every other container would be built from
    // the same image, so there is nothing left for this run to try.
    expect(classifyTicketRunError(new Error(error), runtime)).toBe('run-fatal')
    expect(missingAgentBinaryMessage(new Error(error), runtime, image)).toBe(
      `${runtime === 'claude-code' ? 'claude' : 'codex'} is not installed in image ${image} — the image predates the burner Dockerfile. Rebuild it from Settings → Burns (Rebuild image).`,
    )
  })

  it.each([
    ['codex', '/bin/sh: codex: not found'],
    ['claude-code', 'env: claude: No such file or directory'],
  ] as const)('recognizes the %s shell missing-command wording', (runtime, error) => {
    expect(classifyTicketRunError(new Error(error), runtime)).toBe('run-fatal')
  })

  it.each(['codex', 'claude-code'] as const)(
    'keeps an ordinary %s exit code 1 retryable',
    (runtime) => {
      expect(classifyTicketRunError(new Error(`${runtime} exited with code 1`), runtime)).toBe(
        'retryable',
      )
    },
  )

  it.each([
    'claude-code exited with code 1:\n',
    'claude-code exited with code 137:\nkilled',
    'AgentIdleTimeoutError: agent produced no output for 600s',
    'API Error: Connection closed mid-response',
    'fetch failed: ECONNRESET',
    'read ETIMEDOUT',
    'overloaded_error: Overloaded',
    'rate limit exceeded, try again later',
    'HTTP 529 too many requests',
    'internal server error',
    'Session capture failed: no space left on device',
  ])('retryable: %s', (msg) => {
    expect(classifyTicketRunError(new Error(msg))).toBe('retryable')
  })

  it.each([
    'there is an issue with the selected model',
    'resumeSession "abc" not found under /home',
    'fatal: some completely unknown git explosion',
  ])('fatal: %s', (msg) => {
    expect(classifyTicketRunError(new Error(msg))).toBe('fatal')
  })

  /**
   * The account, not the ticket: every remaining ticket would spend its own
   * container to be told the same thing, so these end the run (decision 3).
   */
  it.each([
    'claude-code exited with code 1:\nInvalid API key',
    'authentication_error: unauthorized',
    'Your credit balance is too low',
    'run `claude setup-token` — OAuth token missing',
    'Claude AI usage limit reached|1751500000',
    '5-hour usage limit reached — resets at 3pm',
  ])('run-fatal: %s', (msg) => {
    expect(classifyTicketRunError(new Error(msg))).toBe('run-fatal')
  })

  /**
   * A refusal halts the run only when it names something the ACCOUNT owns.
   * `permission denied` is also how git and the filesystem report a read-only
   * path, and halting a healthy run over one ticket's chmod is the expensive
   * direction of the mistake — those stay ticket-fatal.
   */
  it.each([
    'git checkout failed: permission denied',
    "EACCES: permission denied, open '/home/agent/cache/slots/1/repo/out.txt'",
  ])('fatal, not run-fatal, for a permission failure that is not the account: %s', (msg) => {
    expect(classifyTicketRunError(new Error(msg), 'claude-code')).toBe('fatal')
  })

  /**
   * Which side of the refusal the account word lands on is an accident of the
   * CLI's phrasing, not evidence about whose door was closed — `API token
   * permission denied` says exactly what `permission denied: invalid api key`
   * says (decision 8).
   */
  it.each([
    'API token permission denied',
    'credential rejected — permission denied',
    'permission denied: invalid api key',
  ])('run-fatal wherever the credential subject sits: %s', (msg) => {
    expect(classifyTicketRunError(new Error(msg), 'claude-code')).toBe('run-fatal')
  })

  // The subscription cap matched no pattern before this feature and fell to
  // fatal-by-default — one exhausted plan, one wasted container per ticket.
  it('reads the Anthropic usage limit as the account fact it is', () => {
    expect(
      classifyTicketRunError(
        new Error('claude-code exited with code 1:\nClaude AI usage limit reached'),
        'claude-code',
      ),
    ).toBe('run-fatal')
  })

  it('defaults unknown throws to fatal (never blind-retry)', () => {
    expect(classifyTicketRunError('weird')).toBe('fatal')
    expect(classifyTicketRunError(undefined)).toBe('fatal')
  })

  /**
   * The codex CLI reports the same facts in OpenAI's words. A burn that retries
   * a bad API key three times wastes ~10 minutes per attempt rebuilding a
   * sandbox to fail identically; one that gives up on a plain rate limit throws
   * away a ticket that would have landed.
   */
  describe('OpenAI wording, on codex burns', () => {
    it.each([
      'codex exited with code 1: 429 rate_limit_exceeded',
      'server_error: the model is overloaded',
      'stream disconnected before completion',
    ])('retryable: %s', (msg) => {
      expect(classifyTicketRunError(new Error(msg), 'codex')).toBe('retryable')
    })

    it.each([
      'codex exited with code 1: 401 invalid_api_key',
      'Error code: 403 - permission denied for this org',
      'insufficient_quota: You exceeded your current quota',
      'CODEX_API_KEY is not set',
      // The status arrives after the word that names whose door it was — the
      // same fact as `401 invalid_api_key`, phrased the other way round.
      'forbidden response: status 403',
      'api key rejected with 401',
      // The reason phrase stops the status naming an account by itself, but it
      // never gets in the way of a message that does name one.
      '403 forbidden: invalid api key',
    ])('run-fatal: %s', (msg) => {
      expect(classifyTicketRunError(new Error(msg), 'codex')).toBe('run-fatal')
    })

    // A model this account cannot reach is one assignment's problem — another
    // ticket on another model burns fine, so the run carries on.
    //
    // A bare status number is the same kind of problem: 401 and 403 are how
    // every HTTP call in the sandbox reports a closed door, and only the
    // wording beside one says the door was the account's — a status's own
    // reason phrase (`403 forbidden`) is that same number spelled twice.
    it.each([
      'model_not_found: the model `gpt-5.6-sol` does not exist or you do not have access',
      'invalid_request_error: unsupported parameter',
      'request failed with status 403',
      'proxy returned 401 for the telemetry endpoint',
      '403 forbidden',
      'Forbidden (403)',
    ])('fatal, without halting the run: %s', (msg) => {
      expect(classifyTicketRunError(new Error(msg), 'codex')).toBe('fatal')
    })

    // A burn runs on the operator's borrowed `codex login`. When that login is
    // revoked or lapses mid-run the CLI says so in login words, and no retry of
    // ours fixes it — the human has to run `codex login` on the host.
    it.each([
      'codex exited with code 1: not logged in',
      'stream error: Unauthorized',
      'authentication failed for the ChatGPT account',
      'auth required: run codex login',
      'could not exchange refresh token',
    ])('run-fatal, on a lapsed borrowed login: %s', (msg) => {
      expect(classifyTicketRunError(new Error(msg), 'codex')).toBe('run-fatal')
    })

    // 429 means two different things to OpenAI: a rate limit worth waiting out,
    // and an exhausted account that no retry will fix. Quota wins.
    it('reads an exhausted quota as run-fatal even though it arrives as a 429', () => {
      const msg = 'Error code: 429 - {"type":"insufficient_quota"}'
      expect(classifyTicketRunError(new Error(msg), 'codex')).toBe('run-fatal')
    })

    it('keeps the Anthropic retry classification exactly as it was', () => {
      expect(classifyTicketRunError(new Error('overloaded_error: Overloaded'), 'claude-code')).toBe(
        'retryable',
      )
      expect(
        classifyTicketRunError(new Error('claude-code exited with code 1:\nInvalid API key'), 'claude-code'),
      ).toBe('run-fatal')
    })
  })
})

describe('retryDelayMs', () => {
  it('backs off 5s → 10s → 20s and caps at 30s', () => {
    expect(retryDelayMs(1)).toBe(5_000)
    expect(retryDelayMs(2)).toBe(10_000)
    expect(retryDelayMs(3)).toBe(20_000)
    expect(retryDelayMs(4)).toBe(30_000)
    expect(retryDelayMs(9)).toBe(30_000)
  })
})

describe('buildRetryNotes', () => {
  it('tells the resumed agent about preserved commits and how to continue', () => {
    const notes = buildRetryNotes({ error: 'claude-code exited with code 1:', commitCount: 3 })
    expect(notes).toContain('3 commit(s)')
    expect(notes).toContain('git log')
    expect(notes).toContain('claude-code exited with code 1:')
    expect(notes).toMatch(/do NOT revert/i)
  })

  it('covers the nothing-committed case', () => {
    const notes = buildRetryNotes({ commitCount: 0 })
    expect(notes).toContain('starting clean')
    expect(notes).not.toContain('are already on your branch')
  })
})

describe('delayUnlessAborted', () => {
  it('resolves early (never rejects) when the signal aborts mid-wait', async () => {
    const controller = new AbortController()
    const p = delayUnlessAborted(60_000, controller.signal)
    controller.abort(new Error('stop'))
    await expect(p).resolves.toBeUndefined()
  })

  it('resolves immediately on an already-aborted signal', async () => {
    await expect(delayUnlessAborted(60_000, AbortSignal.abort())).resolves.toBeUndefined()
  })
})

describe('stopTicketRun', () => {
  it('reports no agent — and nothing left to kill — for a ticket that is not burning', async () => {
    await expect(stopTicketRun('tkt_nope')).resolves.toEqual({ stopped: false, confirmed: true })
  })

  it('reports the same for a halt that finds no burning agent', async () => {
    await expect(haltTicketRun('tkt_nope', 'usage limit reached')).resolves.toEqual({
      stopped: false,
      confirmed: true,
    })
  })

  // A stopped ticket's record has to say WHICH stop ended it: the operator's
  // click is a decision, a run halt is an account they have to go fix.
  it('names the run halt, not the human, when the halt is what aborted the lane', () => {
    expect(ticketStopReason(new RunHaltedAbort('usage limit reached'))).toBe(
      'stopped: run halted (usage limit reached)',
    )
    expect(ticketStopReason(new Error('ticket stopped by user'))).toBe('stopped by user')
    expect(ticketStopReason(undefined)).toBe('stopped by user')
  })
})

// ---------------------------------------------------------------------------
// Fallback branch lookup — real git fixtures
// ---------------------------------------------------------------------------

const tmpDirs: string[] = []
afterAll(() => {
  for (const d of tmpDirs) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      // best-effort — Windows can hold git locks briefly
    }
  }
})

/** git init -b main + local identity + one seed commit + feature/demo branch. */
async function initRepoWithFeature(): Promise<{ dir: string; g: SimpleGit }> {
  const dir = mkdtempSync(join(tmpdir(), 'runcastle-robust-'))
  tmpDirs.push(dir)
  const g = simpleGit(dir)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  await g.checkoutLocalBranch('feature/demo')
  return { dir, g }
}

/** Commit one file on a new branch off feature/demo, then return to feature/demo. */
async function seedAttemptBranch(
  dir: string,
  g: SimpleGit,
  branch: string,
  file: string,
  committerDate: string,
): Promise<void> {
  await g.checkoutLocalBranch(branch)
  writeFileSync(join(dir, file), `${file}\n`)
  await g.add([file])
  // simple-git refuses GIT_EDITOR in a custom child env (allowUnsafeEditor),
  // so strip editor vars from the inherited environment before pinning dates.
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.includes('EDITOR')) env[k] = v
  }
  await g
    .env({ ...env, GIT_COMMITTER_DATE: committerDate, GIT_AUTHOR_DATE: committerDate })
    .commit(`ticket(2): ${file}`)
  await g.checkout('feature/demo')
}

describe('findPreservedTicketBranch (fallback for pre-attemptBranch burns)', () => {
  it('finds the newest unmerged attempt branch by the deterministic prefix', async () => {
    const { dir, g } = await initRepoWithFeature()
    await seedAttemptBranch(dir, g, 'runcastle/ticket/demo/2-old1', 'old.txt', '2026-07-01T00:00:00Z')
    await seedAttemptBranch(dir, g, 'runcastle/ticket/demo/2-new1', 'new.txt', '2026-07-20T00:00:00Z')
    // Same tip as feature/demo — nothing preserved, never a candidate.
    await g.branch(['runcastle/ticket/demo/2-empt', 'feature/demo'])
    // Different seq — different ticket, out of scope.
    await seedAttemptBranch(dir, g, 'runcastle/ticket/demo/3-oth1', 'other.txt', '2026-07-21T00:00:00Z')

    const found = await findPreservedTicketBranch(dir, 'feature/demo', 'demo', 2)
    expect(found?.branch).toBe('runcastle/ticket/demo/2-new1')
    expect(found?.commits).toHaveLength(1)
  })

  it('returns undefined when no attempt branch holds unmerged work', async () => {
    const { dir, g } = await initRepoWithFeature()
    await g.branch(['runcastle/ticket/demo/2-empt', 'feature/demo'])
    expect(await findPreservedTicketBranch(dir, 'feature/demo', 'demo', 2)).toBeUndefined()
  })

  it('is best-effort on a non-repo path', async () => {
    expect(await findPreservedTicketBranch(join(tmpdir(), 'nope-not-a-repo'), 'f', 'demo', 2)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// retryTicket — the manual per-ticket retry service
// ---------------------------------------------------------------------------

const stubBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run() {
    return { status: 'succeeded', summary: 'stub' }
  },
}

function ticketInput(title: string, blockedBy: number[] = []) {
  return { title, goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy }
}

describe('retryTicket', () => {
  let ctx: AppCtx
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    ctx = await makeTestCtx()
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', stubBurner)
  })

  afterEach(() => {
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
  })

  it('resets ONLY the target (and starts a run), leaving other failed tickets failed', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [target, other] = storeTickets(ctx, featureId, [
      ticketInput('target'),
      ticketInput('other-failed'),
    ])
    updateTicket(ctx, target.id, { status: 'failed', error: 'stream died' })
    updateTicket(ctx, other.id, { status: 'failed', error: 'agent made no commits' })

    const { runId, retried } = await retryTicket(ctx, target.id)
    expect(runId).toMatch(/^run/)
    expect(retried).toEqual([target.seq])

    const after = Object.fromEntries(listByFeature(ctx, featureId).map((t) => [t.title, t]))
    expect(after['target'].status).toBe('pending')
    expect(after['target'].error).toBeUndefined()
    expect(after['other-failed'].status).toBe('failed')
  })

  it('pulls failed blockers along transitively (retrying a dependent alone is pointless)', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [root, mid, leaf, unrelated] = storeTickets(ctx, featureId, [
      ticketInput('root'),
      ticketInput('mid', [1]),
      ticketInput('leaf', [2]),
      ticketInput('unrelated'),
    ])
    for (const t of [root, mid, leaf, unrelated]) {
      updateTicket(ctx, t.id, { status: 'failed', error: 'x' })
    }

    const { retried } = await retryTicket(ctx, leaf.id)
    expect(retried).toEqual([root.seq, mid.seq, leaf.seq])

    const after = Object.fromEntries(listByFeature(ctx, featureId).map((t) => [t.title, t]))
    expect(after['root'].status).toBe('pending')
    expect(after['mid'].status).toBe('pending')
    expect(after['leaf'].status).toBe('pending')
    expect(after['unrelated'].status).toBe('failed')
  })

  it('keeps attemptBranch on a plain retry (resume) and clears it on fresh', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [a] = storeTickets(ctx, featureId, [ticketInput('a')])
    updateTicket(ctx, a.id, {
      status: 'failed',
      error: 'stream died',
      attemptBranch: 'runcastle/ticket/demo/1-abc',
    })
    expect(getTicket(ctx, a.id).attemptBranch).toBe('runcastle/ticket/demo/1-abc')

    await retryTicket(ctx, a.id)
    expect(getTicket(ctx, a.id).attemptBranch).toBe('runcastle/ticket/demo/1-abc')

    updateTicket(ctx, a.id, { status: 'failed', error: 'stream died again' })
    await retryTicket(ctx, a.id, { fresh: true })
    const after = getTicket(ctx, a.id)
    expect(after.status).toBe('pending')
    expect(after.attemptBranch).toBeUndefined()
  })

  it('keeps a landing conflict on a plain retry (resolve) and drops it on fresh (re-implement)', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [a] = storeTickets(ctx, featureId, [ticketInput('a')])
    updateTicket(ctx, a.id, {
      status: 'failed',
      error: 'conflicts with feature/demo',
      attemptBranch: 'runcastle/ticket/demo/1-abc',
      conflictFiles: ['src/a.ts', 'src/b.ts'],
    })

    // Plain retry: the implemented work and the conflict both survive, which is
    // what routes the next burn through the resolver instead of the implementer.
    const plain = await retryTicket(ctx, a.id)
    expect(plain.resolvingConflict).toBe(true)
    const resumed = getTicket(ctx, a.id)
    expect(resumed.status).toBe('pending')
    expect(resumed.attemptBranch).toBe('runcastle/ticket/demo/1-abc')
    expect(resumed.conflictFiles).toEqual(['src/a.ts', 'src/b.ts'])

    // Fresh: the conflicting branch is being discarded, so the conflict it
    // described must go with it — the next burn re-implements from the tip.
    updateTicket(ctx, a.id, { status: 'failed', error: 'conflicts again' })
    const fresh = await retryTicket(ctx, a.id, { fresh: true })
    expect(fresh.resolvingConflict).toBe(false)
    const after = getTicket(ctx, a.id)
    expect(after.attemptBranch).toBeUndefined()
    expect(after.conflictFiles).toBeUndefined()
  })

  it('emits a ticket.retry event naming the retried seqs', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [a] = storeTickets(ctx, featureId, [ticketInput('a')])
    updateTicket(ctx, a.id, { status: 'failed', error: 'x' })

    await retryTicket(ctx, a.id)
    const ev = listAfter(ctx, featureId, 0).find((e) => e.type === 'ticket.retry')
    expect(ev?.data).toEqual({
      retried: [a.seq],
      fresh: false,
      resumedFrom: null,
      preservedCommits: 0,
      resolvingConflict: false,
    })
  })

  it('adopts an orphaned attempt branch when the ticket has no recorded pointer', async () => {
    const { dir, g } = await initRepoWithFeature()
    await seedAttemptBranch(dir, g, 'runcastle/ticket/demo/1-orph', 'work.txt', '2026-07-21T00:00:00Z')
    const featureId = seedFeature(ctx, seedProject(ctx, dir).id, {
      phase: 'implementation',
      slug: 'demo',
    }).id
    const [a] = storeTickets(ctx, featureId, [ticketInput('a')])
    updateTicket(ctx, a.id, { status: 'failed', error: 'died before attemptBranch existed' })

    const res = await retryTicket(ctx, a.id)
    expect(res.resumedFrom).toBe('runcastle/ticket/demo/1-orph')
    expect(res.preservedCommits).toBe(1)
    expect(getTicket(ctx, a.id).attemptBranch).toBe('runcastle/ticket/demo/1-orph')
  })

  it('fresh discards every attempt branch of the ticket, orphans included', async () => {
    const { dir, g } = await initRepoWithFeature()
    await seedAttemptBranch(dir, g, 'runcastle/ticket/demo/1-one1', 'one.txt', '2026-07-19T00:00:00Z')
    await seedAttemptBranch(dir, g, 'runcastle/ticket/demo/1-two1', 'two.txt', '2026-07-20T00:00:00Z')
    const featureId = seedFeature(ctx, seedProject(ctx, dir).id, {
      phase: 'implementation',
      slug: 'demo',
    }).id
    const [a] = storeTickets(ctx, featureId, [ticketInput('a')])
    updateTicket(ctx, a.id, {
      status: 'failed',
      error: 'x',
      attemptBranch: 'runcastle/ticket/demo/1-two1',
    })

    const res = await retryTicket(ctx, a.id, { fresh: true })
    expect(res.resumedFrom).toBeNull()
    expect(getTicket(ctx, a.id).attemptBranch).toBeUndefined()
    expect(await listTicketAttemptBranches(dir, 'demo', 1)).toEqual([])
  })

  it('refuses a ticket that is not failed', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [a] = storeTickets(ctx, featureId, [ticketInput('a')])
    await expect(retryTicket(ctx, a.id)).rejects.toThrow(GateError)
    await expect(retryTicket(ctx, a.id)).rejects.toThrow(/only failed tickets/)
  })

  it('refuses while a run is live for the feature', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
    const [a] = storeTickets(ctx, featureId, [ticketInput('a')])
    updateTicket(ctx, a.id, { status: 'failed', error: 'x' })
    ctx.db
      .insert(runs)
      .values({
        id: newId('run'),
        featureId,
        workflow: 'ticket-burner',
        status: 'running',
        startedAt: Date.now(),
        endedAt: null,
        summary: null,
      })
      .run()

    await expect(retryTicket(ctx, a.id)).rejects.toThrow(/run is live/)
  })
})
