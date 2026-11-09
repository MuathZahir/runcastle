import { Button, EmptyState } from '../../ui'
import { IconMessage, IconPlay, IconSparkle } from '../../icons'
import { useIsPhone } from '../../lib/use-phone'

/** Which of the two the human pressed, while its launch is in flight. */
export type StartAgentPress = 'start' | 'selfPlan'

/**
 * A never-run feature's empty main chat (a-new-feature-waits-for-start
 * decisions 1, 3, 6, 8): opening the feature starts nothing, so the chat waits
 * here. **Start** is its one primary — the agent reads its brief, explores and
 * speaks first; **Plan it yourself** is a quiet button beside it, a run that
 * plans the feature alone. While one is in flight it shows busy and both are
 * off; a refused start says why on a line under them and Start stays pressable.
 * The caller removes this once either one has launched.
 */
export function StartAgent({
  onStart,
  onPlanItYourself,
  starting,
  refusal,
}: {
  onStart: () => void
  onPlanItYourself: () => void
  /** The pressed one, in flight: it shows busy and both are off. */
  starting?: StartAgentPress | undefined
  /** Why the last press was refused ("Claude Code is not signed in. Run claude login"). */
  refusal?: string | undefined
}) {
  const phone = useIsPhone()
  const size = phone ? 'touch' : 'md'
  const busy = starting !== undefined
  return (
    <EmptyState
      className="animate-fade-in"
      icon={<IconMessage />}
      title="Not started yet"
      hint="The agent reads the brief, looks through the code and speaks first."
      action={
        <div className="flex flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" size={size} icon={<IconPlay />} loading={starting === 'start'} disabled={busy} onClick={onStart}>
              Start
            </Button>
            <Button
              variant="ghost"
              size={size}
              icon={<IconSparkle />}
              loading={starting === 'selfPlan'}
              disabled={busy}
              title="A run that plans the feature without you"
              onClick={onPlanItYourself}
            >
              Plan it yourself
            </Button>
          </div>
          {refusal && !busy && (
            <p role="alert" className="m-0 max-w-80 animate-fade-in text-sm text-pretty text-danger-text">
              {refusal}
            </p>
          )}
        </div>
      }
    />
  )
}
