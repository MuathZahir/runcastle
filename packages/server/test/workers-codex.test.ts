import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type * as acp from '@agentclientprotocol/sdk/unstable'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Feature, foldThread } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolStartWorker } from '../src/mcp/server'
import { listAfter } from '../src/services/events'
import { createAgentHost, setAgentHostForTests } from '../src/threads/host'
import { threadLifecycle } from '../src/threads/lifecycle'
import { readThreadEvents, type AgentHost } from '../src/threads/types'
import { codexSetup } from '../src/workers/codex-setup'
import { setSandboxEngineForTests } from '../src/workers/engine'
import { getWorker, withWorkers, workerTurnSlot } from '../src/workers/service'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'
import { fakeEngine, fakeHost, initRepo, type FakeEngine } from './support/fake-workers'

/**
 * Codex workers (interactive-workers decisions 8, 11, 12): a worker on one of
 * the human's Codex models runs codex-acp inside its sandbox, gets the human's
 * Codex setup, runs in auto-review with the same fallback as Claude Code, and
 * resumes its conversation after an idle stop. No container: the fake engine
 * records the launch the real one would make.
 */

const CODEX_MODEL = 'gpt-5.6-sol'

let ctx: AppCtx
let data: string
let restoreDataDir: () => void
let repo: string
let feature: Feature
let lead: string
let engine: FakeEngine
let userHome: string
let codexHome: string

beforeEach(async () => {
  data = tmpRepo()
  restoreDataDir = useDataDir(data)
  ctx = await makeTestCtx()
  ctx.config = { ...ctx.config, models: [{ id: CODEX_MODEL, runtime: 'codex', note: 'background build work' }] }
  repo = initRepo('work')
  feature = seedFeature(ctx, seedProject(ctx, repo).id, { slug: 'work' })
  lead = createSessionRow(ctx, { featureId: feature.id, kind: 'chat', worktreePath: '/wt' }).id
  markSessionLive(ctx, lead, { ccSessionId: `cc-${lead}` })
  markSessionEnded(ctx, lead)
  engine = fakeEngine()
  setSandboxEngineForTests(engine)
  userHome = tmpRepo()
  codexHome = join(userHome, '.codex')
  vi.stubEnv('HOME', userHome)
  vi.stubEnv('CODEX_HOME', codexHome)
  // No Claude token anywhere: a Codex worker must not need one.
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '')
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

function put(file: string, body: string): void {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, body)
}

const HUMAN_CONFIG = [
  'model = "gpt-5.5"',
  'model_reasoning_effort = "high"',
  'approval_policy = "never"',
  'sandbox_mode = "danger-full-access"',
  'notify = ["/Users/me/bin/notify.sh"]',
  'model_instructions_file = "/Users/me/instructions.md"',
  'personality = "pragmatic"',
  '',
  '[projects."/Users/me/code/app"]',
  'trust_level = "trusted"',
  '',
  '[features]',
  'hooks = true',
  '',
  '[mcp_servers.linear]',
  'url = "https://mcp.linear.app/mcp"',
  '',
  '[mcp_servers.worker]',
  'command = "/Users/me/bin/other-worker"',
  '',
  '[mcp_servers.runcastle]',
  'url = "http://localhost:4512/mcp"',
  '',
  '[model_providers.proxy]',
  'base_url = "https://llm.example/v1"',
  '',
].join('\n')

/** A human's Codex home with what a worker must get and what it must not. */
function fakeCodexHome(): void {
  put(join(codexHome, 'AGENTS.md'), '# my rules\n')
  put(join(codexHome, 'skills', 'grill', 'SKILL.md'), 'grill\n')
  put(join(codexHome, 'prompts', 'review.md'), 'review\n')
  put(join(codexHome, 'rules', 'default.rules'), 'prefix_rule(pattern=["git"], decision="allow")\n')
  put(join(codexHome, 'config.toml'), HUMAN_CONFIG)
  put(join(codexHome, 'auth.json'), '{"tokens":{"access_token":"codex-login"}}')
  put(join(codexHome, '.credentials.json'), '{"linear":{"access_token":"mcp-login"}}')
  put(join(codexHome, 'hooks.json'), '{"hooks":{"Stop":[]}}')
  put(join(codexHome, 'sessions', '2026', '11', '01', 'rollout-x.jsonl'), '{}\n')
  put(join(codexHome, 'history.jsonl'), '{}\n')
  put(join(codexHome, 'log', 'codex-tui.log'), 'x')
}

const MCP = { command: 'node', args: ['/opt/runcastle/worker-mcp.cjs'], env: { WORKER_PORT: '41001', RUNCASTLE_TOOLS_SOCKET: '/home/agent/.runcastle/tools.sock' } }

