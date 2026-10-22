import {
  DEFAULT_RUNTIME,
  type Feature,
  LEAD_WAKE_FAILED,
  type LeadWakeFailedData,
  type ReviewGateRun,
  type SessionRow,
} from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { launchSession, type LaunchSessionInput, type LaunchSessionResult } from '../launcher/launcher'
import { activeSessionsForFeature, getSessionRow, takeRequestedEnd } from '../launcher/sessions'
import { subscribeLive } from './bus'
import { emit, getEventRow } from './events'
import { tagRuncastlePrompt } from './lead-prompt'
import { markHumanMessage } from './lead-status'
import { asyncRewakeDelivery, codexQueueDelivery, type OrchestratorDelivery } from './orchestrator-delivery'
import {
  hasOrchestratorLines,
  leadMessageKey,
  queueOrchestratorLine,
  requeueOrchestratorLines,
  takeOrchestratorLines,
} from './orchestrator-messages'
import { getRunRow } from './repo'
import { listByFeature as listFindings } from './review-findings'
import { listRounds, runClaimedTicketIds } from './runs'
import { listByIds } from './tickets'

/**
 * The one way anything reaches a feature's lead (`the-feature-lead-runs-rounds`
 * spec, "Waking the lead"): runcastle's own wakes (Go, a round's end, Stop) and
 * the human's messages (Send to agent, the orchestrator's `send_to_feature`).
 *
 * `source` is what tells the two apart for the Ask-mode dispatch check: only a
 * `human` message stamps the feature's last-human-message mark. Either way the
 * prompt that reaches the lead carries runcastle's tag, so the
 * `UserPromptSubmit` hook does not count it again as a typed one.
 */
export interface LeadMessage {
  text: string
  source: 'human' | 'runcastle'
}

/**
 * Deliver `msg` to the feature's lead (decision 12). The SIGNATURE is the
 * contract; this is what is behind it.
 *
 * The message is tagged as runcastle's ({@link tagRuncastlePrompt}) and queued
 * under the feature's {@link leadMessageKey}, then:
 *
 * - a lead with a terminal (its chat is up and not headless) is kicked through
 *   its runtime's own channel ({@link leadDeliveryFor}) — never typed in, so a
 *   message that arrives mid-turn waits for the turn's end — and
 *   `lead.message_queued` says which channel;
 * - otherwise `lead.message_pending` is emitted and the message waits: for a
 *   headless run already going, until it exits; with no chat up at all, the
 *   lead waker ({@link startLeadWaker}) resumes the conversation headless with
 *   it.
 */
export async function deliverToLead(ctx: AppCtx, feature: Feature, msg: LeadMessage): Promise<void> {
  if (msg.source === 'human') markHumanMessage(ctx, feature.id)
  const key = leadMessageKey(feature.id)
  queueOrchestratorLine(key, tagRuncastlePrompt(msg.text))
  const lead = activeLead(ctx, feature.id)
  if (lead && !lead.headless) {
    leadDeliveryFor(lead).kick(lead, key)
    markReceived(feature.id)
    emit(ctx, feature.id, {
      type: 'lead.message_queued',
      message: `message queued for the agent at its turn end (${msg.source})`,
      data: { source: msg.source, sessionId: lead.id, route: liveRouteOf(lead), text: msg.text },
    })
    return
  }
  if (!waitingSince.has(feature.id)) waitingSince.set(feature.id, Date.now())
  emit(ctx, feature.id, {
    type: 'lead.message_pending',
    message: lead
      ? `message waiting for the agent's run to end (${msg.source})`
      : `message waiting for the agent (${msg.source})`,
    data: { source: msg.source, sessionId: lead?.id ?? null, text: msg.text },
  })
}

/** The feature's chat session that is up (launching or live), if any. */
function activeLead(ctx: AppCtx, featureId: string): SessionRow | undefined {
  return activeSessionsForFeature(ctx, featureId).find((s) => s.kind === 'chat')
}

