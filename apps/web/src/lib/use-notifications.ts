import { useCallback, useEffect, useRef, useState } from 'react'
import { trpc } from '../trpc'
import { useLivePoll } from './live'
import { eventToNotification, type DesktopNotification } from './notifications'

/**
 * Desktop-notification driver (streamlining-ux, ticket 10). Wraps the pure
 * `eventToNotification` mapping in the thin Notification-API shell it needs:
 * a persisted on/off preference, a permission request from the enable gesture,
 * and a project-wide events poll that fires only for *fresh* events while the
 * tab is in the background.
 *
 * Design notes matching the ticket:
 * - The poll runs only while enabled (no overhead when off) and advances an
 *   `afterId` cursor exactly like `useEventLog`, so each batch holds only new
 *   events. The first batch after enabling is the historical backfill — skipped
 *   via `initialized` so reloads never replay old runs.
 * - Permission is requested only inside `toggle` (a user gesture), never on
 *   mount; the preference persists in localStorage.
 * - A ping fires only when the tab is hidden or unfocused — a visible dashboard
 *   already shows the change.
 * - Everything degrades gracefully where `Notification` is undefined.
 */

const STORAGE_KEY = 'runcastle:notifications'
const supported = typeof Notification !== 'undefined'

export interface NotificationsControl {
  supported: boolean
  enabled: boolean
  toggle: () => void
}

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

function fire({ title, body }: DesktopNotification): void {
  try {
    const n = new Notification(title, { body })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    // Construction can throw on a permission race; a dropped ping is harmless.
  }
}

export function useDesktopNotifications(
  projectId: string,
  features: { id: string; title: string }[],
): NotificationsControl {
  const [enabled, setEnabled] = useState(() => supported && readPref())
  const [cursor, setCursor] = useState<number | undefined>(undefined)
  const initialized = useRef(false)

  // featureId → title, read at fire time without retriggering the poll effect.
  const titles = useRef(new Map<string, string>())
  titles.current = new Map(features.map((f) => [f.id, f.title]))

  const query = trpc.events.listByProject.useQuery(
    { projectId, afterId: cursor },
    { refetchInterval: useLivePoll(), enabled: supported && enabled },
  )

  useEffect(() => {
    const batch = query.data
    if (!batch || batch.length === 0) return
    const maxId = batch[batch.length - 1].id // listByProject returns id-ascending

    const away = document.hidden || !document.hasFocus()
    if (initialized.current && Notification.permission === 'granted' && away) {
      for (const ev of batch) {
        const title = ev.featureId ? titles.current.get(ev.featureId) : undefined
        const notification = eventToNotification(ev, title)
        if (notification) fire(notification)
      }
    }
    initialized.current = true
    setCursor(maxId)
  }, [query.data])

  const toggle = useCallback(() => {
    if (!supported) return
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
      void Notification.requestPermission().then((permission) => {
        if (permission !== 'granted') {
          setEnabled(false)
          writePref(false)
        }
      })
    }
  }, [enabled])

  return { supported, enabled, toggle }
}
