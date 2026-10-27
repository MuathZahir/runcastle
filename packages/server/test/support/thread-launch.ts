import { readFileSync } from 'node:fs'
import { DEFAULT_RUNTIME, type ThreadEvent } from '@runcastle/core'
import type { AppCtx } from '../../src/db/types'
import { getSessionRow } from '../../src/launcher/sessions'
import { runtimeAdapterFor } from '../../src/launcher/runtimes'
import type { AcpLaunchSpec } from '../../src/launcher/runtimes/types'
import { acpLaunchInput } from '../../src/threads/launch'
import { readThreadEvents } from '../../src/threads/types'

/**
 * Reading what a launch did to its thread (chat-as-web-components ticket 4):
 * the prompts it said into the thread's log, and the ACP launch — briefing
 * files included — the thread's process would start with.
 */

type Prompt = Extract<ThreadEvent, { type: 'prompt' }>

/** Every prompt in the thread's log, oldest first. */
export function promptsOf(threadId: string): Prompt[] {
  return readThreadEvents(threadId).filter((e): e is Prompt => e.type === 'prompt')
}

/** The thread's first prompt — a launch's kickoff — or '' when nothing was said. */
export function kickoffOf(threadId: string): string {
  return promptsOf(threadId)[0]?.text ?? ''
}

/** The ACP launch of the thread's row, written to disk as its process start writes it. */
export async function acpLaunchOf(ctx: AppCtx, threadId: string): Promise<AcpLaunchSpec> {
  const row = getSessionRow(ctx, threadId)
  if (!row) throw new Error(`no thread ${threadId}`)
  const runtime = runtimeAdapterFor(row.runtime ?? DEFAULT_RUNTIME)
  return runtime.acpLaunch!(await acpLaunchInput(ctx, row))
}

/** The system prompt (Claude) or AGENTS.md (Codex) the thread's process is briefed with. */
export async function briefOf(ctx: AppCtx, threadId: string): Promise<string> {
  const spec = await acpLaunchOf(ctx, threadId)
  const file = spec.files.find((f) => /system-prompt\.md$|AGENTS\.md$/.test(f))
  if (!file) throw new Error(`no briefing among ${spec.files.join(', ')}`)
  return readFileSync(file, 'utf8')
}
