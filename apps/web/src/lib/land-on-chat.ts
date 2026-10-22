import { createContext, useCallback, useContext } from 'react'
import type { FeatureView } from './routes'

/**
 * Landing on the chat after a session launch (one-chat-layout-everywhere
 * decisions 3 and 9): every button that starts or resumes a feature session —
 * Chat, Start, every resolve, fix drive —
 * brings that feature's chat forward once the launch has succeeded. The chat
 * is the page (design-mode decision 5), so landing changes only the chat
 * column: a panel open beside it — the drive, the design — stays open.
 *
 * One operation rather than per-button navigation: the shell provides it (it
 * owns which feature and which view are selected, and remembers the view), and
 * every launch site calls it from its mutation's `onSuccess`, wherever in the
 * tree it sits. A launch on a live chat answers with that same session
 * (one-chat-per-feature decision 12), so landing simply brings it forward.
 *
 * Outside a shell (a component rendered on its own) there is nowhere to land,
 * and landing does nothing.
 */
const LandOnChatContext = createContext<(featureId: string) => void>(() => {})

export const LandOnChatProvider = LandOnChatContext.Provider

/**
 * The view a launch lands `featureId` on: the one on screen when that is this
 * feature's, so its panel and URL stay put; else the chat alone. `shown.featureId`
 * is null when no feature's chat is on screen (the project page, a draft's body).
 */
export function landingView(featureId: string, shown: { featureId: string | null; view: FeatureView }): FeatureView {
  return shown.featureId === featureId ? shown.view : 'chat'
}

/** The land-on-chat operation for `featureId` — call it on a launch's success. */
export function useLandOnChat(featureId: string): () => void {
  const land = useContext(LandOnChatContext)
  return useCallback(() => land(featureId), [land, featureId])
}
