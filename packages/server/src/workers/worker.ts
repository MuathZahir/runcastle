import { execFile, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { promisify } from 'node:util'
import * as acp from '@agentclientprotocol/sdk/unstable'
import type { AgentRuntime, WorkerKind } from '@runcastle/core'
import { dataDir } from '@runcastle/core/paths'
import type { AgentProcess } from '../threads/host'
import { CODEX_SETUP_MANAGED } from './codex-setup'
import { type WorkerPermissionMode, permissionModeOf, workerAllowsItself } from './permissions'
import {
  CODEX_AUTO_REVIEW_MODE,
  type Engine,
  IN,
  adapterEntry,
  adapterExecArgs,
  adapterVersion,
  codexAdapterEntry,
  codexAdapterExecArgs,
  codexAdapterVersion,
  containerState,
  cacheDirsScript,
  devRestartScript,
  engineRun,
  guardInstallScript,
  execSh,
  installScript,
  mcpMergeScript,
  pickFreePort,
  projectSetupScript,
  relayExecArgs,
  runArgs,
  setupClearScript,
  setupScript,
  workerMcpServer,
} from './sandbox'
import { SETUP_MANAGED, type WorkerSetup } from './setup-copy'
import { type WorkerToolHandler, serveToolRelay } from './tool-relay'
import { WORKER_MCP_SCRIPT, WORKER_RELAY_SCRIPT } from './worker-mcp-script'

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
  /** The agent runtime inside it: Claude Code or Codex (decision 12). */
  runtime: AgentRuntime
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

/** Each runtime's adapter in the runtime dir: the file it is bundled to, and the host entry it is bundled from. */
const ADAPTER_BUNDLES: Record<AgentRuntime, { file: string; entry: () => string }> = {
  'claude-code': { file: 'acp.mjs', entry: adapterEntry },
  codex: { file: 'codex-acp.mjs', entry: codexAdapterEntry },
}

/**
 * The `runtime`'s adapter bundled to one file plus the worker's MCP script,
 * mounted read-only. The dir is named by both adapters' versions; each bundle
 * is built once, when a worker on its runtime first needs it.
 */
export async function ensureRuntimeDir(runtime: AgentRuntime): Promise<string> {
  const dir = join(workersDir(), 'runtime', `${adapterVersion()}-codex${codexAdapterVersion()}`)
  const adapter = ADAPTER_BUNDLES[runtime]
  const bundle = join(dir, adapter.file)
  if (!existsSync(bundle)) {
    mkdirSync(dir, { recursive: true })
    // The Bun CLI, not `Bun.build`: the web typecheck reads this file without Bun's types.
    await execFileP(process.execPath, ['build', '--target=node', '--format=esm', `--outfile=${bundle}`, adapter.entry()], { maxBuffer: 8 * 1024 * 1024 })
  }
  writeFileSync(join(dir, 'worker-mcp.cjs'), WORKER_MCP_SCRIPT)
  writeFileSync(join(dir, 'worker-relay.cjs'), WORKER_RELAY_SCRIPT)
  return dir
}

const execFileP = promisify(execFile)

async function git(repo: string, args: string[]): Promise<string> {
  return (await execFileP('git', ['-C', repo, ...args], { maxBuffer: 8 * 1024 * 1024 })).stdout
}

export interface NewSandboxInput {
  id: string
  engine: Engine
  runtime: AgentRuntime
  container: string
  branch: string
  image: string
  repoPath: string
  featureBranch: string
  /** Ports other workers hold, even stopped ones: never handed out again (review finding). */
  takenPorts: ReadonlySet<number>
  /** Skip the dependency install (the harness measures it separately). */
  skipInstall?: boolean
  /** The project's burn cache volume, its package-manager store env and the dirs to make on it; absent with `burnCache: 'off'`. */
  cache?: { volume: string; env: Record<string, string>; dirs: string[] }
  /** `--cpus` for the container (`burnCpus`). */
  cpus?: number
  /** The project's `setupCommand`, run in the clone after the install. */
  setupCommand?: string
}

/** Create the worker's branch and sandbox: container up, clone made, dependencies installed. Times each step. */
export async function createWorkerSandbox(input: NewSandboxInput): Promise<WorkerSandbox & { timings: Record<string, number> }> {
  const port = await pickFreePort(41000, 400, input.takenPorts)
  const sb = {
    id: input.id,
    engine: input.engine,
    runtime: input.runtime,
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
  const runtimeDir = await timed('runtimeBundle', () => ensureRuntimeDir(input.runtime))
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
        ...(input.cache ? { cache: { volume: input.cache.volume, env: input.cache.env } } : {}),
        ...(input.cpus !== undefined ? { cpus: input.cpus } : {}),
      }),
    ),
  )
  if (input.cache) await execSh(sb.engine, sb.container, cacheDirsScript(input.cache.dirs))
  await timed('clone', () =>
    execSh(sb.engine, sb.container, setupScript({ featureBranch: input.featureBranch, workerBranch: sb.branch, gitName, gitEmail })),
  )
  if (!input.skipInstall) await timed('install', () => execSh(sb.engine, sb.container, installScript()))
  if (!input.skipInstall && input.setupCommand) await timed('setupCommand', () => execSh(sb.engine, sb.container, projectSetupScript(input.setupCommand!)))
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

