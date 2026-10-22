import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ScenarioErrand } from '../../lib/chat-sessions'
import { trpc } from '../../trpc'
import { IconX } from '../../icons'
import { DropdownMenuItem } from '../../ui/dropdown-menu'
import { EndSessionItem } from '../EndSessionButton'
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
 * The scenario chat in the column: the shared chat surface. Kept mounted while
 * its session lives — hidden, not unmounted — so xterm keeps its buffer. Its
 * errand, its close and End session are the switcher's ({@link ScenarioChatMenu}).
 */
export function ScenarioChatView({ chat, hidden }: { chat: ScenarioChatApi; hidden: boolean }) {
  const { sessionId } = chat
  if (!sessionId) return null
  return (
    <ChatView
      key={sessionId}
      label="Scenario chat"
      session={{ id: sessionId, status: 'live' }}
      onEnded={() => chat.ended(sessionId)}
      hidden={hidden || !chat.listed}
    />
  )
}

/** What the scenario chat is for, as the switcher's hint line says it. */
export function scenarioErrandHint(errand: ScenarioErrand): string {
  return errand.kind === 'new' ? 'Describe the state you want to land in' : 'Fix the scenario that failed'
}

/**
 * The switcher's rows while the scenario chat is in front (design-mode
 * decision 12, where its own header row was): close, which hands the column
 * back, and End session.
 */
export function ScenarioChatMenu({ chat, featureId }: { chat: ScenarioChatApi; featureId?: string }) {
  const { sessionId } = chat
  if (!sessionId) return null
  return (
    <>
      <DropdownMenuItem icon={<IconX />} onSelect={chat.close}>
        Close the scenario chat
      </DropdownMenuItem>
      <EndSessionItem
        {...(featureId ? { featureId } : {})}
        sessionId={sessionId}
        onEnded={() => chat.ended(sessionId)}
      />
    </>
  )
}
