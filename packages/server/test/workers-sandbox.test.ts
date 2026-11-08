import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk/unstable'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolStartWorker, toolsForAudience } from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { list as listFeatures } from '../src/services/features'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import { readThreadEvents, type AgentHost } from '../src/threads/types'
import { setSandboxEngineForTests } from '../src/workers/engine'
import { getWorker, withWorkers, workerTurnSlot } from '../src/workers/service'
import { SETUP_MANAGED, claudeSetup, setupFingerprint } from '../src/workers/setup-copy'
import { serveToolRelay } from '../src/workers/tool-relay'
import { WORKER_MCP_SCRIPT, WORKER_RELAY_SCRIPT } from '../src/workers/worker-mcp-script'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'
import { fakeEngine, fakeHost, initRepo, type FakeEngine } from './support/fake-workers'

/**
 * A worker inside its sandbox (interactive-workers decisions 8, 9, 10, 11): the
 * human's setup the engine is asked to copy in, the permission mode and its
 * fallback, and runcastle's tools reached through the relay runcastle opens
 * into the container. No container: a fake engine, and the in-sandbox scripts
 * run as plain processes on a socket in a temp dir.
 */

let ctx: AppCtx
let data: string
let restoreDataDir: () => void
let repo: string
let feature: Feature
let lead: string
let engine: FakeEngine
let userHome: string

beforeEach(async () => {
  data = tmpRepo()
  restoreDataDir = useDataDir(data)
  ctx = await makeTestCtx()
  repo = initRepo('work')
  feature = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'work' })
  lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' }).id
  markSessionLive(ctx, lead, { ccSessionId: `cc-${lead}` })
  markSessionEnded(ctx, lead)
  engine = fakeEngine()
  setSandboxEngineForTests(engine)
  userHome = tmpRepo()
  vi.stubEnv('HOME', userHome)
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'test-token')
})

afterEach(() => {
  setAgentHostForTests(undefined)
  setSandboxEngineForTests(undefined)
  vi.unstubAllEnvs()
  restoreDataDir()
  rmTemp(data)
  rmTemp(repo)
  rmTemp(userHome)
})

function put(file: string, body: string | object): void {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body))
}

/** A human's home with everything a setup holds, the parts a worker must get and the parts it must not. */
function fakeUserHome(home: string): void {
  const c = join(home, '.claude')
  put(join(c, 'CLAUDE.md'), '# mine\n')
  put(join(c, 'rules', 'style.md'), 'short sentences\n')
  put(join(c, 'skills', 'grill', 'SKILL.md'), 'grill\n')
  put(join(c, 'agents', 'reviewer.md'), 'review\n')
  put(join(c, 'settings.json'), {
    model: 'opus',
    effortLevel: 'high',
    alwaysThinkingEnabled: true,
    enabledPlugins: { 'design@acme': true, 'old@acme': false },
    permissions: { allow: ['Bash(git status)'], deny: ['Read(.env)'], defaultMode: 'acceptEdits' },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: '/Users/me/hook.sh' }] }] },
    statusLine: { type: 'command', command: '/Users/me/status.sh' },
    env: { SECRET: 'x' },
  })
  const design = join(c, 'plugins', 'cache', 'acme', 'design', '1.0.0')
  const old = join(c, 'plugins', 'cache', 'acme', 'old', '1.0.0')
  put(join(design, 'plugin.json'), { name: 'design' })
  put(join(old, 'plugin.json'), { name: 'old' })
  put(join(c, 'plugins', 'installed_plugins.json'), {
    version: 2,
    plugins: { 'design@acme': [{ scope: 'user', installPath: design }], 'old@acme': [{ scope: 'user', installPath: old }] },
  })
  put(join(c, 'plugins', 'known_marketplaces.json'), {
    acme: { installLocation: join(c, 'plugins', 'marketplaces', 'acme') },
    other: { installLocation: join(c, 'plugins', 'marketplaces', 'other') },
  })
  put(join(c, '.credentials.json'), { claudeAiOauth: { accessToken: 'claude-login' }, mcpOAuth: { 'linear|abc': { accessToken: 'mcp-login' } } })
  put(join(c, 'projects', '-repo', 'conv.jsonl'), '{}\n')
  put(join(c, 'history.jsonl'), '{}\n')
  put(join(c, 'sessions', 's.json'), '{}')
  put(join(c, 'file-history', 'f'), 'x')
  put(join(home, '.claude.json'), {
    mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } },
    projects: { '/repo': { history: [] } },
    oauthAccount: { emailAddress: 'me@x' },
  })
}

