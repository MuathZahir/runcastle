import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { promisify } from 'node:util'
import * as acp from '@agentclientprotocol/sdk/unstable'
import type { WorkerKind } from '@runcastle/core'
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
 * A worker's sandbox on a real container engine: its bare copy of the feature
 * branch, its container, the adapter inside it. Nothing here persists anything:
 * the worker service keeps the record (the `workers` table) and hands these
 * functions a {@link WorkerSandbox} built from it. Free of the app's context, so
 * the measuring harness drives the same code the server does.
 */
export interface WorkerSandbox {
  /** The worker's id: its thread's session id. */
  id: string
  engine: Engine
  container: string
  /** The host repo its branch is fetched into. */
  repoPath: string
  featureBranch: string
  /** The worker's own branch, cut from `featureBranch`. */
  branch: string
  port: number
  previewUrl: string
}

/** What a worker's briefing says: its assignment. */
export interface WorkerBrief {
  label: string
  kind: WorkerKind
  goal: string | null
  doneWhen: string | null
}

/** What the worker's `hand_back` tool wrote. */
export interface HandbackNote {
  summary: string
  at: number
}

export function workersDir(): string {
  return join(dataDir(), 'workers')
}

/** The worker's own bare copy of the feature branch, which its sandbox pushes into. */
export function workerOrigin(id: string): string {
  return join(workersDir(), 'origins', `${id}.git`)
}

/** The preview address of a worker's one published port, on the host's loopback. */
export function previewUrlFor(port: number): string {
  return `http://localhost:${port}/`
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

export interface NewSandboxInput {
  id: string
  engine: Engine
  container: string
  branch: string
  image: string
  repoPath: string
  featureBranch: string
  /** Ports other workers hold, even stopped ones: never handed out again (review finding). */
  takenPorts: ReadonlySet<number>
  /** Skip the dependency install (the harness measures it separately). */
  skipInstall?: boolean
}

/** Create the worker's branch and sandbox: container up, clone made, dependencies installed. Times each step. */
export async function createWorkerSandbox(input: NewSandboxInput): Promise<WorkerSandbox & { timings: Record<string, number> }> {
  const port = await pickFreePort(41000, 400, input.takenPorts)
  const sb = {
    id: input.id,
    engine: input.engine,
    container: input.container,
    repoPath: input.repoPath,
    featureBranch: input.featureBranch,
    branch: input.branch,
    port,
    previewUrl: previewUrlFor(port),
    timings: {} as Record<string, number>,
  }
  const timed = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = performance.now()
    try {
      return await fn()
    } finally {
      sb.timings[step] = Math.round(performance.now() - t0)
    }
  }
  const t0 = performance.now()
  const runtimeDir = await timed('runtimeBundle', () => ensureRuntimeDir())
  const originDir = workerOrigin(sb.id)
  await timed('originCopy', async () => {
    rmSync(originDir, { recursive: true, force: true })
    await execFileP('git', ['clone', '-q', '--bare', '--no-hardlinks', '--single-branch', '--branch', input.featureBranch, input.repoPath, originDir])
    await git(originDir, ['branch', '-f', sb.branch, input.featureBranch])
  })
  const gitName = (await git(input.repoPath, ['config', 'user.name']).catch(() => 'runcastle worker')).trim()
  const gitEmail = (await git(input.repoPath, ['config', 'user.email']).catch(() => 'worker@runcastle.local')).trim()
  await timed('containerRun', () =>
    engineRun(
      sb.engine,
      runArgs({
        engine: sb.engine,
        container: sb.container,
        image: input.image,
        port,
        originDir,
        runtimeDir,
        uid: process.getuid?.() ?? 1000,
        gid: process.getgid?.() ?? 1000,
      }),
    ),
  )
  await execSh(sb.engine, sb.container, `mkdir -p ${IN.cache} && chown -R ${process.getuid?.() ?? 1000} ${IN.cache}`, { root: true })
  await timed('clone', () =>
    execSh(sb.engine, sb.container, setupScript({ featureBranch: input.featureBranch, workerBranch: sb.branch, gitName, gitEmail })),
  )
  if (!input.skipInstall) await timed('install', () => execSh(sb.engine, sb.container, installScript()))
  sb.timings.sandboxTotal = Math.round(performance.now() - t0)
  return sb
}

/** Start a stopped sandbox again and bring its dev server back (decision 8). Returns ms spent, 0 when it was running. */
export async function ensureSandboxRunning(sb: WorkerSandbox): Promise<number> {
  const state = await containerState(sb.engine, sb.container)
  if (state === 'running') return 0
  if (state === 'missing') throw new Error(`its sandbox ${sb.container} is gone`)
  const t0 = performance.now()
  await engineRun(sb.engine, ['start', sb.container])
  await execSh(sb.engine, sb.container, devRestartScript(sb.port))
  return Math.round(performance.now() - t0)
}

/** Stop the sandbox, keeping its filesystem (decision 8). */
export async function stopSandbox(sb: WorkerSandbox): Promise<void> {
  await engineRun(sb.engine, ['stop', '-t', '5', sb.container]).catch(() => {})
}

