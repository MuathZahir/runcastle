import type { ReactNode } from 'react'
import { shiftShortcut } from './platform'
import { createPublished } from './published'

/**
 * The open feature's actions, for the ⌘K palette (you-always-know-what-s-waiting
 * decision 8): the feature page publishes the header's own buttons — its
 * primary, New thread, Merge & ship, Start test drive — and the palette lists
 * them first, so the two run the same dispatcher and can never disagree.
 */
export interface FeatureCommand {
  /** The dispatcher kind it fires: a stable key for the row. */
  key: string
  label: string
  /** The header button's own icon. */
  icon?: ReactNode
  /** The shortcut that does the same, spelled for this machine. */
  kbd?: string
  /** Why it cannot run right now, exactly where the header would disable it. */
  disabled?: string
  run: () => void
}

export interface FeatureCommands {
  /** The feature's title: the group's heading. */
  title: string
  commands: FeatureCommand[]
}

const published = createPublished<FeatureCommands>()

/**
 * Under the project shell: what the open feature page publishes, for the
 * palette beside it. A publish wakes only the palette, never the page.
 */
export const FeatureCommandsProvider = published.Provider

/** A fixed set of the open feature's commands: a palette rendered on its own, in a test. */
export const FeatureCommandsValue = published.Value

/** The feature page's side: publish its commands while mounted (null for none). */
export function PublishFeatureCommands({ commands }: { commands: FeatureCommands | null }): null {
  published.usePublish(commands)
  return null
}

/** The palette's side: what the open feature page published, or null. */
export const useFeatureCommands: () => FeatureCommands | null = published.useValue

/** The New thread shortcut (decision 7): Ctrl+Shift+O, ⌘⇧O on a Mac. */
export function isNewThreadHotkey(e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'key'>): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o'
}

/** {@link isNewThreadHotkey} spelled the way this machine spells it. */
export const newThreadShortcut = (): string => shiftShortcut('O')
