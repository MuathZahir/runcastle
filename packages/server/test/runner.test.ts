import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project, WorkflowDef } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { commitDocs, createFeatureBranch, ensureTalkWorktree } from '../src/services/git'
import { getRunRow } from '../src/services/repo'
import { listByFeature as listFindings, reportFinding } from '../src/services/review-findings'
import { storeTickets } from '../src/services/tickets'
import { workflowRegistry } from '../src/workflows/registry'
import { cancelRun, startRun, workflowClaimsFeatureBranch } from '../src/workflows/runner'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

const successDef: WorkflowDef = {
  id: 'test-success',
  async run() {
    return { status: 'succeeded', summary: 'ok' }
  },
}

const throwDef: WorkflowDef = {
  id: 'test-throw',
  async run() {
    throw new Error('boom')
  },
}

describe('workflow runner', () => {
  let ctx: AppCtx
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'building' }).id
    workflowRegistry.set(successDef.id, successDef)
    workflowRegistry.set(throwDef.id, throwDef)
  })

  afterEach(() => {
    workflowRegistry.delete(successDef.id)
    workflowRegistry.delete(throwDef.id)
  })

  it('finalizes a succeeded run and emits run.started + run.finished', async () => {
    const { runId, done } = await startRun(ctx, featureId, 'test-success')
    await done

    const run = getRunRow(ctx, runId)
    expect(run.status).toBe('succeeded')
    expect(run.summary).toBe('ok')
    expect(run.endedAt).toBeGreaterThan(0)

    const types = listAfter(ctx, featureId, 0).map((e) => e.type)
    expect(types).toContain('run.started')
    expect(types).toContain('run.finished')
  })

  it('marks a throwing run failed and finalizes it', async () => {
    const { runId, done } = await startRun(ctx, featureId, 'test-throw')
    await done

    const run = getRunRow(ctx, runId)
    expect(run.status).toBe('failed')
    expect(run.summary).toContain('boom')
    expect(run.endedAt).toBeGreaterThan(0)

    const types = listAfter(ctx, featureId, 0).map((e) => e.type)
    expect(types).toContain('run.finished')
  })

  it('persists a workflow’s run digest on the run row, and leaves it null without one', async () => {
    const digestDef: WorkflowDef = {
      id: 'test-digest',
      async run() {
        return { status: 'succeeded', summary: 'ok', digest: '## ticket 1 — A\n\nDid it.' }
      },
    }
    workflowRegistry.set(digestDef.id, digestDef)
    try {
      const withDigest = await startRun(ctx, featureId, digestDef.id)
      await withDigest.done
      expect(getRunRow(ctx, withDigest.runId).digest).toBe('## ticket 1 — A\n\nDid it.')
    } finally {
      workflowRegistry.delete(digestDef.id)
    }

    // A workflow that returns no digest (research, an aborted burn) never writes one.
    const without = await startRun(ctx, featureId, 'test-success')
    await without.done
    expect(getRunRow(ctx, without.runId).digest).toBeUndefined()
  })

  it('rejects an unregistered workflow id', async () => {
    await expect(startRun(ctx, featureId, 'nope')).rejects.toThrow(/not registered/)
  })

  it('exposes a per-run modelOverride to the workflow ctx (issue #48)', async () => {
    let seen: string | undefined = 'unset'
    const captureDef: WorkflowDef = {
      id: 'test-capture-model',
      async run(wctx) {
        seen = wctx.modelOverride
        return { status: 'succeeded', summary: 'ok' }
      },
    }
    workflowRegistry.set(captureDef.id, captureDef)
    try {
      const { done } = await startRun(ctx, featureId, captureDef.id, { modelOverride: 'claude-cheap' })
      await done
      expect(seen).toBe('claude-cheap')
    } finally {
      workflowRegistry.delete(captureDef.id)
    }
  })

  it('re-reads tickets minted mid-run and mirrors a fix ticket onto its finding', async () => {
    const reviewTicket = storeTickets(ctx, featureId, [
      {
        title: 'Review',
        goal: 'Review the lap',
        context: '',
        acceptanceCriteria: [],
        seams: [],
        blockedBy: [],
        kind: 'review',
      },
    ])[0]

    let opened = 0
    let reread: number[] = []
    const findingDef: WorkflowDef = {
      id: 'test-findings',
      async run(wctx) {
        opened = wctx.tickets.length
        // What `report_finding` does while the review ticket is burning.
        const { finding } = reportFinding(ctx, {
          featureId,
          reviewTicket,
          input: {
            kind: 'defect',
            severity: 'high',
            title: 'Save loses edits',
            location: 'screen: editor',
            citation: 'spec.md: edits persist',
            detail: 'The old value returns.',
            reproStep: 'Edit the title, save, reload.',
          },
        })
        reread = (wctx.listTickets?.() ?? []).map((t) => t.seq)
        wctx.updateFinding?.(finding.id, 'failed', 'the repro still reproduces')
        return { status: 'succeeded', summary: 'ok' }
      },
    }
    workflowRegistry.set(findingDef.id, findingDef)
    try {
      await (await startRun(ctx, featureId, findingDef.id)).done
    } finally {
      workflowRegistry.delete(findingDef.id)
    }

    // The snapshot the run opened with held only the review; the re-read sees
    // the fix ticket its finding minted.
    expect(opened).toBe(1)
    expect(reread).toEqual([reviewTicket.seq, reviewTicket.seq + 1])
    expect(listFindings(ctx, featureId)[0]).toMatchObject({
      status: 'failed',
      openReason: 'fix-failed',
      failureReason: 'the repro still reproduces',
    })
  })
})