/** Whether `session` is a feature's lead with a terminal: the one a live wake reaches. */
export function isLiveLeadSession(session: Pick<SessionRow, 'kind' | 'featureId' | 'headless'>): boolean {
  return session.kind === 'chat' && !!session.featureId && !session.headless
}

/** Which live channel a lead's runtime takes, as `lead.message_queued` names it. */
function liveRouteOf(session: Pick<SessionRow, 'runtime'>): 'waiter' | 'codex-queue' {
  return (session.runtime ?? DEFAULT_RUNTIME) === 'codex' ? 'codex-queue' : 'waiter'
}

/**
 * A lead's Codex delivery: `codex queue`, as the orchestrator's, except that a
 * failed spawn keeps its lines rather than dropping them. They then wait for the
 * next kick or for the session to end, when the headless resume takes them —
 * the fallback the spec names if Codex cannot take a message live. Built on
 * first use: this module sits in an import cycle with the launcher.
 */
let leadCodexDelivery: OrchestratorDelivery | undefined

function holdFailedLines(key: string, lines: string[], code: number | null): boolean {
  console.error(`codex queue exited ${code}; holding ${lines.length} lead message line(s)`)
  requeueOrchestratorLines(key, lines)
  return false
}

/** The live delivery for a lead's runtime: the Stop-hook waiter on Claude Code, `codex queue` on Codex. */
export function leadDeliveryFor(session: Pick<SessionRow, 'runtime'>): OrchestratorDelivery {
  if (liveRouteOf(session) !== 'codex-queue') return asyncRewakeDelivery
  leadCodexDelivery ??= codexQueueDelivery(undefined, undefined, holdFailedLines)
  return leadCodexDelivery
}

/** Opens the headless resume of a feature's chat — `launchSession`, or a test's stand-in. */
export type LeadLauncher = (ctx: AppCtx, input: LaunchSessionInput) => Promise<LaunchSessionResult>

/**
 * The event types after which a feature's pending lead messages may need a
 * headless resume. A drive's stop retries one that failed while it held the
 * feature branch.
 */
const WAKE_TRIGGERS = new Set([
  'lead.message_pending',
  'session.pty_exited',
  'session.spawn_failed',
  'testdrive.stopped',
])

/** The triggers a feature's own session ending fires, as opposed to a new message or a drive stopping. */
const EXIT_TRIGGERS = new Set(['session.pty_exited', 'session.spawn_failed'])

/** Features whose headless resume is being opened right now. */
const waking = new Set<string>()

/** A headless wake's messages, held against its session until the agent checks in (decision 28). */
interface HeldWake {
  featureId: string
  lines: string[]
}

/** Held wakes by the session launched with them. */
const heldWakes = new Map<string, HeldWake>()

/**
 * Wakes whose agent checked in, by session, until the process ends: a headless
 * run is one turn, so a non-zero exit is one that died mid-turn with the
 * messages in hand.
 */
const wakesInTurn = new Map<string, HeldWake>()

/**
 * Wakes per feature that died before their agent checked in, since the last
 * one that did. The first is retried at once, fresh from the docs; past that a
 * feature's own exits retry nothing, so a wake that keeps dying waits for the
 * next real trigger instead of relaunching in a loop.
 */
const failedWakes = new Map<string, number>()

/**
 * When the oldest message no agent has yet received was sent, and the last wake
 * failure, per feature — what the drive panel reads instead of claiming
 * delivery (decision 28). A message queued for a live lead's turn end counts as
 * received: the agent holds it.
 */
const waitingSince = new Map<string, number>()
const lastWakeFailure = new Map<string, { reason: string; at: number }>()

/** What the drive panel shows about a feature's messages to the agent. */
export interface LeadDeliveryState {
  /** When the oldest message still waiting for an agent was sent; null when nothing waits. */
  waitingSince: number | null
  /** The last headless wake that died before the agent took it, while its messages still wait. */
  lastFailure: { reason: string; at: number } | null
}

