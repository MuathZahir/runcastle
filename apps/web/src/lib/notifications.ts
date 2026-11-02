import { type EventRow, FEATURE_NEEDS_YOU, needPings } from '@runcastle/core'
import { NOTIFY_OFFER } from './vocabulary'

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
 * The notification a polled event should fire, or `null` to ignore it: a
 * `feature.needs_you` the shared {@link needPings} rule pings for, titled with
 * the need's words and naming the feature (looked up by the caller). A round
 * finishing or failing no longer pings: the agent handles both and asks when
 * it cannot.
 */
export function eventToNotification(
  event: EventRow,
  featureTitle?: string,
): DesktopNotification | null {
  if (event.type !== FEATURE_NEEDS_YOU || !needPings(event.data)) return null
  return { title: event.data.words, body: featureTitle ?? 'your feature' }
}
