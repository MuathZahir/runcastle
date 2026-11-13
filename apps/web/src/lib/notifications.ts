import { type EventRow, FEATURE_NEEDS_YOU, needPings } from '@runcastle/core'
import { NOTIFY_OFFER } from './vocabulary'
import { pathFor } from './routes'

/**
 * Event → desktop-notification mapping (streamlining-ux ticket 10;
 * you-always-know-what-s-waiting decision 11).
 *
 * A ping fires when a feature, in any project, starts needing the human: the
 * server emits `feature.needs_you` on entering a need, and the same
 * {@link needPings} rule the phone push uses says which of those ping. This
 * pure module turns a polled event into the notification payload to fire, or
 * `null` for every other event.
 *
 * Kept free of the Notification API and React so it's unit-testable in isolation;
 * the firing itself is a thin shell in `use-notifications.ts`.
 */

export interface DesktopNotification {
  title: string
  body: string
}

/** What the status bar's notify button is currently saying (findings F17.9). */
export type NotifyState = 'on' | 'off' | 'blocked'

export interface NotifyButton {
  state: NotifyState
  label: string
  /** The hover explanation — for `blocked`, how to unblock. */
  title: string
}

/**
 * The notify button's three states.
 *
 * It used to have one appearance and a click that did nothing at all when the
 * browser had denied permission: no state, no explanation, no route back. A
 * denied permission cannot be re-requested from script — only the user can undo
 * it in site settings — so the honest thing is to say so and point at where.
 */
export function notifyButton(input: {
  enabled: boolean
  permission: NotificationPermission
}): NotifyButton {
  if (input.permission === 'denied') {
    return {
      state: 'blocked',
      label: 'notify blocked',
      title:
        'Your browser has blocked notifications for runcastle. Allow them in site settings (the icon beside the address bar), then click again.',
    }
  }
  if (input.enabled) {
    return {
      state: 'on',
      label: 'notify on',
      title: 'Desktop notifications on — click to turn them off',
    }
  }
  return {
    state: 'off',
    label: 'notify off',
    title: NOTIFY_OFFER,
  }
}


/**
 * The notification a polled event should fire, or `null` to ignore it: every
 * well-formed `feature.needs_you` pings (needs-you-is-the-agent-s-call decision
 * 14, the shared {@link needPings} rule), titled with the agent's line and
 * naming its feature, or an epic's chat when it has none.
 */
export function eventToNotification(
  event: EventRow,
  featureTitle?: string,
): DesktopNotification | null {
  if (event.type !== FEATURE_NEEDS_YOU || !needPings(event.data)) return null
  const where = event.data.featureId === null ? 'An epic’s chat' : (featureTitle ?? 'your feature')
  return { title: `Needs you · ${event.data.why}`, body: where }
}

/**
 * Where a ping's click lands (decision 12): the exact chat the need waits in,
 * on its feature's page, or on the Orchestrator for an epic's own chat. Null
 * for an event that does not ping, or a feature the server no longer lists.
 */
export function needPath(
  event: Pick<EventRow, 'type' | 'projectId' | 'data'>,
  feature: { projectId: string; slug: string } | null,
): string | null {
  if (event.type !== FEATURE_NEEDS_YOU || !needPings(event.data)) return null
  const thread = `?thread=${encodeURIComponent(event.data.threadId)}`
  if (event.data.featureId === null) return pathFor({ kind: 'chat', projectId: event.projectId }) + thread
  if (!feature) return null
  return pathFor({ kind: 'feature', projectId: feature.projectId, featureSlug: feature.slug }) + thread
}