/** Every worker container on the engine, stopped ones too, by name: true when it runs. */
export async function workerContainers(engine: Engine): Promise<Map<string, boolean>> {
  const out = await engineRun(engine, ['ps', '-a', '--filter', 'name=runcastle-worker-', '--format', '{{.Names}}\t{{.State}}'])
  const found = new Map<string, boolean>()
  for (const line of out.split('\n')) {
    const [name, state] = line.trim().split('\t')
    if (name) found.set(name, state === 'running')
  }
  return found
}

/** Remove the sandbox, the worker branch on the host and its bare copy (decision 18). */
export async function removeSandbox(sb: WorkerSandbox): Promise<void> {
  await engineRun(sb.engine, ['rm', '-f', sb.container]).catch(() => {})
  await git(sb.repoPath, ['branch', '-D', sb.branch]).catch(() => {})
  rmSync(workerOrigin(sb.id), { recursive: true, force: true })
}

/** The handback the worker wrote since the last one taken, removed as it is read so one handback wakes the lead once. */
/** Whether the worker has started a dev server: its start_dev_server tool records the command. */
export async function devServerRecorded(sb: WorkerSandbox): Promise<boolean> {
  try {
    return (await execSh(sb.engine, sb.container, `[ -f ${IN.state}/dev.json ] && echo yes || true`)).trim() === 'yes'
  } catch {
    return false
  }
}

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
 * Whether the agent's record of `conversationId` is inside the sandbox, where
 * the worker's agent keeps it: the host disk never holds it, so the host's own
 * check would call every worker conversation gone. An id that is not a plain
 * token is never looked for.
 */
export async function conversationInSandbox(sb: WorkerSandbox, conversationId: string): Promise<boolean> {
  if (!/^[\w-]+$/.test(conversationId)) return false
  const out = await execSh(sb.engine, sb.container, conversationLookupScript(sb.runtime, conversationId))
  return out.trim() === 'yes'
}

/** The shell check that prints `yes` when the runtime's record of `conversationId` is in the sandbox: Claude Code's transcript, or Codex's rollout. */
export function conversationLookupScript(runtime: AgentRuntime, conversationId: string): string {
  return runtime === 'codex'
    ? `find ${IN.codexHome}/sessions -name 'rollout-*-${conversationId}.jsonl' 2>/dev/null | grep -q . && echo yes || true`
    : `ls "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects/*/${conversationId}.jsonl >/dev/null 2>&1 && echo yes || true`
}

/** The shell that prints the path of the runtime's record of `conversationId` inside the sandbox, or nothing. */
export function conversationPathScript(runtime: AgentRuntime, conversationId: string): string {
  return runtime === 'codex'
    ? `find ${IN.codexHome}/sessions -name 'rollout-*-${conversationId}.jsonl' 2>/dev/null | head -n 1`
    : `ls "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/projects/*/${conversationId}.jsonl 2>/dev/null | head -n 1`
}

