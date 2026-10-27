import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntime, Feature, Project } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { Hono } from 'hono'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { GateError } from '../src/errors'
import { evaluateEditGuard } from '../src/launcher/edit-guard'
import { evaluateInstallGuard } from '../src/launcher/install-guard'
import {
  launchDriveFixSession,
  launchSession,
  launchSideSession,
  type LaunchSessionInput,
} from '../src/launcher/launcher'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import {
  activeSessionsForFeature,
  createSessionRow,
  getSessionRow,
  kickoffLineFor,
  markSessionEnded,
  markSessionLive,
  newestThread,
} from '../src/launcher/sessions'
import { toolDispatchRound, toolsForAudience } from '../src/mcp/server'
import hooksApp from '../src/routes/hooks'
import { promptMatchesKickoff } from '../src/services/conversations'
import { stopAllDocsWatch } from '../src/services/docs-watch'
import { listAfter } from '../src/services/events'
import { deleteFeature } from '../src/services/features'
import { recordFinding } from '../src/services/findings'
import { __resetTestDriveState, createFeatureBranch, testDrive } from '../src/services/git'
import { deliverToLead } from '../src/services/lead-delivery'
import { openProject } from '../src/services/projects'
import { getProjectById, listSessionsByFeature } from '../src/services/repo'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import type { AgentHost } from '../src/threads/types'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'
import { acpLaunchOf, briefOf, kickoffOf, promptsOf } from './support/thread-launch'

/**
 * Side sessions (several-sessions-per-feature): an extra conversation on a
 * feature, opened beside the main chat. It starts fresh, works in the talk
 * worktree under the main chat's write rules, never takes or waits on the
 * feature's main chat, and never runs rounds — every lookup keyed on the
 * `chat` kind keeps finding the main chat alone. Since chat-as-web-components
 * it is a thread: its kickoff is its first prompt, and a reopen just opens it.
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

const SIDE_OPENING = 'Proceed as a side session'

let ctx: AppCtx
let project: Project
let restoreDataDir: () => void
let fake: FakeAcp
let host: AgentHost

beforeEach(async () => {
  restoreDataDir = useDataDir(mkTmp('rc-side-home-'))
  ctx = await makeTestCtx()
  const repo = mkTmp('rc-side-repo-')
  const g = simpleGit(repo)
  await g.init(['-b', 'main'])
  await g.addConfig('user.email', 'test@runcastle.dev')
  await g.addConfig('user.name', 'Runcastle Test')
  await g.addConfig('core.autocrlf', 'false')
  writeFileSync(join(repo, 'README.md'), 'base\n')
  await g.add(['README.md'])
  await g.commit('initial commit')
  project = await openProject(ctx, repo)
  setRuntimeCtx(ctx)
  fake = createFakeAcp()
  host = createAgentHost({ ctx, transport: fake.transport, launch: FAKE_LAUNCH })
  setAgentHostForTests(host)
})

afterEach(async () => {
  await host.stopAll('shutdown')
  setAgentHostForTests(undefined)
  vi.restoreAllMocks()
  clearRuntimeCtx()
  stopAllDocsWatch()
  __resetTestDriveState()
  restoreDataDir()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function feature(slug: string, overrides: Partial<Feature> = {}): Promise<Feature> {
  const f = seedFeature(ctx, project.id, { slug, ...overrides })
  await createFeatureBranch(project, slug, 'main')
  tmpDirs.push(worktreeDir(project.id, slug))
  return f
}

function useRuntime(runtime: AgentRuntime): void {
  const id = runtime === 'codex' ? 'gpt-5.6-sol' : 'claude-sonnet-5'
  ctx.config = { ...ctx.config, model: id, models: [{ id, runtime }] }
}

async function openSide(featureId: string, reopenSessionId?: string): Promise<string> {
  const { sessionId } = await launchSideSession(
    ctx,
    { featureId, ...(reopenSessionId ? { reopenSessionId } : {}) },
    { spawn: false },
  )
  tmpDirs.push(sessionDir(sessionId))
  return sessionId
}

async function launch(
  featureId: string,
  input: Partial<Omit<LaunchSessionInput, 'featureId' | 'kind'>> = {},
): Promise<string> {
  const { sessionId } = await launchSession(ctx, { featureId, kind: 'chat', ...input }, { spawn: false })
  tmpDirs.push(sessionDir(sessionId))
  return sessionId
}

/** A main chat whose conversation the CLI recorded; ended unless said otherwise. */
async function mainChat(featureId: string, ccSessionId: string, opts: { live?: boolean } = {}): Promise<string> {
  const id = await launch(featureId)
  markSessionLive(ctx, id, { ccSessionId })
  if (!opts.live) markSessionEnded(ctx, id)
  return id
}