export function leadDeliveryState(featureId: string): LeadDeliveryState {
  const since = waitingSince.get(featureId) ?? null
  return { waitingSince: since, lastFailure: since === null ? null : (lastWakeFailure.get(featureId) ?? null) }
}

/** An agent took the feature's messages: nothing is waiting any more. */
function markReceived(featureId: string): void {
  waitingSince.delete(featureId)
  lastWakeFailure.delete(featureId)
}

/**
 * Resume the feature's chat headless with every pending lead message as its
 * prompt, when there are any and no session of the feature is up. A live lead
 * takes its messages itself; a headless run already going, or a terminal of
 * another kind (the feature's one slot), gets them retried when it exits. A
 * launch that is refused puts the messages back and says why.
 *
 * The messages are held against the launched session, not handed over: only
 * its checking in releases them ({@link startLeadWaker}), and a process that
 * ends first puts them back. After one such death the retry starts fresh from
 * the docs; after a second, `fromExit` wakes (the feature's own session ending)
 * stand down until a real trigger — a new message, a drive stopping. Resolves
 * with the new session id, or null when nothing was launched.
 */
export async function wakeLeadHeadless(
  ctx: AppCtx,
  featureId: string,
  launch: LeadLauncher = launchSession,
  fromExit = false,
): Promise<string | null> {
  const key = leadMessageKey(featureId)
  if (waking.has(featureId) || !hasOrchestratorLines(key)) return null
  // A side session is not the feature's terminal: it never holds the lead's slot.
  if (activeSessionsForFeature(ctx, featureId).some((s) => s.kind !== 'side')) return null
  const failures = failedWakes.get(featureId) ?? 0
  if (fromExit && failures >= 2) return null
  waking.add(featureId)
  const lines = takeOrchestratorLines(key)
  let diedAtLaunch = false
  try {
    const { sessionId, resumed = false } = await launch(ctx, {
      featureId,
      kind: 'chat',
      purpose: 'lead-wake',
      message: lines.join('\n\n'),
      ...(failures > 0 ? { fresh: true } : {}),
    })
    emit(ctx, featureId, {
      type: 'lead.woken_headless',
      message: resumed
        ? 'the agent was not open — resumed its conversation headless with the message'
        : 'the agent was not open and had no conversation to resume — started it headless from the docs with the message',
      data: { sessionId, messages: lines.length, resumed },
    })
    heldWakes.set(sessionId, { featureId, lines })
    // The launch can settle before it resolves: a spawn that failed has ended
    // the row, and a hook that beat this line here has already checked it in.
    const status = getSessionRow(ctx, sessionId)?.status
    if (status === 'live') checkInHeldWake(sessionId)
    else if (status === 'ended') diedAtLaunch = failHeldWake(ctx, sessionId, null, '')
    return sessionId
  } catch (err) {
    requeueOrchestratorLines(key, lines)
    const reason = err instanceof Error ? err.message : String(err)
    // Nothing ran, so nothing printed: the refusal is the whole why.
    const data: LeadWakeFailedData = { exitCode: null, tail: reason, messages: lines.length }
    emit(ctx, featureId, { type: LEAD_WAKE_FAILED, message: `could not resume the agent headless: ${reason}`, data })
    return null
  } finally {
    waking.delete(featureId)
    // Its exit event came while this wake was still opening, so it retried nothing.
    if (diedAtLaunch) {
      void wakeLeadHeadless(ctx, featureId, launch, true).catch((err) => console.error('lead waker failed', err))
    }
  }
}

/** The wake's agent checked in: its messages are delivered, and the feature's wakes are healthy again. */
function releaseHeldWake(sessionId: string): void {
  const held = heldWakes.get(sessionId)
  if (!held) return
  heldWakes.delete(sessionId)
  failedWakes.delete(held.featureId)
  markReceived(held.featureId)
}

