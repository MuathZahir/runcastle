import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createSandbox } from '@ai-hero/sandcastle'
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
  type CacheMount,
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
  /**
   * Where the host's {@link GateSandboxOptions.outDir} is visible to `exec`'d
   * commands — a bind mount in a container, the host path itself on the host.
   * Absent when no `outDir` was asked for.
   */
  outPath?: string
}

export interface GateSandboxOptions {
  /** A host dir commands in the sandbox may write into, read back once it closes. */
  outDir?: string
}

/** Where a container sees {@link GateSandboxOptions.outDir}. */
export const GATE_SANDBOX_OUT_PATH = '/home/agent/runcastle-stories-out'

/**
 * Open a sandbox on `branch`, install its dependencies, hand it to `use`, and
 * tear it down on every exit path — killing any command still running in it —
 * before resolving. Rejects when the sandbox cannot be opened or the install
 * fails — {@link runReviewGates} turns that into `couldnt_run`.
 */
export type WithGateSandbox = <T>(
  branch: string,
  use: (sandbox: GateSandbox) => Promise<T>,
  options?: GateSandboxOptions,
) => Promise<T>

/**
 * Work that rides the gate run's sandbox after its verify commands, so it costs
 * no second install (the UI-states build). `run` is handed the last sandbox the
 * commands ran in, or one opened just for it when there are none; `abandon` is
 * called instead when no sandbox could be had for it.
 */
export interface GateSandboxStep {
  outDir: string
  run(sandbox: GateSandbox): Promise<void>
  abandon(reason: string, err: unknown): void
}

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
  /** Run in the same sandbox once the verify commands are done; never changes the record. */
  afterCommands?: GateSandboxStep
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
  const step = input.afterCommands
  if (commands.length === 0 && !step) return { status: 'none_configured' }

  const withSandbox = input.deps?.withSandbox ?? burnGateSandbox(config, project)
  const timeoutMs = input.deps?.commandTimeoutMs ?? GATE_COMMAND_TIMEOUT_MS
  const branch = reviewGateBranch(ticketId)

  const results: GateCommandResult[] = []
  let stepRan = false
  const runStep = async (sandbox: GateSandbox): Promise<void> => {
    if (!step) return
    stepRan = true
    try {
      await step.run(sandbox)
    } catch (err) {
      step.abandon(`it failed in the gate sandbox: ${headline(errorText(err))}`, err)
    }
  }
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
      while (results.length < commands.length || (step && !stepRan)) {
        await withSandbox(branch, async (sandbox) => {
          for (const [i, command] of commands.entries()) {
            if (i < results.length) continue
            const { result, stillRunning } = await runGateCommand(
              sandbox, command, ticketId, `${i}.log`, timeoutMs,
            )
            results.push(result)
            if (stillRunning) return
          }
          await runStep(sandbox)
        }, step ? { outDir: step.outDir } : undefined)
      }
    })
    if (commands.length === 0) return { status: 'none_configured' }
    return { status: 'ran', commit: sha, commands: results }
  } catch (err) {
    if (step && !stepRan) {
      step.abandon(`the gate sandbox could not be set up: ${headline(errorText(err))}`, err)
    }
    if (commands.length === 0) return { status: 'none_configured' }
    if (results.length > 0) {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
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
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  try {
    writeFileSync(reviewGateLogPath(ticketId, 'run.log'), `${detail}\n`)
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

/**
 * The real sandbox boundary: wherever this project's burns run (decision 2),
 * set up exactly as a burn's is — the same image and cache mounts, the same
 * slot / isolated / mounted setup hook and install, a warm cache slot when one
 * is free. No agent runs, so the prompt-only pieces (burn guard, agent auth)
 * are left out.
 */
export function burnGateSandbox(config: RuncastleConfig, project: Project): WithGateSandbox {
  return (branch, use, options = {}) => {
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
      // The out dir is written from inside the container and read on the host
      // once it closes; on the host there is nothing to mount.
      const onHost = config.sandbox === 'noSandbox'
      const mounts: CacheMount[] = options.outDir && !onHost
        ? [...cache.mounts, { hostPath: options.outDir, sandboxPath: GATE_SANDBOX_OUT_PATH }]
        : cache.mounts
      const outPath = options.outDir ? (onHost ? options.outDir : GATE_SANDBOX_OUT_PATH) : undefined
      for (const mount of mounts) {
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
      const sandbox = await createSandbox({
        branch,
        sandbox: selectSandbox(config, project, mounts, cache.env, {
          onChildSpawn: registerHostChildren(lane, {}),
        }),
        cwd: project.repoPath,
        ...(setup
          ? { hooks: { sandbox: { onSandboxReady: [{ command: setup, timeoutMs: SETUP_HOOK_TIMEOUT_MS }] } } }
          : {}),
      })
      let running = 0
      try {
        return await use({
          ...(outPath ? { outPath } : {}),
          exec: async (command) => {
            running++
            try {
              return await sandbox.exec(command, cwd ? { cwd } : {})
            } finally {
              running--
            }
          },
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