describe('opening a side session', () => {
  for (const runtime of ['claude-code', 'codex'] as const) {
    it(`starts a fresh conversation on ${runtime}, briefed with its role and the feature state`, async () => {
      useRuntime(runtime)
      const f = await feature(`fresh-${runtime}`)
      const chat = await mainChat(f.id, 'cc-main')

      const side = await openSide(f.id)

      expect(side).not.toBe(chat)
      expect(getSessionRow(ctx, side)?.ccSessionId).toBeUndefined()
      const kickoff = kickoffOf(side)
      expect(promptsOf(side)[0]).toMatchObject({ source: 'runcastle' })
      expect(kickoff).toContain(`[runcastle] ${SIDE_OPENING}: you are a side session of this feature`)
      expect(kickoff).toContain('Feature status: Talking with you;')
      expect(kickoff).toContain("Wait for the human's ask.")
      // Recognised as runcastle's kickoff, so titles and transcripts can drop it.
      expect(promptMatchesKickoff(kickoffLineFor('side', undefined, runtime), kickoff)).toBe(true)
      expect(getSessionRow(ctx, side)).toMatchObject({ kind: 'side', openedBeside: chat })
      expect(listAfter(ctx, f.id, 0).find((e) => e.type === 'session.side_opened')?.data).toEqual({
        sessionId: side,
        openedBeside: chat,
        reopened: false,
      })
    })

    it(`reopens on ${runtime} as the same thread, saying nothing`, async () => {
      useRuntime(runtime)
      const f = await feature(`reopen-${runtime}`)
      await mainChat(f.id, 'cc-main')
      const first = await openSide(f.id)
      markSessionLive(ctx, first, { ccSessionId: 'cc-side' })
      markSessionEnded(ctx, first)

      const again = await launchSideSession(ctx, { featureId: f.id, reopenSessionId: first }, { spawn: false })

      expect(again).toEqual({ sessionId: first, resumed: true })
      expect(promptsOf(first)).toHaveLength(1)
      expect(getSessionRow(ctx, first)?.ccSessionId).toBe('cc-side')
    })
  }

  it('records no main chat when the feature has none yet', async () => {
    const f = await feature('no-chat')
    const side = await openSide(f.id)
    expect(getSessionRow(ctx, side)?.openedBeside).toBeUndefined()
    expect(listAfter(ctx, f.id, 0).find((e) => e.type === 'session.side_opened')?.data).toMatchObject({
      openedBeside: null,
    })
  })

  it('refuses to reopen a session that is not one of the feature’s side sessions', async () => {
    const f = await feature('not-side')
    const chat = await mainChat(f.id, 'cc-main')
    await expect(launchSideSession(ctx, { featureId: f.id, reopenSessionId: chat }, { spawn: false })).rejects.toThrow(
      GateError,
    )
  })

  it('works in the talk worktree, as the main chat does', async () => {
    const f = await feature('worktree')
    const side = await openSide(f.id)
    expect(getSessionRow(ctx, side)?.worktreePath).toBe(worktreeDir(project.id, f.slug))
  })

  it('carries its role, its one limit, the shared folder and the wait in its system prompt', async () => {
    const f = await feature('prompt')
    const side = await openSide(f.id)
    const prompt = await briefOf(ctx, side)
    expect(prompt).toContain(`You are a **side session** of feature \`${f.slug}\``)
    expect(prompt).toContain('alone dispatches, stops and declares ready')
    expect(prompt).toContain('The folder is shared with the main chat')
    expect(prompt).toContain('never `git add -A`')
    expect(prompt).toContain("Wait for the human's ask")
    expect(prompt).toContain('You may change code in this checkout')
  })

  it('works unprompted whatever the feature is doing, like the lead', async () => {
    const fresh = await feature('perm-fresh')
    const building = await feature('perm-building', {})
    for (const f of [fresh, building]) {
      const spec = await acpLaunchOf(ctx, await openSide(f.id))
      expect(spec.sessionMode).toBe('bypassPermissions')
    }
  })
})

