import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntime, Feature, Project } from '@runcastle/core'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { Hono } from 'hono'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { evaluateEditGuard } from '../src/launcher/edit-guard'
import { evaluateInstallGuard } from '../src/launcher/install-guard'
import { launchSession, type LaunchSessionInput } from '../src/launcher/launcher'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, kickoffLineFor, markSessionEnded, markSessionLive, newestThread } from '../src/launcher/sessions'
import { toolDeclareReady, toolsForAudience } from '../src/mcp/server'
import hooksApp from '../src/routes/hooks'
import { stopAllDocsWatch } from '../src/services/docs-watch'
import { listAfter } from '../src/services/events'
import { __resetTestDriveState, createFeatureBranch } from '../src/services/git'
import { deliverToLead } from '../src/services/lead-delivery'
import { mainChatContext } from '../src/services/main-chat-excerpt'
import { openProject } from '../src/services/projects'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import type { AgentHost } from '../src/threads/types'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { seedFeature } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'
import { promptsOf } from './support/thread-launch'

/**
 * Old side chats (several-sessions-per-feature, retired by interactive-workers
 * decisions 7 and 23): nothing makes or reopens one any more (thread-launch and
 * thread-controls cover the refusals), but the rows made before stay. Every
 * lookup keyed on the `chat` kind keeps finding the main chat alone beside
 * them, and the rules they ran under stay as they were. The main chat's quote,
 * which side chats were the first to carry, is read here at its own seam.
 */

const tmpDirs: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

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

/** A side chat from before workers, its conversation recorded as `ccSessionId`. */
function oldSide(featureId: string, ccSessionId: string): string {
  const { id } = createSessionRow(ctx, { featureId, kind: 'side', worktreePath: worktreeDir(project.id, 'side') })
  markSessionLive(ctx, id, { ccSessionId })
  return id
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

describe('the main chat stays the main chat beside an old side chat', () => {
  it('the Chat door and the lead skip it', async () => {
    const f = await feature('lookups', {})
    const chat = await mainChat(f.id, 'cc-main')
    const side = oldSide(f.id, 'cc-side')

    expect(newestThread(ctx, { featureId: f.id }, 'chat')?.id).toBe(chat)

    // The Chat door reopens the main chat's thread, not the side one.
    expect(await launch(f.id)).toBe(chat)

    // A round's message reaches the main chat, never the side chat.
    await deliverToLead(ctx, f, { text: 'Round 1 returned', source: 'runcastle' })
    const queued = listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.message_queued')
    expect(queued?.data).toMatchObject({ sessionId: chat, route: 'prompt' })
    expect(promptsOf(chat).at(-1)?.text).toBe('[runcastle] Round 1 returned')
    expect(promptsOf(side)).toHaveLength(0)
  })

  it('stays the lead after a /clear moved its row onto a new conversation', async () => {
    const f = await feature('after-clear', {})
    const chat = await mainChat(f.id, 'cc-before-clear', { live: true })
    oldSide(f.id, 'cc-side')

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

    await deliverToLead(ctx, f, { text: 'Round 1 returned', source: 'runcastle' })
    const queued = listAfter(ctx, f.id, 0).find((e) => e.type === 'lead.message_queued')
    expect(queued?.data).toMatchObject({ sessionId: chat })
    expect(newestThread(ctx, { featureId: f.id }, 'chat')).toMatchObject({ id: chat, ccSessionId: 'cc-after-clear' })
  })
})

describe('what a side session could write', () => {
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

  it('docs and code, and installs — exactly as the main chat', () => {
    for (const kind of ['chat', 'side'] as const) {
      expect(edit(kind, doc)).toBeNull()
      expect(edit(kind, code)).toBeNull()
      expect(install(kind)).toBeNull()
    }
  })

  it('stays out of a session kind that is neither: drive-fix keeps its narrow paths', () => {
    expect(evaluateEditGuard({ kind: 'drive-fix', toolName: 'Edit', filePath: code, worktreePath, featureSlug: 'feat' })).not.toBeNull()
  })
})

describe('the tools a side session had', () => {
  it('every chat tool but the lead’s own', () => {
    const side = toolsForAudience('side')
    for (const tool of ['get_feature_context', 'read_feature_doc', 'resolve_finding', 'record_event']) {
      expect(side).toContain(tool)
    }
    for (const tool of ['start_worker', 'declare_ready', 'wait_for_you']) {
      expect(side).not.toContain(tool)
      expect(toolsForAudience('chat')).toContain(tool)
    }
  })

  it('is refused a lead tool at call time, pointed at the main chat', async () => {
    const f = seedFeature(ctx, project.id, { slug: 'no-rounds' })
    const side = createSessionRow(ctx, { featureId: f.id, kind: 'side', worktreePath: '/wt' })
    expect(() => toolDeclareReady(ctx, side, { scenario: 'x' })).toThrow(/main chat/)
  })
})

describe('the main chat’s quote in a kickoff', () => {
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

  /** The quote as a kickoff opened on `f` carries it, after `HEADER`, written for a fresh session row. */
  const HEADER = 'HEADER'
  function quoted(f: Feature): { text: string; sessionId: string } {
    const sessionId = createSessionRow(ctx, { featureId: f.id, kind: 'scenario', worktreePath: '/wt' }).id
    tmpDirs.push(sessionDir(sessionId))
    return { text: mainChatContext(ctx, f, sessionId, HEADER), sessionId }
  }

  for (const runtime of ['claude-code', 'codex'] as const) {
    it(`carries the marked quote and both paths on ${runtime}`, async () => {
      useRuntime(runtime)
      const f = await feature(`excerpt-${runtime}`)
      const chat = await mainChat(f.id, 'cc-main')
      const path = transcript(runtime, [
        ['user', kickoffLineFor('chat', undefined, runtime)],
        ['user', 'lets talk about the cache'],
        ['assistant', 'the cache should expire hourly'],
      ])
      markSessionLive(ctx, chat, { transcriptPath: path })

      const { text } = quoted(f)

      expect(text.startsWith(HEADER)).toBe(true)
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

    const { sessionId } = quoted(f)

    // 12 × 1.5k characters is over the cap, and a capped quote this long rides a file.
    const quote = readFileSync(join(sessionDir(sessionId), 'main-chat-excerpt.md'), 'utf8')
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

    const { text, sessionId } = quoted(f)

    const file = join(sessionDir(sessionId), 'main-chat-excerpt.md')
    expect(text).toContain(file)
    expect(text).not.toContain('b'.repeat(100))
    expect(readFileSync(file, 'utf8')).toContain('c'.repeat(2400))
  })

  it('says so in a line when there is no main chat, or nothing on disk', async () => {
    const f = await feature('nothing')
    expect(quoted(f).text).toContain('nothing on record to quote')
    await mainChat(f.id, 'cc-main')
    expect(quoted(f).text).toContain('nothing on record to quote')
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

    const { text } = quoted(f)

    expect(text).toContain('Human: fresh talk about plums')
    expect(text).not.toContain('pears')
    expect(text).not.toContain('<command-name>')
    expect(text).not.toContain('<local-command-stdout>')
  })
})