describe('workflowClaimsFeatureBranch', () => {
  it('only the ticket-burner claims the feature branch', () => {
    expect(workflowClaimsFeatureBranch('ticket-burner')).toBe(true)
    expect(workflowClaimsFeatureBranch('research')).toBe(false)
    expect(workflowClaimsFeatureBranch('anything-else')).toBe(false)
  })
})

describe('talk worktree at the burn boundary (one-chat-per-feature decision 9)', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let talkWt: string
  let restoreDataDir: () => void
  const tmpDirs: string[] = []

  /** A workflow stub whose run blocks until the test opens its gate. */
  function gatedDef(id: string, outcome: 'succeeded' | 'throw' = 'succeeded'): {
    def: WorkflowDef
    open: () => void
  } {
    let open!: () => void
    const gate = new Promise<void>((r) => {
      open = r
    })
    const def: WorkflowDef = {
      id,
      async run() {
        await gate
        if (outcome === 'throw') throw new Error('burn failed')
        return { status: 'succeeded', summary: 'ok' }
      },
    }
    return { def, open }
  }

  /** Run `body` with the burner registry entry replaced by a gated stub. */
  async function withGatedBurner(
    outcome: 'succeeded' | 'throw',
    body: (open: () => void, done: () => Promise<void>) => Promise<void>,
  ): Promise<void> {
    const original = workflowRegistry.get('ticket-burner')
    const { def, open } = gatedDef('ticket-burner', outcome)
    workflowRegistry.set(def.id, def)
    try {
      const run = await startRun(ctx, feature.id, 'ticket-burner')
      await body(open, () => run.done)
    } finally {
      if (original) workflowRegistry.set('ticket-burner', original)
      else workflowRegistry.delete('ticket-burner')
    }
  }

  async function headOf(path: string): Promise<string> {
    return (await simpleGit(path).revparse(['--abbrev-ref', 'HEAD'])).trim()
  }

  /** Commit a docs file in the talk worktree, as a chat session's tools do. */
  async function chatCommits(name: string): Promise<void> {
    const docs = join(talkWt, 'docs', 'features', feature.slug)
    mkdirSync(docs, { recursive: true })
    writeFileSync(join(docs, name), 'a note\n')
    await commitDocs(talkWt, `runcastle: ${name}`)
  }

  /** The local branches of the parent repo. */
  async function branches(): Promise<string[]> {
    return (await simpleGit(project.repoPath).branchLocal()).all
  }

  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'rc-runner-home-'))
    tmpDirs.push(home)
    restoreDataDir = useDataDir(home)

    ctx = await makeTestCtx()
    const repo = mkdtempSync(join(tmpdir(), 'rc-runner-repo-'))
    tmpDirs.push(repo)
    const g = simpleGit(repo)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.addConfig('core.autocrlf', 'false')
    writeFileSync(join(repo, 'README.md'), 'base\n')
    await g.add(['README.md'])
    await g.commit('initial commit')

    project = seedProject(ctx, repo)
    feature = seedFeature(ctx, project.id, { slug: 'runwt', phase: 'building' })
    await createFeatureBranch(project, feature.slug, 'main')
    talkWt = await ensureTalkWorktree(project, feature)
  })

  afterEach(() => {
    restoreDataDir()
    while (tmpDirs.length) {
      const dir = tmpDirs.pop()
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          // best-effort cleanup on Windows
        }
      }
    }
  })

  it('a non-claiming workflow leaves the talk worktree attached for the whole run', async () => {
    const { def, open } = gatedDef('test-nonclaiming')
    workflowRegistry.set(def.id, def)
    try {
      const { done } = await startRun(ctx, feature.id, def.id)
      // mid-run: still on the feature branch — an HITL session can live here
      expect(await headOf(talkWt)).toBe('feature/runwt')
      open()
      await done
      expect(await headOf(talkWt)).toBe('feature/runwt')
    } finally {
      workflowRegistry.delete(def.id)
    }
  })

  it('parks the talk worktree on a chat branch for the run, then hands the feature branch back', async () => {
    await withGatedBurner('succeeded', async (open, done) => {
      // mid-run: on a chat temp branch — the feature branch is free for the
      // burner worktree, and the chat has somewhere of its own to commit
      const parked = await headOf(talkWt)
      expect(parked.startsWith('runcastle/chat/runwt/')).toBe(true)
      // working files did not move with it
      expect(existsSync(join(talkWt, 'README.md'))).toBe(true)

      open()
      await done()

      expect(await headOf(talkWt)).toBe('feature/runwt')
      // nothing was committed on it, so the branch is gone
      expect(await branches()).not.toContain(parked)
    })
  })

  it('lands the chat commits made mid-run as the last landing', async () => {
    await withGatedBurner('succeeded', async (open, done) => {
      const parked = await headOf(talkWt)
      await chatCommits('notes.md')

      open()
      await done()

      expect(await headOf(talkWt)).toBe('feature/runwt')
      // the note is on the feature branch, and the branch that carried it is gone
      const g = simpleGit(project.repoPath)
      const files = await g.raw(['ls-tree', '-r', '--name-only', 'feature/runwt'])
      expect(files).toContain(`docs/features/${feature.slug}/notes.md`)
      expect(await branches()).not.toContain(parked)
    })
  })

  it('lands them on a FAILED run too — which way the burn went says nothing about the notes', async () => {
    await withGatedBurner('throw', async (open, done) => {
      await chatCommits('failed-run-note.md')

      open()
      await done()

      expect(await headOf(talkWt)).toBe('feature/runwt')
      const files = await simpleGit(project.repoPath).raw([
        'ls-tree',
        '-r',
        '--name-only',
        'feature/runwt',
      ])
      expect(files).toContain(`docs/features/${feature.slug}/failed-run-note.md`)
    })
  })

  it('lands them on a CANCELLED run too', async () => {
    const original = workflowRegistry.get('ticket-burner')
    const { def, open } = gatedDef('ticket-burner', 'throw')
    workflowRegistry.set(def.id, def)
    try {
      const { runId, done } = await startRun(ctx, feature.id, 'ticket-burner')
      await chatCommits('cancelled-run-note.md')
      const cancelling = cancelRun(runId)
      open() // the abort alone only interrupts the fiber; the stub still unblocks
      await cancelling
      await done

      expect(getRunRow(ctx, runId)?.status).toBe('cancelled')
      expect(await headOf(talkWt)).toBe('feature/runwt')
      const files = await simpleGit(project.repoPath).raw([
        'ls-tree',
        '-r',
        '--name-only',
        'feature/runwt',
      ])
      expect(files).toContain(`docs/features/${feature.slug}/cancelled-run-note.md`)
    } finally {
      if (original) workflowRegistry.set('ticket-burner', original)
      else workflowRegistry.delete('ticket-burner')
    }
  })
})