describe('a side session never blocks and is never blocked', () => {
  it('opens while the main chat is running or ended — any number at once', async () => {
    const live = await feature('beside-live')
    await mainChat(live.id, 'cc-live', { live: true })
    await openSide(live.id)
    await openSide(live.id)
    expect(listSessionsByFeature(ctx, live.id).filter((s) => s.kind === 'side')).toHaveLength(2)

    const ended = await feature('beside-ended')
    await mainChat(ended.id, 'cc-ended')
    await expect(openSide(ended.id)).resolves.toBeTruthy()
  })

  it('lets the chat and a self-planning run launch while it is up', async () => {
    const chatFeature = await feature('let-chat')
    const side = await openSide(chatFeature.id)
    markSessionLive(ctx, side, { ccSessionId: 'cc-side' })
    const chat = await launch(chatFeature.id)
    expect(chat).not.toBe(side)
    expect(getSessionRow(ctx, chat)?.kind).toBe('chat')

    const plan = await feature('let-self-plan')
    await openSide(plan.id)
    await expect(launch(plan.id, { purpose: 'self-plan' })).resolves.toBeTruthy()
  })

  it('lets a drive-fix session open on a failed drive', async () => {
    const f = await feature('let-drive-fix')
    await openSide(f.id)
    recordFinding(ctx, project.id, {
      key: 'driveSetupCommand',
      value: 'echo could-not-reach-postgres && exit 3',
      source: 'session',
    })
    project = getProjectById(ctx, project.id) ?? project
    const start = await testDrive(ctx, project, f, 'start')
    expect(start.hookFailure).toBeDefined()

    const { sessionId } = await launchDriveFixSession(ctx, { featureId: f.id }, { spawn: false })
    tmpDirs.push(sessionDir(sessionId))
    expect(getSessionRow(ctx, sessionId)?.kind).toBe('drive-fix')
  })
})

describe('the main chat stays the main chat', () => {
  it('the Chat door and the lead skip a side session', async () => {
    const f = await feature('lookups', {})
    const chat = await mainChat(f.id, 'cc-main')
    const side = await openSide(f.id)
    markSessionLive(ctx, side, { ccSessionId: 'cc-side' })

    expect(newestThread(ctx, { featureId: f.id }, 'chat')?.id).toBe(chat)

    // The Chat door reopens the main chat's thread, not a side one.
    expect(await launch(f.id)).toBe(chat)

    // Go or a round's message reaches the main chat, never the side session.
    await deliverToLead(ctx, f, { text: 'Round 1 returned', source: 'runcastle' })
    const queued = listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.message_queued')
    expect(queued?.data).toMatchObject({ sessionId: chat, route: 'prompt' })
    expect(promptsOf(chat).at(-1)?.text).toBe('[runcastle] Round 1 returned')
    expect(promptsOf(side)).toHaveLength(1)
  })

  it('stays the lead after a /clear moved its row onto a new conversation', async () => {
    const f = await feature('after-clear', {})
    const chat = await mainChat(f.id, 'cc-before-clear', { live: true })
    const side = await openSide(f.id)
    markSessionLive(ctx, side, { ccSessionId: 'cc-side' })

    const app = new Hono()
    app.route('/api/hooks', hooksApp)
    await app.request('/api/hooks/session-start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'session-start',
        sessionId: chat,
        payload: { session_id: 'cc-after-clear', hook_event_name: 'SessionStart', source: 'clear' },
      }),
    })
    expect(getSessionRow(ctx, chat)?.ccSessionId).toBe('cc-after-clear')

    await deliverToLead(ctx, f, { text: 'Round 1 returned', source: 'runcastle' })
    const queued = listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.message_queued')
    expect(queued?.data).toMatchObject({ sessionId: chat })
    expect(newestThread(ctx, { featureId: f.id }, 'chat')).toMatchObject({ id: chat, ccSessionId: 'cc-after-clear' })
  })
})

