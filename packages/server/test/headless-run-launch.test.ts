import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntime, Feature } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { handlePtyExit, launchSession, type LaunchSessionInput } from '../src/launcher/launcher'
import {
  activeSessionsForFeature,
  createSessionRow,
  getSessionRow,
  markSessionEnded,
  markSessionLive,
} from '../src/launcher/sessions'
import { getFeatureFull } from '../src/services/features'
import { listAfter } from '../src/services/events'
import { createFeatureBranch } from '../src/services/git'
import { storeTickets } from '../src/services/tickets'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * The orchestrator's headless runs on a feature (`whole-cuts-plan-themselves`,
 * "Headless runs on a feature"): a `relay` of its message into the planning
 * conversation and a start-lap planned headless — what they render, what they
 * resume, what they refuse, and what their exit says.
 */

describe('a headless run on a feature', () => {
  let ctx: AppCtx
  let repoPath: string
  let projectId: string
  const cleanup: string[] = []

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'runcastle-headless-'))
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

  async function launch(
    featureId: string,
    input: Partial<Omit<LaunchSessionInput, 'featureId' | 'kind'>> = {},
  ): Promise<string> {
    const { sessionId } = await launchSession(
      ctx,
      { featureId, kind: 'chat', ...input },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))
    return sessionId
  }

  const relay = (message = 'Drop decision 3; the human never asked for it.') =>
    ({ purpose: 'relay', message }) as const

  function launchedCommand(featureId: string, sessionId: string): string {
    const launched = listAfter(ctx, featureId, 0).find(
      (e) => e.type === 'session.launched' && e.data?.sessionId === sessionId,
    )
    return String(launched?.data?.command)
  }

  /** The injected prompt: Claude Code's appended file, or Codex's `AGENTS.md` in its home. */
  function injectedPrompt(featureId: string, sessionId: string): string {
    const codexHome = /CODEX_HOME=(\S+)/.exec(launchedCommand(featureId, sessionId))?.[1]
    return readFileSync(
      codexHome ? join(codexHome, 'AGENTS.md') : join(sessionDir(sessionId), 'system-prompt.md'),
      'utf8',
    )
  }

  /** An earlier chat whose conversation the CLI recorded, now ended. */
  async function earlierChat(featureId: string, ccSessionId: string): Promise<void> {
    const earlier = await launch(featureId)
    markSessionLive(ctx, earlier, { ccSessionId })
    markSessionEnded(ctx, earlier)
  }

  function pendingTicket(featureId: string): void {
    storeTickets(ctx, featureId, [
      {
        title: 'Next lap', goal: 'Do it', context: '',
        acceptanceCriteria: [], seams: [], blockedBy: [],
      },
    ])
  }

  it('records headless on the session row of every headless launch, visible in FeatureFull', async () => {
    const plan = await feature('self-plan')
    const relayed = await feature('relayed')
    const lap = await feature('lap', { phase: 'review' })
    const ordinary = await feature('ordinary')

    const ids = [
      await launch(plan.id, { purpose: 'self-plan' }),
      await launch(relayed.id, relay()),
      await launch(lap.id, { purpose: 'start-lap', headless: true }),
    ]
    for (const [i, f] of [plan, relayed, lap].entries()) {
      const session = getFeatureFull(ctx, f.id).sessions.find((s) => s.id === ids[i])
      expect(session?.headless).toBe(true)
    }
    const chat = await launch(ordinary.id)
    expect(getSessionRow(ctx, chat)?.headless).toBe(false)
  })

  describe('a relay', () => {
    it('resumes the latest conversation on Claude Code: `-p --resume <id> … <kickoff>`', async () => {
      useRuntime('claude-code')
      const f = await feature('claude-relay')
      await earlierChat(f.id, 'cc-plan')

      const sessionId = await launch(f.id, relay())
      const command = launchedCommand(f.id, sessionId)
      expect(command).toMatch(/ claude -p --resume cc-plan --settings /)
      expect(command).toContain(
        "The orchestrator's message: Drop decision 3; the human never asked for it.",
      )
      expect(getSessionRow(ctx, sessionId)?.purpose).toBe('relay')
    })

    it('resumes on Codex as `exec resume <id> <kickoff>`', async () => {
      useRuntime('codex')
      const f = await feature('codex-relay')
      await earlierChat(f.id, 'thread-plan')

      const sessionId = await launch(f.id, relay())
      const command = launchedCommand(f.id, sessionId)
      expect(command).toContain(
        'codex exec resume --dangerously-bypass-hook-trust thread-plan Proceed with your task: no human is present',
      )
      expect(command).toContain('$revisit')
    })

    it('launches fresh when there is nothing to resume', async () => {
      useRuntime('claude-code')
      const f = await feature('fresh-relay')
      const sessionId = await launch(f.id, relay())
      const command = launchedCommand(f.id, sessionId)
      expect(command).toMatch(/ claude -p --settings /)
      expect(command).not.toContain('--resume')
    })

    it('leaves a self-planning run fresh, even with a conversation on record', async () => {
      useRuntime('claude-code')
      const f = await feature('plan-fresh')
      await earlierChat(f.id, 'cc-earlier')
      const sessionId = await launch(f.id, { purpose: 'self-plan' })
      expect(launchedCommand(f.id, sessionId)).not.toContain('--resume')
    })

    for (const runtime of ['claude-code', 'codex'] as const) {
      it(`briefs no human, the message and the orchestrator's mark on ${runtime}`, async () => {
        useRuntime(runtime)
        const f = await feature(`brief-${runtime}`)
        const sessionId = await launch(f.id, relay())

        const command = launchedCommand(f.id, sessionId)
        expect(command).toContain('Proceed with your task: no human is present')
        expect(command).toContain("is from the project's orchestrator, not the human")
        expect(command).toContain('**Changed by the orchestrator:** <why>')
        expect(command).toContain(runtime === 'codex' ? '$revisit' : '/runcastle:revisit')

        const prompt = injectedPrompt(f.id, sessionId)
        expect(prompt).toContain('## No human is present')
        expect(prompt).toContain('This is a relay run')
        expect(prompt).toContain('`**Changed by the orchestrator:** <why>`')
        expect(prompt).toContain(runtime === 'codex' ? '`$revisit`' : '`/runcastle:revisit`')
      })
    }

    it('is refused without a message', async () => {
      const f = await feature('no-message')
      await expect(launch(f.id, relay('  '))).rejects.toThrow(/message .* is required/)
      expect(activeSessionsForFeature(ctx, f.id)).toEqual([])
    })

    it('is refused while another session is live, leaving it untouched', async () => {
      const f = await feature('busy')
      const chat = await launch(f.id)
      markSessionLive(ctx, chat, { ccSessionId: 'cc-live' })

      const attempt = launch(f.id, relay())
      await expect(attempt).rejects.toBeInstanceOf(GateError)
      await expect(attempt).rejects.toThrow(/only one terminal per feature/)
      expect(activeSessionsForFeature(ctx, f.id).map((s) => s.id)).toEqual([chat])
    })
  })

  describe('a headless start-lap', () => {
    it('renders a print-mode command with the message and the no-human rule', async () => {
      useRuntime('claude-code')
      const f = await feature('lap-claude', { phase: 'review' })
      const sessionId = await launch(f.id, {
        purpose: 'start-lap',
        headless: true,
        message: 'Make the empty state say why it is empty.',
      })

      const command = launchedCommand(f.id, sessionId)
      expect(command).toMatch(/ claude -p /)
      expect(command).toContain('no human is present and nobody will reply to you')
      expect(command).toContain('PLAN LAP 2 FROM REVIEW by yourself')
      expect(command).toContain(
        "The project's orchestrator asks this of the lap: Make the empty state say why it is empty.",
      )
      expect(command).toContain('Planning without a human')
      expect(command).not.toContain('Interview me')

      const prompt = injectedPrompt(f.id, sessionId)
      expect(prompt).toContain('## This is lap 2')
      expect(prompt).toContain('This lap plans itself')
    })

    it('renders Codex `exec` with the skills spelled its way', async () => {
      useRuntime('codex')
      const f = await feature('lap-codex', { phase: 'review' })
      const sessionId = await launch(f.id, { purpose: 'start-lap', headless: true })
      const command = launchedCommand(f.id, sessionId)
      expect(command).toContain('codex exec --dangerously-bypass-hook-trust Proceed with your task:')
      expect(command).toContain('$revisit')
      expect(command).toContain('$ideate')
    })

    it('leaves the interactive start-lap as it was', async () => {
      useRuntime('claude-code')
      const f = await feature('lap-human', { phase: 'review' })
      const sessionId = await launch(f.id, { purpose: 'start-lap' })
      const command = launchedCommand(f.id, sessionId)
      expect(command).not.toContain(' -p ')
      expect(command).toContain('Interview me about what the test drive taught')
      expect(getSessionRow(ctx, sessionId)?.headless).toBe(false)
      expect(injectedPrompt(f.id, sessionId)).not.toContain('## No human is present')
    })

    it('is refused where the Start-lap door is: away from review', async () => {
      const f = await feature('lap-planning', { phase: 'building' })
      await expect(launch(f.id, { purpose: 'start-lap', headless: true })).rejects.toThrow(
        /not review, so there is no next lap to start/,
      )
    })

    it('is refused while another session is live, rather than ending it', async () => {
      const f = await feature('lap-busy', { phase: 'review' })
      const chat = await launch(f.id)
      markSessionLive(ctx, chat, { ccSessionId: 'cc-live' })
      await expect(launch(f.id, { purpose: 'start-lap', headless: true })).rejects.toThrow(
        /only one terminal per feature/,
      )
      expect(getSessionRow(ctx, chat)?.status).toBe('live')
    })
  })

  it('keeps every chat launch off a live headless run', async () => {
    const f = await feature('working')
    const run = await launch(f.id, relay())

    for (const input of [{}, { purpose: 'start-lap' }, relay()] as const) {
      const attempt = launch(f.id, input)
      await expect(attempt).rejects.toBeInstanceOf(GateError)
      await expect(attempt).rejects.toThrow(/working by itself — stop the run first/)
    }
    markSessionLive(ctx, run, { ccSessionId: 'cc-run' })
    await expect(launch(f.id)).rejects.toThrow(/stop the run first/)
    expect(activeSessionsForFeature(ctx, f.id).map((s) => s.id)).toEqual([run])
  })

  describe('on exit', () => {
    function runEnded(featureId: string) {
      return listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.run_ended')
    }

    it('says a relay finished when it exited cleanly', async () => {
      const f = await feature('relay-done')
      const run = await launch(f.id, relay())
      handlePtyExit(ctx, f, getSessionRow(ctx, run)!, {}, 0)
      const [ended] = runEnded(f.id)
      expect(ended?.message).toBe("the orchestrator's change finished")
      expect(ended?.data).toEqual({ sessionId: run, purpose: 'relay', complete: true, exitCode: 0 })
    })

    it('says a relay stopped short when it exited non-zero', async () => {
      const f = await feature('relay-short')
      const run = await launch(f.id, relay())
      handlePtyExit(ctx, f, getSessionRow(ctx, run)!, {}, 1)
      expect(runEnded(f.id)[0]?.data).toEqual({
        sessionId: run, purpose: 'relay', complete: false, exitCode: 1,
      })
    })

    it('says a lap finished when its tickets are on the board', async () => {
      const f = await feature('lap-done', { phase: 'review' })
      const run = await launch(f.id, { purpose: 'start-lap', headless: true })
      pendingTicket(f.id)
      handlePtyExit(ctx, f, getSessionRow(ctx, run)!, {}, 0)
      expect(runEnded(f.id)[0]?.data).toEqual({
        sessionId: run, purpose: 'start-lap', complete: true, exitCode: 0,
      })
    })

    it('says a lap stopped short with no tickets, even on a clean exit', async () => {
      const f = await feature('lap-short', { phase: 'review' })
      const run = await launch(f.id, { purpose: 'start-lap', headless: true })
      handlePtyExit(ctx, f, getSessionRow(ctx, run)!, {}, 0)
      const [ended] = runEnded(f.id)
      expect(ended?.message).toBe('planning the next lap stopped before it was finished')
      expect(ended?.data?.complete).toBe(false)
    })

    it('leaves self-plan on its own event, and an interactive chat on none', async () => {
      const plan = await feature('plan-exit')
      const run = await launch(plan.id, { purpose: 'self-plan' })
      handlePtyExit(ctx, plan, getSessionRow(ctx, run)!, {}, 0)
      expect(runEnded(plan.id)).toEqual([])
      expect(listAfter(ctx, plan.id, 0).some((e) => e.type === 'session.self_plan_ended')).toBe(true)

      const human = await feature('human-exit')
      const chat = createSessionRow(ctx, { featureId: human.id, kind: 'chat', worktreePath: 'C:\\wt' })
      handlePtyExit(ctx, human, chat, {}, 0)
      expect(runEnded(human.id)).toEqual([])
    })
  })
})