describe("the human's setup in the sandbox", () => {
  it('copies CLAUDE.md, rules, skills, agents, enabled plugins, model and effort, MCP servers and their logins, and nothing else', () => {
    fakeUserHome(userHome)
    const setup = claudeSetup(userHome)
    const c = join(userHome, '.claude')
    expect(setup.files.map((f) => f.to).sort()).toEqual([
      '.claude/.credentials.json',
      '.claude/CLAUDE.md',
      '.claude/agents',
      '.claude/plugins/cache/acme/design/1.0.0',
      '.claude/plugins/installed_plugins.json',
      '.claude/plugins/known_marketplaces.json',
      '.claude/rules',
      '.claude/settings.json',
      '.claude/skills',
    ])
    const content = (to: string) => JSON.parse(setup.files.find((f) => f.to === to)!.content!)
    // Hooks, the status line and env stay on the host; the worker starts in auto mode over the human's default.
    expect(content('.claude/settings.json')).toEqual({
      model: 'opus',
      effortLevel: 'high',
      alwaysThinkingEnabled: true,
      enabledPlugins: { 'design@acme': true, 'old@acme': false },
      permissions: { allow: ['Bash(git status)'], deny: ['Read(.env)'], defaultMode: 'auto' },
    })
    // MCP logins only, never the human's Claude login.
    expect(content('.claude/.credentials.json')).toEqual({ mcpOAuth: { 'linear|abc': { accessToken: 'mcp-login' } } })
    // Only the enabled plugin, at the sandbox's home.
    expect(content('.claude/plugins/installed_plugins.json')).toEqual({
      version: 2,
      plugins: { 'design@acme': [{ scope: 'user', installPath: '/home/agent/.claude/plugins/cache/acme/design/1.0.0' }] },
    })
    expect(Object.keys(content('.claude/plugins/known_marketplaces.json'))).toEqual(['acme'])
    expect(setup.files.find((f) => f.to === '.claude/skills')?.from).toBe(join(c, 'skills'))
    expect(setup.mcpServers).toEqual({ linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } })
  })

  it('gives a human with no setup only the auto-mode settings', () => {
    expect(claudeSetup(userHome)).toEqual({
      files: [{ to: '.claude/settings.json', content: `${JSON.stringify({ permissions: { defaultMode: 'auto' } }, null, 2)}\n` }],
      mcpServers: {},
    })
  })

  it('is copied in at the start, skipped at a wake while it is unchanged, and copied again once it changed', async () => {
    fakeUserHome(userHome)
    const host = fakeHost()
    setAgentHostForTests(host.host)
    const { workerId } = await toolStartWorker(ctx, getSessionRow(ctx, lead)!, { label: 'Header', purpose: 'The header', kind: 'on-its-own', goal: 'Build it' })
    engine.transport = createFakeAcp().transport
    const transport = withWorkers(ctx, () => {
      throw new Error('only workers run here')
    })
    const row = getSessionRow(ctx, workerId)!
    await transport({} as never, row)
    await transport({} as never, row)
    const container = getWorker(ctx, workerId)!.container
    expect(engine.setups).toEqual([{ container, setup: claudeSetup(userHome), guard: true }])

    // A new skill reaches the worker at its next wake (decision 8).
    put(join(userHome, '.claude', 'skills', 'ship', 'SKILL.md'), 'ship\n')
    await transport({} as never, row)
    expect(engine.setups).toHaveLength(2)
    expect(engine.setups[1]).toEqual({ container, setup: claudeSetup(userHome), guard: true })
    expect(engine.processes).toHaveLength(3)
  })

  it('fingerprints a setup by its paths, sizes and times, so any change to it is seen', () => {
    fakeUserHome(userHome)
    const before = setupFingerprint(claudeSetup(userHome))
    expect(setupFingerprint(claudeSetup(userHome))).toBe(before)
    const skill = join(userHome, '.claude', 'skills', 'grill', 'SKILL.md')
    writeFileSync(skill, 'grill harder\n')
    const edited = setupFingerprint(claudeSetup(userHome))
    expect(edited).not.toBe(before)
    utimesSync(skill, new Date(2020, 0, 1), new Date(2020, 0, 1))
    expect(setupFingerprint(claudeSetup(userHome))).not.toBe(edited)
    // Claude Code's own bookkeeping, written as it runs, is no change to the setup.
    const synced = join(userHome, '.claude', 'skills', 'synced', 'account')
    put(join(synced, 'docx', 'SKILL.md'), 'docx\n')
    put(join(synced, 'manifest.json'), { round: 1 })
    const settled = setupFingerprint(claudeSetup(userHome))
    put(join(userHome, '.claude', 'plugins', 'cache', 'acme', 'design', '1.0.0', '.in_use', '4243'), 'pid')
    put(join(synced, 'manifest.json'), { round: 2, skills: ['docx'] })
    put(join(synced, '.last-complete-round'), 'later')
    expect(setupFingerprint(claudeSetup(userHome))).toBe(settled)
    // What runcastle writes counts by its content: the human's MCP servers here.
    put(join(userHome, '.claude.json'), { mcpServers: {} })
    expect(setupFingerprint(claudeSetup(userHome))).not.toBe(settled)
  })

  it('never clears the plugin marketplaces Claude Code cloned in the sandbox', () => {
    expect(SETUP_MANAGED).toContain('.claude/plugins/cache')
    const clone = '.claude/plugins/marketplaces/acme/.claude-plugin/marketplace.json'
    expect(SETUP_MANAGED.filter((managed) => clone === managed || clone.startsWith(`${managed}/`))).toEqual([])
  })
})