/** Remove the sandbox, the worker branch on the host and its bare copy (decision 18). */
export async function removeSandbox(sb: WorkerSandbox): Promise<void> {
  await engineRun(sb.engine, ['rm', '-f', sb.container]).catch(() => {})
  await git(sb.repoPath, ['branch', '-D', sb.branch]).catch(() => {})
  rmSync(workerOrigin(sb.id), { recursive: true, force: true })
}

/** The handback the worker wrote since the last one taken, removed as it is read so one handback wakes the lead once. */
export async function takeHandbackNote(sb: WorkerSandbox): Promise<HandbackNote | undefined> {
  const file = `${IN.state}/handback.json`
  let raw: string
  try {
    raw = await execSh(sb.engine, sb.container, `cat ${file} 2>/dev/null && rm -f ${file} || true`)
  } catch {
    return undefined
  }
  if (!raw.trim()) return undefined
  return JSON.parse(raw) as HandbackNote
}

/**
 * Whether Claude Code's transcript of `conversationId` is inside the sandbox,
 * where the worker's agent keeps it: the host disk never holds it, so the host's
 * own check would call every worker conversation gone. An id that is not a
 * plain token is never looked for.
 */
export async function conversationInSandbox(sb: WorkerSandbox, conversationId: string): Promise<boolean> {
  if (!/^[\w-]+$/.test(conversationId)) return false
  const out = await execSh(sb.engine, sb.container, `ls "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects/*/${conversationId}.jsonl >/dev/null 2>&1 && echo yes || true`)
  return out.trim() === 'yes'
}

/** Bring the worker's commits from its own bare copy into the host repo; a fetch runs none of that repo's hooks. */
export async function fetchWorkerBranch(sb: WorkerSandbox): Promise<void> {
  await git(sb.repoPath, ['fetch', '-q', workerOrigin(sb.id), `+refs/heads/${sb.branch}:refs/heads/${sb.branch}`])
}

/** What a worker of each kind does with its turn and when it hands back (decision 5). */
function howItHandsBack(kind: WorkerKind): string {
  switch (kind) {
    case 'with-you':
      return (
        '- This is work the human judges by eye. Make a first pass, show it (start_dev_server), then end your turn and wait for the human. ' +
        'Iterate with them; hand back only once they say they are happy, or they ask you to hand back.'
      )
    case 'on-its-own':
      return (
        '- Work on your own. When the done-when is met (or you cannot meet it), hand back. ' +
        'End your turn without handing back only to ask the human a real question.'
      )
    case 'unassigned':
      return '- The human started you without an assignment: wait for what they ask. Hand back when they ask you to, or when the work they asked for is done.'
  }
}

/** The worker's briefing, appended to Claude Code's system prompt. */
export function workerBriefing(sb: WorkerSandbox, brief: WorkerBrief): string {
  return [
    `# You are a runcastle worker: ${brief.label}`,
    '',
    brief.kind === 'unassigned'
      ? 'The human started you on this feature. You run inside a sandbox container; the human types to you in this conversation.'
      : 'Your lead (the agent running this feature) gave you one assignment. You run inside a sandbox container; the human can open this conversation at any time and type to you.',
    '',
    ...(brief.goal ? [`## Goal\n${brief.goal}`, ''] : []),
    ...(brief.doneWhen ? [`## Done when\n${brief.doneWhen}`, ''] : []),
    '## How you work',
    `- Work in ${IN.repo}, on branch ${sb.branch}. Commit as you go with conventional messages: every commit is copied back to runcastle automatically. Uncommitted work is not handed back.`,
    `- To show the human a screen, call start_dev_server. Your dev server must listen on 0.0.0.0, port ${sb.port}; the human opens it at ${sb.previewUrl}.`,
    '- You have no route to runcastle or the internet beyond what the sandbox allows; your tools are hand_back and start_dev_server.',
    howItHandsBack(brief.kind),
    '- To hand back, call hand_back with a short summary: what you did, what is left, and every direction the human gave you directly in this conversation (your lead never reads it, so the summary is the only way it learns them). Then end your turn.',
  ].join('\n')
}

/**
 * The sandbox transport (decision 2): the ACP adapter runs inside the
 * container, reached over `docker exec -i` stdio. The session opens in the
 * container's clone, with the worker's own MCP server and no permission prompts.
 */
export async function workerProcess(sb: WorkerSandbox, brief: WorkerBrief, token: string, model?: string): Promise<AgentProcess> {
  await ensureSandboxRunning(sb)
  const child = spawn(sb.engine, adapterExecArgs(sb.container, sb.port, sb.previewUrl), {
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
      { name: 'WORKER_PORT', value: String(sb.port) },
      { name: 'WORKER_PREVIEW_URL', value: sb.previewUrl },
      { name: 'PATH', value: '/home/agent/.local/bin:/usr/local/bin:/usr/bin:/bin' },
    ],
  }
  return {
    target: acp.ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>),
    exited,
    kill: async () => {
      child.kill('SIGTERM')
      // Killing the exec client does not end the process inside the container.
      await execSh(sb.engine, sb.container, `pkill -f ${IN.runtime}/acp.mjs || true`).catch(() => {})
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
            extraArgs: { 'append-system-prompt': workerBriefing(sb, brief) },
          },
        },
      },
      mode: 'bypassPermissions',
    },
  }
}
