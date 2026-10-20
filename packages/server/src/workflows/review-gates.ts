import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { stripVTControlCharacters } from 'node:util'
import {
  type CreateSandboxOptions,
  type Sandbox,
  type SandboxExecOptions,
  createSandbox,
} from '@ai-hero/sandcastle'
import {
  type GateCommandResult,
  type Project,
  type ReviewGateRun,
  type RuncastleConfig,
  resolveBurnCacheMode,
  resolvePreparedSettings,
  resolveSandboxImage,
} from '@runcastle/core'
import { reviewGateLogDir, reviewGateLogPath } from '@runcastle/core/paths'
import { createSystemExec } from '../doctor/system-exec'
import {
  cleanupBurnWorktree,
  deleteTempBranch,
  excludeBurnWorktrees,
  pinBranchAt,
} from '../services/git'
import {
  ensureBurnCacheVolume,
  getBurnSlotAllocator,
  slotRepoPath,
} from './burn-cache'
import { killRegistry, registerHostChildren } from './kill-registry'
import {
  ISOLATED_REPO_PATH,
  SETUP_HOOK_TIMEOUT_MS,
  buildBurnCacheMounts,
  buildIsolatedSetupCommand,
  buildSlotSetupCommand,
  buildSlotStamp,
  detectPackageManager,
  readRepoToolchain,
  resolveBurnWorkspaceMode,
  resolveSetupCommand,
  selectSandbox,
  withBurnCacheSlot,
} from './ticket-burner'

/**
 * The server's own gate run for a review pass (gates-mode-review decisions
 * #1-#3): the project's verify commands, run once each against the feature
 * branch's tip in a burn-style sandbox, recorded as a {@link ReviewGateRun}.
 *
 * The reviewer used to run these itself, in the human's checkout — which is
 * still on the base branch, so "gates passed" proved only that main was green.
 * Running them here tests the branch, keeps every install inside a sandbox
 * (ADR-0005), and yields a record the review page can show as-is.
 */

/**
 * Each verify command's time limit: the burn install step's own 15 minutes, so
 * one hung test cannot stall the review indefinitely (decision 3).
 */
export const GATE_COMMAND_TIMEOUT_MS = SETUP_HOOK_TIMEOUT_MS

/** What a gate command produced — sandcastle's `exec` result, which never throws on non-zero. */
export interface GateExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** An opened, installed sandbox holding the throwaway branch, ready for commands. */
export interface GateSandbox {
  exec(command: string): Promise<GateExecResult>
}

/**
 * Open a sandbox on `branch`, install its dependencies, hand it to `use`, and
 * tear it down on every exit path — killing any command still running in it —
 * before resolving. Rejects when the sandbox cannot be opened or the install
 * fails — {@link runReviewGates} turns that into `couldnt_run`.
 */
export type WithGateSandbox = <T>(
  branch: string,
  use: (sandbox: GateSandbox) => Promise<T>,
) => Promise<T>

export interface ReviewGatesDeps {
  /** The sandbox boundary; defaults to the burn execution path. */
  withSandbox?: WithGateSandbox
  /** Per-command time limit; defaults to {@link GATE_COMMAND_TIMEOUT_MS}. */
  commandTimeoutMs?: number
}

export interface ReviewGatesInput {
  config: RuncastleConfig
  project: Project
  /** The review ticket the record and its logs belong to. */
  ticketId: string
  /** The feature-branch tip the gates run against. */
  sha: string
  deps?: ReviewGatesDeps
}

/** The throwaway branch the gate sandbox checks out, so the feature branch never is. */
export function reviewGateBranch(ticketId: string): string {
  return `runcastle/gates/${ticketId}`
}