/** {@link releaseHeldWake} on the agent checking in, watching its turn from there. */
function checkInHeldWake(sessionId: string): void {
  const held = heldWakes.get(sessionId)
  if (!held) return
  releaseHeldWake(sessionId)
  wakesInTurn.set(sessionId, held)
}

/** `lead.wake_failed`: the message, and its exit code and last output to say why. */
function emitWakeFailed(
  ctx: AppCtx,
  featureId: string,
  message: string,
  data: LeadWakeFailedData & Record<string, unknown>,
): void {
  const last = data.tail.split('\n').at(-1)?.trim()
  emit(ctx, featureId, {
    type: LEAD_WAKE_FAILED,
    message: last ? `${message} — last output: ${last.slice(0, 120)}` : message,
    data,
  })
}

/**
 * A wake's session ended after its agent checked in. A non-zero (or unknown)
 * exit died in its one turn with the messages in hand: they are not put back —
 * the agent had them, and may have acted on some — but `lead.wake_failed` says
 * it stopped, so nobody reads the feature as worked on.
 */
function endWakeTurn(ctx: AppCtx, sessionId: string, exitCode: number | null, tail: string): void {
  const wake = wakesInTurn.get(sessionId)
  if (!wake) return
  wakesInTurn.delete(sessionId)
  if (exitCode === 0) return
  const how = exitCode === null ? 'ended' : `exited (code ${exitCode})`
  emitWakeFailed(
    ctx,
    wake.featureId,
    `the agent's headless wake ${how} during its turn — it had ${wake.lines.length} message(s); open the chat to see where it stopped`,
    { sessionId, exitCode, tail, messages: wake.lines.length },
  )
}

/**
 * A wake's session ended. Before its agent checked in, a non-zero (or unknown)
 * exit means the agent never took the messages: they go back on the queue,
 * first, and `lead.wake_failed` says why. A clean exit ran to completion, so its
 * messages count as delivered even if no hook ever said so. Returns whether the
 * messages were put back.
 */
function failHeldWake(ctx: AppCtx, sessionId: string, exitCode: number | null, tail: string): boolean {
  const held = heldWakes.get(sessionId)
  if (!held) return false
  if (exitCode === 0) {
    releaseHeldWake(sessionId)
    return false
  }
  heldWakes.delete(sessionId)
  requeueOrchestratorLines(leadMessageKey(held.featureId), held.lines)
  const failures = (failedWakes.get(held.featureId) ?? 0) + 1
  failedWakes.set(held.featureId, failures)
  const how = exitCode === null ? 'ended' : `exited (code ${exitCode})`
  const message =
    `the agent's headless wake ${how} before the agent started — ${held.lines.length} message(s) back in the queue; ` +
    (failures === 1 ? 'retrying fresh from the docs' : 'they go with the next message or when a drive stops')
  lastWakeFailure.set(held.featureId, { reason: how, at: Date.now() })
  emitWakeFailed(ctx, held.featureId, message, {
    sessionId,
    messages: held.lines.length,
    exitCode,
    tail,
    failures,
  })
  return true
}

/**
 * Subscribe the lead waker to the live event bus; returns the unsubscribe.
 * Called once at boot, beside the orchestrator notifier. A message left pending,
 * or a feature's session ending with messages still pending, resumes the lead
 * headless ({@link wakeLeadHeadless}). Best effort: nothing here throws into the
 * emitter.
 */
