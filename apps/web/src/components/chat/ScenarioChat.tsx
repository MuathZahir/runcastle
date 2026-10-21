import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ScenarioErrand } from '../../lib/chat-sessions'
import { trpc } from '../../trpc'
import { IconX } from '../../icons'
import { IconButton } from '../../ui'
import { ChatView } from './ChatView'

/**
 * The scenario chat (drive-scenarios decisions 3, 8), in the chat column
 * rather than docked beside the drive (design-mode decision 9): the drive keeps
 * the whole panel, and the column switches to the chat an errand opens.
 *
 * The page holds this state — the column and the drive's Scenario menu are far
 * apart — and hands the drive its two calls through `ScenarioChatContext`.
 */
export interface ScenarioChatApi {
  /** The errand's live session, mounted while it lives even when closed. */
  sessionId: string | null
  errand: ScenarioErrand
  /** The session has a place in the switcher (it was not closed). */
  listed: boolean
  /** An errand was clicked: name it now, so a briefed live chat is renamed too. */
  begin: (errand: ScenarioErrand) => void
  /** The server answered with the errand's session: list it and bring it to the front. */
  opened: (sessionId: string) => void
  /** The human closed the errand: the column goes back to the feature chat. */
  close: () => void
  ended: (sessionId: string) => void
}

/** The drive's way into the page's scenario chat; null where no column hosts one. */
export const ScenarioChatContext = createContext<Pick<ScenarioChatApi, 'begin' | 'opened'> | null>(null)

export function useScenarioChatDoor(): Pick<ScenarioChatApi, 'begin' | 'opened'> | null {
  return useContext(ScenarioChatContext)
}

/**
 * The scenario chat's state. `driveSessionId` is the live drive's own record of
 * it — a chat opened in another tab, or before a reload — and `onFront` is how
 * an open brings it to the front of the column.
 */
export function useScenarioChat(driveSessionId: string | undefined, onFront: (sessionId: string) => void): ScenarioChatApi {
  const utils = trpc.useUtils()
  // The session this browser just opened, so the chat shows before the drive's
  // poll has caught up with it.
  const [opened, setOpened] = useState<string | null>(null)
  // Closing only takes it out of the switcher; ＋ New scenario brings it back.
  const [closed, setClosed] = useState<string | null>(null)
  const [ended, setEnded] = useState<readonly string[]>([])
  const [errand, setErrand] = useState<ScenarioErrand>({ kind: 'new' })
  const sessionId =
    opened && !ended.includes(opened) ? opened : driveSessionId && !ended.includes(driveSessionId) ? driveSessionId : null
  const front = useRef(onFront)
  front.current = onFront

  const begin = useCallback((next: ScenarioErrand) => setErrand(next), [])
  const open = useCallback((id: string) => {
    setOpened(id)
    setClosed(null)
    front.current(id)
  }, [])
  const end = useCallback(
    (id: string) => {
      setEnded((list) => [...list, id])
      void utils.feature.driveInfo.invalidate()
    },
    [utils],
  )
  return useMemo(
    () => ({
      sessionId,
      errand,
      listed: !!sessionId && sessionId !== closed,
      begin,
      opened: open,
      close: () => setClosed(sessionId),
      ended: end,
    }),
    [sessionId, errand, closed, begin, open, end],
  )
}

/**
 * The scenario chat in the column: the shared chat surface, its errand under
 * the switcher, and a close that hands the column back. Kept mounted while its
 * session lives — hidden, not unmounted — so xterm keeps its buffer.
 */
export function ScenarioChatView({
  chat,
  switcher,
  featureId,
  hidden,
}: {
  chat: ScenarioChatApi
  switcher: ReactNode
  featureId?: string
  hidden: boolean
}) {
  const { sessionId } = chat
  if (!sessionId) return null
  return (
    <ChatView
      key={sessionId}
      label="Scenario chat"
      session={{ id: sessionId, status: 'live' }}
      contextLine={switcher}
      meta={
        <>
          <span className="min-w-0 flex-1 truncate">
            {chat.errand.kind === 'new' ? 'Describe the state you want to land in' : 'Fix the scenario that failed'}
          </span>
          <IconButton size="sm" label="Close the scenario chat" icon={<IconX />} onClick={chat.close} />
        </>
      }
      {...(featureId ? { featureId } : {})}
      onEnded={() => chat.ended(sessionId)}
      hidden={hidden || !chat.listed}
    />
  )
}
