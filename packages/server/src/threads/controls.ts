import type * as acp from '@agentclientprotocol/sdk/unstable'
import { Effort, type ModelChoice, type ThreadEvent, type ThreadView, type ToolKind, type WorkStep } from '@runcastle/core'
import { labelKey, LONG_CONTEXT, rosterLabel } from './model-catalog'

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

/** claude-agent-acp's "Default (recommended)" entry, whose description names the model it stands for. */
const DEFAULT_MODEL = 'default'

/** The model Claude's `default` entry stands for: the entry its description names. */
function defaultTarget(option: SelectOption): { value: string; name: string } | undefined {
  const values = selectValues(option)
  const named = values.find((c) => c.value === DEFAULT_MODEL)?.description
  return named ? values.find((c) => c.value !== DEFAULT_MODEL && c.name === named) : undefined
}

/** claude-agent-acp's "Default" effort: Claude Code resolves the level itself. */
const DEFAULT_EFFORT = 'default'

/** The level Claude's `default` effort entry names ("Default (High)"); none when it names none. */
function defaultEffortLevel(option: SelectOption): Effort | undefined {
  const entry = selectValues(option).find((c) => c.value === DEFAULT_EFFORT)
  const named = /\b(low|medium|high|max)\b/i.exec(`${entry?.description ?? ''} ${entry?.name ?? ''}`)?.[1]
  return named ? (named.toLowerCase() as Effort) : undefined
}

/** The level an effort option says the session runs on: its value, or the one `default` names. */
function effortLevel(option: SelectOption | undefined): Effort | undefined {
  if (!option) return undefined
  if (option.currentValue === DEFAULT_EFFORT) return defaultEffortLevel(option)
  const level = Effort.safeParse(option.currentValue)
  return level.success ? level.data : undefined
}

/** The model, effort and fast mode a session's options say it runs on; `default` as the model or level it stands for. */
export function currentConfig(options: readonly acp.SessionConfigOption[] | null | undefined): { model: string; label: string; effort?: Effort; fast?: boolean } | null {
  const model = modelOption(options)
  if (!model) return null
  const on = selectValues(model).find((c) => c.value === model.currentValue)
  const running = model.currentValue === DEFAULT_MODEL ? (defaultTarget(model) ?? { value: DEFAULT_MODEL, name: on?.description || on?.name || DEFAULT_MODEL }) : on
  const effort = effortLevel(effortOption(options))
  const fast = fastOption(options)
  const fastOn = fast?.type === 'boolean' ? fast.currentValue : fast ? fast.currentValue === 'on' : undefined
  return {
    model: running?.value ?? model.currentValue,
    label: running?.name ?? model.currentValue,
    ...(effort ? { effort } : {}),
    ...(fastOn !== undefined ? { fast: fastOn } : {}),
  }
}

/** A runtime's models as its adapter offers them, kept past any one session (see `model-catalog.ts`). */
export interface ModelCatalog {
  models: ModelChoice[]
  /** The model the runtime starts on when nobody names one: what Claude's "Default (recommended)" stands for. */
  defaultId?: string
}

/**
 * `prev` brought up to date with what a session's options say. The list,
 * labels and descriptions are the adapter's; Claude's `default` entry is not a
 * model of its own but the one it names. A session's options describe only the
 * model it runs on, so that model's effort levels and fast mode are learnt from
 * them and every other model keeps what an earlier session taught. Options
 * that say the level a model `startsOn` — a session's as it opened, or later
 * while nobody picked an effort in it — also teach that model's start effort;
 * a `default` that names no level teaches nothing and forgets nothing.
 */
export function catalogFromOptions(
  prev: ModelCatalog | null,
  options: readonly acp.SessionConfigOption[] | null | undefined,
  startsOn = false,
): ModelCatalog | null {
  const model = modelOption(options)
  const config = currentConfig(options)
  if (!model || !config) return null
  const target = defaultTarget(model)
  const effort = effortOption(options)
  const efforts = effort ? selectValues(effort).flatMap((c) => (Effort.safeParse(c.value).success ? [c.value as Effort] : [])) : []
  const fast = fastOption(options) !== undefined
  const known = new Map((prev?.models ?? []).map((m) => [m.id, m]))
  const models = selectValues(model)
    .filter((c) => !(c.value === DEFAULT_MODEL && target))
    .map((c): ModelChoice => {
      const here = c.value === config.model
      const was = known.get(c.value)
      const modelEfforts = here ? efforts : was?.efforts
      const defaultEffort = (here && startsOn ? config.effort : undefined) ?? was?.defaultEffort
      const isDefault = c.value === DEFAULT_MODEL
      return {
        id: c.value,
        label: isDefault ? c.description || c.name : c.name,
        ...(c.description && !isDefault ? { note: c.description } : {}),
        ...((here ? fast : was?.fast) ? { fast: true } : {}),
        ...(modelEfforts ? { efforts: modelEfforts } : {}),
        ...(defaultEffort ? { defaultEffort } : {}),
      }
    })
  const defaultId = target?.value ?? prev?.defaultId
  return { models, ...(defaultId && models.some((m) => m.id === defaultId) ? { defaultId } : {}) }
}

/**
 * The model option's own value for the model `id` names: `id` itself when the
 * option offers it, else the entry named as that model. The picker may hold
 * runcastle's roster ids (`claude-haiku-5-5`) while the adapter's values are
 * its own (Claude Code's aliases, `haiku`), so a roster id is matched by the
 * label its adapter gives the model ("Haiku 5.5"), a 1M one ("Opus 5.5 (1M)")
 * whichever way the adapter spells its context ("(1M context)").
 *
 * A Claude `[1m]` id the adapter names no entry for lands on the base model's
 * entry with Claude Code's `[1m]` suffix (`opus[1m]`), else on the base model
 * itself: the same model with its standard context, never another model.
 * Undefined when no entry is.
 */
function modelValue(option: SelectOption, id: string): string | undefined {
  const values = selectValues(option)
  if (values.some((c) => c.value === id)) return id
  const names = new Set([id, rosterLabel(id, 'claude-code'), rosterLabel(id, 'codex')].map(labelKey))
  const named = values.find((c) => c.value !== DEFAULT_MODEL && names.has(labelKey(c.name)))?.value
  if (named || !LONG_CONTEXT.test(id)) return named
  const base = modelValue(option, id.replace(LONG_CONTEXT, ''))
  return base && (values.find((c) => c.value === `${base}[1m]`)?.value ?? base)
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
    // Already on it through Claude's `default`, which stands for it.
    if (option.currentValue === DEFAULT_MODEL && defaultTarget(option)?.value === value) return
    if (option.currentValue === DEFAULT_EFFORT && defaultEffortLevel(option) === value) return
    if (selectValues(option).some((c) => c.value === value)) out.push({ sessionId, configId: option.id, value })
  }
  const model = modelOption(options)
  select(model, model && choice.model !== undefined ? modelValue(model, choice.model) : undefined)
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
      case 'notice':
        under('Agent', `*${item.text}*`)
        break
    }
  }
  return `${out.join('\n\n')}\n`
}