describe('what a side session may write', () => {
  const worktreePath = '/wt/feat'
  const doc = 'docs/features/feat/spec.md'
  const code = 'src/app.ts'

  function edit(kind: 'chat' | 'side', filePath: string) {
    return evaluateEditGuard({ kind, toolName: 'Edit', filePath, worktreePath, featureSlug: 'feat' })
  }

  function install(kind: 'chat' | 'side') {
    return evaluateInstallGuard({
      kind,
      toolName: 'Bash',
      command: 'bun install',
      worktreePath,
      talkWorktreePath: worktreePath,
    })
  }

  // Every feature chat is the lead and writes code and installs; a side session
  // follows the main chat exactly.
  it('writes docs and code — exactly as the main chat', () => {
    for (const kind of ['chat', 'side'] as const) {
      expect(edit(kind, doc)).toBeNull()
      expect(edit(kind, code)).toBeNull()
    }
  })

  it('installs, exactly as the main chat', () => {
    for (const kind of ['chat', 'side'] as const) {
      expect(install(kind)).toBeNull()
    }
  })

  it('stays out of a session kind that is neither: drive-fix keeps its narrow paths', () => {
    expect(evaluateEditGuard({ kind: 'drive-fix', toolName: 'Edit', filePath: code, worktreePath, featureSlug: 'feat' })).not.toBeNull()
  })

  it('is held by the lead’s line guard, like the main chat', async () => {
    const f = await feature('line-guard', {})
    const side = await openSide(f.id)
    const app = new Hono()
    app.route('/api/hooks', hooksApp)
    const res = await app.request('/api/hooks/pre-tool', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'pre-tool',
        sessionId: side,
        payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push origin main' } },
      }),
    })
    const json = (await res.json()) as { hookSpecificOutput?: { permissionDecision?: string } }
    expect(json.hookSpecificOutput?.permissionDecision).toBe('deny')
  })

  it('labels every turn role=side', async () => {
    const f = await feature('label')
    const side = await openSide(f.id)
    const app = new Hono()
    app.route('/api/hooks', hooksApp)
    const res = await app.request('/api/hooks/user-prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'user-prompt',
        sessionId: side,
        payload: { hook_event_name: 'UserPromptSubmit', prompt: 'what is decision 4?' },
      }),
    })
    const json = (await res.json()) as { hookSpecificOutput: { additionalContext: string } }
    expect(json.hookSpecificOutput.additionalContext).toBe(
      `[runcastle] feature=${f.slug} status=Talking with you tickets=0 role=side`,
    )
  })
})

describe('the tools a side session gets', () => {
  it('every chat tool but the four round tools', () => {
    const side = toolsForAudience('side')
    for (const tool of [
      'get_feature_context',
      'read_feature_doc',
      'list_tickets',
      'get_ticket',
      'emit_tickets',
      'update_ticket',
      'cancel_ticket',
      'resolve_finding',
      'create_feature',
      'record_event',
    ]) {
      expect(side).toContain(tool)
    }
    for (const tool of ['dispatch_round', 'stop_round', 'declare_ready', 'wait_for_you']) {
      expect(side).not.toContain(tool)
      expect(toolsForAudience('chat')).toContain(tool)
    }
  })

  it('is refused a round at call time, pointed at the main chat', async () => {
    const f = seedFeature(ctx, project.id, { slug: 'no-rounds' })
    const side = createSessionRow(ctx, { featureId: f.id, kind: 'side', worktreePath: '/wt' })
    expect(() => toolDispatchRound(ctx, side, { seqs: [1] })).toThrow(/main chat/)
  })
})

describe('deleting a feature', () => {
  it('stops its running side threads along with the main chat', async () => {
    const f = await feature('deleted')
    const chat = await mainChat(f.id, 'cc-main', { live: true })
    const sides = [await openSide(f.id), await openSide(f.id)]
    for (const id of [chat, ...sides]) await host.prompt(id, { text: 'hi' }, { source: 'human' })
    expect(fake.processes).toHaveLength(3)

    // The rows go with the feature, so what is observable is each process stopped.
    await deleteFeature(ctx, f.id)
    await vi.waitFor(() => expect(fake.processes.every((p) => p.killed)).toBe(true))
    expect([chat, ...sides].some((id) => host.isRunning(id))).toBe(false)
    expect(listSessionsByFeature(ctx, f.id)).toEqual([])
  })
})

