import * as acp from '@agentclientprotocol/sdk/unstable'
import type { AgentProcess, AgentTransport } from '../../src/threads/host'

/**
 * An in-process fake ACP agent (chat-as-web-components): the agent side of
 * `@agentclientprotocol/sdk`, connected straight to the host's client, so the
 * host, the thread router and the launch procedures are tested with no CLI
 * spawned. A test scripts what each turn does through {@link FakeScript}.
 *
 * Every "process" the host starts is a fresh {@link FakeProcess}, kept in
 * `fake.processes`, so a test can crash one, see it killed, or see a second
 * one start after an idle stop.
 */

/** A question as a test writes it; the fake renders it the way claude-agent-acp does. */
export interface FakeQuestion {
  header: string
  question: string
  options: string[]
  multiSelect?: boolean
}

/** One running `session/prompt`, as its script drives it. */
export interface FakeTurn {
  sessionId: string
  prompt: acp.ContentBlock[]
  /** Send any session update. */
  update(update: acp.SessionUpdate): Promise<void>
  /** Send an agent message chunk. */
  say(text: string, messageId?: string): Promise<void>
  think(text: string): Promise<void>
  /** Ask for permission (allow once / always / reject offered) and wait for the answer. */
  permission(toolCall: acp.ToolCallUpdate): Promise<acp.RequestPermissionResponse>
  /** Ask AskUserQuestion's questions as claude-agent-acp's form elicitation, and wait for the answer. */
  ask(questions: FakeQuestion[]): Promise<acp.CreateElicitationResponse>
  /** Resolves when the client cancels this turn. */
  cancelled: Promise<void>
  /** The next prompt steered into this turn. */
  nextSteer(): Promise<acp.ContentBlock[]>
}

export interface FakeScript {
  /** Advertise the steering extension. Default true. */
  steering?: boolean
  /** The id `session/new` answers with. */
  sessionId?: string
  /** The model config option's current value. Default `claude-opus-5-5` ("Opus 5.5"). */
  model?: { id: string; label: string }
  /** More models the model option offers, beside `model`. */
  models?: { id: string; label: string }[]
  /**
   * Offer effort and fast mode the way an adapter does: Claude's `effort` and
   * `fast` (a boolean when `fastBoolean`), or Codex's `reasoning_effort` and
   * `fast-mode`. None by default.
   */
  options?: 'claude' | 'codex'
  fastBoolean?: boolean
  /** What `_auth/status_update` pushes once a session opens. */
  authStatus?: unknown
  /** The session mode `session/new` / `session/load` report. Default `default`. */
  mode?: string
  /** What `session/load` replays before it answers. */
  replay?: acp.SessionUpdate[]
  /** Make `session/new` and `session/load` fail with this message. */
  failSession?: string
  /** What a turn does. Default: says "Done." and ends the turn. */
  turn?: (turn: FakeTurn) => Promise<acp.StopReason | void>
  /** Answer codex-acp's `_codex/hooks/list` with these hooks, and trust them on `_codex/hooks/trust`. */
  codexHooks?: { key: string; currentHash: string; trustStatus?: string }[]
}

export interface FakeProcess {
  app: acp.AgentApp
  /** Every request and notification the agent received, in order. */
  received: { method: string; params: unknown }[]
  killed: boolean
  /** Exit as if the process died, with this on its stderr. */
  crash(stderr: string): void
}

export interface FakeAcp {
  script: FakeScript
  processes: FakeProcess[]
  transport: AgentTransport
  /** The process started last. */
  last(): FakeProcess
}

