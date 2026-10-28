import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ReviewGateRun, WorkflowCtx, WorkflowDef } from '@runcastle/core'
import { reviewGateLogDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { getRunRow } from '../src/services/repo'
import { storeTickets, updateTicket } from '../src/services/tickets'
import { onlyFeatureDocs, pickReusableGates, type GateCandidate } from '../src/workflows/gate-reuse'
import { workflowRegistry } from '../src/workflows/registry'
import { startRun } from '../src/workflows/runner'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

const CMDS = ['bun run typecheck', 'bun run test']

function ran(commit: string, commands = CMDS, outcome: 'passed' | 'failed' = 'passed'): ReviewGateRun {
  return {
    status: 'ran',
    commit,
    commands: commands.map((command, i) => ({ command, outcome, exitCode: outcome === 'passed' ? 0 : 1, log: `${i}.log` })),
  }
}

function candidate(id: string, at: number, gates: ReviewGateRun): GateCandidate {
  return { kind: 'review', id, at, gates }
}

describe('pickReusableGates', () => {
  const unmovedTip = (commit: string) => commit === 'tip'

  it('takes a result on the tip, failed ones included', () => {
    const failed = candidate('r1', 1, ran('tip', CMDS, 'failed'))
    expect(pickReusableGates([failed], CMDS, unmovedTip)).toBe(failed)
  })

  it('takes a result on a commit the caller calls unmoved, and skips one that moved', () => {
    const docsOnly = candidate('r1', 1, ran('old'))
    expect(pickReusableGates([docsOnly], CMDS, (c) => c === 'old')).toBe(docsOnly)
    expect(pickReusableGates([docsOnly], CMDS, unmovedTip)).toBeUndefined()
  })

  it('never takes a result that did not run', () => {
    const couldnt: ReviewGateRun = { status: 'couldnt_run', commit: 'tip', reason: 'no sandbox', log: null }
    expect(pickReusableGates([candidate('a', 1, couldnt), candidate('b', 2, { status: 'none_configured' })], CMDS, () => true)).toBeUndefined()
  })

  it('never takes a run in which a command timed out or could not start', () => {
    const timedOut = ran('tip')
    if (timedOut.status === 'ran') timedOut.commands[1] = { command: CMDS[1]!, outcome: 'couldnt_run', exitCode: null, reason: 'timed out', log: '1.log' }
    expect(pickReusableGates([candidate('a', 1, timedOut)], CMDS, unmovedTip)).toBeUndefined()
  })

  it('skips a result for different commands, or the same ones in another order', () => {
    expect(pickReusableGates([candidate('a', 1, ran('tip', ['bun run typecheck']))], CMDS, unmovedTip)).toBeUndefined()
    expect(pickReusableGates([candidate('a', 1, ran('tip', [...CMDS].reverse()))], CMDS, unmovedTip)).toBeUndefined()
  })

  it('prefers the newest qualifying result', () => {
    const older = candidate('old', 1, ran('tip'))
    const newer = candidate('new', 5, ran('tip'))
    const newestButMoved = candidate('moved', 9, ran('elsewhere'))
    expect(pickReusableGates([older, newestButMoved, newer], CMDS, unmovedTip)).toBe(newer)
  })
})

describe('onlyFeatureDocs', () => {
  it('holds only for paths under the feature’s own docs dir', () => {
    expect(onlyFeatureDocs(['docs/features/demo/spec.md', 'docs/features/demo/x/y.md'], 'demo')).toBe(true)
    expect(onlyFeatureDocs(['docs/features/demo/spec.md', 'src/a.ts'], 'demo')).toBe(false)
    expect(onlyFeatureDocs(['docs/features/demo-two/spec.md'], 'demo')).toBe(false)
  })
})

const landingBurner: WorkflowDef = {
  id: 'ticket-burner',
  async run(wctx: WorkflowCtx) {
    for (const t of wctx.tickets) {
      if (t.status === 'pending') wctx.updateTicket(t.id, { status: 'done', commits: ['abc'] })
    }
    return { status: 'succeeded', summary: 'all landed' }
  },
}

describe('a round end reusing an earlier gate result', () => {
  let ctx: AppCtx
  let home: string
  let repo: string
  let restoreEnv: () => void
  let original: WorkflowDef | undefined

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'rc-home-'))
    restoreEnv = useDataDir(home)
    ctx = await makeTestCtx()
    ;(ctx.config as { verifyCommands?: string }).verifyCommands = CMDS.join('\n')
    original = workflowRegistry.get('ticket-burner')
    workflowRegistry.set('ticket-burner', landingBurner)
    repo = mkdtempSync(join(tmpdir(), 'rc-repo-'))
    const g = simpleGit(repo)
    await g.init()
    await g.addConfig('user.email', 't@t')
    await g.addConfig('user.name', 't')
    writeFileSync(join(repo, 'a.txt'), '1')
    await g.add('.')
    await g.commit('init')
    await g.raw(['branch', '-M', 'feature/demo'])
  })

  afterEach(() => {
    restoreEnv()
    if (original) workflowRegistry.set('ticket-burner', original)
    else workflowRegistry.delete('ticket-burner')
    rmTemp(home)
    rmTemp(repo)
  })

  /** A review ticket that gated `commit`, with a log on disk. */
  async function gatedReview(featureId: string, commit: string, gates = ran(commit)): Promise<string> {
    const [review] = storeTickets(ctx, featureId, [
      { title: 'Review', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [], kind: 'review' },
    ])
    updateTicket(ctx, review.id, { status: 'done', reviewGateRun: gates })
    mkdirSync(reviewGateLogDir(review.id), { recursive: true })
    writeFileSync(join(reviewGateLogDir(review.id), '0.log'), 'typecheck output')
    return review.id
  }

  async function round(featureId: string, ran: { calls: number }) {
    const [t] = storeTickets(ctx, featureId, [
      { title: 'Impl', goal: 'g', context: 'c', acceptanceCriteria: ['a'], seams: ['s'], blockedBy: [], kind: 'implementation' },
    ])
    const { runId, done } = await startRun(ctx, featureId, 'ticket-burner', {
      ticketIds: [t.id],
      roundGates: async () => {
        ran.calls++
        return { status: 'couldnt_run', commit: '', reason: 'fresh run', log: null }
      },
    })
    await done
    return runId
  }

  it('stores the review’s result on the run without running the gates, logs copied', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'demo' }).id
    const tip = (await simpleGit(repo).revparse(['feature/demo'])).trim()
    const reviewId = await gatedReview(featureId, tip)
    const counter = { calls: 0 }

    const runId = await round(featureId, counter)

    expect(counter.calls).toBe(0)
    expect(getRunRow(ctx, runId).gates).toMatchObject({
      status: 'ran',
      commit: tip,
      reusedFrom: { kind: 'review', id: reviewId },
    })
    expect(readFileSync(join(reviewGateLogDir(runId), '0.log'), 'utf8')).toBe('typecheck output')
    const wake = listAfter(ctx, featureId, 0).find(
      (e) => e.type === 'lead.message_queued' || e.type === 'lead.wake_failed',
    )
    expect((wake?.data as { text: string }).text).toContain(`not re-run: the branch had not moved since commit ${tip.slice(0, 7)}`)
  })

  it('runs the gates when the branch has a non-docs commit since the recorded result', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'demo' }).id
    const g = simpleGit(repo)
    const old = (await g.revparse(['feature/demo'])).trim()
    const reviewId = await gatedReview(featureId, old)
    writeFileSync(join(repo, 'b.txt'), '2')
    await g.add('.')
    await g.commit('code change')
    const counter = { calls: 0 }

    const runId = await round(featureId, counter)

    expect(counter.calls).toBe(1)
    expect(getRunRow(ctx, runId).gates).toMatchObject({ status: 'couldnt_run' })
    expect(reviewId).not.toBe(runId)
  })

  it('still reuses it across a commit that only touches the feature’s docs', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'demo' }).id
    const g = simpleGit(repo)
    const old = (await g.revparse(['feature/demo'])).trim()
    await gatedReview(featureId, old)
    mkdirSync(join(repo, 'docs', 'features', 'demo'), { recursive: true })
    writeFileSync(join(repo, 'docs', 'features', 'demo', 'spec.md'), 'notes')
    await g.add('.')
    await g.commit('docs')
    const counter = { calls: 0 }

    const runId = await round(featureId, counter)

    expect(counter.calls).toBe(0)
    expect(getRunRow(ctx, runId).gates).toMatchObject({ status: 'ran', commit: old })
  })

  it('runs the gates when the earlier record is a failed run that could not run', async () => {
    const featureId = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'demo' }).id
    const tip = (await simpleGit(repo).revparse(['feature/demo'])).trim()
    await gatedReview(featureId, tip, { status: 'couldnt_run', commit: tip, reason: 'no sandbox', log: null })
    const counter = { calls: 0 }

    await round(featureId, counter)

    expect(counter.calls).toBe(1)
  })
})