async function startCodexWorker(kind: 'with-you' | 'on-its-own' = 'on-its-own'): Promise<string> {
  const { workerId } = await toolStartWorker(ctx, getSessionRow(ctx, lead)!, {
    label: 'Data',
    purpose: 'The data changes',
    kind,
    goal: 'Change the data',
    doneWhen: 'Tests pass',
    model: CODEX_MODEL,
  })
  return workerId
}

describe('starting a Codex worker', () => {
  it('starts through the sandbox engine with codex-acp running inside the container, and no Claude token', async () => {
    fakeCodexHome()
    setAgentHostForTests(fakeHost().host)
    const id = await startCodexWorker()
    expect(getWorker(ctx, id)).toMatchObject({ runtime: 'codex', model: CODEX_MODEL, status: 'working' })

    engine.transport = createFakeAcp().transport
    await withWorkers(ctx, () => {
      throw new Error('only workers run here')
    })({} as never, getSessionRow(ctx, id)!)

    const container = getWorker(ctx, id)!.container!
    const { execArgs, env, session } = engine.launches[0]!
    expect(execArgs.slice(0, 4)).toEqual(['exec', '-i', '-w', '/home/agent/repo'])
    expect(execArgs).toEqual(expect.arrayContaining(['CODEX_HOME=/home/agent/.codex', 'CODEX_PATH=codex', 'INITIAL_AGENT_MODE=agent', 'WORKER_PORT=41001']))
    expect(execArgs.slice(-3)).toEqual([container, 'node', '/opt/runcastle/codex-acp.mjs'])
    expect(execArgs.some((a) => a.startsWith('CLAUDE_CODE'))).toBe(false)
    expect(env).toEqual({})
    expect(session).toEqual({ cwd: '/home/agent/repo', mcpServers: [], mode: 'agent' })
    expect(engine.processes[0]?.token).toBeUndefined()
    expect(engine.processes[0]?.model).toBe(CODEX_MODEL)
    // The human's Codex setup went in first, not the Claude one.
    expect(engine.setups[0]?.setup.files.map((f) => f.to)).toContain('.codex/config.toml')
    expect(engine.setups[0]?.setup).not.toHaveProperty('mcpServers')
  })
})

describe("the human's Codex setup in the sandbox", () => {
  it('copies the instructions, skills, prompts, rules, logins and a worker config, and never hooks, history or rollouts', () => {
    fakeCodexHome()
    const setup = codexSetup(codexHome, { model: CODEX_MODEL, briefing: '# You are a runcastle worker: Data', mcp: MCP })
    expect(setup.files.map((f) => f.to).sort()).toEqual([
      '.codex/.credentials.json',
      '.codex/AGENTS.md',
      '.codex/auth.json',
      '.codex/config.toml',
      '.codex/prompts',
      '.codex/rules',
      '.codex/skills',
    ])
    const file = (to: string) => setup.files.find((f) => f.to === to)!
    expect(file('.codex/AGENTS.md').content).toBe('# my rules\n\n# You are a runcastle worker: Data\n')
    expect(file('.codex/auth.json').from).toBe(join(codexHome, 'auth.json'))
    expect(file('.codex/skills').from).toBe(join(codexHome, 'skills'))

    const config = file('.codex/config.toml').content!
    // The human's model settings, servers and providers come along…
    expect(config).toContain('model_reasoning_effort = "high"')
    expect(config).toContain('personality = "pragmatic"')
    expect(config).toContain('[mcp_servers.linear]\nurl = "https://mcp.linear.app/mcp"')
    expect(config).toContain('[model_providers.proxy]\nbase_url = "https://llm.example/v1"')
    // …but nothing host-specific, no hooks, and neither their posture nor their model.
    for (const gone of ['/Users/me', 'danger-full-access', 'approval_policy = "never"', '[features]', 'hooks', 'gpt-5.5', 'localhost:4512']) {
      expect(config).not.toContain(gone)
    }
  })

  it('gives a worker with no Codex setup its briefing and config only', () => {
    const setup = codexSetup(codexHome, { model: CODEX_MODEL, briefing: 'brief', mcp: MCP })
    expect(setup.files.map((f) => f.to)).toEqual(['.codex/AGENTS.md', '.codex/config.toml'])
    expect(setup.files[0]?.content).toBe('brief\n')
  })

  it("runs on auto-review with on-request approvals, the worker's model and clone, and runcastle's tools as its own MCP server", () => {
    const config = codexSetup(codexHome, { model: CODEX_MODEL, briefing: 'brief', mcp: MCP }).files.find((f) => f.to === '.codex/config.toml')!.content!
    const lines = config.split('\n')
    expect(lines).toEqual(
      expect.arrayContaining([
        `model = "${CODEX_MODEL}"`,
        'approval_policy = "on-request"',
        'approvals_reviewer = "auto_review"',
        'sandbox_mode = "workspace-write"',
        'mcp_oauth_credentials_store = "file"',
        '[projects."/home/agent/repo"]',
        'trust_level = "trusted"',
      ]),
    )
    expect(config).toContain(
      [
        '[mcp_servers.worker]',
        'command = "node"',
        'args = ["/opt/runcastle/worker-mcp.cjs"]',
        'env = { "WORKER_PORT" = "41001", "RUNCASTLE_TOOLS_SOCKET" = "/home/agent/.runcastle/tools.sock" }',
        'default_tools_approval_mode = "approve"',
      ].join('\n'),
    )
  })
})