/** A promise with its resolver outside it. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const PERMISSION_OPTIONS: acp.PermissionOption[] = [
  { optionId: 'allow', name: 'Yes', kind: 'allow_once' },
  { optionId: 'always', name: "Yes, and don't ask again", kind: 'allow_always' },
  { optionId: 'reject', name: 'No', kind: 'reject_once' },
]

function questionForm(sessionId: string, toolCallId: string, questions: FakeQuestion[]): acp.CreateElicitationRequest {
  const properties: Record<string, acp.ElicitationPropertySchema> = {}
  questions.forEach((q, n) => {
    const options = q.options.map((label) => ({ const: label, title: label }))
    const description = questions.length === 1 ? undefined : q.question
    properties[`question_${n}`] = q.multiSelect
      ? { type: 'array', title: q.header, description, items: { anyOf: options } }
      : { type: 'string', title: q.header, description, oneOf: options }
    properties[`question_${n}_custom`] = { type: 'string', title: 'Other' }
  })
  return {
    mode: 'form',
    sessionId,
    toolCallId,
    message: questions.length === 1 ? questions[0].question : 'Please answer the following questions.',
    requestedSchema: { type: 'object', properties },
  } as acp.CreateElicitationRequest
}

function fakeProcess(script: FakeScript): FakeProcess & AgentProcess {
  const exited = deferred<{ stderr: string }>()
  const received: FakeProcess['received'] = []
  let current: { cancel: () => void; steer: (blocks: acp.ContentBlock[]) => void } | null = null
  const model = script.model ?? { id: 'claude-opus-5-5', label: 'Opus 5.5' }
  const select = (id: string, category: string, currentValue: string, values: string[]): acp.SessionConfigOption => ({
    id,
    name: id,
    category,
    type: 'select',
    currentValue,
    options: values.map((value) => ({ value, name: value })),
  })
  const extra: acp.SessionConfigOption[] =
    script.options === 'claude'
      ? [
          select('effort', 'thought_level', 'high', ['default', 'low', 'medium', 'high', 'max']),
          script.fastBoolean
            ? { id: 'fast', name: 'Fast mode', category: 'model_config', type: 'boolean', currentValue: false }
            : select('fast', 'model_config', 'off', ['on', 'off']),
        ]
      : script.options === 'codex'
        ? [select('reasoning_effort', 'thought_level', 'medium', ['low', 'medium', 'high', 'xhigh']), select('fast-mode', 'model_config', 'off', ['off', 'on'])]
        : []
  const opened: { modes: acp.SessionModeState; configOptions: acp.SessionConfigOption[] } = {
    modes: { currentModeId: script.mode ?? 'default', availableModes: ['default', 'acceptEdits', 'bypassPermissions'].map((id) => ({ id, name: id })) },
    configOptions: [
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select' as const,
        currentValue: model.id,
        options: [model, ...(script.models ?? [])].map((m) => ({ value: m.id, name: m.label })),
      },
      ...extra,
    ],
  }
  let forks = 0
  const note = (method: string, params: unknown) => received.push({ method, params })
  const pushAuth = async (client: { notify: (method: string, params: unknown) => Promise<void> }) => {
    if (script.authStatus !== undefined) await client.notify('_auth/status_update', { authStatus: script.authStatus })
  }

  const app = acp
    .agent({ name: 'fake-agent' })
    .onRequest(acp.methods.agent.initialize, ({ params }) => {
      note('initialize', params)
      return {
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
        ...(script.steering === false ? {} : { _meta: { steering: { supported: true } } }),
      }
    })
    .onRequest(acp.methods.agent.session.new, async ({ params, client }) => {
      note('session/new', params)
      if (script.failSession) throw new Error(script.failSession)
      await pushAuth(client)
      return { sessionId: script.sessionId ?? 'acp-session-1', ...opened }
    })
    .onRequest(acp.methods.agent.session.fork, async ({ params, client }) => {
      note('session/fork', params)
      await pushAuth(client)
      return { sessionId: `${params.sessionId}-fork-${++forks}`, ...opened }
    })
    .onRequest(acp.methods.agent.session.setConfigOption, ({ params }) => {
      note('session/set_config_option', params)
      const option = opened.configOptions.find((o) => o.id === params.configId)
      if (!option) throw new Error(`no option ${params.configId}`)
      option.currentValue = params.value as never
      return { configOptions: opened.configOptions }
    })
    .onRequest(acp.methods.agent.session.load, async ({ params, client }) => {
      note('session/load', params)
      if (script.failSession) throw new Error(script.failSession)
      for (const update of script.replay ?? []) await client.notify(acp.methods.client.session.update, { sessionId: params.sessionId, update })
      return opened
    })
    .onRequest(acp.methods.agent.session.setMode, ({ params }) => {
      note('session/set_mode', params)
      opened.modes.currentModeId = params.modeId
      return {}
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      note('session/prompt', params)
      const cancelled = deferred()
      const steers: acp.ContentBlock[][] = []
      let waiting: ((blocks: acp.ContentBlock[]) => void) | null = null
      current = {
        cancel: () => cancelled.resolve(),
        steer: (blocks) => {
          if (waiting) waiting(blocks)
          else steers.push(blocks)
          waiting = null
        },
      }
      const update = (u: acp.SessionUpdate) => client.notify(acp.methods.client.session.update, { sessionId: params.sessionId, update: u })
      const turn: FakeTurn = {
        sessionId: params.sessionId,
        prompt: params.prompt,
        update,
        say: (text, messageId) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text }, ...(messageId ? { messageId } : {}) }),
        think: (text) => update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } }),
        permission: (toolCall) =>
          client.request(acp.methods.client.session.requestPermission, { sessionId: params.sessionId, toolCall, options: PERMISSION_OPTIONS }),
        ask: (questions) => client.request(acp.methods.client.elicitation.create, questionForm(params.sessionId, 'ask-tool', questions)),
        cancelled: cancelled.promise,
        nextSteer: () =>
          steers.length
            ? Promise.resolve(steers.shift()!)
            : new Promise((r) => {
                waiting = r
              }),
      }
      try {
        const stop = await (script.turn ?? (async (t) => void (await t.say('Done.'))))(turn)
        return { stopReason: stop ?? 'end_turn' }
      } finally {
        current = null
      }
    })
    .onNotification(acp.methods.agent.session.cancel, ({ params }) => {
      note('session/cancel', params)
      current?.cancel()
    })
    .onRequest('_codex/hooks/list', (raw: unknown) => raw as { cwd: string }, ({ params }) => {
      note('_codex/hooks/list', params)
      return { cwd: params.cwd, hooks: script.codexHooks ?? [] }
    })
    .onRequest('_codex/hooks/trust', (raw: unknown) => raw as { cwd: string; hooks: { key: string }[] }, ({ params }) => {
      note('_codex/hooks/trust', params)
      for (const hook of script.codexHooks ?? []) if (params.hooks.some((h) => h.key === hook.key)) hook.trustStatus = 'trusted'
      return { trusted: true }
    })
    .onRequest('_session/steering', (raw: unknown) => raw as { sessionId: string; prompt: acp.ContentBlock[] }, ({ params }) => {
      note('_session/steering', params)
      if (!current) return { outcome: 'promptRequired' }
      current.steer(params.prompt)
      return { outcome: 'steered' }
    })

  const proc: FakeProcess & AgentProcess = {
    app,
    received,
    killed: false,
    target: app,
    exited: exited.promise,
    kill: async () => {
      proc.killed = true
      exited.resolve({ stderr: '' })
    },
    crash: (stderr) => exited.resolve({ stderr }),
  }
  return proc
}

/** A fake ACP runtime: `transport` goes into `createAgentHost`, `script` says what the agent does. */
export function createFakeAcp(script: FakeScript = {}): FakeAcp {
  const fake: FakeAcp = {
    script,
    processes: [],
    transport: () => {
      const proc = fakeProcess(fake.script)
      fake.processes.push(proc)
      return proc
    },
    last: () => fake.processes[fake.processes.length - 1],
  }
  return fake
}

/** A launch that spawns nothing: the fake transport ignores it. */
export const FAKE_LAUNCH = async () => ({
  files: [],
  command: 'fake-agent',
  args: [],
  env: {},
  envScrub: [],
  sessionMeta: { claudeCode: { options: { model: 'claude-opus-5-5' } } },
  sessionMode: 'bypassPermissions',
})