describe('what a new side session knows of the main chat', () => {
  const claudeLine = (role: 'user' | 'assistant', text: string): string =>
    JSON.stringify({ type: role, message: { content: text } })
  const codexLine = (role: 'user' | 'assistant', text: string): string =>
    JSON.stringify({
      type: 'response_item',
      payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] },
    })

  function transcript(runtime: AgentRuntime, turns: Array<['user' | 'assistant', string]>): string {
    const path = join(mkTmp('rc-side-tr-'), 'main.jsonl')
    const line = runtime === 'codex' ? codexLine : claudeLine
    writeFileSync(path, `${turns.map(([r, t]) => line(r, t)).join('\n')}\n`)
    return path
  }

  for (const runtime of ['claude-code', 'codex'] as const) {
    it(`carries the role, state, marked quote and both paths on ${runtime}`, async () => {
      useRuntime(runtime)
      const f = await feature(`excerpt-${runtime}`)
      const chat = await mainChat(f.id, 'cc-main')
      const path = transcript(runtime, [
        ['user', kickoffLineFor('chat', undefined, runtime)],
        ['user', 'lets talk about the cache'],
        ['assistant', 'the cache should expire hourly'],
      ])
      markSessionLive(ctx, chat, { transcriptPath: path })

      const text = kickoffOf(await openSide(f.id))

      expect(text).toContain(SIDE_OPENING)
      expect(text).toContain('Feature status: Talking with you;')
      expect(text).toContain('not the human speaking to you now')
      expect(text).toContain('Human: lets talk about the cache')
      expect(text).toContain('Assistant: the cache should expire hourly')
      expect(text).not.toContain(kickoffLineFor('chat', undefined, runtime).slice(0, 40))
      expect(text).toContain(path)
      expect(text).toContain(join('docs', 'features', `excerpt-${runtime}`, 'decisions.md'))
    })
  }

  it('drops the oldest turns first to fit the cap', async () => {
    const f = await feature('capped')
    const chat = await mainChat(f.id, 'cc-main')
    const turns: Array<['user' | 'assistant', string]> = []
    for (let i = 0; i < 12; i++) turns.push([i % 2 ? 'assistant' : 'user', `turn-${i} ${'x'.repeat(1500)}`])
    markSessionLive(ctx, chat, { transcriptPath: transcript('claude-code', turns) })

    const side = await openSide(f.id)

    // 12 × 1.5k characters is over the cap, and a capped quote this long rides a file.
    const quote = readFileSync(join(sessionDir(side), 'main-chat-excerpt.md'), 'utf8')
    expect(quote).not.toContain('turn-0 ')
    expect(quote).toContain('turn-11')
    expect(quote.length).toBeLessThanOrEqual(8_100)
  })

  it('writes a quote too long for argv to a file in the artifacts dir and points at it', async () => {
    const f = await feature('long')
    const chat = await mainChat(f.id, 'cc-main')
    markSessionLive(ctx, chat, {
      transcriptPath: transcript('claude-code', [
        ['user', 'a'.repeat(2400)],
        ['assistant', 'b'.repeat(2400)],
        ['user', 'c'.repeat(2400)],
      ]),
    })

    const side = await openSide(f.id)
    const text = kickoffOf(side)

    const file = join(sessionDir(side), 'main-chat-excerpt.md')
    expect(text).toContain(file)
    expect(text).not.toContain('b'.repeat(100))
    expect(readFileSync(file, 'utf8')).toContain('c'.repeat(2400))
  })

  it('says so in a line when there is no main chat, or nothing on disk', async () => {
    const f = await feature('nothing')
    expect(kickoffOf(await openSide(f.id))).toContain('nothing on record to quote')
    await mainChat(f.id, 'cc-main')
    expect(kickoffOf(await openSide(f.id))).toContain('nothing on record to quote')
  })

  it('quotes only the turns since a /clear', async () => {
    const f = await feature('cleared')
    const chat = await mainChat(f.id, 'cc-before', { live: true })
    const before = transcript('claude-code', [['user', 'old talk about pears']])
    // How Claude Code opens a post-clear transcript: the command, then its output.
    const after = transcript('claude-code', [
      ['user', '<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>'],
      ['user', '<local-command-stdout></local-command-stdout>'],
      ['user', 'fresh talk about plums'],
    ])
    markSessionLive(ctx, chat, { transcriptPath: before })
    const app = new Hono()
    app.route('/api/hooks', hooksApp)
    await app.request('/api/hooks/session-start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event: 'session-start',
        sessionId: chat,
        payload: {
          session_id: 'cc-after',
          transcript_path: after,
          hook_event_name: 'SessionStart',
          source: 'clear',
        },
      }),
    })

    const text = kickoffOf(await openSide(f.id))

    expect(text).toContain('Human: fresh talk about plums')
    expect(text).not.toContain('pears')
    expect(text).not.toContain('<command-name>')
    expect(text).not.toContain('<local-command-stdout>')
  })
})
