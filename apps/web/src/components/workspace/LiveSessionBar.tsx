import { Button, SessionStatusDot } from '../../ui'
import { IconArrowRight } from '../../icons'
import type { LiveSessionLine } from '../../lib/feature-ui'
import { EndSessionButton } from '../EndSessionButton'
import { Notice } from '../review/Notice'

/**
 * A feature session that is up, as one line on Overview in every state
 * (one-chat-layout-everywhere decision 7): "● Chat live · lap 2 · Open chat ·
 * End session". Open chat switches to the Chat tab, where every session kind
 * lives — it no longer pins a planning view — and End session lets the human
 * close it without entering the chat, which is what the bar's "End session &
 * …" compound labels lean on.
 */
export function LiveSessionBar({
  featureId,
  line,
  onOpen,
}: {
  featureId: string
  line: LiveSessionLine
  /** Bring the Chat tab to the front. */
  onOpen: () => void
}) {
  return (
    <Notice
      tone="quiet"
      role="status"
      icon={<SessionStatusDot status="live" />}
      title={line.text}
      actions={
        <>
          <Button size="sm" variant="ghost" icon={<IconArrowRight />} onClick={onOpen}>
            Open chat
          </Button>
          <EndSessionButton featureId={featureId} sessionId={line.sessionId} />
        </>
      }
    />
  )
}
