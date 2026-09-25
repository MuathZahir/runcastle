import type { Phase } from '@runcastle/core'
import { Button, SessionStatusDot } from '../../ui'
import { IconArrowRight } from '../../icons'
import { Notice } from './Notice'
import type { LiveSessionLine } from '../../lib/feature-ui'
import { EndSessionButton } from '../EndSessionButton'

/**
 * A session that is still up, as one line in the alert slot (decision 5).
 *
 * Review renders no terminal at all any more. The panel it replaces was a
 * uniformity fallthrough — mounted unconditionally, filtered by neither phase
 * nor kind — which is how a live *ideation* terminal came to squat above the
 * fold of a page whose contract is to open on the evidence. A session from an
 * earlier phase is state the human should know about and not a workspace they
 * should work in here, so it gets a line with the two verbs that apply: Open,
 * which goes to the view that actually holds it, and End.
 *
 * An ended session renders nothing (there is no line to draw), and a readonly
 * history view renders nothing either — both live verbs are actions, and the
 * page that is a record offers none (decision 33a).
 */
export function LiveSessionAlert({
  featureId,
  line,
  readonly,
  onOpen,
}: {
  featureId: string
  line: LiveSessionLine
  /** Looking back at review on a shipped feature — history, never an action. */
  readonly: boolean
  /** Go to the phase whose view holds this session's terminal. */
  onOpen?: (phase: Phase) => void
}) {
  if (readonly) return null
  const { phase } = line

  return (
    <Notice
      tone="quiet"
      role="status"
      icon={<SessionStatusDot status="live" />}
      title={line.text}
      actions={
        <>
          {phase && onOpen && (
            <Button size="sm" variant="ghost" icon={<IconArrowRight />} onClick={() => onOpen(phase)}>
              Open
            </Button>
          )}
          <EndSessionButton featureId={featureId} sessionId={line.sessionId} />
        </>
      }
    />
  )
}
