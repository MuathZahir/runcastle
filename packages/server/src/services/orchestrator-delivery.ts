import { spawn } from 'node:child_process'
import { DEFAULT_RUNTIME, type AgentRuntime, type SessionRow } from '@runcastle/core'
import { writeToLiveTerminal } from '../launcher/launcher'
import { codexHomeDir } from '../launcher/runtimes/codex'
import { resolveSpawnTarget } from '../util/resolve-executable'
import { answerOrchestratorWaiter, hasOrchestratorLines, takeOrchestratorLines } from './orchestrator-messages'

/**
 * How a live orchestrator's pending lines reach it (`whole-cuts-plan-themselves`
 * decision 20): through each CLI's own channel for putting a message into a
 * live session, never typed into the terminal the human may be typing in.
 *
 * Every delivery takes ALL the session's pending lines at once and hands them
 * over as one message, one line each — so events that end together can never
 * arrive joined into one line.
 */
export interface OrchestratorDelivery {
  /**
   * Lines are pending for `session` under `key` (its own id unless said
   * otherwise — a feature lead's are under `leadMessageKey`): deliver them now,
   * or when the channel next can.
   */
  kick(session: SessionRow, key?: string): void
}

/**
 * Claude Code: the session's `asyncRewake` hook is long-polling for its lines
 * (`renderSettings`, the hook client's `wait-messages` mode); answer it. With no
 * waiter up, the lines wait for the next one, which starts at the next turn end
 * or session start.
 */
export const asyncRewakeDelivery: OrchestratorDelivery = {
  kick: (session, key = session.id) => answerOrchestratorWaiter(key),
}

/** One `codex queue` spawn: the program, its argv, and the env it runs with. */
export interface CodexQueueCommand {
  file: string
  args: string[]
  env: NodeJS.ProcessEnv
}

/**
 * `codex queue --thread <conversation id> --message <lines>` against the
 * session's own generated Codex home, where its queue lives. The conversation id
 * is the one the SessionStart hook recorded — the same one `codex resume <id>`
 * reopens. Resolved exactly as the Codex adapter resolves `codex` for a session.
 */
export function codexQueueCommand(
  session: Pick<SessionRow, 'id'>,
  conversationId: string,
  message: string,
  env: NodeJS.ProcessEnv = process.env,
): CodexQueueCommand {
  const target = resolveSpawnTarget('codex', [
    'queue',
    '--thread',
    conversationId,
    '--message',
    message,
  ])
  return { file: target.file, args: target.args, env: { ...env, CODEX_HOME: codexHomeDir(session.id) } }
}

/** Run one command to its exit. Resolves with the exit code; never rejects. */
export type RunCommand = (command: CodexQueueCommand) => Promise<number | null>

const runCommand: RunCommand = (command) =>
  new Promise((resolve) => {
    // An argv, never a shell: the message is whatever the lines say.
    const child = spawn(command.file, command.args, {
      env: command.env,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', (err) => {
      console.error('codex queue failed to start', err)
      resolve(null)
    })
    child.on('exit', (code) => resolve(code))
  })

/**
 * How long a Codex delivery waits after the first kick before it takes the
 * lines, so events that end together go as one message: a burn's review ticket
 * and the burn itself end tens of milliseconds apart. Small beside the queue
 * service's own ~10 s poll.
 */
export const CODEX_GATHER_MS = 1000

/**
 * Codex: queue the lines to the session's thread. Codex's queue service starts a
 * turn with them when the thread is idle, or delivers them after the current
 * turn when it is busy (it polls about every 10 s). The first kick opens a
 * `gatherMs` window and the lines are taken when it closes. One spawn at a time
 * per key: lines arriving while one gathers or runs go in it or the next.
 * Best effort — a failed spawn is handed to `onFailed`, which by default logs it
 * and drops its lines; it returns whether to carry on with lines that queued
 * meanwhile (`false` holds them for the next kick).
 */
export function codexQueueDelivery(
  run: RunCommand = runCommand,
  gatherMs = CODEX_GATHER_MS,
  onFailed: (key: string, lines: string[], code: number | null) => boolean = dropFailedLines,
): OrchestratorDelivery {
  const busy = new Set<string>()
  const send = (session: SessionRow, key = session.id): void => {
    const conversationId = session.ccSessionId
    if (busy.has(key) || !conversationId || !hasOrchestratorLines(key)) return
    busy.add(key)
    const deliver = (): void => {
      const lines = takeOrchestratorLines(key)
      if (lines.length === 0) {
        busy.delete(key)
        return
      }
      void run(codexQueueCommand(session, conversationId, lines.join('\n'))).then((code) => {
        busy.delete(key)
        if (code === 0 || onFailed(key, lines, code)) send(session, key)
      })
    }
    setTimeout(deliver, gatherMs).unref?.()
  }
  return { kick: send }
}

function dropFailedLines(_key: string, lines: string[], code: number | null): boolean {
  console.error(`codex queue exited ${code}; dropped ${lines.length} line(s)`)
  return true
}

/**
 * The fallback, for a runtime whose channel does not work in the interactive
 * session runcastle spawns: type the batch into the terminal. Both TUIs enable
 * bracketed paste, so the lines go as one bracketed paste — newlines inside it
 * stay newlines rather than submits — and `writeToLiveTerminal`'s per-session
 * queue submits each batch whole before the next one starts.
 */
export const typingDelivery: OrchestratorDelivery = {
  kick(session, key = session.id) {
    const lines = takeOrchestratorLines(key)
    if (lines.length > 0) writeToLiveTerminal(session.id, bracketedPaste(lines.join('\n')))
  },
}

/** `text` wrapped in the bracketed-paste markers, so a TUI reads it as one paste. */
export function bracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`
}

/**
 * Which delivery each runtime uses — the one place to flip a runtime to the
 * fallback (`typingDelivery`) if its channel turns out not to work live.
 */
const DELIVERY_BY_RUNTIME: Record<AgentRuntime, OrchestratorDelivery> = {
  'claude-code': asyncRewakeDelivery,
  codex: codexQueueDelivery(),
}

/** The delivery for a session's runtime. */
export function deliveryFor(session: Pick<SessionRow, 'runtime'>): OrchestratorDelivery {
  return DELIVERY_BY_RUNTIME[session.runtime ?? DEFAULT_RUNTIME]
}
