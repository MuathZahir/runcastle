import type * as acp from '@agentclientprotocol/sdk/unstable'
import { Effort, type ModelChoice, type ThreadEvent, type ThreadView, type ToolKind, type WorkStep } from '@runcastle/core'

/**
 * The thread controls' pure parts (chat-as-web-components ticket 5): reading
 * and setting the model, effort and fast mode through ACP session config
 * options, finding where a rewind or a branch forks the agent's conversation,
 * matching `@` files, and a thread as Markdown. The host and the thread router
 * do the IO around them.
 */

// ---- session config options ----

/** What the composer chooses for the next message. */
export interface ConfigChoice {
  model?: string
  effort?: Effort
  fast?: boolean
}

type SelectOption = Extract<acp.SessionConfigOption, { type: 'select' }>

function selectValues(option: SelectOption): { value: string; name: string; description?: string | null }[] {
  return option.options.flatMap((o) => ('group' in o ? o.options : [o]))
}

/** The model option: Claude's and Codex's are both `model`. */
export function modelOption(options: readonly acp.SessionConfigOption[] | null | undefined): SelectOption | undefined {
  const option = options?.find((o) => o.category === 'model' || o.id === 'model')
  return option?.type === 'select' ? option : undefined
}

/** The effort option: Claude's `effort`, Codex's `reasoning_effort`, both of category `thought_level`. */
function effortOption(options: readonly acp.SessionConfigOption[] | null | undefined): SelectOption | undefined {
  const option = options?.find((o) => o.category === 'thought_level')
  return option?.type === 'select' ? option : undefined
}

/** Fast mode: Claude's `fast`, Codex's `fast-mode`; a boolean, or an on/off select. Absent when the model has none. */
function fastOption(options: readonly acp.SessionConfigOption[] | null | undefined): acp.SessionConfigOption | undefined {
  return options?.find((o) => o.id === 'fast' || o.id === 'fast-mode')
}

/** The model, effort and fast mode a session's options say it runs on. */
export function currentConfig(options: readonly acp.SessionConfigOption[] | null | undefined): { model: string; label: string; effort?: Effort; fast?: boolean } | null {
  const model = modelOption(options)
  if (!model) return null
  const label = selectValues(model).find((c) => c.value === model.currentValue)?.name ?? model.currentValue
  const effort = Effort.safeParse(effortOption(options)?.currentValue)
  const fast = fastOption(options)
  const fastOn = fast?.type === 'boolean' ? fast.currentValue : fast ? fast.currentValue === 'on' : undefined
  return { model: model.currentValue, label, ...(effort.success ? { effort: effort.data } : {}), ...(fastOn !== undefined ? { fast: fastOn } : {}) }
}

/**
 * The models a session offers, for the composer's picker. The session's
 * options describe only the model it runs on, so only that one can say it
 * offers fast mode.
 */
export function modelChoices(options: readonly acp.SessionConfigOption[] | null | undefined): ModelChoice[] {
  const model = modelOption(options)
  if (!model) return []
  const fast = fastOption(options) !== undefined
  return selectValues(model).map((c) => ({
    id: c.value,
    label: c.name,
    ...(c.description ? { note: c.description } : {}),
    ...(fast && c.value === model.currentValue ? { fast: true } : {}),
  }))
}

/**
 * The `session/set_config_option` requests that move a session's options to
 * `choice`, in the order they must go: the model first, since the effort
 * levels and fast mode a session offers are the model's. A value the session
 * does not offer, or already has, asks for nothing.
 */
export function configRequests(
  sessionId: string,
  options: readonly acp.SessionConfigOption[] | null | undefined,
  choice: ConfigChoice,
): acp.SetSessionConfigOptionRequest[] {
  const out: acp.SetSessionConfigOptionRequest[] = []
  const select = (option: SelectOption | undefined, value: string | undefined) => {
    if (!option || value === undefined || option.currentValue === value) return
    if (selectValues(option).some((c) => c.value === value)) out.push({ sessionId, configId: option.id, value })
  }
  select(modelOption(options), choice.model)
  select(effortOption(options), choice.effort)
  const fast = fastOption(options)
  if (fast && choice.fast !== undefined) {
    if (fast.type === 'boolean') {
      if (fast.currentValue !== choice.fast) out.push({ sessionId, configId: fast.id, type: 'boolean', value: choice.fast })
    } else select(fast as SelectOption, choice.fast ? 'on' : 'off')
  }
  return out
}

// ---- fork points ----

/** Ids the host's update mapper makes up for chunks the adapter sent without one (see `host.ts`). */
const MADE_UP_ID = /^(msg|thought)_sess_.{12}_[0-9a-z]+_\d+$/