/** `verifyCommands` is free text, one command per line; blank lines are not commands. */
export function parseVerifyCommands(verifyCommands: string | undefined): string[] {
  return (verifyCommands ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * A sandbox that opened but whose setup — the slot sync, the clone, the
 * install — failed or hung, so its checkout is no place to run a command.
 * `output` is the setup's own, the log a reader needs.
 */
export class SandboxSetupError extends Error {
  constructor(message: string, readonly output: string) {
    super(message)
    this.name = 'SandboxSetupError'
  }
}

/** An error in full, for a log: a failed setup's own output, else the stack. */
export function errorDetail(err: unknown): string {
  if (err instanceof SandboxSetupError) return `${err.message}\n\n${stripVTControlCharacters(err.output)}`
  return err instanceof Error ? (err.stack ?? err.message) : String(err)
}

/** The first non-blank line of an error — what fits in a one-line reason. */
export function headline(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? 'unknown error'
}

/**
 * Pin the throwaway `branch` at `sha` for `use`, and discard it (and any
 * worktree a sandbox left on it) on every exit path, including a crashed
 * earlier run's leftovers before it starts.
 */
export async function withThrowawayBranch<T>(
  repoPath: string,
  branch: string,
  sha: string,
  use: () => Promise<T>,
): Promise<T> {
  const discardBranch = async (): Promise<void> => {
    await cleanupBurnWorktree(repoPath, branch)
    await deleteTempBranch(repoPath, branch)
  }
  try {
    // A crashed earlier run may have left the branch pinned by its worktree,
    // which would refuse the move below.
    await discardBranch()
    await pinBranchAt(repoPath, branch, sha)
    // The sandbox is a burn worktree too, and may be the project's first.
    await excludeBurnWorktrees(repoPath)
    return await use()
  } finally {
    await discardBranch()
  }
}

/**
 * One command against its time limit. sandcastle's `exec` cannot be aborted, so
 * `'timeout'` leaves it running: the caller must end the sandbox to kill it.
 */
export async function execWithTimeout(
  sandbox: GateSandbox,
  command: string,
  timeoutMs: number,
): Promise<GateExecResult | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>((done) => {
    timer = setTimeout(() => done('timeout'), timeoutMs)
  })
  try {
    return await Promise.race([sandbox.exec(command), timedOut])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Run a sandbox's setup script against its time limit, and
 * reject with a {@link SandboxSetupError} when it does not exit 0. A hung
 * setup is left running, like a timed-out command: the caller's teardown
 * kills it. Its output so far is what streamed out before the limit.
 */
async function runSandboxSetup(
  exec: (command: string, opts: SandboxExecOptions) => Promise<GateExecResult>,
  setup: string,
  timeoutMs: number,
): Promise<void> {
  const streamed: string[] = []
  const result = await execWithTimeout(
    { exec: (command) => exec(command, { onLine: (line) => streamed.push(line) }) },
    setup,
    timeoutMs,
  )
  if (result === 'timeout') {
    throw new SandboxSetupError(
      `the sync-and-install setup ${timeoutReason(timeoutMs)}`,
      streamed.join('\n'),
    )
  }
  if (result.exitCode !== 0) {
    throw new SandboxSetupError(
      `the sync-and-install setup exited ${result.exitCode}`,
      [result.stdout, result.stderr].filter(Boolean).join('\n'),
    )
  }
}

/** The one-line reason a command abandoned at its time limit is given. */
export function timeoutReason(timeoutMs: number): string {
  return `timed out after ${Math.round(timeoutMs / 60_000)} minutes`
}

/**
 * Run the project's verify commands against `sha` and return the record. Never
 * throws for an environment that fails — a sandbox that will not open, an
 * install that fails, a command that hangs all come back as `couldnt_run`.
 */
export async function runReviewGates(input: ReviewGatesInput): Promise<ReviewGateRun> {
  const { config, project, ticketId, sha } = input
  const commands = parseVerifyCommands(resolvePreparedSettings(config, project).verifyCommands)
  if (commands.length === 0) return { status: 'none_configured' }

  const withSandbox = input.deps?.withSandbox ?? burnGateSandbox(config, project)
  const timeoutMs = input.deps?.commandTimeoutMs ?? GATE_COMMAND_TIMEOUT_MS
  const branch = reviewGateBranch(ticketId)

  const results: GateCommandResult[] = []
  try {
    // Fresh logs only: a re-run of this pass must not leave an older run's
    // `run.log` or surplus `<i>.log` beside the record it replaces. Inside the
    // try because a log held open (EBUSY/EPERM on Windows) must not escape.
    rmSync(reviewGateLogDir(ticketId), { recursive: true, force: true })
    mkdirSync(reviewGateLogDir(ticketId), { recursive: true })
    await withThrowawayBranch(project.repoPath, branch, sha, async () => {
      // sandcastle's `exec` cannot be aborted, so a command over its time limit
      // ends the sandbox it ran in — the teardown is what kills it — and the rest
      // run in a fresh one. No two commands ever run side by side.
      while (results.length < commands.length) {
        await withSandbox(branch, async (sandbox) => {
          for (const [i, command] of commands.entries()) {
            if (i < results.length) continue
            const { result, stillRunning } = await runGateCommand(
              sandbox, command, ticketId, `${i}.log`, timeoutMs,
            )
            results.push(result)
            if (stillRunning) return
          }
        })
      }
    })
    return { status: 'ran', commit: sha, commands: results }
  } catch (err) {
    if (results.length > 0) {
      const detail = errorDetail(err)
      // Only a reopen after a timeout gets here: keep what already ran.
      const reason = `the gate sandbox could not be reopened: ${headline(errorText(err))}`
      for (const [i, command] of commands.entries()) {
        if (i < results.length) continue
        writeFileSync(reviewGateLogPath(ticketId, `${i}.log`), `${detail}\n`)
        results.push({ command, outcome: 'couldnt_run', exitCode: null, reason, log: `${i}.log` })
      }
      return { status: 'ran', commit: sha, commands: results }
    }
    return {
      status: 'couldnt_run',
      commit: sha,
      reason: `the gate sandbox could not be set up: ${headline(errorText(err))}`,
      log: writeRunLog(ticketId, err),
    }
  }
}

/**
 * Keep a failed run's full error as `run.log`, and name it — or `null` when the
 * log dir is itself what failed, so the record still comes back.
 */
function writeRunLog(ticketId: string, err: unknown): 'run.log' | null {
  try {
    writeFileSync(reviewGateLogPath(ticketId, 'run.log'), `${errorDetail(err)}\n`)
    return 'run.log'
  } catch {
    return null
  }
}

/** A command's record, and whether it was abandoned at its time limit while still running. */
interface GateCommandRun {
  result: GateCommandResult
  stillRunning: boolean
}

async function runGateCommand(
  sandbox: GateSandbox,
  command: string,
  ticketId: string,
  log: string,
  timeoutMs: number,
): Promise<GateCommandRun> {
  const logPath = reviewGateLogPath(ticketId, log)
  try {
    const result = await execWithTimeout(sandbox, command, timeoutMs)
    if (result === 'timeout') {
      const reason = timeoutReason(timeoutMs)
      writeFileSync(logPath, `${reason}\n`)
      return {
        result: { command, outcome: 'couldnt_run', exitCode: null, reason, log },
        stillRunning: true,
      }
    }
    writeFileSync(logPath, [result.stdout, result.stderr].filter(Boolean).join('\n'))
    return {
      result: result.exitCode === 0
        ? { command, outcome: 'passed', exitCode: 0, log }
        : { command, outcome: 'failed', exitCode: result.exitCode, log },
      stillRunning: false,
    }
  } catch (err) {
    const reason = `could not start: ${headline(errorText(err))}`
    writeFileSync(logPath, `${errorText(err)}\n`)
    return {
      result: { command, outcome: 'couldnt_run', exitCode: null, reason, log },
      stillRunning: false,
    }
  }
}

export interface BurnGateSandboxDeps {
  /** sandcastle's `createSandbox`: the container (or host) boundary itself. */
  open?: (options: CreateSandboxOptions) => Promise<Pick<Sandbox, 'exec' | 'close'>>
  /** The setup's time limit; defaults to the burn install's. */
  setupTimeoutMs?: number
}

/**
 * The real sandbox boundary: wherever this project's burns run (decision 2),
 * set up exactly as a burn's is — the same image and cache mounts, the same
 * slot / isolated / mounted setup hook and install, a warm cache slot when one
 * is free. No agent runs, so the prompt-only pieces (burn guard, agent auth)
 * are left out. A setup that fails or hangs rejects with a
 * {@link SandboxSetupError}; nothing then runs in that checkout.
 */
export function burnGateSandbox(
  config: RuncastleConfig,
  project: Project,
  deps: BurnGateSandboxDeps = {},
): WithGateSandbox {
  const open = deps.open ?? createSandbox
  const setupTimeoutMs = deps.setupTimeoutMs ?? SETUP_HOOK_TIMEOUT_MS
  return (branch, use) => {
    const allocator =
      resolveBurnCacheMode(config) === 'volume'
        ? getBurnSlotAllocator(config.burnConcurrency)
        : undefined
    return withBurnCacheSlot(allocator, async (slot) => {
      if (slot !== undefined) {
        await ensureBurnCacheVolume({
          engine: config.sandbox === 'podman' ? 'podman' : 'docker',
          imageName: resolveSandboxImage(config, project),
          projectId: project.id,
          exec: createSystemExec({ cwd: project.repoPath }),
        })
      }
      const workspaceMode = resolveBurnWorkspaceMode(
        slot === undefined ? { ...config, burnCache: 'off' } : config,
      )
      const toolchain = readRepoToolchain(project.repoPath)
      const pm = detectPackageManager(toolchain)
      const setupCommand = resolveSetupCommand(
        toolchain,
        resolvePreparedSettings(config, project).setupCommand,
      )
      const cache = buildBurnCacheMounts(slot, project.id, config.sandbox, pm)
      const onHost = config.sandbox === 'noSandbox'
      for (const mount of cache.mounts) {
        if ('hostPath' in mount) mkdirSync(mount.hostPath, { recursive: true })
      }
      const setup =
        slot !== undefined
          ? buildSlotSetupCommand(
            slot,
            branch,
            setupCommand,
            pm,
            buildSlotStamp(resolveSandboxImage(config, project), toolchain.packageManagerField),
          )
          : workspaceMode === 'isolated'
            ? buildIsolatedSetupCommand(branch, setupCommand, pm)
            : setupCommand
      // Where the installed checkout is: the slot's, the container clone, or —
      // mounted — the sandbox's own default, the worktree itself.
      const cwd =
        slot !== undefined
          ? slotRepoPath(slot)
          : workspaceMode === 'isolated'
            ? ISOLATED_REPO_PATH
            : undefined

      // The throwaway branch names this gate run, so it is the kill lane too.
      const lane = branch
      // No `onSandboxReady` hook: `createSandbox` runs one with a plain `exec`,
      // so a sync or install that failed was swallowed (its time limit too) and
      // the commands ran in a checkout nobody installed.
      const sandbox = await open({
        branch,
        sandbox: selectSandbox(config, project, cache.mounts, cache.env, {
          onChildSpawn: registerHostChildren(lane, {}),
        }),
        cwd: project.repoPath,
      })
      let running = 0
      const exec = async (command: string, opts: SandboxExecOptions): Promise<GateExecResult> => {
        running++
        try {
          return await sandbox.exec(command, opts)
        } finally {
          running--
        }
      }
      try {
        // Where the hook ran: the sandbox's own repo dir, whitelisted for git
        // first, as sandcastle did — in a container only, never the host's config.
        if (setup) {
          const script = onHost ? setup : `git config --global --add safe.directory '*' && ${setup}`
          await runSandboxSetup(exec, script, setupTimeoutMs)
        }
        return await use({
          exec: (command) => exec(command, cwd ? { cwd } : {}),
        })
      } finally {
        // A command abandoned at its time limit is still running. `close()`
        // removes a container with everything in it, but the host provider's
        // `close()` is a no-op — its child dies only by pid.
        if (running > 0) await killRegistry().killAndWait(lane)
        killRegistry().release(lane)
        await sandbox.close()
      }
    })
  }
}