/**
 * Where, inside the sandbox, the agent keeps its own record of `conversationId`
 * (Claude's session file, Codex's rollout); undefined when there is none. An id
 * that is not a plain token is never looked for.
 */
export async function conversationPathInSandbox(sb: WorkerSandbox, conversationId: string): Promise<string | undefined> {
  if (!/^[\w-]+$/.test(conversationId)) return undefined
  await ensureSandboxRunning(sb)
  const out = await execSh(sb.engine, sb.container, conversationPathScript(sb.runtime, conversationId))
  return out.trim().split('\n')[0] || undefined
}

/** Bring the worker's commits from its own bare copy into the host repo; a fetch runs none of that repo's hooks. */
export async function fetchWorkerBranch(sb: WorkerSandbox): Promise<void> {
  await git(sb.repoPath, ['fetch', '-q', workerOrigin(sb.id), `+refs/heads/${sb.branch}:refs/heads/${sb.branch}`])
}

/**
 * Bring the feature branch's current tip from the host repo into the worker's
 * bare copy, which was cloned with that branch alone and never moves by
 * itself: a worker sent back to merge the feature branch in then reaches it
 * with `git fetch origin` (burns-become-workers decision 6).
 */
export async function refreshWorkerFeatureBranch(sb: WorkerSandbox): Promise<void> {
  await git(workerOrigin(sb.id), ['fetch', '-q', '--update-head-ok', sb.repoPath, `+refs/heads/${sb.featureBranch}:refs/heads/${sb.featureBranch}`])
}

/**
 * Put the human's setup into the sandbox's home (decisions 8, 12), in place
 * of an earlier start's copy: staged on the host (owner-only, since it carries
 * logins), copied in with the engine's `cp`, the staging removed after.
 * The sandbox's own conversations (and Claude's `~/.claude.json` state) stay;
 * a Claude setup replaces only its `mcpServers`, a Codex one carries them in
 * its `config.toml`. The fingerprint is written last, so a copy cut off midway
 * is made again at the next start.
 */
