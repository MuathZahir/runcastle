import type { EventRow } from '@runcastle/core'

/**
 * Event → desktop-notification mapping (streamlining-ux, ticket 10).
 *
 * The burn-and-walk-away promise needs a ping when the away-period ends. The web
 * app already sees every event within 1.5s via the events poll; this pure module
 * turns a polled event into the notification payload to fire, or `null` for the
 * (overwhelming majority of) events that aren't an away-period ending.
 *
 * Kept free of the Notification API and React so it's unit-testable in isolation;
 * the firing itself is a thin shell in `use-notifications.ts`.
 *
 * A finishing burn emits a single `run.finished` event carrying its terminal
 * status in `data` (see `packages/server/src/workflows/runner.ts` finalize):
 * `succeeded` → review is ready, `failed` → something went wrong, `cancelled` →
 * the human stopped it themselves (not an away-period end, so no ping). The
 * server exposes no session state that needs the human — SessionStatus is only
 * launching/live/ended — so there's nothing else to notify on here.
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
    title: 'Notify me when a burn finishes',
  }
}

/** The `data` payload of a `run.finished` event (runner finalize). */
interface RunFinishedData {
  status: 'succeeded' | 'failed' | 'cancelled'
  summary: string
}

function runFinishedData(data: unknown): RunFinishedData | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (typeof d.status !== 'string' || typeof d.summary !== 'string') return null
  if (d.status !== 'succeeded' && d.status !== 'failed' && d.status !== 'cancelled') return null
  return { status: d.status, summary: d.summary }
}

/** First line of a run summary, trimmed to a notification-sized length. */
function shortReason(summary: string): string {
  const firstLine = summary.split('\n')[0].trim()
  return firstLine.length > 140 ? `${firstLine.slice(0, 139)}…` : firstLine
}

/**
 * The notification a polled event should fire, or `null` to ignore it. The
 * feature title (looked up by the caller from `event.featureId`) names which
 * burn finished; omit it and the payload still reads sensibly.
 */
export function eventToNotification(
  event: EventRow,
  featureTitle?: string,
): DesktopNotification | null {
  if (event.type !== 'run.finished') return null
  const data = runFinishedData(event.data)
  if (!data) return null

  const feature = featureTitle ?? 'your feature'
  if (data.status === 'succeeded') {
    return { title: 'Burn complete — review is ready', body: feature }
  }
  if (data.status === 'failed') {
    return { title: 'Burn failed', body: `${feature}: ${shortReason(data.summary)}` }
  }
  // cancelled — the human stopped it, not an away-period ending; no ping.
  return null
}
