import { DEFAULT_RUNTIME, type Feature, type ReviewGateRun, type SessionRow } from '@runcastle/core'
import type { AppCtx } from '../db/types'
import { launchSession, type LaunchSessionInput } from '../launcher/launcher'
import { activeSessionsForFeature } from '../launcher/sessions'
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
    emit(ctx, feature.id, {
      type: 'lead.message_queued',
      message: `message queued for the agent at its turn end (${msg.source})`,
      data: { source: msg.source, sessionId: lead.id, route: liveRouteOf(lead), text: msg.text },
    })
    return
  }
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
export type LeadLauncher = (ctx: AppCtx, input: LaunchSessionInput) => Promise<{ sessionId: string }>

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

/** Features whose headless resume is being opened right now. */
const waking = new Set<string>()

/**
 * Resume the feature's chat headless with every pending lead message as its
 * prompt, when there are any and no session of the feature is up. A live lead
 * takes its messages itself; a headless run already going, or a terminal of
 * another kind (the feature's one slot), gets them retried when it exits. A
 * launch that is refused puts the messages back and says why. Resolves with the
 * new session id, or null when nothing was launched.
 */
export async function wakeLeadHeadless(
  ctx: AppCtx,
  featureId: string,
  launch: LeadLauncher = launchSession,
): Promise<string | null> {
  const key = leadMessageKey(featureId)
  if (waking.has(featureId) || !hasOrchestratorLines(key)) return null
  if (activeSessionsForFeature(ctx, featureId).length > 0) return null
  waking.add(featureId)
  const lines = takeOrchestratorLines(key)
  try {
    const { sessionId } = await launch(ctx, {
      featureId,
      kind: 'chat',
      purpose: 'lead-wake',
      message: lines.join('\n\n'),
    })
    emit(ctx, featureId, {
      type: 'lead.woken_headless',
      message: 'the agent was not open — resumed its conversation headless with the message',
      data: { sessionId, messages: lines.length },
    })
    return sessionId
  } catch (err) {
    requeueOrchestratorLines(key, lines)
    emit(ctx, featureId, {
      type: 'lead.wake_failed',
      message: `could not resume the agent headless: ${err instanceof Error ? err.message : String(err)}`,
      data: { messages: lines.length },
    })
    return null
  } finally {
    waking.delete(featureId)
  }
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
      if (!event || !WAKE_TRIGGERS.has(event.type)) return
      void wakeLeadHeadless(ctx, featureId, launch).catch((err) => console.error('lead waker failed', err))
    } catch (err) {
      console.error('lead waker failed', err)
    }
  })
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