/** The adapter's own id for the last thing the agent said in `events`; null when it said nothing, or nothing it can fork at. */
export function lastAgentMessageId(events: readonly ThreadEvent[]): string | null | 'unknown' {
  for (let n = events.length - 1; n >= 0; n--) {
    const e = events[n]
    if (e.type === 'agent_text') return MADE_UP_ID.test(e.messageId) ? 'unknown' : e.messageId
  }
  return null
}

/** The index of the first prompt after `at` that starts a turn of its own: where the turn of the prompt at `at` ends. */
export function turnEndIndex(events: readonly ThreadEvent[], at: number): number {
  const next = events.findIndex((e, n) => n > at && e.type === 'prompt' && !e.steered)
  return next < 0 ? events.length : next
}

/**
 * The `_meta` that makes both adapters' `session/fork` fork at a message
 * (claude-agent-acp `fork-session.ts`, codex-acp `SessionFork.ts`): up to and
 * including the agent message `messageId` — Claude's API message id, Codex's
 * turn item id, as each adapter sends it on its message chunks.
 */
export function forkAtMeta(messageId: string): Record<string, unknown> {
  return { jetbrains: { air: { fork: { version: 1, messageId } } } }
}

// ---- @ files ----

/**
 * The paths matching `query` for `@`: every character of the query in order
 * (case-insensitive), the shortest path first; all paths, shortest first, for
 * an empty query.
 */
export function fuzzyFiles(paths: readonly string[], query: string, limit: number): string[] {
  const q = query.toLowerCase()
  const matches = (path: string): boolean => {
    const p = path.toLowerCase()
    let at = 0
    for (const ch of q) {
      at = p.indexOf(ch, at)
      if (at < 0) return false
      at++
    }
    return true
  }
  return paths
    .filter(matches)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, limit)
}

// ---- export ----

/** "45s", "3m 43s", "1h 5m". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

const VERBS: Partial<Record<ToolKind, [string, string, string]>> = {
  read: ['read', 'file', 'files'],
  edit: ['edited', 'file', 'files'],
  delete: ['deleted', 'file', 'files'],
  move: ['moved', 'file', 'files'],
  execute: ['ran', 'command', 'commands'],
  search: ['ran', 'search', 'searches'],
  fetch: ['fetched', 'page', 'pages'],
}

/** "Worked for 3m 43s: read 3 files, ran 2 commands". */
function workLine(steps: readonly WorkStep[], seconds: number): string {
  const counts = new Map<string, { verb: string; one: string; many: string; n: number }>()
  const count = (verb: string, one: string, many: string) => {
    const key = `${verb} ${many}`
    const c = counts.get(key) ?? { verb, one, many, n: 0 }
    c.n++
    counts.set(key, c)
  }
  for (const step of steps) {
    if (step.kind === 'subagent') count('ran', 'subagent', 'subagents')
    if (step.kind !== 'tools') continue
    for (const call of step.calls) {
      const verb = VERBS[call.kind]
      if (verb) count(...verb)
      else count('took', 'other step', 'other steps')
    }
  }
  const parts = [...counts.values()].map((c) => `${c.verb} ${c.n} ${c.n === 1 ? c.one : c.many}`)
  return `Worked for ${formatDuration(seconds)}${parts.length ? `: ${parts.join(', ')}` : ''}`
}

/**
 * A thread as Markdown, for Copy / Save: what the human said under "You", what
 * runcastle sent under "Runcastle", the agent's words under "Agent" with each
 * turn's work summarised on one line; images as links.
 */
export function threadMarkdown(view: ThreadView, title: string): string {
  const out: string[] = [`# ${title}`]
  let heading: string | null = null
  const under = (name: string, text: string) => {
    if (heading !== name) out.push(`## ${name}`)
    heading = name
    out.push(text)
  }
  for (const item of view.items) {
    switch (item.kind) {
      case 'user': {
        const images = (item.images ?? []).map((i) => `![${i.name}](${i.src})`)
        // Two human messages in a row are two messages, not one.
        heading = null
        under(item.from === 'runcastle' ? 'Runcastle' : 'You', [item.text, ...images].filter(Boolean).join('\n\n'))
        break
      }
      case 'work':
        under('Agent', `*${workLine(item.steps, item.seconds)}*`)
        break
      case 'agent':
        under('Agent', item.text)
        break
      case 'answered':
        under('Agent', `> ${item.what} ${item.answer}`)
        break
      case 'changes':
        under('Agent', `Changed ${item.files.map((f) => `\`${f.path}\` (+${f.added} −${f.removed})`).join(', ')}`)
        break
      case 'model':
        under('Agent', `*Now on ${item.model}*`)
        break
      case 'stopped':
        under('Agent', '*Stopped*')
        break
      case 'compacted':
        under('Agent', '*Context compacted*')
        break
      case 'error':
        under('Agent', `> Error: ${item.message}`)
        break
    }
  }
  return `${out.join('\n\n')}\n`
}
