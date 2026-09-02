import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { settingsMention, type SettingsLocation } from '../../lib/settings'
import { BARE_BUTTON } from './button'

/**
 * Turning "…Rebuild it from Settings → Burns (Rebuild image)." into a link that
 * actually goes there (decision 9).
 *
 * The doctor's stale-image fix and the burner's missing-binary failure both name
 * a settings page in prose, and the walk found every one of those pointers to be
 * an instruction to go looking. They surface far from the shell — inside a
 * ticket's error, a lane's headline — so opening settings travels as context
 * rather than as a prop threaded through every phase body between here and the
 * shell that owns the dialog.
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

/**
 * A message with its settings pointer, if it has one, rendered as a link. Falls
 * back to the plain text — a message nobody can act on should not look like it
 * offers something.
 */
export function MessageWithSettingsLink({ text }: { text: string }) {
  const open = useContext(OpenSettings)
  const mention = settingsMention(text)
  if (!open || !mention) return <>{text}</>
  return (
    <>
      {mention.before}
      <button
        type="button"
        className={`${BARE_BUTTON} cursor-pointer text-accent-hi underline underline-offset-2 hover:text-accent-2`}
        onClick={(event) => {
          // The lane this can sit in is itself a click target.
          event.stopPropagation()
          open(mention.location)
        }}
      >
        {mention.phrase}
      </button>
      {mention.after}
    </>
  )
}
