import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createSessionRow, getSessionRow, markSessionEnded, markSessionLive } from '../src/launcher/sessions'
import { toolStartWorker } from '../src/mcp/server'
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
import { fakeEngine, initRepo, type FakeEngine } from './support/fake-workers'

/**
 * Codex workers (interactive-workers decisions 8, 11, 12; workers-build-in-the-feature-s-folder):
 * a Codex worker starts on the host through the base transport, with no container and no sandbox
 * engine call. The codex-setup module still builds a Codex home for old sandbox workers, so its
 * file shapes stay pinned here.
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
  it('starts on the host through the base transport with runtime codex: no container, no sandbox engine call, no Claude token', async () => {
    fakeCodexHome()
    const fake = createFakeAcp()
    const host = realHost(fake)
    const id = await startCodexWorker()
    await until(() => readThreadEvents(id).some((e) => e.type === 'turn_ended'))

    const w = getWorker(ctx, id)!
    expect(w).toMatchObject({ runtime: 'codex', model: CODEX_MODEL, container: null })
    expect(w.folder).toBeTruthy()
    expect(getSessionRow(ctx, id)).toMatchObject({ runtime: 'codex', model: CODEX_MODEL })
    // The agent came from the base transport: the fake one ran once.
    expect(fake.processes).toHaveLength(1)
    // The sandbox engine was never asked for anything, and the human's Codex setup was not copied anywhere.
    expect(engine.order).toEqual([])
    expect(engine.created).toEqual([])
    expect(engine.setups).toEqual([])
    expect(engine.launches).toEqual([])
    await host.stopAll('shutdown')
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


/** A real agent host over the fake ACP agent, the base transport behind the worker transport and the server's lifecycle. */
function realHost(fake: FakeAcp): AgentHost {
  const host = createAgentHost({
    ctx,
    transport: withWorkers(ctx, fake.transport),
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
