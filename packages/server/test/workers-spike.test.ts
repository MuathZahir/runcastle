import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ThreadEvent } from '@runcastle/core'
import type { AppCtx } from '../src/db/types'
import { createSessionRow } from '../src/launcher/sessions'
import { createAgentHost, type AgentTransport } from '../src/threads/host'
import { readThreadEvents, type AgentHost } from '../src/threads/types'
import { adapterExecArgs, runArgs, setupScript } from '../src/workers/sandbox'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'
import { createFakeAcp, FAKE_LAUNCH } from './support/fake-acp-agent'

/**
 * The workers spike (workers-prototype-an-agent-you-can-enter-inside-a-sandbox):
 * the sandbox's argv (one published loopback port, never host networking —
 * decision 23), the adapter exec (the token by name only), and the thread host
 * opening a session where its transport says (decision 2).
 */

describe('worker sandbox argv', () => {
  const spec = {
    engine: 'docker' as const,
    container: 'runcastle-worker-abc',
    image: 'sandcastle:runcastle',
    port: 41001,
    gitCommonDir: '/repo/.git',
    runtimeDir: '/data/workers/runtime/0.97.0',
    uid: 1001,
    gid: 1001,
  }

  it('publishes exactly one port, on the host loopback, and never uses host networking', () => {
    const args = runArgs(spec)
    expect(args.filter((a) => a === '-p')).toHaveLength(1)
    expect(args[args.indexOf('-p') + 1]).toBe('127.0.0.1:41001:41001')
    expect(args).not.toContain('--network')
    expect(args.some((a) => a.startsWith('--net') || a === 'host')).toBe(false)
    expect(args).toContain('/data/workers/runtime/0.97.0:/opt/runcastle:ro')
    expect(args.at(-1)).toBe('sandcastle:runcastle')
  })

  it('passes the Claude token by name, never its value', () => {
    const args = adapterExecArgs('runcastle-worker-abc', 41001, 'http://localhost:41001/')
    expect(args.slice(0, 2)).toEqual(['exec', '-i'])
    expect(args).toContain('CLAUDE_CODE_OAUTH_TOKEN')
    expect(args.some((a) => a.startsWith('CLAUDE_CODE_OAUTH_TOKEN='))).toBe(false)
    expect(args.slice(-3)).toEqual(['runcastle-worker-abc', 'node', '/opt/runcastle/acp.mjs'])
  })

  it('clones the worker branch and pushes every commit back to it', () => {
    const script = setupScript({ featureBranch: 'feature/x', workerBranch: 'runcastle/worker/abc', gitName: "O'Neil", gitEmail: 'a@b.c' })
    expect(script).toContain("git clone -q --branch 'runcastle/worker/abc' /home/agent/host.git /home/agent/repo")
    expect(script).toContain('HEAD:refs/heads/runcastle/worker/abc')
    expect(script).toContain(`user.name 'O'\\''Neil'`)
  })
})

describe('a transport that says where the session opens', () => {
  let ctx: AppCtx
  let host: AgentHost
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    featureId = seedFeature(ctx, seedProject(ctx).id).id
  })
  afterEach(async () => {
    await host?.stopAll('shutdown')
  })

  it('opens the session with the transport cwd, MCP servers, options and mode in place of the launch', async () => {
    const fake = createFakeAcp()
    const sandboxed: AgentTransport = async (spec, row) => ({
      ...(await fake.transport(spec, row)),
      session: {
        cwd: '/home/agent/repo',
        mcpServers: [{ name: 'worker', command: 'node', args: ['/opt/runcastle/worker-mcp.cjs'], env: [] }],
        meta: { claudeCode: { options: { permissionMode: 'bypassPermissions' } } },
        mode: 'acceptEdits',
      },
    })
    host = createAgentHost({ ctx, transport: sandboxed, launch: FAKE_LAUNCH })
    const row = createSessionRow(ctx, { featureId, kind: 'side', worktreePath: '/host/placeholder' })
    await host.prompt(row.id, { text: 'Start' }, { source: 'runcastle' })
    const deadline = Date.now() + 3000
    let events: ThreadEvent[] = []
    while (!(events = readThreadEvents(row.id)).some((e) => e.type === 'turn_ended')) {
      if (Date.now() > deadline) throw new Error('no turn end')
      await new Promise((r) => setTimeout(r, 5))
    }
    const received = fake.last().received
    expect(received[1]).toMatchObject({
      method: 'session/new',
      params: {
        cwd: '/home/agent/repo',
        mcpServers: [{ name: 'worker' }],
        _meta: { claudeCode: { options: { permissionMode: 'bypassPermissions' } } },
      },
    })
    expect(received.some((r) => r.method === 'session/set_mode' && (r.params as { modeId: string }).modeId === 'acceptEdits')).toBe(true)
  })
})
