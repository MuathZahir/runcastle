/**
 * The workers spike's measuring harness (decisions 16, 25, 27). Drives the
 * same sandbox code and ACP adapter the server does, with no server and no
 * database, against a scratch clone of a repo; and the same steps as a host
 * chat in a host git worktree, for the baseline.
 *
 *   RUNCASTLE_DATA_DIR=/tmp/wspike/data bun packages/server/src/workers/spike-harness.ts \
 *     --repo /path/to/repo --runs 5 [--model claude-sonnet-5-5] [--side sandbox|host|both]
 *
 * Writes every run's numbers to <out>/results-<time>.json and prints medians.
 * Never point RUNCASTLE_DATA_DIR at the live data folder.
 */
import { execFile, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { promisify } from 'node:util'
import * as acp from '@agentclientprotocol/sdk/unstable'
import { dataDir } from '@runcastle/core/paths'
import type { AgentProcess } from '../threads/host'
import { IN, adapterEntry, engineRun, installScript, pickFreePort } from './sandbox'
import { claudeToken } from './service'
import { createWorkerSandbox, removeSandbox, stopSandbox, takeHandback, workerProcess } from './worker'

const execFileP = promisify(execFile)
const sh = async (cmd: string, cwd?: string): Promise<string> =>
  (await execFileP('sh', ['-c', cmd], { cwd, maxBuffer: 32 * 1024 * 1024 })).stdout

type Row = Record<string, number | string | boolean | null>

interface Opened {
  conn: acp.ClientConnection
  sessionId: string
  firstChunkAt: () => number | undefined
  resetChunk: () => void
  text: () => string
  initMs: number
  openMs: number
}

const TRIVIAL = 'Reply with exactly the word: ok'
const EDIT =
  "Create the file spike/hello.txt containing the word hello, commit it with the message 'chore: spike hello', and reply with the word done."
const HANDBACK = "Call your hand_back tool with the summary 'spike handback: wrote spike/hello.txt', then reply with the word done."

/** Connect a client to an agent process and open (or load) a session, timing both. */
async function open(proc: AgentProcess, session: { cwd: string; mcpServers: acp.McpServer[]; meta?: Record<string, unknown>; mode?: string }, loadId?: string): Promise<Opened> {
  let firstChunk: number | undefined
  let text = ''
  const app = acp
    .client({ name: 'workers-spike' })
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      const u = params.update
      if (u.sessionUpdate === 'agent_message_chunk') {
        if (firstChunk === undefined) firstChunk = performance.now()
        if (u.content.type === 'text') text += u.content.text
      }
    })
    .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => ({
      outcome: { outcome: 'selected' as const, optionId: params.options[0]!.optionId },
    }))
  const conn = app.connect(proc.target as acp.Stream)
  const t0 = performance.now()
  await conn.agent.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  })
  const initMs = performance.now() - t0
  const t1 = performance.now()
  const req = { cwd: session.cwd, mcpServers: session.mcpServers, _meta: session.meta }
  let sessionId: string
  if (loadId) {
    await conn.agent.request(acp.methods.agent.session.load, { ...req, sessionId: loadId })
    sessionId = loadId
  } else {
    sessionId = ((await conn.agent.request(acp.methods.agent.session.new, req)) as acp.NewSessionResponse).sessionId
  }
  if (session.mode) await conn.agent.request(acp.methods.agent.session.setMode, { sessionId, modeId: session.mode }).catch(() => {})
  const openMs = performance.now() - t1
  // Replayed history on load is not this turn's output.
  firstChunk = undefined
  text = ''
  return {
    conn,
    sessionId,
    firstChunkAt: () => firstChunk,
    resetChunk: () => {
      firstChunk = undefined
      text = ''
    },
    text: () => text,
    initMs: Math.round(initMs),
    openMs: Math.round(openMs),
  }
}

async function turn(o: Opened, prompt: string): Promise<{ firstMs: number | null; totalMs: number; text: string }> {
  o.resetChunk()
  const t0 = performance.now()
  await o.conn.agent.request(acp.methods.agent.session.prompt, { sessionId: o.sessionId, prompt: [{ type: 'text', text: prompt }] })
  const first = o.firstChunkAt()
  return { firstMs: first === undefined ? null : Math.round(first - t0), totalMs: Math.round(performance.now() - t0), text: o.text().trim().slice(0, 200) }
}