// --- the permission mode ------------------------------------------------------------

/** A real agent host over the fake ACP agent, the worker transport and the server's lifecycle. */
function realHost(fake: FakeAcp): AgentHost {
  engine.transport = fake.transport
  const host = createAgentHost({
    ctx,
    transport: withWorkers(ctx, () => {
      throw new Error('only workers run here')
    }),
    launch: FAKE_LAUNCH,
    lifecycle: threadLifecycle(ctx),
    turnSlot: workerTurnSlot(ctx),
    idleMs: 60_000,
  })
  setAgentHostForTests(host)
  return host
}

async function until(done: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms
  while (!done()) {
    if (Date.now() > deadline) throw new Error('never got there')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const bash: acp.ToolCallUpdate = { toolCallId: 'c1', title: 'Bash', kind: 'execute' }
const neon: acp.ToolCallUpdate = {
  toolCallId: 'c2',
  title: 'mcp__neon__run_sql',
  kind: 'other',
  _meta: { claudeCode: { toolName: 'mcp__neon__run_sql', mcpServer: { name: 'neon', source: 'user' } } },
}

/** A worker whose first turn asks to run `calls` in order, recording each answer the agent got. */
async function workerAsking(mode: string, calls: acp.ToolCallUpdate[]): Promise<{ id: string; host: AgentHost; answers: acp.RequestPermissionResponse[] }> {
  const answers: acp.RequestPermissionResponse[] = []
  const fake = createFakeAcp({
    mode,
    turn: async (t) => {
      for (const call of calls) answers.push(await t.permission(call))
      await t.say('Done.')
    },
  })
  const host = realHost(fake)
  const { workerId } = await toolStartWorker(ctx, getSessionRow(ctx, lead)!, { label: 'Data', purpose: 'The data', kind: 'on-its-own', goal: 'Do it' })
  return { id: workerId, host, answers }
}

const modeEvents = () =>
  listAfter(ctx, feature.id, 0)
    .filter((e) => e.type === 'worker.permission_mode')
    .map((e) => (e.data as { mode: string }).mode)

const asks = (id: string) => readThreadEvents(id).filter((e) => e.type === 'ask')

describe('the permission mode', () => {
  it('runs in auto mode when the session opens in it, and leaves whatever auto mode still asks to the human', async () => {
    const { id, host, answers } = await workerAsking('auto', [bash])
    await until(() => asks(id).length === 1)
    expect(answers).toEqual([])
    expect(modeEvents()).toEqual(['auto'])
    await host.stopAll('shutdown')
  })

  it('falls back when auto mode is unavailable: in-sandbox tools are allowed, a call to one of the human’s MCP servers asks', async () => {
    const { id, host, answers } = await workerAsking('acceptEdits', [bash, neon])
    await until(() => asks(id).length === 1)
    expect(answers).toEqual([{ outcome: { outcome: 'selected', optionId: expect.stringMatching(/allow/) } }])
    expect(asks(id)[0]).toMatchObject({ ask: { kind: 'approval', call: { title: 'mcp__neon__run_sql' } } })
    expect(modeEvents()).toEqual(['fallback'])
    // Halted on the human's answer, the worker reads as needing them.
    expect(getWorker(ctx, id)?.status).toBe('needs-you')
    await host.stopAll('shutdown')
  })
})

// --- runcastle's tools through the relay --------------------------------------------

/** Run one of the in-sandbox scripts as a plain process, on a socket in `dir`. */
function runScript(dir: string, name: string, body: string): ChildProcessWithoutNullStreams {
  const file = join(dir, name)
  writeFileSync(file, body)
  return spawn(process.execPath, [file], {
    env: {
      ...process.env,
      RUNCASTLE_TOOLS_SOCKET: join(dir, 'tools.sock'),
      RUNCASTLE_WORKER_STATE: join(dir, 'state'),
      RUNCASTLE_WORKER_REPO: join(dir, 'repo'),
    },
  })
}

/** Speak MCP to the worker's server: send one request, resolve with its response. */
function mcpClient(child: ChildProcessWithoutNullStreams): (method: string, params?: unknown) => Promise<{ result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] } }> {
  let buf = ''
  let next = 1
  const waiting = new Map<number, (msg: never) => void>()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buf += chunk
    let i = buf.indexOf('\n')
    while (i >= 0) {
      const msg = JSON.parse(buf.slice(0, i)) as { id: number }
      buf = buf.slice(i + 1)
      i = buf.indexOf('\n')
      waiting.get(msg.id)?.(msg as never)
    }
  })
  return (method, params) =>
    new Promise((resolve) => {
      const id = next++
      waiting.set(id, resolve)
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
}

describe("the worker's runcastle tools", () => {
  let dir: string
  let children: ChildProcessWithoutNullStreams[]

  beforeEach(() => {
    dir = tmpRepo()
    mkdirSync(join(dir, 'repo'), { recursive: true })
    children = []
  })
  afterEach(() => {
    for (const c of children) c.kill()
    rmTemp(dir)
  })

  it('are exactly hand_back, start_dev_server, read_feature, show_file and park_feature, and runcastle offers a worker none of its own', async () => {
    const mcp = runScript(dir, 'worker-mcp.cjs', WORKER_MCP_SCRIPT)
    children.push(mcp)
    const ask = mcpClient(mcp)
    const listed = await ask('tools/list')
    expect(listed.result?.tools?.map((t) => t.name)).toEqual(['hand_back', 'start_dev_server', 'read_feature', 'show_file', 'park_feature'])
    expect(toolsForAudience('worker')).toEqual([])
  })

  it('reach runcastle over the relay’s stdio and come back to the call that asked', async () => {
    const relay = runScript(dir, 'worker-relay.cjs', WORKER_RELAY_SCRIPT)
    children.push(relay)
    const calls: { tool: string; args: Record<string, unknown> }[] = []
    serveToolRelay(relay.stdout, relay.stdin, async (tool, args) => {
      calls.push({ tool, args })
      if (tool === 'park_feature') throw new Error('no project here')
      return `answer to ${tool}`
    })
    writeFileSync(join(dir, 'repo', 'shot.png'), 'png')
    const mcp = runScript(dir, 'worker-mcp.cjs', WORKER_MCP_SCRIPT)
    children.push(mcp)
    const ask = mcpClient(mcp)

    const [read, shown, parked] = await Promise.all([
      ask('tools/call', { name: 'read_feature', arguments: {} }),
      ask('tools/call', { name: 'show_file', arguments: { path: 'shot.png', caption: 'The header' } }),
      ask('tools/call', { name: 'park_feature', arguments: { title: 'Dark mode', oneLiner: 'A dark theme', brief: 'Later' } }),
    ])
    expect(read.result).toEqual({ content: [{ type: 'text', text: 'answer to read_feature' }] })
    expect(shown.result).toEqual({ content: [{ type: 'text', text: 'answer to show_file' }] })
    expect(parked.result).toEqual({ content: [{ type: 'text', text: 'no project here' }], isError: true })
    // show_file resolves the path inside the sandbox before asking.
    expect(calls).toContainEqual({ tool: 'show_file', args: { path: join(dir, 'repo', 'shot.png'), caption: 'The header' } })

    // A file that is not there never reaches runcastle.
    const missing = await ask('tools/call', { name: 'show_file', arguments: { path: 'nope.png' } })
    expect(missing.result?.isError).toBe(true)
    expect(calls).toHaveLength(3)
  })
})

describe("runcastle's answers to a worker's tools", () => {
  async function startedWorker(): Promise<string> {
    const host = fakeHost()
    setAgentHostForTests(host.host)
    const { workerId } = await toolStartWorker(ctx, getSessionRow(ctx, lead)!, { label: 'Header', purpose: 'The header', kind: 'with-you', goal: 'Build it' })
    engine.transport = createFakeAcp().transport
    await withWorkers(ctx, () => {
      throw new Error('only workers run here')
    })({} as never, getSessionRow(ctx, workerId)!)
    return workerId
  }

  it('show_file posts the sandbox’s file into the worker’s own chat', async () => {
    const id = await startedWorker()
    engine.sandboxFiles.set('/home/agent/repo/shots/header.png', 'png bytes')
    const answer = await engine.processes[0]!.tools('show_file', { path: '/home/agent/repo/shots/header.png', caption: 'The header' })
    expect(answer).toBe('Shown header.png in this chat.')
    const shown = readThreadEvents(id).filter((e) => e.type === 'file_shown')
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ file: { name: 'header.png', path: 'shots/header.png', caption: 'The header', size: 9 } })
    expect(readThreadEvents(lead).some((e) => e.type === 'file_shown')).toBe(false)
  })

  it('park_feature makes a draft backlog feature in the worker’s project', async () => {
    await startedWorker()
    const answer = await engine.processes[0]!.tools('park_feature', { title: 'Dark mode', oneLiner: 'A dark theme', brief: 'Deferred: not this feature.' })
    expect(answer).toMatch(/^Parked as a draft in the backlog: dark-mode\./)
    const parked = listFeatures(ctx, feature.projectId).find((f) => f.slug === 'dark-mode')
    expect(parked).toMatchObject({ title: 'Dark mode', status: 'draft' })
  })

  it('read_feature gives the feature’s state', async () => {
    await startedWorker()
    const answer = JSON.parse(await engine.processes[0]!.tools('read_feature', {})) as { feature: { feature: { slug: string } }; leadLatestTurns: unknown }
    expect(answer.feature.feature.slug).toBe('work')
    expect(answer).toHaveProperty('leadLatestTurns')
  })
})
