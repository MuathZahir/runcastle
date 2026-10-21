import { useState } from 'react'
import type { FeatureFull } from '../../lib/api'
import { FEATURE_CHAT, featureChatEntries, shownSession, type ChatSessionEntry } from '../../lib/chat-sessions'
import { activeSession, chatContextLine } from '../../lib/feature-ui'
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
  sessions,
  driveSessionId,
}: {
  /** The feature's sessions; its own live one names the feature chat's entry. */
  sessions: FeatureFull['sessions']
  /** The live drive's record of its scenario chat. */
  driveSessionId: string | undefined
}): FeatureChatColumn {
  const [picked, setPicked] = useState<string>(FEATURE_CHAT)
  const scenario = useScenarioChat(driveSessionId, setPicked)
  // Never the scenario chat itself: `activeSession` passes over it, so the
  // errand's session has its own entry and the feature chat keeps its own.
  const featureLive = activeSession(sessions)
  const entries = featureChatEntries({
    featureLive: featureLive
      ? { label: featureLive.kind === 'chat' ? 'Feature chat' : chatContextLine(featureLive) }
      : null,
    scenario: scenario.listed && scenario.sessionId ? { sessionId: scenario.sessionId, errand: scenario.errand } : null,
  })
  return { scenario, entries, inFront: shownSession(entries, picked)?.id ?? FEATURE_CHAT, pick: setPicked }
}
