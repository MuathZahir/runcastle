import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionKind } from '@runcastle/core'
import { PROJECT_WORKTREE_SLUG, worktreeDir } from '@runcastle/core/paths'
import { features, runs } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow, markSessionEnded } from '../src/launcher/sessions'
import { toolsForAudience } from '../src/mcp/server'
import hooksApp from '../src/routes/hooks'
import { type LiveSignal, subscribeLive } from '../src/services/bus'
import { listAfter, listByProject } from '../src/services/events'
import { recordFinding } from '../src/services/findings'
import { keysToPrepare } from '../src/services/prep'
import { getProjectById } from '../src/services/repo'
import { storeTickets } from './helpers/tickets'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

function mount(): Hono {
  const app = new Hono()
  app.route('/api/hooks', hooksApp)
  return app
}

async function post(app: Hono, event: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await app.request(`/api/hooks/${event}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

describe('hooks route', () => {
  let ctx: AppCtx
  let featureId: string
  let sessionId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    const feature = seedFeature(ctx, project.id, { slug: 'dark-mode' })
    featureId = feature.id
    const session = createSessionRow(ctx, {
      featureId,
      kind: 'chat',
      worktreePath: 'C:\\wt\\dark-mode',
    })
    sessionId = session.id
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  it('session-start marks the session live, stores cc ids, and injects context', async () => {
    const { status, json } = await post(mount(), 'session-start', {
      sessionId,
      payload: {
        session_id: 'cc-123',
        transcript_path: '/tmp/t.jsonl',
        hook_event_name: 'SessionStart',
        source: 'startup',
      },
    })

    expect(status).toBe(200)
    // exact verified SessionStart shape (additionalContext nested in hookSpecificOutput)
    expect(json.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(json.hookSpecificOutput.additionalContext).toContain('[runcastle] Demo feature')
    expect(json.hookSpecificOutput.additionalContext).toContain('status: Talking with you')
    expect(json.hookSpecificOutput.additionalContext).toContain('returns only what changed')
    // A Claude Code session ends with one line that loads every runcastle tool at once.
    const lastLine = json.hookSpecificOutput.additionalContext.split('\n').at(-1)
    expect(lastLine).toBe(
      `Load your runcastle tools once: ToolSearch "select:${toolsForAudience('chat').map((n) => `mcp__runcastle__${n}`).join(',')}"`,
    )

    const session = getSessionRow(ctx, sessionId)
    expect(session?.status).toBe('live')
    expect(session?.ccSessionId).toBe('cc-123')
    expect(session?.transcriptPath).toBe('/tmp/t.jsonl')
  })

  /**
   * REGRESSION (merge-conflict "Resolve with agent" opened a terminal that just
   * sat there): a resumed session is a started session. The settings used to
   * register `matcher: 'startup'` alone, so this call never happened for a
   * `--resume` launch — the row stayed `launching`, no `ccSessionId` was ever
   * recorded, and the kickoff was never typed.
   */
  it('session-start with source=resume goes live exactly like a fresh start', async () => {
    const { status } = await post(mount(), 'session-start', {
      sessionId,
      payload: {
        session_id: 'cc-resumed',
        transcript_path: '/tmp/t.jsonl',
        hook_event_name: 'SessionStart',
        source: 'resume',
      },
    })

    expect(status).toBe(200)
    const session = getSessionRow(ctx, sessionId)
    expect(session?.status).toBe('live')
    expect(session?.ccSessionId).toBe('cc-resumed')

    const started = listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.started')
    expect(started).toHaveLength(1)
    expect(started[0].message).toContain('resumed')
  })

  /**
   * `/clear` and compaction start a NEW Claude Code conversation in the same
   * terminal: keep the id current (a stale one resumes the wrong transcript)
   * without re-announcing a session that is already live.
   */
  it('a later session-start refreshes the cc id without a second started event', async () => {
    const app = mount()
    await post(app, 'session-start', {
      sessionId,
      payload: { session_id: 'cc-1', hook_event_name: 'SessionStart', source: 'startup' },
    })
    await post(app, 'session-start', {
      sessionId,
      payload: { session_id: 'cc-2', hook_event_name: 'SessionStart', source: 'clear' },
    })

    expect(getSessionRow(ctx, sessionId)?.ccSessionId).toBe('cc-2')
    expect(listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.started')).toHaveLength(1)
  })

  /** lead-chats-stay-small decision 15: after a compaction the agent re-reads the record before acting on its summary. */
  it('opens a compacted session’s start context with the re-read, and no other start’s', async () => {
    const app = mount()
    const start = (source: string) =>
      post(app, 'session-start', { sessionId, payload: { session_id: 'cc-1', hook_event_name: 'SessionStart', source } })
    const resumed = (await start('resume')).json.hookSpecificOutput.additionalContext as string
    expect(resumed.startsWith('[runcastle] ')).toBe(true)
    const compacted = (await start('compact')).json.hookSpecificOutput.additionalContext as string
    expect(compacted).toBe(`Your context was just compacted. Before acting on the summary, call get_feature_context.\n${resumed}`)
  })

  /** lead-chats-stay-small decision 14: runcastle's compaction command is no human message, so the feature's waiting reason stays. */
  it('does not count the compaction command as the human writing to the lead', async () => {
    ctx.db.update(features).set({ waitingReason: 'plan to approve', waitingKind: 'plan' }).where(eq(features.id, featureId)).run()
    await post(mount(), 'user-prompt', { sessionId, payload: { hook_event_name: 'UserPromptSubmit', prompt: '/compact Keep in the summary: what you wait on.' } })
    const row = ctx.db.select().from(features).where(eq(features.id, featureId)).get()!
    expect(row.waitingReason).toBe('plan to approve')
    expect(listAfter(ctx, featureId, 0).some((e) => e.type === 'lead.human_message')).toBe(false)
  })

  /**
   * REGRESSION (lap-2 drive): one SessionStart that timed out client-side left
   * the chat with no conversation id, so the headless wake could not resume it
   * and started a fresh conversation. Every turn hook carries the id too, so the
   * first one to arrive checks the session in.
   */
  describe('a session whose SessionStart never arrived', () => {
    const turnPayloads = {
      'user-prompt': { hook_event_name: 'UserPromptSubmit', prompt: 'go' },
      stop: { hook_event_name: 'Stop' },
    }
    for (const [event, payload] of Object.entries(turnPayloads)) {
      it(`is checked in by its first ${event}, once`, async () => {
        const app = mount()
        const turn = { sessionId, payload: { ...payload, session_id: 'cc-late', transcript_path: '/tmp/late.jsonl' } }
        await post(app, event, turn)
        await post(app, event, turn)

        expect(getSessionRow(ctx, sessionId)).toMatchObject({
          status: 'live',
          ccSessionId: 'cc-late',
          transcriptPath: '/tmp/late.jsonl',
        })
        expect(listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.started')).toHaveLength(1)
      })
    }

    it('keeps the id current from a turn hook after a missed /clear SessionStart', async () => {
      const app = mount()
      await post(app, 'session-start', {
        sessionId,
        payload: { session_id: 'cc-1', hook_event_name: 'SessionStart', source: 'startup' },
      })
      await post(app, 'stop', { sessionId, payload: { session_id: 'cc-2', hook_event_name: 'Stop' } })

      expect(getSessionRow(ctx, sessionId)?.ccSessionId).toBe('cc-2')
      expect(listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.started')).toHaveLength(1)
    })

    it('never brings an ended session back', async () => {
      markSessionEnded(ctx, sessionId)
      await post(mount(), 'stop', { sessionId, payload: { session_id: 'cc-late', hook_event_name: 'Stop' } })

      expect(getSessionRow(ctx, sessionId)).toMatchObject({ status: 'ended', ccSessionId: undefined })
    })

    it('checks in a project-scoped session the same way', async () => {
      const project = createSessionRow(ctx, {
        projectId: seedProject(ctx).id,
        kind: 'project',
        worktreePath: 'C:\\wt\\proj',
      })
      await post(mount(), 'user-prompt', {
        sessionId: project.id,
        payload: { session_id: 'cc-proj', hook_event_name: 'UserPromptSubmit', prompt: 'hi' },
      })

      expect(getSessionRow(ctx, project.id)).toMatchObject({ status: 'live', ccSessionId: 'cc-proj' })
    })

    /**
     * REGRESSION (lap 3 review): a SessionStart whose write hit a locked database
     * answered `{}` and said nothing, so the row sat `launching` with no trace of
     * why. The failure is now on the timeline, and the first turn still checks in.
     */
    it('says so on the timeline when its SessionStart write fails, and its first turn checks it in', async () => {
      const app = mount()
      const silence = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(ctx.db, 'update').mockImplementationOnce(() => {
        throw new Error('database is locked')
      })
      const start = await post(app, 'session-start', {
        sessionId,
        payload: { session_id: 'cc-1', hook_event_name: 'SessionStart', source: 'startup' },
      })

      expect(start).toEqual({ status: 200, json: {} })
      expect(getSessionRow(ctx, sessionId)?.status).toBe('launching')
      expect(listAfter(ctx, featureId, 0).find((e) => e.type === 'session.checkin_failed')).toMatchObject({
        message: expect.stringContaining('database is locked'),
        data: { sessionId, reason: 'database is locked' },
      })
      expect(silence).toHaveBeenCalled()

      await post(app, 'stop', { sessionId, payload: { session_id: 'cc-1', hook_event_name: 'Stop' } })
      expect(getSessionRow(ctx, sessionId)).toMatchObject({ status: 'live', ccSessionId: 'cc-1' })
      expect(listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.started')).toHaveLength(1)
      vi.restoreAllMocks()
    })
  })

  it('user-prompt injects one compact runcastle line in the verified shape', async () => {
    storeTickets(ctx, featureId, [
      { title: 'a', goal: 'g', context: 'c', acceptanceCriteria: ['x'], seams: ['s'], blockedBy: [] },
      { title: 'b', goal: 'g', context: 'c', acceptanceCriteria: ['x'], seams: ['s'], blockedBy: [] },
    ])

    const { json } = await post(mount(), 'user-prompt', {
      sessionId,
      payload: { hook_event_name: 'UserPromptSubmit', prompt: 'hi' },
    })

    expect(json.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')
    expect(json.hookSpecificOutput.additionalContext).toBe(
      '[runcastle] feature=dark-mode status=Talking with you',
    )
  })

  describe('the status words a chat is told, never a phase', () => {
    async function promptContext(): Promise<string> {
      // runcastle's own prompt: a human one would clear the waiting reason it reports
      const { json } = await post(mount(), 'user-prompt', {
        sessionId,
        payload: { hook_event_name: 'UserPromptSubmit', prompt: '[runcastle] a round returned' },
      })
      return json.hookSpecificOutput.additionalContext
    }

    async function startContext(): Promise<string> {
      const { json } = await post(mount(), 'session-start', {
        sessionId,
        payload: { session_id: 'cc-status', hook_event_name: 'SessionStart', source: 'startup' },
      })
      return json.hookSpecificOutput.additionalContext
    }

    async function expectStatus(words: string): Promise<void> {
      const prompt = await promptContext()
      const start = await startContext()
      expect(prompt).toContain(`status=${words}`)
      expect(start).toContain(`status: ${words}; branch:`)
      for (const text of [prompt, start]) expect(text).not.toMatch(/phase/)
    }

    it('says "Talking with you" with nothing running and nothing asked', async () => {
      await expectStatus('Talking with you')
    })

    it('says "Waiting for you · <why>" while a waiting reason is set', async () => {
      ctx.db.update(features).set({ waitingReason: 'ready to test' }).where(eq(features.id, featureId)).run()
      await expectStatus('Waiting for you · ready to test')
    })

    it('says "Merged" once the feature has shipped', async () => {
      ctx.db.update(features).set({ status: 'shipped' }).where(eq(features.id, featureId)).run()
      await expectStatus('Merged')
    })
  })

  it('claude session-end marks the session ended and emits session.ended', async () => {
    const { json } = await post(mount(), 'session-end', {
      sessionId,
      payload: { hook_event_name: 'SessionEnd' },
    })
    expect(json).toEqual({})
    expect(getSessionRow(ctx, sessionId)?.status).toBe('ended')
    expect(listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.ended')).toHaveLength(1)
  })

  it('codex session-end only records the ended conversation and preserves live state', async () => {
    const feature = seedFeature(ctx, seedProject(ctx).id, { slug: 'codex-chat' })
    const session = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'chat',
      worktreePath: 'C:\\wt\\codex-chat',
      model: { id: 'gpt-5', runtime: 'codex' },
    })
    await post(mount(), 'session-start', {
      sessionId: session.id,
      payload: { session_id: 'codex-thread', source: 'startup' },
    })

    const { json } = await post(mount(), 'session-end', {
      sessionId: session.id,
      payload: { hook_event_name: 'SessionEnd', reason: 'other' },
    })

    expect(json).toEqual({})
    expect(getSessionRow(ctx, session.id)?.status).toBe('live')
    const events = listAfter(ctx, feature.id, 0)
    expect(events.filter((e) => e.type === 'session.ended')).toHaveLength(0)
    const notes = events.filter((e) => e.type === 'session.conversation_ended')
    expect(notes).toHaveLength(1)
    expect(notes[0]?.message).toBe('conversation ended (reason: other)')
    expect(notes[0]?.data).toEqual({ sessionId: session.id, reason: 'other' })
  })

  it('project-scoped codex session-end is also only a conversation note', async () => {
    const project = seedProject(ctx)
    const session = createSessionRow(ctx, {
      projectId: project.id,
      kind: 'project',
      worktreePath: 'C:\\repo',
      model: { id: 'gpt-5', runtime: 'codex' },
    })
    await post(mount(), 'session-start', {
      sessionId: session.id,
      payload: { session_id: 'codex-project-thread', source: 'startup' },
    })

    await post(mount(), 'session-end', {
      sessionId: session.id,
      payload: { hook_event_name: 'SessionEnd', reason: 'other' },
    })

    expect(getSessionRow(ctx, session.id)?.status).toBe('live')
    const events = listByProject(ctx, project.id, 0)
    expect(events.filter((e) => e.type === 'session.ended')).toHaveLength(0)
    const notes = events.filter((e) => e.type === 'session.conversation_ended')
    expect(notes).toHaveLength(1)
    expect(notes[0]?.data).toEqual({ sessionId: session.id, reason: 'other' })
  })

  it('session-start never tells the session a lap (the agent would repeat it)', async () => {
    const lapFeature = seedFeature(ctx, seedProject(ctx).id, { slug: 'lapper' })
    const s = createSessionRow(ctx, {
      featureId: lapFeature.id,
      kind: 'chat',
      worktreePath: '/wt/lapper',
    })

    const { json } = await post(mount(), 'session-start', {
      sessionId: s.id,
      payload: { session_id: 'cc-lap', hook_event_name: 'SessionStart', source: 'startup' },
    })

    expect(json.hookSpecificOutput.additionalContext).toContain('status: Talking with you; branch:')
    expect(json.hookSpecificOutput.additionalContext).not.toMatch(/\blap\b/i)
  })

  /**
   * The edit guard: every feature chat is the lead from its first message and
   * writes code (tickets-and-review-are-tools-not-phases decisions 4 and 13),
   * self-planning runs included, and on Claude Code it is answered `allow` so it
   * never stalls on a prompt. The other kinds keep their own lines.
   */
  describe('pre-tool — who writes code', () => {
    async function preTool(id: string, tool: string, filePath: string): Promise<any> {
      const { json } = await post(mount(), 'pre-tool', {
        sessionId: id,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          tool_input: { file_path: filePath },
        },
      })
      return json
    }

    it('has no opinion on a feature chat editing source, whatever the feature is doing', async () => {
      const chat = createSessionRow(ctx, { featureId, kind: 'chat', worktreePath: '/wt/dark-mode' }).id
      for (const tool of ['Edit', 'Write', 'NotebookEdit']) {
        expect(await preTool(chat, tool, 'src/theme.ts')).toEqual({})
      }
      expect(await preTool(chat, 'Edit', '/wt/dark-mode/src/theme.ts')).toEqual({})
    })

    it('lets a self-planning run and a side session write too: purpose no longer guards it', async () => {
      const selfPlan = createSessionRow(ctx, {
        featureId,
        kind: 'chat',
        purpose: 'self-plan',
        worktreePath: '/wt/dark-mode',
      }).id
      const side = createSessionRow(ctx, { featureId, kind: 'side', worktreePath: '/wt/dark-mode' }).id
      for (const id of [selfPlan, side]) {
        expect(await preTool(id, 'Write', 'src/theme.ts')).toEqual({})
      }
    })

    it('leaves an orchestrator alone — it writes code too', async () => {
      const projectSession = createSessionRow(ctx, {
        projectId: seedProject(ctx).id,
        kind: 'project',
        worktreePath: '/wt/project',
      }).id
      expect(await preTool(projectSession, 'Edit', '/wt/project/src/index.ts')).toEqual({})
    })

    it('keeps binding every other feature-scoped kind', async () => {
      const fix = createSessionRow(ctx, { featureId, kind: 'drive-fix', worktreePath: '/repo' }).id
      const json = await preTool(fix, 'Edit', '/repo/src/theme.ts')
      expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
    })
  })

  /**
   * After Go the lead never stalls on a prompt (`the-feature-lead-runs-rounds`
   * decision 27): a chat launched in planning keeps its permission mode, so the
   * hook answers `allow`. The line guard denies in every phase and mode.
   */
  describe('pre-tool — the lead runs unprompted, inside the human\'s lines', () => {
    let repoPath: string
    let leadFeatureId: string
    let leadPath: string

    beforeEach(() => {
      const project = seedProject(ctx)
      repoPath = project.repoPath
      leadFeatureId = seedFeature(ctx, project.id, { slug: 'lead' }).id
      leadPath = worktreeDir(project.id, 'lead')
    })

    async function shell(id: string, command: string, tool = 'Bash'): Promise<any> {
      const { json } = await post(mount(), 'pre-tool', {
        sessionId: id,
        payload: { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command } },
      })
      return json
    }

    it('has no opinion on a lead shell call that crosses no line', async () => {
      const lead = createSessionRow(ctx, { featureId: leadFeatureId, kind: 'chat', worktreePath: leadPath }).id
      expect(await shell(lead, 'git merge main')).toEqual({})
      expect(await shell(lead, 'bun run test', 'PowerShell')).toEqual({})
    })

    it('denies the three named acts with a reason', async () => {
      const lead = createSessionRow(ctx, { featureId: leadFeatureId, kind: 'chat', worktreePath: leadPath }).id
      for (const cmd of ['git push origin main', `git -C "${repoPath}" status`, 'git branch -D feature/lead']) {
        const json = await shell(lead, cmd)
        expect(json.hookSpecificOutput.permissionDecision, cmd).toBe('deny')
        expect(json.hookSpecificOutput.permissionDecisionReason).toMatch(/human/)
      }
    })

    it('leaves a Codex lead with no opinion on what it allows — Codex never asks', async () => {
      const lead = createSessionRow(ctx, {
        featureId: leadFeatureId,
        kind: 'chat',
        worktreePath: leadPath,
        model: { id: 'gpt-5.5', runtime: 'codex' },
      }).id
      expect(await shell(lead, 'git merge main')).toEqual({})
      expect((await shell(lead, 'git push origin main')).hookSpecificOutput.permissionDecision).toBe('deny')
    })
  })

  /**
   * The checkout guard: the host-side kinds run without prompts in the human's
   * own checkout, so the hook refuses what the prompts used to catch.
   */
  describe('pre-tool — the checkout guard on host-side sessions', () => {
    let repo: string

    beforeEach(() => {
      repo = mkdtempSync(join(tmpdir(), 'rc-checkout-guard-'))
      const run = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
      run('init', '-q')
      mkdirSync(join(repo, '.runcastle'))
      writeFileSync(join(repo, '.runcastle', 'drive-setup.sh'), 'echo\n')
      writeFileSync(join(repo, 'mine.ts'), 'x\n')
      run('add', 'mine.ts', '.runcastle/drive-setup.sh')
    })
    afterEach(() => rmSync(repo, { recursive: true, force: true }))

    async function shell(kind: SessionKind, command: string): Promise<any> {
      const id = createSessionRow(ctx, { featureId, kind, worktreePath: repo }).id
      const { json } = await post(mount(), 'pre-tool', {
        sessionId: id,
        payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } },
      })
      return json
    }

    it('denies a refused command with the reason', async () => {
      const json = await shell('drive-fix', 'git push origin main')
      expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(json.hookSpecificOutput.permissionDecisionReason).toMatch(/Leave it to them/)
    })

    it('denies a commit while the human\'s paths are staged, naming them', async () => {
      const json = await shell('drive-fix', 'git commit -m fix')
      expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
      expect(json.hookSpecificOutput.permissionDecisionReason).toContain('mine.ts')
    })

    it('has no opinion on a command it allows', async () => {
      expect(await shell('scenario', 'git status')).toEqual({})
    })
  })

  /**
   * The talk-worktree install guard: talk worktrees are docs-only (charter
   * decision 6), so a package install from a shell there is denied — and only
   * there.
   */
  describe('pre-tool — no package installs in a talk worktree', () => {
    let projectId: string
    let talkPath: string
    let talkFeatureId: string

    beforeEach(() => {
      projectId = seedProject(ctx).id
      talkFeatureId = seedFeature(ctx, projectId, { slug: 'no-deps' }).id
      talkPath = worktreeDir(projectId, 'no-deps')
    })

    async function install(id: string, tool = 'Bash'): Promise<any> {
      const { json } = await post(mount(), 'pre-tool', {
        sessionId: id,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          tool_input: { command: 'cd packages/server && bun install' },
        },
      })
      return json
    }

    it('denies an install from another kind in a feature talk worktree, naming the alternative', async () => {
      const talk = createSessionRow(ctx, {
        featureId: talkFeatureId,
        kind: 'scenario',
        worktreePath: talkPath,
      }).id
      for (const tool of ['Bash', 'PowerShell']) {
        const json = await install(talk, tool)
        expect(json.hookSpecificOutput).toMatchObject({
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
        })
        const reason = json.hookSpecificOutput.permissionDecisionReason
        expect(reason).toMatch(/docs-only/)
        expect(reason).toMatch(/worker sandbox/)
        expect(reason).toMatch(/review round/)
        expect(reason).toMatch(/test drive/)
      }
    })

    it('allows other shell commands in the same worktree', async () => {
      const talk = createSessionRow(ctx, {
        featureId: talkFeatureId,
        kind: 'scenario',
        worktreePath: talkPath,
      }).id
      const { json } = await post(mount(), 'pre-tool', {
        sessionId: talk,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'grep -rn "bun install" docs/' },
        },
      })
      expect(json).toEqual({})
    })

    it('allows a drive-fix session in the main checkout', async () => {
      const fix = createSessionRow(ctx, {
        featureId: talkFeatureId,
        kind: 'drive-fix',
        worktreePath: '/repo',
      }).id
      expect(await install(fix)).toEqual({})
    })

    it('allows the orchestrator in the __project worktree', async () => {
      const project = createSessionRow(ctx, {
        projectId,
        kind: 'project',
        worktreePath: worktreeDir(projectId, PROJECT_WORKTREE_SLUG),
      }).id
      expect(await install(project)).toEqual({})
    })

    it('allows a non-orchestrator whose cwd is the __project worktree', async () => {
      const chat = createSessionRow(ctx, {
        featureId: talkFeatureId,
        kind: 'scenario',
        worktreePath: worktreeDir(projectId, PROJECT_WORKTREE_SLUG),
      }).id
      expect(await install(chat)).toEqual({})
    })

    it('lets the feature chat install, self-planning runs included, without a prompt', async () => {
      for (const purpose of [undefined, 'self-plan'] as const) {
        const lead = createSessionRow(ctx, {
          featureId: talkFeatureId,
          kind: 'chat',
          ...(purpose ? { purpose } : {}),
          worktreePath: talkPath,
        }).id
        expect(await install(lead)).toEqual({})
        markSessionEnded(ctx, lead)
      }
    })
  })

  /** Codex uses the shared hook protocol with runtime-specific end semantics. */
  describe('a Codex session drives the same lifecycle through the same route', () => {
    let codexSession: string

    beforeEach(() => {
      codexSession = createSessionRow(ctx, {
        featureId,
        kind: 'chat',
        worktreePath: '/wt/dark-mode',
        model: { id: 'gpt-5.6-sol', runtime: 'codex' },
      }).id
    })

    it('goes live on SessionStart, awaits input on Stop, and stays live on SessionEnd', async () => {
      await post(mount(), 'session-start', {
        sessionId: codexSession,
        payload: { session_id: 'codex-rollout-7', hook_event_name: 'SessionStart', source: 'startup' },
      })
      expect(getSessionRow(ctx, codexSession)).toMatchObject({
        status: 'live',
        // the id `codex resume` needs, captured from the payload like any other
        ccSessionId: 'codex-rollout-7',
      })

      await post(mount(), 'stop', { sessionId: codexSession, payload: { hook_event_name: 'Stop' } })
      expect(getSessionRow(ctx, codexSession)?.awaitingInput).toBe(true)

      await post(mount(), 'session-end', {
        sessionId: codexSession,
        payload: { hook_event_name: 'SessionEnd', reason: 'other' },
      })
      expect(getSessionRow(ctx, codexSession)?.status).toBe('live')
    })

    it('lets a Codex self-plan run patch source with no opinion: Codex never asks', async () => {
      const selfPlan = createSessionRow(ctx, {
        featureId,
        kind: 'chat',
        purpose: 'self-plan',
        worktreePath: '/wt/dark-mode',
        model: { id: 'gpt-5.6-sol', runtime: 'codex' },
      }).id
      const { json } = await post(mount(), 'pre-tool', {
        sessionId: selfPlan,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'apply_patch',
          tool_input: { file_path: '/wt/dark-mode/src/theme.ts' },
        },
      })
      expect(json).toEqual({})
    })
  })

  it('returns {} for an unknown session id (never breaks a session)', async () => {
    const { json } = await post(mount(), 'session-start', {
      sessionId: 'sess_does_not_exist',
      payload: {},
    })
    expect(json).toEqual({})
  })

  it('returns {} when no session id is provided', async () => {
    const { json } = await post(mount(), 'session-start', { payload: {} })
    expect(json).toEqual({})
  })

  /**
   * Ticket 4 — per-session turn state (decisions §3). The server used to hear
   * only that a prompt went IN, so a live session mid-turn and a live session
   * that had been waiting on its human for an hour looked identical, and the
   * triage lanes called both of them "Needs you".
   */
  describe('turn state', () => {
    const awaiting = (): boolean | undefined => getSessionRow(ctx, sessionId)?.awaitingInput

    it('starts out working — a fresh session has not stopped for anyone', () => {
      expect(awaiting()).toBe(false)
    })

    it('marks the session awaiting input when the agent stops, answering {}', async () => {
      const { json } = await post(mount(), 'stop', {
        sessionId,
        payload: { hook_event_name: 'Stop', stop_hook_active: false },
      })

      expect(json).toEqual({})
      expect(awaiting()).toBe(true)
    })

    it('marks the agent working again when a prompt is submitted', async () => {
      await post(mount(), 'stop', { sessionId, payload: { hook_event_name: 'Stop' } })
      await post(mount(), 'user-prompt', {
        sessionId,
        payload: { hook_event_name: 'UserPromptSubmit', prompt: 'carry on' },
      })

      expect(awaiting()).toBe(false)
    })

    // The ordering hazard: the two hooks interleave, and a prompt arriving after
    // a Stop is the human answering — which is the agent working again.
    it('lets the last hook win across a whole conversation', async () => {
      const stop = (): Promise<unknown> =>
        post(mount(), 'stop', { sessionId, payload: { hook_event_name: 'Stop' } })
      const prompt = (): Promise<unknown> =>
        post(mount(), 'user-prompt', {
          sessionId,
          payload: { hook_event_name: 'UserPromptSubmit', prompt: 'more' },
        })

      await prompt()
      await stop()
      await prompt()
      expect(awaiting()).toBe(false)
      await stop()
      expect(awaiting()).toBe(true)
    })

    // The feature header's status line reads this bit (agent working vs. ready
    // for you), so a flip has to reach the browser on the push, not the 30s
    // safety poll — and an unchanged bit pushes nothing.
    it('pushes a live signal when the turn state flips, and only then', async () => {
      const signals: LiveSignal[] = []
      const unsubscribe = subscribeLive((s) => signals.push(s))
      try {
        await post(mount(), 'stop', { sessionId, payload: { hook_event_name: 'Stop' } })
        expect(signals).toEqual([{ kind: 'turn', sessionId }])
        await post(mount(), 'stop', { sessionId, payload: { hook_event_name: 'Stop' } })
        expect(signals).toHaveLength(1)
        await post(mount(), 'user-prompt', {
          sessionId,
          payload: { hook_event_name: 'UserPromptSubmit', prompt: 'more' },
        })
        expect(signals.filter((s) => s.kind === 'turn')).toHaveLength(2)
      } finally {
        unsubscribe()
      }
    })

    it('returns {} for a stop on an unknown session', async () => {
      const { json } = await post(mount(), 'stop', {
        sessionId: 'sess_does_not_exist',
        payload: { hook_event_name: 'Stop' },
      })
      expect(json).toEqual({})
    })

    it('tracks a project-scoped conversation the same way', async () => {
      const project = createSessionRow(ctx, {
        projectId: seedProject(ctx).id,
        kind: 'project',
        worktreePath: 'C:\\wt\\proj',
      })

      await post(mount(), 'stop', { sessionId: project.id, payload: { hook_event_name: 'Stop' } })
      expect(getSessionRow(ctx, project.id)?.awaitingInput).toBe(true)

      await post(mount(), 'user-prompt', {
        sessionId: project.id,
        payload: { hook_event_name: 'UserPromptSubmit', prompt: 'hi' },
      })
      expect(getSessionRow(ctx, project.id)?.awaitingInput).toBe(false)
    })
  })
})

/**
 * The featureless sessions (the orchestrator, and a scenario chat on a project
 * drive) share this branch of the route, and each is briefed as itself.
 * Observed live: a `project` session opened by measuring setup/verify commands
 * instead of engaging the human, because the branch once handed it a bare
 * preparation agenda rather than the facts its opening turns on.
 */
describe('hooks route, project-scoped sessions', () => {
  let ctx: AppCtx
  let projectId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    projectId = seedProject(ctx).id
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  function projectScopedSession(kind: SessionKind): string {
    return createSessionRow(ctx, { projectId, kind, worktreePath: 'C:\\wt\\proj' }).id
  }

  /**
   * Decision 3: the orchestrator's start note carries the three facts its
   * opening turns on — open keys, an empty repo, a feature ever — and only a new
   * project with code and open keys is prepared first.
   */
  describe("an orchestrator's start note", () => {
    async function startNote(): Promise<string> {
      const { json } = await post(mount(), 'session-start', {
        sessionId: projectScopedSession('project'),
        payload: { session_id: 'cc-p1', hook_event_name: 'SessionStart', source: 'startup' },
      })
      expect(json.hookSpecificOutput.hookEventName).toBe('SessionStart')
      return json.hookSpecificOutput.additionalContext
    }

    function giveTheRepoCode(): void {
      const project = getProjectById(ctx, projectId)!
      writeFileSync(join(project.repoPath, 'index.ts'), 'export {}\n')
    }

    it('on a new project with code and open keys, says to prepare first', async () => {
      giveTheRepoCode()
      const note = await startNote()
      expect(note).toContain('[runcastle] orchestrator for test')
      expect(note).toMatch(/Open prepared keys: .*devCommand/)
      expect(note).toContain('Repo: has code.')
      expect(note).toContain('Features: none ever.')
      expect(note).toContain('prepare first')
    })

    it('on a project that has had features, offers in one line instead of taking over', async () => {
      giveTheRepoCode()
      seedFeature(ctx, projectId, { slug: 'shipped' })
      const note = await startNote()
      expect(note).toContain('Features: this project has had features.')
      expect(note).toContain('one line offering to set up the open keys')
      expect(note).not.toContain('prepare first')
    })

    it('on an empty repo, opens as usual', async () => {
      const note = await startNote()
      expect(note).toContain('Repo: empty.')
      expect(note).toContain('Opening (your skill\'s §0): open as usual.')
    })

    it('with every key closed, has nothing open and opens as usual', async () => {
      giveTheRepoCode()
      const project = getProjectById(ctx, projectId)!
      for (const key of keysToPrepare(ctx, project)) {
        recordFinding(ctx, projectId, { key, value: '', source: 'session', evidence: 'not used here' })
      }
      const note = await startNote()
      expect(note).toContain('Open prepared keys: none.')
      expect(note).toContain('open as usual.')
    })

    it('ends with the one line that loads every orchestrator tool', async () => {
      const note = await startNote()
      const tools = toolsForAudience('project').map((n) => `mcp__runcastle__${n}`)
      expect(note.split('\n').at(-1)).toBe(`Load your runcastle tools once: ToolSearch "select:${tools.join(',')}"`)
    })
  })

  it('an orchestrator still gets the whole lifecycle', async () => {
    const sessionId = projectScopedSession('project')
    await post(mount(), 'session-start', {
      sessionId,
      payload: {
        session_id: 'cc-p2',
        transcript_path: '/tmp/p.jsonl',
        hook_event_name: 'SessionStart',
        source: 'startup',
      },
    })

    const live = getSessionRow(ctx, sessionId)
    expect(live?.status).toBe('live')
    expect(live?.ccSessionId).toBe('cc-p2')
    expect(live?.transcriptPath).toBe('/tmp/p.jsonl')

    const { json } = await post(mount(), 'session-end', {
      sessionId,
      payload: { hook_event_name: 'SessionEnd' },
    })
    expect(json).toEqual({})
    expect(getSessionRow(ctx, sessionId)?.status).toBe('ended')
  })

  it('labels an orchestrator as one on every turn', async () => {
    const { json } = await post(mount(), 'user-prompt', {
      sessionId: projectScopedSession('project'),
      payload: { hook_event_name: 'UserPromptSubmit', prompt: 'hi' },
    })
    expect(json.hookSpecificOutput.additionalContext).toBe('[runcastle] orchestrator')
  })

  it('announces each kind by its own name in its lifecycle events', async () => {
    for (const [kind, noun] of [
      ['project', 'orchestrator'],
      ['scenario', 'scenario chat'],
    ] as const) {
      const sessionId = projectScopedSession(kind)
      const before = listByProject(ctx, projectId, 0).at(-1)?.id ?? 0
      await post(mount(), 'session-start', {
        sessionId,
        payload: { session_id: `cc-${kind}`, hook_event_name: 'SessionStart', source: 'startup' },
      })
      await post(mount(), 'session-end', { sessionId, payload: { hook_event_name: 'SessionEnd' } })

      const messages = listByProject(ctx, projectId, before).map((e) => e.message)
      expect(messages).toEqual([`${noun} live`, `${noun} ended`])
    }
  })
})
