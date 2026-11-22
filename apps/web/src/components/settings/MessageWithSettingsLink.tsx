import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { SettingsLocation } from '../../lib/settings'
import { LINK } from '../../ui'

/**
 * Links that open settings on the row they name (decision 9). They surface far
 * from the shell — inside a chat card, a drive state — so opening settings
 * travels as context rather than as a prop threaded through every body between
 * here and the shell that owns the dialog.
 */
const OpenSettings = createContext<((location: SettingsLocation) => void) | null>(null)

export function OpenSettingsProvider({
  open,
  children,
}: {
  open: (location: SettingsLocation) => void
  children: ReactNode
}) {
  return <OpenSettings.Provider value={open}>{children}</OpenSettings.Provider>
}

/** The shell's settings opener, for a button rather than a phrase; `null` outside the provider. */
export function useOpenSettings() {
  return useContext(OpenSettings)
}

/**
 * A phrase that opens settings on the row it names — the drive states name the
 * dev-command field directly. Renders as plain text outside the provider,
 * because a link that goes nowhere is worse than none.
 */
export function SettingsLink({
  location,
  children,
}: {
  location: SettingsLocation
  children: ReactNode
}) {
  const open = useContext(OpenSettings)
  if (!open) return <>{children}</>
  return (
    <button
      type="button"
      className={LINK}
      onClick={(event) => {
        // The lane or row this can sit in is itself a click target.
        event.stopPropagation()
        open(location)
      }}
    >
      {children}
    </button>
  )
}