export async function copyWorkerSetup(sb: WorkerSandbox, setup: WorkerSetup, fingerprint: string, opts: { guard?: boolean } = {}): Promise<void> {
  await ensureSandboxRunning(sb)
  const stage = join(workersDir(), 'setup', sb.id)
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true, mode: 0o700 })
  try {
    for (const f of setup.files) {
      const dest = join(stage, ...f.to.split('/'))
      mkdirSync(dirname(dest), { recursive: true })
      if (f.content !== undefined) writeFileSync(dest, f.content, { mode: 0o600 })
      else if (f.from) {
        try {
          // A plugin's `.in_use` markers name the host's processes, not the sandbox's.
          cpSync(f.from, dest, { recursive: true, dereference: true, filter: (src) => basename(src) !== '.in_use' })
        } catch (err) {
          // One unreadable skill or a dangling link must not keep the worker from starting.
          console.error(`worker ${sb.id}: left ${f.to} out of its setup copy`, err)
        }
      }
    }
    const claudeMcp = 'mcpServers' in setup ? setup.mcpServers : undefined
    if (claudeMcp) {
      const mcp = join(stage, '.runcastle', 'user-mcp.json')
      mkdirSync(dirname(mcp), { recursive: true })
      writeFileSync(mcp, JSON.stringify(claudeMcp), { mode: 0o600 })
    }
    await execSh(sb.engine, sb.container, setupClearScript([...SETUP_MANAGED, ...CODEX_SETUP_MANAGED, SETUP_FINGERPRINT]))
    // `-a` keeps the host owner, which is the user the sandbox runs as.
    await engineRun(sb.engine, ['cp', '-a', `${stage}/.`, `${sb.container}:${IN.home}`])
    if (claudeMcp) await execSh(sb.engine, sb.container, mcpMergeScript())
    // Runcastle's own hook, written after the copy that cleared `settings.json` and before the fingerprint that vouches for it.
    if (opts.guard && sb.runtime === 'claude-code') await execSh(sb.engine, sb.container, guardInstallScript())
    if (!/^[\w-]+$/.test(fingerprint)) throw new Error('a setup fingerprint is a plain token')
    await execSh(sb.engine, sb.container, `printf '%s' ${fingerprint} > ${IN.home}/${SETUP_FINGERPRINT}`)
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

/** Where, under the sandbox's home, the fingerprint of its last finished setup copy is kept. */
const SETUP_FINGERPRINT = '.runcastle/setup-fingerprint'

/** The fingerprint of the setup last copied in, read from the sandbox (woken if need be); undefined when there is none. */
export async function copiedSetupFingerprint(sb: WorkerSandbox): Promise<string | undefined> {
  await ensureSandboxRunning(sb)
  const out = await execSh(sb.engine, sb.container, `cat ${IN.home}/${SETUP_FINGERPRINT} 2>/dev/null || true`)
  return out.trim() || undefined
}

/** Copy one file out of the sandbox to `hostPath` (a file `show_file` shows). */
export async function copyOutOfSandbox(sb: WorkerSandbox, containerPath: string, hostPath: string): Promise<void> {
  mkdirSync(dirname(hostPath), { recursive: true })
  await engineRun(sb.engine, ['cp', `${sb.container}:${containerPath}`, hostPath])
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

/** The worker's briefing: appended to Claude Code's system prompt, or after the human's instructions in a Codex worker's AGENTS.md. */
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
    `- To show the human a screen, call start_dev_server. Your dev server must accept connections from outside the container: listen on 0.0.0.0 (not localhost), port ${sb.port}. The human opens it at ${sb.previewUrl}.`,
    "- Runcastle's tools for you: hand_back, start_dev_server, read_feature (the feature's state, decisions and the lead's latest turns), show_file (a file or screenshot, into this chat) and park_feature (work for another feature, parked in the backlog). You have no others, and no route to runcastle.",
    '- You run in an automatic permission mode: anything risky may be blocked. When an action is blocked, say in this chat what you wanted to do and why, then end your turn so the human can decide.',
    "- Checks: while you work, run only the tests that cover each slice before you commit it. Run the project-wide static check (typecheck or its equivalent) once at the end, and once more only after fixing what it found. Never run the full test suite or the project's verify commands whole: your lead runs those. Keep your hand-back summary short.",
    howItHandsBack(brief.kind),
    '- To hand back, call hand_back with a short summary: what you did, what is left, and every direction the human gave you directly in this conversation (your lead never reads it, so the summary is the only way it learns them). Then end your turn.',
  ].join('\n')
}

/** What a worker's agent process is started with, beyond its sandbox and brief. */
export interface WorkerProcessOptions {
  /** A Claude Code worker's token, passed into the exec by name; a Codex worker signs in with the login its setup copied in. */
  token?: string
  model?: string
  /** Runcastle's answers to the worker's relayed tools (decision 9). */
  tools: WorkerToolHandler
  /** The permission mode the session runs in, each time it is reported (decision 11). */
  onMode: (mode: WorkerPermissionMode) => void
}

/**
 * A worker process's side of its permission mode (decision 11): the mode its
 * session reports, passed on to `onMode`, decides which asks it answers itself
 * (`workerAllowsItself`).
 */
export function permissionHooks(
  onMode: (mode: WorkerPermissionMode) => void,
  runtime: AgentRuntime = 'claude-code',
): Required<Pick<AgentProcess, 'onMode' | 'allowsItself'>> {
  let mode: WorkerPermissionMode | undefined
  return {
    onMode: (modeId) => {
      const next = permissionModeOf(modeId, runtime)
      if (!next) return
      mode = next
      onMode(next)
    },
    allowsItself: (req) => workerAllowsItself(mode, req),
  }
}

