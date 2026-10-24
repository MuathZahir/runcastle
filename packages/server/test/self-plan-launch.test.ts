import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AgentRuntime, Feature, SessionPurpose } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { features } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { handlePtyExit, launchSession } from '../src/launcher/launcher'
import {
  activeSessionsForFeature,
  createSessionRow,
  getSessionRow,
  markSessionEnded,
  markSessionLive,
} from '../src/launcher/sessions'
import { listAfter } from '../src/services/events'
import { setWaiting } from '../src/services/lead-status'
import { featureDocPath } from '../src/services/feature-docs'
import { createFeatureBranch } from '../src/services/git'
import { getFeatureRow, projectForFeature } from '../src/services/repo'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * "Plan it yourself" (`features-plan-themselves` decisions 3, 9, 11): the
 * feature's planning chat launched headless with the `self-plan` purpose —
 * what it renders, what it refuses, how it keeps the chat off a running plan,
 * and what its exit says about the plan.
 */

describe('a self-planning run', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-self-plan-'))
    cleanup.push(repoPath)
    const g = simpleGit(repoPath)
    await g.init(['-b', 'main'])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    await g.raw(['commit', '--allow-empty', '-m', 'initial commit'])
    projectId = seedProject(ctx, repoPath).id
  })

  afterEach(() => {
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  async function feature(slug: string, overrides: Partial<Feature> = {}): Promise<Feature> {
    const f = seedFeature(ctx, projectId, { slug, ...overrides })
    await createFeatureBranch({ id: projectId, name: 't', repoPath }, slug, 'main')
    cleanup.push(worktreeDir(projectId, slug))
    return f
  }

  function useRuntime(runtime: AgentRuntime): void {
    const id = runtime === 'codex' ? 'gpt-5.6-sol' : 'claude-sonnet-5'
    ctx.config = { ...ctx.config, model: id, models: [{ id, runtime }] }
  }

  async function launch(featureId: string, purpose?: SessionPurpose): Promise<string> {
    const { sessionId } = await launchSession(
      ctx,
      { featureId, kind: 'chat', ...(purpose ? { purpose } : {}) },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))
    return sessionId
  }

  function launchedCommand(featureId: string, sessionId: string): string {
    const launched = listAfter(ctx, featureId, 0).find(
      (e) => e.type === 'session.launched' && e.data?.sessionId === sessionId,
    )
    return String(launched?.data?.command)
  }

  it('keeps its purpose on the session row', async () => {
    const f = await feature('row')
    const row = createSessionRow(ctx, {
      featureId: f.id,
      kind: 'chat',
      purpose: 'self-plan',
      worktreePath: 'C:\\wt',
    })
    expect(getSessionRow(ctx, row.id)?.purpose).toBe('self-plan')
  })

  it('launches Claude Code in print mode, briefed that no human is present', async () => {
    useRuntime('claude-code')
    const f = await feature('claude-plan')
    const sessionId = await launch(f.id, 'self-plan')

    const row = getSessionRow(ctx, sessionId)
    expect(row?.kind).toBe('chat')
    expect(row?.purpose).toBe('self-plan')
    const launching = listAfter(ctx, f.id, 0).find((e) => e.type === 'session.launching')
    expect(launching?.data?.purpose).toBe('self-plan')

    const command = launchedCommand(f.id, sessionId)
    expect(command).toContain('claude -p ')
    expect(command).not.toContain('--resume')
    expect(command).toContain('Proceed with your task: no human is present')
    expect(command).toContain('/runcastle:feature')
    expect(command).toContain('references/planning-alone.md')
    // The feature-state part of the chat header still follows the opening.
    // No lap in it: the round count is the human-facing number (decision 16).
    expect(command).toContain('Feature status: Talking with you; rounds run: 0;')
    expect(command).not.toMatch(/\blap\b/i)
  })

  it('launches Codex as `exec`, naming the skill its way', async () => {
    useRuntime('codex')
    const f = await feature('codex-plan')
    const sessionId = await launch(f.id, 'self-plan')

    const command = launchedCommand(f.id, sessionId)
    expect(command).toContain('codex exec --dangerously-bypass-hook-trust ')
    expect(command).not.toContain(' resume ')
    expect(command).toContain('no human is present')
    expect(command).toContain('$feature')
    expect(command).toContain('references/planning-alone.md')
  })

  it('never resumes an earlier conversation', async () => {
    useRuntime('claude-code')
    const f = await feature('fresh')
    const earlier = await launch(f.id)
    markSessionLive(ctx, earlier, { ccSessionId: 'cc-earlier' })
    markSessionEnded(ctx, earlier)

    const sessionId = await launch(f.id, 'self-plan')
    expect(launchedCommand(f.id, sessionId)).not.toContain('--resume')
    const types = listAfter(ctx, f.id, 0)
      .filter((e) => e.data?.sessionId === sessionId)
      .map((e) => e.type)
    expect(types).not.toContain('session.resumed')
    expect(types).not.toContain('session.resume_unavailable')
  })

  describe('is refused, leaving no session behind,', () => {
    async function expectRefused(f: Feature, reason: RegExp): Promise<void> {
      const before = activeSessionsForFeature(ctx, f.id).map((s) => s.id)
      const attempt = launch(f.id, 'self-plan')
      await expect(attempt).rejects.toBeInstanceOf(GateError)
      await expect(attempt).rejects.toThrow(reason)
      expect(activeSessionsForFeature(ctx, f.id).map((s) => s.id)).toEqual(before)
    }

    it('when the feature is a draft', async () => {
      const f = await feature('drafted', { status: 'draft' })
      await expectRefused(f, /in the backlog/)
    })

    it('when the feature has shipped', async () => {
      const f = await feature('done', { status: 'shipped' })
      await expectRefused(f, /is shipped/)
    })
  })

  it('plans a started feature whatever it has already produced or done', async () => {
    for (const [slug, overrides] of [['decided', {}], ['building', {}]] as const) {
      const f = await feature(slug, overrides)
      const path = featureDocPath(projectForFeature(ctx, f), f, 'decisions.md')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, '# decisions\n')
      const sessionId = await launch(f.id, 'self-plan')
      expect(getSessionRow(ctx, sessionId)?.purpose).toBe('self-plan')
    }
  })

  describe('is still refused, leaving no session behind,', () => {
    async function expectRefused(f: Feature, reason: RegExp): Promise<void> {
      const before = activeSessionsForFeature(ctx, f.id).map((s) => s.id)
      const attempt = launch(f.id, 'self-plan')
      await expect(attempt).rejects.toBeInstanceOf(GateError)
      await expect(attempt).rejects.toThrow(reason)
      expect(activeSessionsForFeature(ctx, f.id).map((s) => s.id)).toEqual(before)
    }

    it('when another session is up', async () => {
      const f = await feature('busy')
      createSessionRow(ctx, { featureId: f.id, kind: 'prepare', worktreePath: 'C:\\wt' })
      await expectRefused(f, /only one terminal per feature/)
    })
  })

  it('keeps every chat launch off a running plan', async () => {
    const f = await feature('running')
    const run = await launch(f.id, 'self-plan')

    for (const purpose of [undefined, 'start-lap', 'self-plan'] as const) {
      const attempt = launch(f.id, purpose)
      await expect(attempt).rejects.toBeInstanceOf(GateError)
      await expect(attempt).rejects.toThrow(/planning itself — stop the run first/)
    }
    // Live as well as launching, and the run itself is untouched.
    markSessionLive(ctx, run, { ccSessionId: 'cc-run' })
    await expect(launch(f.id)).rejects.toThrow(/stop the run first/)
    expect(activeSessionsForFeature(ctx, f.id).map((s) => s.id)).toEqual([run])
    expect(listAfter(ctx, f.id, 0).some((e) => e.type === 'session.kickoff')).toBe(false)
  })

  describe('on exit', () => {
    function selfPlanEnded(featureId: string) {
      return listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.self_plan_ended')
    }

    it('says the plan is complete when the run ended by asking the human for the yes', async () => {
      const f = await feature('done')
      const run = await launch(f.id, 'self-plan')
      setWaiting(ctx, f.id, 'Start round 1?')

      handlePtyExit(ctx, f, getSessionRow(ctx, run)!, {}, 0)

      const [ended] = selfPlanEnded(f.id)
      expect(ended?.message).toBe('planning finished')
      expect(ended?.data).toEqual({ sessionId: run, complete: true, exitCode: 0 })
    })

    it('says planning stopped short otherwise', async () => {
      const f = await feature('short')
      const run = await launch(f.id, 'self-plan')

      handlePtyExit(ctx, getFeatureRow(ctx, f.id), getSessionRow(ctx, run)!, {}, 1)

      const [ended] = selfPlanEnded(f.id)
      expect(ended?.message).toBe('planning stopped before the plan was complete')
      expect(ended?.data).toEqual({ sessionId: run, complete: false, exitCode: 1 })
    })

    it('says nothing for a session with any other purpose', async () => {
      const f = await feature('plain')
      const chat = await launch(f.id)
      handlePtyExit(ctx, f, getSessionRow(ctx, chat)!, {}, 0)
      expect(selfPlanEnded(f.id)).toEqual([])
    })
  })
})