// --- the permission mode, and resuming --------------------------------------------

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

const shell: acp.ToolCallUpdate = { toolCallId: 'c1', title: 'bun install', kind: 'execute' }
/** codex-acp marks an MCP tool approval on the request, not the tool call. */
const linear = { call: { toolCallId: 'c2', title: 'linear.create_issue', kind: 'other' } as acp.ToolCallUpdate, meta: { is_mcp_tool_approval: true } }

const modeEvents = () =>
  listAfter(ctx, feature.id, 0)
    .filter((e) => e.type === 'worker.permission_mode')
    .map((e) => (e.data as { mode: string }).mode)
const asks = (id: string) => readThreadEvents(id).filter((e) => e.type === 'ask')

describe("a Codex worker's permission mode", () => {
  async function workerAsking(mode: string): Promise<{ id: string; host: AgentHost; answers: acp.RequestPermissionResponse[] }> {
    const answers: acp.RequestPermissionResponse[] = []
    const host = realHost(
      createFakeAcp({
        mode,
        turn: async (t) => {
          answers.push(await t.permission(shell))
          answers.push(await t.permission(linear.call, linear.meta))
          await t.say('Done.')
        },
      }),
    )
    return { id: await startCodexWorker(), host, answers }
  }

  it('runs in auto-review when the session opens in it, leaving what the reviewer still asks to the human', async () => {
    const { id, host, answers } = await workerAsking('agent')
    await until(() => asks(id).length === 1)
    expect(answers).toEqual([])
    expect(modeEvents()).toEqual(['auto'])
    await host.stopAll('shutdown')
  })

  it("falls back when auto-review is unavailable: in-sandbox actions are allowed, a call to one of the human's MCP servers asks", async () => {
    const { id, host, answers } = await workerAsking('workspace-write')
    await until(() => asks(id).length === 1)
    expect(answers).toEqual([{ outcome: { outcome: 'selected', optionId: expect.stringMatching(/allow/) } }])
    expect(asks(id)[0]).toMatchObject({ ask: { kind: 'approval', call: { title: 'linear.create_issue' } } })
    expect(modeEvents()).toEqual(['fallback'])
    await host.stopAll('shutdown')
  })
})

describe('a Codex worker after an idle stop', () => {
  it('wakes its sandbox and reloads the same conversation over codex-acp', async () => {
    const fake = createFakeAcp()
    const host = realHost(fake)
    const id = await startCodexWorker()
    await until(() => getWorker(ctx, id)?.status === 'needs-you')
    const conversation = getSessionRow(ctx, id)!.ccSessionId
    const container = getWorker(ctx, id)!.container!

    await host.stop(id, 'idle')
    await until(() => engine.stopped.includes(container))
    await host.prompt(id, { text: 'Also the migration' }, { source: 'human' })
    await until(() => readThreadEvents(id).filter((e) => e.type === 'turn_ended').length === 2)

    expect(fake.last().received[1]).toMatchObject({ method: 'session/load', params: { sessionId: conversation, cwd: '/home/agent/repo' } })
    expect(getSessionRow(ctx, id)!.ccSessionId).toBe(conversation)
    expect(engine.launches.map((l) => l.execArgs.at(-1))).toEqual(['/opt/runcastle/codex-acp.mjs', '/opt/runcastle/codex-acp.mjs'])
    // The setup is unchanged, so the wake copies nothing; the rollouts stay in the sandbox's CODEX_HOME.
    expect(engine.setups).toHaveLength(1)
    await host.stopAll('shutdown')
  })

  it('starts no new conversation over a rollout still in the sandbox', async () => {
    const fake = createFakeAcp()
    const host = realHost(fake)
    const id = await startCodexWorker()
    await until(() => getWorker(ctx, id)?.status === 'needs-you')
    const conversation = getSessionRow(ctx, id)!.ccSessionId!
    await host.stop(id, 'idle')

    engine.conversations.add(conversation)
    fake.script.gone = true
    await host.prompt(id, { text: 'Still there?' }, { source: 'human' })
    await until(() => readThreadEvents(id).filter((e) => e.type === 'process' && e.state === 'stopped').length >= 2)
    expect(fake.last().received.map((r) => r.method)).toEqual(['initialize', 'session/load'])
    expect(foldThread(readThreadEvents(id)).items.at(-1)).toMatchObject({ kind: 'error', message: expect.stringContaining('would not reopen') })
    expect(getSessionRow(ctx, id)!.ccSessionId).toBe(conversation)
    await host.stopAll('shutdown')
  })
})
