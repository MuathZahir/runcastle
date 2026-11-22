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
import { getWorker, workerTurnSlot } from '../src/workers/service'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject, tmpRepo } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH, type FakeAcp } from './support/fake-acp-agent'
import { initRepo } from './support/fake-workers'

/**
 * Codex workers (interactive-workers decisions 8, 11, 12; workers-build-in-the-feature-s-folder):
 * a Codex worker starts on the host through the base transport and needs no Claude token.
 */

const CODEX_MODEL = 'gpt-5.6-sol'

let ctx: AppCtx
let data: string
let restoreDataDir: () => void
let repo: string
let feature: Feature
let lead: string
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
  userHome = tmpRepo()
  codexHome = join(userHome, '.codex')
  vi.stubEnv('HOME', userHome)
  vi.stubEnv('CODEX_HOME', codexHome)
  // No Claude token anywhere: a Codex worker must not need one.
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '')
})

afterEach(() => {
  setAgentHostForTests(undefined)
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
  it('starts on the host through the base transport with runtime codex and no Claude token', async () => {
    fakeCodexHome()
    const fake = createFakeAcp()
    const host = realHost(fake)
    const id = await startCodexWorker()
    await until(() => readThreadEvents(id).some((e) => e.type === 'turn_ended'))

    const w = getWorker(ctx, id)!
    expect(w).toMatchObject({ runtime: 'codex', model: CODEX_MODEL })
    expect(w.folder).toBeTruthy()
    expect(getSessionRow(ctx, id)).toMatchObject({ runtime: 'codex', model: CODEX_MODEL })
    // The agent came from the base transport: the fake one ran once.
    expect(fake.processes).toHaveLength(1)
    await host.stopAll('shutdown')
  })
})

/** A real agent host over the fake ACP agent, the base transport and the server's lifecycle. */
function realHost(fake: FakeAcp): AgentHost {
  const host = createAgentHost({
    ctx,
    transport: fake.transport,
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