/** Poll an address from the host until it answers HTTP, up to `limitMs`. */
async function untilAnswers(url: string, limitMs = 120_000): Promise<number | null> {
  const t0 = performance.now()
  while (performance.now() - t0 < limitMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (r.status < 500) return Math.round(performance.now() - t0)
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}

/** Call the worker's start_dev_server tool directly inside the sandbox, as the agent would. */
async function callDevTool(engine: 'docker' | 'podman', container: string, port: number, preview: string, command: string): Promise<{ ms: number; said: string }> {
  const script = `
const { spawn } = require('child_process')
const p = spawn('node', ['${IN.runtime}/worker-mcp.cjs'], { env: { ...process.env, WORKER_PORT: '${port}', WORKER_PREVIEW_URL: '${preview}' }, stdio: ['pipe', 'pipe', 'inherit'] })
let buf = ''
p.stdout.on('data', (c) => { buf += c; const lines = buf.split('\\n'); for (const l of lines.slice(0, -1)) { const m = JSON.parse(l); if (m.id === 2) { console.log(JSON.stringify(m.result)); process.exit(0) } } buf = lines[lines.length - 1] })
p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\\n')
p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'start_dev_server', arguments: { command: process.argv[1] } } }) + '\\n')
`
  const t0 = performance.now()
  const out = await engineRun(engine, ['exec', '-w', IN.repo, container, 'node', '-e', script, command])
  const res = JSON.parse(out.trim().split('\n').pop()!) as { content: { text: string }[]; isError?: boolean }
  return { ms: Math.round(performance.now() - t0), said: `${res.isError ? 'ERROR ' : ''}${res.content[0]!.text.split('\n')[0]}` }
}

function hostAdapter(cwd: string): AgentProcess {
  const child = spawn(process.execPath, [adapterEntry()], {
    cwd,
    env: { ...process.env, CLAUDE_CODE_EXECUTABLE: hostClaude, CLAUDE_CODE_DISABLE_AGENT_VIEW: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.resume()
  return {
    target: acp.ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>),
    exited: new Promise((r) => child.once('exit', () => r({ stderr: '' }))),
    kill: async () => {
      child.kill('SIGTERM')
    },
  }
}

let hostClaude = 'claude'

function args(): { repo: string; runs: number; model: string; side: string; dev: string; devBound: string } {
  const a = process.argv.slice(2)
  const get = (k: string, d: string): string => {
    const i = a.indexOf(`--${k}`)
    return i >= 0 ? a[i + 1]! : d
  }
  const dev = get('dev', 'bun run --cwd apps/web dev --port $RUNCASTLE_DESIGN_PORT --strictPort')
  return { repo: get('repo', ''), runs: Number(get('runs', '5')), model: get('model', 'claude-sonnet-5-5'), side: get('side', 'both'), dev, devBound: get('dev-bound', `${dev} --host 0.0.0.0`) }
}

async function sandboxRun(i: number, scratch: string, model: string, dev: string, devBound: string, image: string): Promise<Row> {
  const row: Row = { side: 'sandbox', run: i }
  const token = claudeToken()
  const rec = await createWorkerSandbox({
    id: `spike${Date.now().toString(36)}${i}`,
    label: `spike ${i}`,
    goal: 'measure',
    doneWhen: 'measured',
    engine: 'docker',
    image,
    repoPath: scratch,
    featureBranch: 'main',
  })
  Object.assign(row, Object.fromEntries(Object.entries(rec.timings).map(([k, v]) => [`sb_${k}`, v])))
  try {
    let t0 = performance.now()
    const proc = await workerProcess(rec, token, model)
    const o = await open(proc, proc.session!)
    row.adapterInitMs = o.initMs
    row.sessionNewMs = o.openMs
    row.coldStartMs = Math.round((rec.timings.sandboxTotal ?? 0) + (performance.now() - t0))
    const t1 = await turn(o, TRIVIAL)
    row.trivialFirstMs = t1.firstMs
    row.trivialTotalMs = t1.totalMs
    row.trivialText = t1.text
    const t2 = await turn(o, EDIT)
    row.editTotalMs = t2.totalMs
    row.editCommitOnHost = (await sh(`git log --oneline main..${rec.branch}`, scratch)).includes('spike hello')
    if (i === 1) row.devDefault = (await callDevTool('docker', rec.container, rec.port, rec.previewUrl, dev)).said
    const d = await callDevTool('docker', rec.container, rec.port, rec.previewUrl, devBound)
    row.devStartMs = d.ms
    row.devSaid = d.said
    row.devFromHostMs = await untilAnswers(rec.previewUrl, 10_000)
    const t3 = await turn(o, HANDBACK)
    row.handbackTurnMs = t3.totalMs
    const hb = await takeHandback(rec)
    row.handbackChars = hb ? JSON.stringify(hb).length : null
    row.handbackCommits = hb?.commits.length ?? null
    // Idle stop, then wake by the next message.
    await proc.kill()
    t0 = performance.now()
    await stopSandbox(rec)
    row.stopMs = Math.round(performance.now() - t0)
    t0 = performance.now()
    const proc2 = await workerProcess(rec, token, model)
    row.wakeSandboxMs = Math.round(performance.now() - t0)
    const o2 = await open(proc2, proc2.session!, o.sessionId)
    row.wakeAdapterInitMs = o2.initMs
    row.wakeLoadMs = o2.openMs
    const t4 = await turn(o2, TRIVIAL)
    row.wakeFirstMs = t4.firstMs
    row.wakeToFirstReplyMs = Math.round(performance.now() - t0 - (t4.totalMs - (t4.firstMs ?? t4.totalMs)))
    row.devAfterWakeMs = await untilAnswers(rec.previewUrl, 120_000)
    await proc2.kill()
    // Attach by handoff (decision 25): a headless run, then its captured session resumed interactively.
    t0 = performance.now()
    const out = await engineRun(
      'docker',
      ['exec', '-w', IN.repo, '-e', 'CLAUDE_CODE_OAUTH_TOKEN', rec.container, IN.claude, '-p', TRIVIAL, '--output-format', 'json', '--model', model],
      { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token },
    )
    row.headlessTurnMs = Math.round(performance.now() - t0)
    const headlessId = (JSON.parse(out) as { session_id: string }).session_id
    t0 = performance.now()
    const proc3 = await workerProcess(rec, token, model)
    const o3 = await open(proc3, proc3.session!, headlessId)
    row.handoffLoadMs = o3.openMs
    const t5 = await turn(o3, TRIVIAL)
    row.handoffAttachToFirstReplyMs = Math.round(performance.now() - t0 - (t5.totalMs - (t5.firstMs ?? t5.totalMs)))
    await proc3.kill()
  } catch (err) {
    row.error = err instanceof Error ? err.message.slice(0, 400) : String(err)
  } finally {
    await removeSandbox(rec)
  }
  return row
}

async function hostRun(i: number, scratch: string, model: string, devBound: string): Promise<Row> {
  const row: Row = { side: 'host', run: i }
  const wt = join(scratch, '..', `host-wt-${i}-${Date.now().toString(36)}`)
  const branch = `spike/host-${i}-${Date.now().toString(36)}`
  try {
    let t0 = performance.now()
    await sh(`git worktree add -q -b ${branch} '${wt}' main`, scratch)
    row.worktreeMs = Math.round(performance.now() - t0)
    t0 = performance.now()
    await sh(installScript().replace(`cd ${IN.repo}`, `cd '${wt}'`))
    row.installMs = Math.round(performance.now() - t0)
    const meta = { claudeCode: { options: { model, permissionMode: 'bypassPermissions', perTaskStopAffordance: false } } }
    t0 = performance.now()
    const proc = hostAdapter(wt)
    const o = await open(proc, { cwd: wt, mcpServers: [], meta, mode: 'bypassPermissions' })
    row.adapterInitMs = o.initMs
    row.sessionNewMs = o.openMs
    row.adapterStartMs = Math.round(performance.now() - t0)
    row.coldStartMs = (row.worktreeMs as number) + (row.installMs as number) + (row.adapterStartMs as number)
    const t1 = await turn(o, TRIVIAL)
    row.trivialFirstMs = t1.firstMs
    row.trivialTotalMs = t1.totalMs
    const t2 = await turn(o, EDIT)
    row.editTotalMs = t2.totalMs
    const port = await pickFreePort(43000)
    t0 = performance.now()
    const dev = spawn('sh', ['-c', devBound.replaceAll('$RUNCASTLE_DESIGN_PORT', String(port))], { cwd: wt, detached: true, stdio: 'ignore' })
    row.devStartMs = await untilAnswers(`http://localhost:${port}/`, 120_000)
    try {
      process.kill(-dev.pid!, 'SIGTERM')
    } catch {}
    await proc.kill()
    t0 = performance.now()
    const proc2 = hostAdapter(wt)
    const o2 = await open(proc2, { cwd: wt, mcpServers: [], meta, mode: 'bypassPermissions' }, o.sessionId)
    row.wakeLoadMs = o2.openMs
    const t4 = await turn(o2, TRIVIAL)
    row.wakeFirstMs = t4.firstMs
    row.wakeToFirstReplyMs = Math.round(performance.now() - t0 - (t4.totalMs - (t4.firstMs ?? t4.totalMs)))
    await proc2.kill()
  } catch (err) {
    row.error = err instanceof Error ? err.message.slice(0, 400) : String(err)
  } finally {
    await sh(`git worktree remove --force '${wt}'; git branch -D ${branch}`, scratch).catch(() => {})
  }
  return row
}

function medians(rows: Row[]): Record<string, number> {
  const keys = new Set(rows.flatMap((r) => Object.keys(r)))
  const out: Record<string, number> = {}
  for (const k of keys) {
    const vals = rows.map((r) => r[k]).filter((v): v is number => typeof v === 'number' && k !== 'run').sort((a, b) => a - b)
    if (vals.length) out[k] = vals[Math.floor((vals.length - 1) / 2)]!
  }
  return out
}

async function main(): Promise<void> {
  const a = args()
  if (!a.repo) throw new Error('--repo <path> is required')
  if (dataDir().endsWith('.runcastle') && !process.env.RUNCASTLE_DATA_DIR) throw new Error('set RUNCASTLE_DATA_DIR to a scratch folder')
  hostClaude = (await sh('command -v claude')).trim()
  const out = join(dataDir(), 'spike')
  mkdirSync(out, { recursive: true })
  const scratch = join(out, `repo-${Date.now().toString(36)}`)
  await sh(`git clone -q --local '${a.repo}' '${scratch}' && git -C '${scratch}' checkout -q -B main origin/main`)
  const image = process.env.SPIKE_IMAGE ?? 'sandcastle:runcastle'
  const rows: Row[] = []
  const save = (): void => writeFileSync(join(out, `results-${process.pid}.json`), JSON.stringify(rows, null, 2))
  for (let i = 1; i <= a.runs; i++) {
    if (a.side !== 'host') {
      rows.push(await sandboxRun(i, scratch, a.model, a.dev, a.devBound, image))
      save()
      console.error(JSON.stringify(rows.at(-1)))
    }
    if (a.side !== 'sandbox') {
      rows.push(await hostRun(i, scratch, a.model, a.devBound))
      save()
      console.error(JSON.stringify(rows.at(-1)))
    }
  }
  const summary = {
    sandbox: medians(rows.filter((r) => r.side === 'sandbox' && !r.error)),
    host: medians(rows.filter((r) => r.side === 'host' && !r.error)),
    errors: rows.filter((r) => r.error).map((r) => `${r.side} ${r.run}: ${r.error}`),
    devDefault: rows.find((r) => r.devDefault)?.devDefault ?? null,
    results: join(out, `results-${process.pid}.json`),
  }
  writeFileSync(join(out, `summary-${process.pid}.json`), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}

if (import.meta.main) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err)
      process.exit(1)
    },
  )
}
