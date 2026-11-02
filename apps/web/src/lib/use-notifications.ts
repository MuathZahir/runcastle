import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Project } from './api'
import { trpc } from '../trpc'
import { useLivePoll } from './live'
import { eventToNotification, type DesktopNotification } from './notifications'
import { tabTitle } from './projects'
import { pathFor } from './routes'
import { goToPath } from './use-history-sync'

/**
 * Desktop-notification driver (streamlining-ux ticket 10;
 * you-always-know-what-s-waiting decisions 11, 13). Wraps the pure
 * `eventToNotification` mapping in the thin Notification-API shell it needs:
 * a persisted on/off preference, a permission request from the enable gesture,
 * and an every-project poll of `feature.needs_you` events that fires only for
 * *fresh* ones while the tab is in the background.
 *
 * Design notes:
 * - Mounted once in the shell ({@link NotificationsProvider}), so it keeps
 *   watching across project switches and on the portfolio home; the sidebar's
 *   toggle reads the same state through {@link useDesktopNotifications}.
 * - The poll runs only while enabled (no overhead when off) and advances an
 *   `afterId` cursor exactly like `useEventLog`, so each batch holds only new
 *   events. The first batch after enabling is the historical backfill — skipped
 *   via `initialized` so reloads never replay old needs.
 * - Permission is requested only inside `toggle` (a user gesture), never on
 *   mount; the preference persists in localStorage.
 * - A ping fires only when the tab is hidden or unfocused — a visible dashboard
 *   already shows the change. Clicking it focuses the window and opens the
 *   feature.
 * - Everything degrades gracefully where `Notification` is undefined.
 */

const STORAGE_KEY = 'runcastle:notifications'
const supported = typeof Notification !== 'undefined'

export interface NotificationsControl {
  supported: boolean
  enabled: boolean
  /** The browser's current answer — `denied` is the one the button must explain. */
  permission: NotificationPermission
  toggle: () => void
}

const UNSUPPORTED: NotificationsControl = { supported: false, enabled: false, permission: 'default', toggle: () => {} }

function readPref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

function writePref(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // Private-mode / disabled storage — the toggle still works for this session.
  }
}

function fire({ title, body }: DesktopNotification, open: () => void): void {
  try {
    const n = new Notification(title, { body })
    n.onclick = () => {
      window.focus()
      open()
      n.close()
    }
  } catch {
    // Construction can throw on a permission race; a dropped ping is harmless.
  }
}

function useNotificationsDriver(): NotificationsControl {
  const [enabled, setEnabled] = useState(() => supported && readPref())
  // Mirrored into state because `Notification.permission` is not reactive — the
  // button has to re-render when a prompt is answered.
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    supported ? Notification.permission : 'default',
  )
  const [cursor, setCursor] = useState<number | undefined>(undefined)
  const initialized = useRef(false)

  const query = trpc.events.needsYou.useQuery(
    { afterId: cursor },
    { refetchInterval: useLivePoll(), enabled: supported && enabled },
  )

  useEffect(() => {
    const batch = query.data
    if (!batch) return
    if (batch.length === 0) {
      // Nothing has ever needed anyone: start from the beginning, so the very
      // first event pings rather than being taken for the backfill.
      if (!initialized.current) {
        initialized.current = true
        setCursor(0)
      }
      return
    }
    const maxId = batch[batch.length - 1].event.id // id-ascending

    const away = document.hidden || !document.hasFocus()
    if (initialized.current && Notification.permission === 'granted' && away) {
      for (const { event, feature } of batch) {
        const notification = eventToNotification(event, feature.title)
        const path = pathFor({ kind: 'feature', projectId: feature.projectId, featureSlug: feature.slug })
        if (notification) fire(notification, () => goToPath(path))
      }
    }
    initialized.current = true
    setCursor(maxId)
  }, [query.data])

  const toggle = useCallback(() => {
    if (!supported) return
    // Denied is not ours to undo — only site settings can. The button says so
    // (see `notifyButton`); flipping the preference here would just make it lie.
    if (Notification.permission === 'denied') {
      setPermission('denied')
      return
    }
    if (enabled) {
      setEnabled(false)
      writePref(false)
      return
    }
    // Enabling: restart from the current tip so historical events never fire.
    initialized.current = false
    setCursor(undefined)
    setEnabled(true)
    writePref(true)
    // Permission must be requested from this gesture — never on page load.
    if (Notification.permission === 'default') {
      void Notification.requestPermission().then((answer) => {
        setPermission(answer)
        if (answer !== 'granted') {
          setEnabled(false)
          writePref(false)
        }
      })
    }
  }, [enabled])

  return { supported, enabled, permission, toggle }
}

const NotificationsContext = createContext<NotificationsControl>(UNSUPPORTED)

/** Run the desktop pings for the whole app; mounted once, in the shell. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  return createElement(NotificationsContext.Provider, { value: useNotificationsDriver() }, children)
}

/** The desktop pings' on/off control, for the sidebar's notify button. */
export function useDesktopNotifications(): NotificationsControl {
  return useContext(NotificationsContext)
}

/**
 * Keep the browser tab's title counting what needs the human across every open
 * project (decision 13). Reads the same per-project feature lists the portfolio
 * polls, so the queries are shared rather than doubled.
 */
export function useNeedsYouTitle(projects: Project[]): void {
  const poll = useLivePoll()
  const lists = trpc.useQueries((t) => projects.map((p) => t.feature.list({ projectId: p.id }, { refetchInterval: poll })))
  const title = tabTitle(lists.map((q) => q.data ?? []))
  useEffect(() => {
    document.title = title
  }, [title])
}
