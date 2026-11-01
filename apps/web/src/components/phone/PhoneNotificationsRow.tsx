import { useEffect, useState } from 'react'
import { trpc } from '../../trpc'
import {
  type PushState,
  readPushState,
  subscribeThisPhone,
  unsubscribeThisPhone,
} from '../../lib/phone-push'
import { Switch } from '../../ui'

/** The row's second line in each state; only `off` and `on` can be switched. */
const WORDS: Record<PushState, string> = {
  off: 'When an agent needs you',
  on: 'On for this phone',
  blocked: 'Blocked. Allow notifications for this site in your phone’s settings.',
  'home-screen': 'Add Runcastle to your Home Screen first, then open it from there.',
  unsupported: 'Open Runcastle through your phone link, in a browser that supports this.',
}

/**
 * The foot of the phone's list (`agents-can-notify-your-phone`, decision 5): one
 * switch per phone, for every project on this runcastle. Turning it on asks the
 * browser's permission, and the server answers with a test notification.
 */
export function PhoneNotificationsRow({ projectId }: { projectId: string }) {
  const [state, setState] = useState<PushState | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const utils = trpc.useUtils()
  const subscribe = trpc.push.subscribe.useMutation()
  const unsubscribe = trpc.push.unsubscribe.useMutation()

  useEffect(() => {
    let live = true
    void readPushState().then((next) => {
      if (live) setState(next)
    })
    return () => {
      live = false
    }
  }, [])

  const turnOn = async () => {
    const subscription = await subscribeThisPhone(await utils.push.publicKey.fetch())
    if (!subscription) return
    try {
      await subscribe.mutateAsync({ projectId, subscription })
    } catch (error) {
      // The server dropped it, so this phone must not stay subscribed either.
      await unsubscribeThisPhone()
      throw error
    }
  }

  const turnOff = async () => {
    const endpoint = await unsubscribeThisPhone()
    if (endpoint) await unsubscribe.mutateAsync({ projectId, endpoint })
  }

  const flip = async (on: boolean) => {
    setBusy(true)
    setFailure(null)
    try {
      await (on ? turnOn() : turnOff())
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That did not work. Try again.')
    }
    setState(await readPushState())
    setBusy(false)
  }

  if (!state) return null
  const switchable = state === 'off' || state === 'on'
  return (
    <div className="flex min-h-13 shrink-0 items-center gap-3 border-t border-border-subtle px-2.5 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text">Notifications</div>
        <div role="status" className={failure ? 'text-xs text-pretty text-danger' : 'text-xs text-pretty text-text-tertiary'}>
          {failure ?? WORDS[state]}
        </div>
      </div>
      {switchable && (
        <Switch
          aria-label="Notifications"
          checked={state === 'on'}
          disabled={busy}
          onChange={(on) => void flip(on)}
        />
      )}
    </div>
  )
}
