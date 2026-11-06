import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { promisify } from 'node:util'
import * as acp from '@agentclientprotocol/sdk/unstable'
import { dataDir } from '@runcastle/core/paths'
import type { AgentProcess } from '../threads/host'
import {
  type Engine,
  IN,
  adapterEntry,
  adapterExecArgs,
  adapterVersion,
  containerState,
  devRestartScript,
  engineRun,
  execSh,
  installScript,
  pickFreePort,
  runArgs,
  setupScript,
} from './sandbox'
import { WORKER_MCP_SCRIPT } from './worker-mcp-script'

/**
 * A worker of the workers spike, with no database (decision 24): one JSON file
 * per worker under `<dataDir>/workers/`, keyed by its thread's session id (or,
 * for the measuring harness, any id). Everything here is free of the app's
 * context so the harness can drive the same code the server does.
 */
export interface WorkerHandback {
  summary: string
  at: number
  commits: string[]
  files: string[]
}

export interface WorkerRecord {
  id: string
  featureId?: string
  label: string
  goal: string
  doneWhen: string
  engine: Engine
  container: string
  image: string
  repoPath: string
  featureBranch: string
  branch: string
  port: number
  previewUrl: string
  status: 'starting' | 'running' | 'stopped' | 'handed-back' | 'failed'
  createdAt: number
  /** The `at` of the last handback the server read, so one handback wakes the lead once. */
  lastHandbackAt?: number
  handbacks: WorkerHandback[]
  error?: string
  /** Milliseconds per setup step, for the report. */
  timings: Record<string, number>
}

export function workersDir(): string {
  return join(dataDir(), 'workers')
}

export function workerFile(id: string): string {
  return join(workersDir(), `${id}.json`)
}

export function readWorker(id: string): WorkerRecord | undefined {
  const f = workerFile(id)
  if (!existsSync(f)) return undefined
  return JSON.parse(readFileSync(f, 'utf8')) as WorkerRecord
}

export function writeWorker(rec: WorkerRecord): void {
  mkdirSync(workersDir(), { recursive: true })
  writeFileSync(workerFile(rec.id), JSON.stringify(rec, null, 2))
}

/** The worker's own bare copy of the feature branch, which its sandbox pushes into. */
export function workerOrigin(id: string): string {
  return join(workersDir(), 'origins', `${id}.git`)
}

export function isWorker(id: string): boolean {
  return existsSync(workerFile(id))
}

export function listWorkers(): WorkerRecord[] {
  if (!existsSync(workersDir())) return []
  return readdirSync(workersDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(workersDir(), f), 'utf8')) as WorkerRecord)
}

/** The adapter bundled to one file plus the worker's MCP script, built once per adapter version and mounted read-only. */
export async function ensureRuntimeDir(): Promise<string> {
  const dir = join(workersDir(), 'runtime', adapterVersion())
  const bundle = join(dir, 'acp.mjs')
  if (!existsSync(bundle)) {
    mkdirSync(dir, { recursive: true })
    // The Bun CLI, not `Bun.build`: the web typecheck reads this file without Bun's types.
    await execFileP(process.execPath, ['build', '--target=node', '--format=esm', `--outfile=${bundle}`, adapterEntry()], { maxBuffer: 8 * 1024 * 1024 })
  }
  writeFileSync(join(dir, 'worker-mcp.cjs'), WORKER_MCP_SCRIPT)
  return dir
}

const execFileP = promisify(execFile)

