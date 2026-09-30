import { createContext, useCallback, useContext } from 'react'

/**
 * Landing on the Chat tab after a session launch (one-chat-layout-everywhere
 * decisions 3 and 9): every button that starts or resumes a feature session —
 * Chat, Start, Iterate, every resolve, fix drive —
 * brings that feature's Chat tab forward once the launch has succeeded.
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

/** The land-on-chat operation for `featureId` — call it on a launch's success. */
export function useLandOnChat(featureId: string): () => void {
  const land = useContext(LandOnChatContext)
  return useCallback(() => land(featureId), [land, featureId])
}
