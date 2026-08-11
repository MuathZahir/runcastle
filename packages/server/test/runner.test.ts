import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Feature, Project, WorkflowDef } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { listAfter } from '../src/services/events'
import { createFeatureBranch, ensureTalkWorktree } from '../src/services/git'
import { getRunRow } from '../src/services/repo'
import { workflowRegistry } from '../src/workflows/registry'
import { startRun, workflowClaimsFeatureBranch } from '../src/workflows/runner'
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
    featureId = seedFeature(ctx, seedProject(ctx).id, { phase: 'implementation' }).id
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
})

describe('workflowClaimsFeatureBranch', () => {
  it('only the ticket-burner claims the feature branch', () => {
    expect(workflowClaimsFeatureBranch('ticket-burner')).toBe(true)
    expect(workflowClaimsFeatureBranch('research')).toBe(false)
    expect(workflowClaimsFeatureBranch('anything-else')).toBe(false)
  })
})

describe('talk worktree detach — only for branch-claiming workflows (ADR-0001 §7)', () => {
  let ctx: AppCtx
  let project: Project
  let feature: Feature
  let talkWt: string
  let prevUserProfile: string | undefined
  let prevHome: string | undefined
  const tmpDirs: string[] = []

  /** A workflow stub whose run blocks until the test opens its gate. */
  function gatedDef(id: string): { def: WorkflowDef; open: () => void } {
    let open!: () => void
    const gate = new Promise<void>((r) => {
      open = r
    })
    const def: WorkflowDef = {
      id,
      async run() {
        await gate
        return { status: 'succeeded', summary: 'ok' }
      },
    }
    return { def, open }
  }

  async function headOf(path: string): Promise<string> {
    return (await simpleGit(path).revparse(['--abbrev-ref', 'HEAD'])).trim()
  }

  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'rc-runner-home-'))
    tmpDirs.push(home)
    prevUserProfile = process.env.USERPROFILE
    prevHome = process.env.HOME
    process.env.USERPROFILE = home
    process.env.HOME = home

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
    feature = seedFeature(ctx, project.id, { slug: 'runwt', phase: 'implementation' })
    await createFeatureBranch(project, feature.slug)
    talkWt = await ensureTalkWorktree(project, feature)
  })

  afterEach(() => {
    process.env.USERPROFILE = prevUserProfile
    process.env.HOME = prevHome
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

  it('the ticket-burner detaches the talk worktree for the run and reattaches at finalize', async () => {
    const original = workflowRegistry.get('ticket-burner')
    const { def, open } = gatedDef('ticket-burner')
    workflowRegistry.set(def.id, def)
    try {
      const { done } = await startRun(ctx, feature.id, 'ticket-burner')
      // mid-run: detached — the feature branch is free for the burner worktree
      expect(await headOf(talkWt)).toBe('HEAD')
      open()
      await done
      // finalize reattached the branch
      expect(await headOf(talkWt)).toBe('feature/runwt')
    } finally {
      if (original) workflowRegistry.set('ticket-burner', original)
      else workflowRegistry.delete('ticket-burner')
    }
  })
})
