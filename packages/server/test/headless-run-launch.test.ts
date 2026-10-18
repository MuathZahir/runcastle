import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntime, Feature } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import { emit, listAfter } from '../src/services/events'
import { startLeadWaker, wakeLeadHeadless } from '../src/services/lead-delivery'
import { leadMessageKey, queueOrchestratorLine } from '../src/services/orchestrator-messages'
import { createFeatureBranch } from '../src/services/git'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * The orchestrator's headless runs on a feature (`whole-cuts-plan-themselves`,
 * "Headless runs on a feature"): a `relay` of its message into the planning
 * conversation — what it renders, what it resumes, what it refuses, and what
 * its exit says.
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
  async function earlierChat(featureId: string, ccSessionId: string, transcriptPath?: string): Promise<void> {
    const earlier = await launch(featureId)
    markSessionLive(ctx, earlier, { ccSessionId, ...(transcriptPath ? { transcriptPath } : {}) })
    markSessionEnded(ctx, earlier)
  }

  it('records headless on the session row of every headless launch, visible in FeatureFull', async () => {
    const plan = await feature('self-plan')
    const relayed = await feature('relayed')
    const ordinary = await feature('ordinary')

    const ids = [
      await launch(plan.id, { purpose: 'self-plan' }),
      await launch(relayed.id, relay()),
    ]
    for (const [i, f] of [plan, relayed].entries()) {
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
        'codex exec resume --dangerously-bypass-hook-trust thread-plan [runcastle] Proceed with your task: no human is present',
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

  /**
   * `the-feature-lead-runs-rounds` decision 12: a lead with no terminal open is
   * resumed headless with its messages, through the lead waker.
   */
  describe('a lead wake', () => {
    const wake = async (featureId: string, text: string): Promise<string> => {
      queueOrchestratorLine(leadMessageKey(featureId), `[runcastle] ${text}`)
      const sessionId = await wakeLeadHeadless(ctx, featureId, (c, input) =>
        launchSession(c, input, { spawn: false }),
      )
      if (!sessionId) throw new Error('nothing was launched')
      cleanup.push(sessionDir(sessionId))
      return sessionId
    }

    it('resumes the feature’s chat on Claude Code as `-p --resume <id>` with the tagged message', async () => {
      const f = await feature('lead-claude', { phase: 'building' })
      await earlierChat(f.id, 'cc-lead')

      const sessionId = await wake(f.id, 'Round 1 returned: succeeded')

      const row = getSessionRow(ctx, sessionId)
      expect(row).toMatchObject({ kind: 'chat', purpose: 'lead-wake', headless: true })
      const command = launchedCommand(f.id, sessionId)
      expect(command).toMatch(/ claude -p --resume cc-lead --settings /)
      expect(command).toContain('[runcastle] No terminal of yours was open')
      expect(command).toContain('[runcastle] Round 1 returned: succeeded')
      expect(injectedPrompt(f.id, sessionId)).toContain('## No terminal is open')
      expect(listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.woken_headless')?.data).toMatchObject({
        resumed: true,
      })
      expect(readFileSync(join(sessionDir(sessionId), 'settings.json'), 'utf8')).not.toContain('wait-messages')
    })

    /**
     * REGRESSION (lap-2 drive): a chat whose SessionStart never recorded its id
     * had nothing to resume, yet the wake's prompt and event both said "resumed".
     */
    it('says it started fresh, in the prompt and the event, when the chat has no conversation on record', async () => {
      const f = await feature('lead-unrecorded', { phase: 'building' })
      markSessionEnded(ctx, await launch(f.id))

      const sessionId = await wake(f.id, 'Round 1 returned: succeeded')

      const command = launchedCommand(f.id, sessionId)
      expect(command).not.toContain('--resume')
      expect(command).toContain('no earlier conversation of this feature could be resumed')
      expect(command).not.toContain('resumed this conversation')
      const woken = listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.woken_headless')
      expect(woken?.data).toMatchObject({ resumed: false })
      expect(woken?.message).not.toContain('resumed its conversation')
      expect(listAfter(ctx, f.id, 0).some((e) => e.type === 'session.resume_unavailable')).toBe(true)
    })

    /**
     * Decision 27: nobody can answer a prompt in a headless wake, so the lead
     * past Go runs with prompts off on Claude Code — interactive too — while a
     * chat still planning keeps asking.
     */
    /**
     * REGRESSION (lap-2 review, decision 28): the old conversation had expired
     * from ~/.claude/projects, `claude -p --resume` exited 1 before checking in,
     * and the wake had already taken the human's note and logged success.
     */
    it('starts fresh when the conversation’s transcript is gone, and an early death hands the message on', async () => {
      const f = await feature('lead-expired', { phase: 'building' })
      await earlierChat(f.id, 'cc-expired', join(repoPath, 'expired', 'cc-expired.jsonl'))
      const launched: string[] = []
      const stop = startLeadWaker(ctx, async (c, input) => {
        const result = await launchSession(c, input, { spawn: false })
        cleanup.push(sessionDir(result.sessionId))
        launched.push(result.sessionId)
        return result
      })
      try {
        queueOrchestratorLine(leadMessageKey(f.id), '[runcastle] my drive notes')
        emit(ctx, f.id, { type: 'lead.message_pending', message: 'waiting' })
        await vi.waitFor(() => expect(launched).toHaveLength(1))
        const first = launched[0] as string

        expect(launchedCommand(f.id, first)).not.toContain('--resume')
        expect(listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.woken_headless')?.data).toMatchObject({
          resumed: false,
        })
        expect(listAfter(ctx, f.id, 0).some((e) => e.type === 'session.resume_gone')).toBe(true)

        // The process dies before the agent checks in: the message is not lost.
        handlePtyExit(ctx, f, getSessionRow(ctx, first)!, {}, 1)
        await vi.waitFor(() => expect(launched).toHaveLength(2))
        expect(listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.wake_failed')?.data).toMatchObject({
          sessionId: first,
          exitCode: 1,
        })
        expect(launchedCommand(f.id, launched[1] as string)).toContain('[runcastle] my drive notes')
      } finally {
        stop()
      }
    })

    it('launches the lead past Go with bypassPermissions on Claude Code, headless and interactive', async () => {
      const f = await feature('lead-bypass', { phase: 'building' })
      await earlierChat(f.id, 'cc-lead')
      const headless = await wake(f.id, 'Round 1 returned')
      expect(launchedCommand(f.id, headless)).toContain('--permission-mode bypassPermissions')
      markSessionEnded(ctx, headless)

      const interactive = await launch(f.id)
      expect(launchedCommand(f.id, interactive)).toContain('--permission-mode bypassPermissions')
    })

    it('keeps a planning chat on acceptEdits, and leaves Codex its own posture', async () => {
      const planning = await feature('lead-planning')
      expect(launchedCommand(planning.id, await launch(planning.id))).toContain('--permission-mode acceptEdits')

      useRuntime('codex')
      const f = await feature('lead-codex-posture', { phase: 'building' })
      const sessionId = await launch(f.id)
      const toml = readFileSync(join(sessionDir(sessionId), 'codex-home', 'config.toml'), 'utf8')
      expect(toml).toContain('approval_policy = "never"')
    })

    it('resumes on Codex as `exec resume <id>` with the message', async () => {
      useRuntime('codex')
      const f = await feature('lead-codex', { phase: 'building' })
      await earlierChat(f.id, 'thread-lead')

      const sessionId = await wake(f.id, 'Go given')

      expect(launchedCommand(f.id, sessionId)).toContain(
        'codex exec resume --dangerously-bypass-hook-trust thread-lead [runcastle] No terminal of yours was open',
      )
      expect(launchedCommand(f.id, sessionId)).toContain('[runcastle] Go given')
    })

    it('tells the orchestrator nothing: no human act, and no run of its own ended', async () => {
      const f = await feature('lead-quiet', { phase: 'building', orchestrated: true })
      const sessionId = await wake(f.id, 'Round 1 returned')
      handlePtyExit(ctx, f, getSessionRow(ctx, sessionId)!, {}, 0)
      expect(listAfter(ctx, f.id, 0).filter((e) => e.type === 'session.run_ended')).toEqual([])
    })

    it('is refused without a message', async () => {
      const f = await feature('lead-empty', { phase: 'building' })
      await expect(launch(f.id, { purpose: 'lead-wake' })).rejects.toThrow(/message for the agent/)
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
