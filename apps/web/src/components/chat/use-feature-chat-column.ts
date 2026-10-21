import { useState } from 'react'
import { FEATURE_CHAT, featureChatEntries, shownSession, type ChatSessionEntry } from '../../lib/chat-sessions'
import { useScenarioChat, type ScenarioChatApi } from './ScenarioChat'

export interface FeatureChatColumn {
  /** The drive errand's chat — what the page provides to the drive through `ScenarioChatContext`. */
  scenario: ScenarioChatApi
  entries: ChatSessionEntry[]
  /** The entry in front of the column. */
  inFront: string
  pick: (id: string) => void
}

/**
 * The feature page's chat column (design-mode decision 9): the feature chat,
 * and the scenario chat while a drive errand's session is live. An errand's
 * open brings its chat to the front; closing it, or its session ending, hands
 * the column back to the feature chat.
 */
export function useFeatureChatColumn({
  featureLive,
  driveSessionId,
}: {
  /** The feature's own session, named, or null when nothing is up. */
  featureLive: { label: string } | null
  /** The live drive's record of its scenario chat. */
  driveSessionId: string | undefined
}): FeatureChatColumn {
  const [picked, setPicked] = useState<string>(FEATURE_CHAT)
  const scenario = useScenarioChat(driveSessionId, setPicked)
  const entries = featureChatEntries({
    featureLive,
    scenario: scenario.listed && scenario.sessionId ? { sessionId: scenario.sessionId, errand: scenario.errand } : null,
  })
  return { scenario, entries, inFront: shownSession(entries, picked)?.id ?? FEATURE_CHAT, pick: setPicked }
}
