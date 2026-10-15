import { spawn } from 'node:child_process'
import { DEFAULT_RUNTIME, type AgentRuntime, type SessionRow } from '@runcastle/core'
import { writeToLiveTerminal } from '../launcher/launcher'
import { codexHomeDir } from '../launcher/runtimes/codex'
import { resolveSpawnTarget } from '../util/resolve-executable'
import { answerOrchestratorWaiter, takeOrchestratorLines } from './orchestrator-messages'

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
  /** Lines are pending for `session`: deliver them now, or when the channel next can. */
  kick(session: SessionRow): void
}

/**
 * Claude Code: the session's `asyncRewake` hook is long-polling for its lines
 * (`renderSettings`, the hook client's `wait-messages` mode); answer it. With no
 * waiter up, the lines wait for the next one, which starts at the next turn end
 * or session start.
 */
export const asyncRewakeDelivery: OrchestratorDelivery = {
  kick: (session) => answerOrchestratorWaiter(session.id),
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
 * Codex: queue the lines to the session's thread. Codex's queue service starts a
 * turn with them when the thread is idle, or delivers them after the current
 * turn when it is busy (it polls about every 10 s). One spawn at a time per
 * session: lines arriving while one runs go in the next. Best effort — a failed
 * spawn is logged and its lines dropped.
 */
export function codexQueueDelivery(run: RunCommand = runCommand): OrchestratorDelivery {
  const running = new Set<string>()
  const send = (session: SessionRow): void => {
    if (running.has(session.id) || !session.ccSessionId) return
    const lines = takeOrchestratorLines(session.id)
    if (lines.length === 0) return
    running.add(session.id)
    void run(codexQueueCommand(session, session.ccSessionId, lines.join('\n'))).then((code) => {
      if (code !== 0) console.error(`codex queue exited ${code}; dropped ${lines.length} line(s)`)
      running.delete(session.id)
      send(session)
    })
  }
  return { kick: send }
}

/**
 * The fallback, for a runtime whose channel does not work in the interactive
 * session runcastle spawns: type the batch into the terminal. Both TUIs enable
 * bracketed paste, so the lines go as one bracketed paste — newlines inside it
 * stay newlines rather than submits — and `writeToLiveTerminal`'s per-session
 * queue submits each batch whole before the next one starts.
 */
export const typingDelivery: OrchestratorDelivery = {
  kick(session) {
    const lines = takeOrchestratorLines(session.id)
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
