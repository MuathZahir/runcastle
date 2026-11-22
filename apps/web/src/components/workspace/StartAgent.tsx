import type { Involvement } from '@runcastle/core'
import { Button, EmptyState } from '../../ui'
import { IconMessage, IconPlay } from '../../icons'
import { startHint } from '../../lib/feature-ui/start'
import { useIsPhone } from '../../lib/use-phone'

/**
 * A never-run feature's empty main chat (a-new-feature-waits-for-start
 * decisions 1, 3, 6, 8): opening the feature starts nothing, so the chat waits
 * here on one **Start**. The hint under it says what the lead does at the
 * feature's level: at "Everything" it reads the brief, explores and asks
 * first; below it, it plans and builds by itself.
 * While the start is in flight it shows busy; a refused start says why on a
 * line under it and Start stays pressable. The caller removes this once the
 * lead has launched.
 */
export function StartAgent({
  level,
  onStart,
  starting = false,
  refusal,
}: {
  /** The feature's "Involve me in" level: what the hint says Start will do. */
  level: Involvement
  onStart: () => void
  /** The start is in flight: Start shows busy and is off. */
  starting?: boolean
  /** Why the last press was refused ("Claude Code is not signed in. Run claude login"). */
  refusal?: string | undefined
}) {
  const phone = useIsPhone()
  return (
    <EmptyState
      className="animate-fade-in"
      icon={<IconMessage />}
      title="Not started yet"
      hint={startHint(level)}
      action={
        <div className="flex flex-col items-center gap-3">
          <Button variant="primary" size={phone ? 'touch' : 'md'} icon={<IconPlay />} loading={starting} disabled={starting} onClick={onStart}>
            Start
          </Button>
          {refusal && !starting && (
            <p role="alert" className="m-0 max-w-80 animate-fade-in text-sm text-pretty text-danger-text">
              {refusal}
            </p>
          )}
        </div>
      }
    />
  )
}