async function git(repo: string, args: string[]): Promise<string> {
  return (await execFileP('git', ['-C', repo, ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout
}

const timed = async <T>(rec: WorkerRecord, step: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = performance.now()
  try {
    return await fn()
  } finally {
    rec.timings[step] = Math.round(performance.now() - t0)
  }
}

export interface NewWorkerInput {
  id: string
  featureId?: string
  label: string
  goal: string
  doneWhen: string
  engine: Engine
  image: string
  repoPath: string
  featureBranch: string
  /** Skip the dependency install (the harness measures it separately). */
  skipInstall?: boolean
}

/** Create the worker's branch and sandbox: container up, clone made, dependencies installed. Times each step. */
export async function createWorkerSandbox(input: NewWorkerInput): Promise<WorkerRecord> {
  // A stopped worker's port is free on the host but still its own: never hand it out again (review finding).
  const port = await pickFreePort(41000, 400, new Set(listWorkers().filter((w) => w.status !== 'failed').map((w) => w.port)))
  const short = input.id.replace(/[^a-zA-Z0-9]/g, '').slice(-10).toLowerCase()
  const rec: WorkerRecord = {
    id: input.id,
    ...(input.featureId ? { featureId: input.featureId } : {}),
    label: input.label,
    goal: input.goal,
    doneWhen: input.doneWhen,
    engine: input.engine,
    container: `runcastle-worker-${short}`,
    image: input.image,
    repoPath: input.repoPath,
    featureBranch: input.featureBranch,
    branch: `runcastle/worker/${short}`,
    port,
    previewUrl: `http://localhost:${port}/`,
    status: 'starting',
    createdAt: Date.now(),
    handbacks: [],
    timings: {},
  }
  writeWorker(rec)
  try {
    const t0 = performance.now()
    const runtimeDir = await timed(rec, 'runtimeBundle', () => ensureRuntimeDir())
    const originDir = workerOrigin(rec.id)
    await timed(rec, 'originCopy', async () => {
      rmSync(originDir, { recursive: true, force: true })
      await execFileP('git', ['clone', '-q', '--bare', '--no-hardlinks', '--single-branch', '--branch', input.featureBranch, input.repoPath, originDir])
      await git(originDir, ['branch', '-f', rec.branch, input.featureBranch])
    })
    const gitName = (await git(input.repoPath, ['config', 'user.name']).catch(() => 'runcastle worker')).trim()
    const gitEmail = (await git(input.repoPath, ['config', 'user.email']).catch(() => 'worker@runcastle.local')).trim()
    await timed(rec, 'containerRun', () =>
      engineRun(
        rec.engine,
        runArgs({
          engine: rec.engine,
          container: rec.container,
          image: rec.image,
          port,
          originDir,
          runtimeDir,
          uid: process.getuid?.() ?? 1000,
          gid: process.getgid?.() ?? 1000,
        }),
      ),
    )
    await execSh(rec.engine, rec.container, `mkdir -p ${IN.cache} && chown -R ${process.getuid?.() ?? 1000} ${IN.cache}`, { root: true })
    await timed(rec, 'clone', () =>
      execSh(rec.engine, rec.container, setupScript({ featureBranch: input.featureBranch, workerBranch: rec.branch, gitName, gitEmail })),
    )
    if (!input.skipInstall) await timed(rec, 'install', () => execSh(rec.engine, rec.container, installScript()))
    rec.timings.sandboxTotal = Math.round(performance.now() - t0)
    rec.status = 'running'
    writeWorker(rec)
    return rec
  } catch (err) {
    rec.status = 'failed'
    rec.error = err instanceof Error ? err.message : String(err)
    writeWorker(rec)
    throw err
  }
}

/** Start a stopped sandbox again and bring its dev server back (decision 8). Returns ms spent, 0 when it was running. */
export async function ensureSandboxRunning(rec: WorkerRecord): Promise<number> {
  const state = await containerState(rec.engine, rec.container)
  if (state === 'running') return 0
  if (state === 'missing') throw new Error(`worker ${rec.label}: its sandbox ${rec.container} is gone`)
  const t0 = performance.now()
  await engineRun(rec.engine, ['start', rec.container])
  await execSh(rec.engine, rec.container, devRestartScript(rec.port))
  const ms = Math.round(performance.now() - t0)
  const fresh = readWorker(rec.id) ?? rec
  fresh.timings.lastWake = ms
  if (fresh.status === 'stopped') fresh.status = 'running'
  writeWorker(fresh)
  return ms
}

/** Stop the sandbox, keeping its filesystem (decision 8). */
export async function stopSandbox(rec: WorkerRecord): Promise<void> {
  await engineRun(rec.engine, ['stop', '-t', '5', rec.container]).catch(() => {})
  const fresh = readWorker(rec.id) ?? rec
  if (fresh.status === 'running' || fresh.status === 'starting') fresh.status = 'stopped'
  writeWorker(fresh)
}

/** Remove the sandbox, the worker branch, its bare copy and its record (the harness's cleanup; `discard` for interactive-workers). */
export async function removeSandbox(rec: WorkerRecord): Promise<void> {
  await engineRun(rec.engine, ['rm', '-f', rec.container]).catch(() => {})
  await git(rec.repoPath, ['branch', '-D', rec.branch]).catch(() => {})
  rmSync(workerOrigin(rec.id), { recursive: true, force: true })
  rmSync(workerFile(rec.id), { force: true })
}

/** A handback the worker wrote since the last one read, with its commits and files from the host's refs. */
export async function takeHandback(rec: WorkerRecord): Promise<WorkerHandback | undefined> {
  let raw: string
  try {
    raw = await execSh(rec.engine, rec.container, `cat ${IN.state}/handback.json 2>/dev/null || true`)
  } catch {
    return undefined
  }
  if (!raw.trim()) return undefined
  const said = JSON.parse(raw) as { summary: string; at: number }
  if (rec.lastHandbackAt && said.at <= rec.lastHandbackAt) return undefined
  // The worker's commits sit in its own bare copy until the host fetches them; a fetch runs none of that repo's hooks.
  await git(rec.repoPath, ['fetch', '-q', workerOrigin(rec.id), `+refs/heads/${rec.branch}:refs/heads/${rec.branch}`]).catch(() => {})
  const range = `${rec.featureBranch}..${rec.branch}`
  const commits = (await git(rec.repoPath, ['log', '--format=%h %s', range]).catch(() => '')).split('\n').filter(Boolean)
  const files = (await git(rec.repoPath, ['diff', '--name-only', `${rec.featureBranch}...${rec.branch}`]).catch(() => ''))
    .split('\n')
    .filter(Boolean)
  const handback: WorkerHandback = { summary: said.summary, at: said.at, commits, files }
  const fresh = readWorker(rec.id) ?? rec
  fresh.lastHandbackAt = said.at
  fresh.handbacks.push(handback)
  fresh.status = 'handed-back'
  writeWorker(fresh)
  return handback
}

/** The worker's briefing, appended to Claude Code's system prompt. */
export function workerBriefing(rec: WorkerRecord): string {
  return [
    `# You are a runcastle worker: ${rec.label}`,
    '',
    'Your lead (the agent running this feature) gave you one assignment. You run inside a sandbox container; the human can open this conversation at any time and type to you.',
    '',
    `## Goal\n${rec.goal}`,
    '',
    `## Done when\n${rec.doneWhen}`,
    '',
    '## How you work',
    `- Work in ${IN.repo}, on branch ${rec.branch}. Commit as you go with conventional messages: every commit is copied back to runcastle automatically. Uncommitted work is not handed back.`,
    `- To show the human a screen, call start_dev_server. Your dev server must listen on 0.0.0.0, port ${rec.port}; the human opens it at ${rec.previewUrl}.`,
    '- You have no route to runcastle or the internet beyond what the sandbox allows; your tools are hand_back and start_dev_server.',
    '- When the goal is done (or you cannot do it), call hand_back with a short summary: what you did, what is left, and any direction the human gave you directly. Then end your turn.',
  ].join('\n')
}

/** The kickoff prompt that starts a worker. */
export function workerKickoff(rec: WorkerRecord): string {
  return `Start your assignment: ${rec.goal}\n\nDone when: ${rec.doneWhen}`
}

/**
 * The sandbox transport (decision 2): the ACP adapter runs inside the
 * container, reached over `docker exec -i` stdio. The session opens in the
 * container's clone, with the worker's own MCP server and no permission prompts.
 */
export async function workerProcess(rec: WorkerRecord, token: string, model?: string): Promise<AgentProcess> {
  await ensureSandboxRunning(rec)
  const child = spawn(rec.engine, adapterExecArgs(rec.container, rec.port, rec.previewUrl), {
    env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (c: Buffer) => {
    stderr = (stderr + c.toString('utf8')).slice(-8000)
  })
  const exited = new Promise<{ stderr: string }>((resolve) => {
    child.once('exit', () => resolve({ stderr }))
    child.once('error', (err) => resolve({ stderr: `${stderr}${err.message}` }))
  })
  const mcp: acp.McpServer = {
    name: 'worker',
    command: 'node',
    args: [`${IN.runtime}/worker-mcp.cjs`],
    env: [
      { name: 'WORKER_PORT', value: String(rec.port) },
      { name: 'WORKER_PREVIEW_URL', value: rec.previewUrl },
      { name: 'PATH', value: '/home/agent/.local/bin:/usr/local/bin:/usr/bin:/bin' },
    ],
  }
  return {
    target: acp.ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>),
    exited,
    kill: async () => {
      child.kill('SIGTERM')
      // Killing the exec client does not end the process inside the container.
      await execSh(rec.engine, rec.container, `pkill -f ${IN.runtime}/acp.mjs || true`).catch(() => {})
    },
    session: {
      cwd: IN.repo,
      mcpServers: [mcp],
      meta: {
        claudeCode: {
          emitRawSDKMessages: [
            { type: 'system', subtype: 'background_tasks_changed' },
            { type: 'system', subtype: 'session_state_changed' },
          ],
          options: {
            ...(model ? { model } : {}),
            permissionMode: 'bypassPermissions',
            perTaskStopAffordance: false,
            extraArgs: { 'append-system-prompt': workerBriefing(rec) },
          },
        },
      },
      mode: 'bypassPermissions',
    },
  }
}