export function startLeadWaker(ctx: AppCtx, launch: LeadLauncher = launchSession): () => void {
  return subscribeLive((signal) => {
    if (signal.kind !== 'event' || !signal.featureId) return
    const featureId = signal.featureId
    try {
      const event = getEventRow(ctx, signal.eventId)
      if (!event) return
      const data = (event.data ?? {}) as { sessionId?: unknown; exitCode?: unknown; tail?: unknown }
      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
      if (event.type === 'session.started' && sessionId) noteCheckIn(ctx, featureId, sessionId)
      if (!WAKE_TRIGGERS.has(event.type)) return
      const fromExit = EXIT_TRIGGERS.has(event.type)
      if (fromExit && sessionId) {
        // A wake the human ended (End session) stopped because they asked: read
        // it as a clean exit, so it is neither a failure nor retried.
        const exitCode = takeRequestedEnd(sessionId) ? 0 : typeof data.exitCode === 'number' ? data.exitCode : null
        // A spawn that failed printed nothing; its event's message is the why.
        const tail =
          typeof data.tail === 'string' ? data.tail : event.type === 'session.spawn_failed' ? event.message : ''
        failHeldWake(ctx, sessionId, exitCode, tail)
        endWakeTurn(ctx, sessionId, exitCode, tail)
      }
      void wakeLeadHeadless(ctx, featureId, launch, fromExit).catch((err) => console.error('lead waker failed', err))
    } catch (err) {
      console.error('lead waker failed', err)
    }
  })
}

/**
 * A feature session checked in. A held wake's agent has its messages now; a
 * terminal lead coming up is handed whatever was waiting at its start
 * (`kickLeadAtStart`), so nothing waits for an agent any more either way.
 */
function noteCheckIn(ctx: AppCtx, featureId: string, sessionId: string): void {
  if (heldWakes.has(sessionId)) {
    checkInHeldWake(sessionId)
    return
  }
  const session = getSessionRow(ctx, sessionId)
  if (session && isLiveLeadSession(session)) markReceived(featureId)
}

/** One line on a round's verify gates, for the wake message. */
function gatesLine(gates: ReviewGateRun | undefined): string {
  if (!gates || gates.status === 'none_configured') return 'Gates: no verify commands are configured.'
  if (gates.status === 'couldnt_run') return `Gates: could not run — ${gates.reason}`
  const failed = gates.commands.filter((c) => c.outcome !== 'passed')
  if (failed.length === 0) return `Gates: all ${gates.commands.length} verify command(s) passed.`
  return `Gates: FAILED — ${failed.map((c) => `\`${c.command}\` (${c.outcome})`).join(', ')}.`
}

/**
 * The single message a returning round wakes its lead with (decision 12): the
 * round's outcome, each ticket it held with its status, the gate result, what a
 * review in the round found, and where the digests are. The record, not prose —
 * the lead reads the digests itself.
 */
export function composeRoundWake(ctx: AppCtx, featureId: string, runId: string): string {
  const run = getRunRow(ctx, runId)
  const round = listRounds(ctx, featureId).find((r) => r.runId === runId)
  const held = listByIds(ctx, runClaimedTicketIds(ctx, runId)).sort((a, b) => a.seq - b.seq)
  const heldIds = new Set(held.map((t) => t.id))
  const findings = listFindings(ctx, featureId).filter((f) => heldIds.has(f.reviewTicketId))

  const lines = [
    `[runcastle] Round ${round?.round ?? '?'} returned: ${run.status}${run.summary ? ` — ${run.summary}` : ''}`,
    ...(held.length > 0
      ? ['Tickets:', ...held.map((t) => `- #${t.seq} ${t.title}: ${t.status}${t.error ? ` (${t.error.split(/\r?\n/, 1)[0]})` : ''}`)]
      : ['Tickets: none']),
    gatesLine(run.gates),
    ...(findings.length > 0
      ? [
          'Review findings:',
          ...findings.map((f) => `- [${f.severity} ${f.kind}] ${f.title} — ${f.location} (${f.status})`),
        ]
      : []),
    'Read each ticket’s digest with get_ticket({ seq }), then fix it yourself, dispatch the next ' +
      'round, ask the human, or declare ready.',
  ]
  return lines.join('\n')
}