/** How a worker's adapter is started in its sandbox and its session opened, per runtime: pure, so tests pin it. */
export interface WorkerLaunch {
  /** The engine's `exec` argv for the adapter. */
  execArgs: string[]
  /** What the exec client is given beyond the server's own env: a secret passed in by name. */
  env: Record<string, string>
  /** The in-container processes that end with the adapter, matched by `pkill -f`. */
  processes: string[]
  session: NonNullable<AgentProcess['session']>
}

/**
 * The launch of a worker's adapter (decisions 2, 11, 12).
 *
 * - Claude Code: claude-agent-acp, its token by name, the briefing appended to
 *   the system prompt, the worker's MCP server on the session, auto mode.
 * - Codex: codex-acp over the worker's own `CODEX_HOME`, whose `config.toml`
 *   (written with the setup copy) holds the model, auto-review, the briefing's
 *   AGENTS.md and the worker's MCP server; the session opens in auto-review.
 */
export function workerLaunch(sb: WorkerSandbox, brief: WorkerBrief, opts: Pick<WorkerProcessOptions, 'token' | 'model'>): WorkerLaunch {
  if (sb.runtime === 'codex') {
    return {
      execArgs: codexAdapterExecArgs(sb.container, sb.port, sb.previewUrl),
      env: {},
      processes: [`${IN.runtime}/codex-acp.mjs`, `${IN.codex} app-server`],
      session: { cwd: IN.repo, mcpServers: [], mode: CODEX_AUTO_REVIEW_MODE },
    }
  }
  if (!opts.token) throw new Error('a Claude Code worker needs the Claude token')
  const server = workerMcpServer(sb.port, sb.previewUrl)
  const mcp: acp.McpServer = {
    name: 'worker',
    command: server.command,
    args: server.args,
    env: Object.entries(server.env).map(([name, value]) => ({ name, value })),
  }
  return {
    execArgs: adapterExecArgs(sb.container, sb.port, sb.previewUrl),
    env: { CLAUDE_CODE_OAUTH_TOKEN: opts.token },
    processes: [`${IN.runtime}/acp.mjs`],
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
            ...(opts.model ? { model: opts.model } : {}),
            perTaskStopAffordance: false,
            extraArgs: { 'append-system-prompt': workerBriefing(sb, brief) },
          },
        },
      },
      // Also the copied settings' `permissions.defaultMode`; set again here for a resumed conversation that ran in another.
      mode: 'auto',
    },
  }
}

/**
 * The sandbox transport (decision 2): the ACP adapter runs inside the
 * container, reached over `docker exec -i` stdio, and a second exec carries the
 * tool relay. The session opens in the container's clone, with the worker's
 * own MCP server, in its runtime's automatic mode (decision 11); when the
 * session reports another mode, that mode is unavailable and the worker answers
 * its in-sandbox permission asks itself, leaving the human's MCP servers to ask.
 */
export async function workerProcess(sb: WorkerSandbox, brief: WorkerBrief, opts: WorkerProcessOptions): Promise<AgentProcess> {
  const launch = workerLaunch(sb, brief, opts)
  await ensureSandboxRunning(sb)
  await ensureRuntimeDir(sb.runtime)
  const relay = spawn(sb.engine, relayExecArgs(sb.container), { stdio: ['pipe', 'pipe', 'ignore'] })
  relay.once('error', () => {})
  serveToolRelay(relay.stdout, relay.stdin, opts.tools)
  const child = spawn(sb.engine, launch.execArgs, {
    env: { ...process.env, ...launch.env },
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
  const ended = [...launch.processes, `${IN.runtime}/worker-relay.cjs`].map((p) => `pkill -f '${p}'`).join('; ')
  return {
    target: acp.ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>),
    exited,
    kill: async () => {
      child.kill('SIGTERM')
      relay.kill('SIGTERM')
      // Killing the exec client does not end the process inside the container.
      await execSh(sb.engine, sb.container, `${ended}; true`).catch(() => {})
    },
    ...permissionHooks(opts.onMode, sb.runtime),
    session: launch.session,
  }
}
