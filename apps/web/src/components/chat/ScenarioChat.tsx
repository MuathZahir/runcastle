import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import type { ScenarioErrand } from '../../lib/chat-sessions'
import { IconX } from '../../icons'
import { DropdownMenuItem } from '../../ui/dropdown-menu'

/**
 * The scenario chat (drive-scenarios decisions 3, 8), in the chat column
 * rather than docked beside the drive (design-mode decision 9): the drive keeps
 * the whole panel, and the column switches to the thread an errand opens.
 *
 * The page holds this state — the column and the drive's Scenario menu are far
 * apart — and hands the drive its two calls through `ScenarioChatContext`.
 */
export interface ScenarioChatApi {
  /** The errand's thread. */
  sessionId: string | null
  errand: ScenarioErrand
  /** The errand is open: its thread may stay in front (it was not closed). */
  listed: boolean
  /** An errand was clicked: name it now, so a briefed chat is renamed too. */
  begin: (errand: ScenarioErrand) => void
  /** The server answered with the errand's thread: bring it to the front. */
  opened: (sessionId: string) => void
  /** The human closed the errand: the column goes back to the feature chat. */
  close: () => void
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
  // The thread this browser just opened, so the chat shows before the drive's
  // poll has caught up with it.
  const [opened, setOpened] = useState<string | null>(null)
  // Closing hands the column back; ＋ New scenario brings it to the front again.
  const [closed, setClosed] = useState<string | null>(null)
  const [errand, setErrand] = useState<ScenarioErrand>({ kind: 'new' })
  const sessionId = opened ?? driveSessionId ?? null
  const front = useRef(onFront)
  front.current = onFront

  const begin = useCallback((next: ScenarioErrand) => setErrand(next), [])
  const open = useCallback((id: string) => {
    setOpened(id)
    setClosed(null)
    front.current(id)
  }, [])
  return useMemo(
    () => ({
      sessionId,
      errand,
      listed: !!sessionId && sessionId !== closed,
      begin,
      opened: open,
      close: () => setClosed(sessionId),
    }),
    [sessionId, errand, closed, begin, open],
  )
}

/** What the scenario chat is for, said in its empty thread. */
export function scenarioErrandHint(errand: ScenarioErrand): string {
  return errand.kind === 'new' ? 'Describe the state you want to land in' : 'Fix the scenario that failed'
}

/** The switcher's row while the scenario chat is in front: close, which hands the column back. */
export function ScenarioChatMenu({ chat }: { chat: ScenarioChatApi }) {
  if (!chat.sessionId) return null
  return (
    <DropdownMenuItem icon={<IconX />} onSelect={chat.close}>
      Close the scenario chat
    </DropdownMenuItem>
  )
}
