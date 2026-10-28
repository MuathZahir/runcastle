import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { getSessionMessages, query, type SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { claudeRuntime } from '../launcher/runtimes/claude'
import { codexRuntime } from '../launcher/runtimes/codex'
import { killProcessTree } from '../pty/kill-tree'
import { spawnTargetFor, type SpawnTarget } from '../util/resolve-executable'
import { runcastleVersion } from '../version'

/**
 * What the ACP adapters do not hand a client, read from the sources the
 * adapters read it from (chat-as-web-components ticket 5):
 *
 * - The account's usage limits. claude-agent-acp asks the Agent SDK's
 *   structured usage control only to render a `/usage` turn as Markdown, and
 *   codex-acp reads `account/rateLimits/read` only to render `/status`; neither
 *   answers a client's request for them. So runcastle asks the same two sources
 *   itself.
 * - Claude Code's file checkpoints. claude-agent-acp turns them on when the
 *   session's options ask (`enableFileCheckpointing`, see `runtimes/claude.ts`)
 *   but only ever dry-runs `rewindFiles`; the real rewind goes through the
 *   Agent SDK on the conversation the checkpoints belong to.
 *
 * Each opens a short-lived connection to the human's own CLI and closes it.
 */

const SIDE_CHANNEL_TIMEOUT_MS = 20_000

async function* noPrompts(): AsyncGenerator<never> {}

function withTimeout<T>(what: string, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out`)), SIDE_CHANNEL_TIMEOUT_MS)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** Claude's structured `/usage` response, under `usage` as `claudeUsageReport` reads it. */
export async function readClaudeUsage(): Promise<unknown> {
  const q = query({ prompt: noPrompts(), options: { pathToClaudeCodeExecutable: claudeRuntime.resolveBinary() } })
  try {
    return { usage: await withTimeout('Claude usage', q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()) }
  } finally {
    q.close()
  }
}

/**
 * The Codex app server's `account/rateLimits/read` response, as `codexUsageReport` reads it.
 * `codex` on Windows is npm's `codex.cmd` shim, which a plain spawn cannot run
 * (codex-acp spawns it through cross-spawn for the same reason), so the app
 * server starts through {@link spawnTargetFor}; `target` is injected in tests.
 */
export function readCodexRateLimits(target: SpawnTarget = spawnTargetFor(codexRuntime.resolveBinary(), ['app-server'])): Promise<unknown> {
  const child = spawn(target.file, target.args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
  const send = (message: Record<string, unknown>) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
  const read = new Promise<unknown>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', () => reject(new Error('the Codex app server exited')))
    createInterface({ input: child.stdout }).on('line', (line) => {
      let message: { id?: number; method?: string; result?: unknown; error?: { message?: string } }
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      // The app server's own notifications and requests are not the answers waited on.
      if (message.method !== undefined) return
      if (message.error) reject(new Error(message.error.message ?? 'the Codex app server refused'))
      else if (message.id === 0) send({ id: 1, method: 'account/rateLimits/read' })
      else if (message.id === 1) resolve(message.result)
    })
    send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'runcastle', title: 'runcastle', version: runcastleVersion() } } })
  })
  return withTimeout('Codex rate limits', read).finally(() => {
    if (child.pid !== undefined && child.exitCode === null) void killProcessTree(child.pid).catch(() => {})
  })
}

/** The text of a transcript user message the human (or runcastle) typed; null for a tool result. */
function promptText(message: SessionMessage): string | null {
  if (message.type !== 'user' || message.parent_tool_use_id !== null) return null
  const content = (message.message as { content?: unknown } | null)?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content) || content.some((b) => (b as { type?: string }).type === 'tool_result')) return null
  return content.flatMap((b) => ((b as { type?: string }).type === 'text' ? [(b as { text: string }).text] : [])).join('\n')
}

/**
 * Put the worktree's files back as they were when the prompt was sent: the
 * `occurrence`-th (1-based) of the conversation's prompts whose text holds
 * `text`, the last such one when there are fewer.
 */
export async function rewindClaudeFiles(input: { sessionId: string; cwd: string; text: string; occurrence: number }): Promise<void> {
  const messages = await getSessionMessages(input.sessionId, { dir: input.cwd })
  const said = input.text.trim()
  const matches = messages.filter((m) => promptText(m)?.includes(said))
  const target = matches[input.occurrence - 1] ?? matches.at(-1)
  if (!target) throw new Error('the message to rewind to is not in the conversation')
  const q = query({
    prompt: noPrompts(),
    options: {
      pathToClaudeCodeExecutable: claudeRuntime.resolveBinary(),
      cwd: input.cwd,
      resume: input.sessionId,
      enableFileCheckpointing: true,
    },
  })
  try {
    const result = await withTimeout('Rewinding the files', q.rewindFiles(target.uuid))
    if (!result.canRewind) throw new Error(result.error ?? 'Claude Code has no checkpoint for that message')
  } finally {
    q.close()
  }
}
