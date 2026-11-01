import { IconMonitor } from '../icons'
import { EmptyState } from '../ui'

/**
 * What a setup screen shows on a phone (runcastle-on-your-phone): opening a
 * project, the first-run wizard and preparation need the computer's folders
 * and terminals, so on a phone they say where to do it, and nothing else.
 */
export function OnYourComputer() {
  return <EmptyState icon={<IconMonitor />} title="Set this up on your computer." className="min-h-0 flex-1" />
}
