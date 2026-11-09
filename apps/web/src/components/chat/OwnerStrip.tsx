import { IconOrchestrator } from '../../icons'
import { BARE_BUTTON, LINK, cx } from '../../ui'
import { RAISED } from './thread/surfaces'

/**
 * The one line above a feature's composer while an orchestrator chat owns the
 * feature (every-feature-has-one-owner decisions 5, 23): sending here takes the
 * feature, so the line says so before the first message. It always offers the
 * way to the chat, so following a feature row into its lead never forces a
 * takeover; while the chat is asking the human about this feature, it says
 * that instead.
 *
 * Information, not a warning: neutral, on the notice strip's one-line row,
 * with no ✕ (it holds while the chat owns the feature) and no button but the
 * link to the chat.
 */
export function OwnerStrip({ chat, asking = false, onOpenChat }: { chat: string; asking?: boolean; onOpenChat: () => void }) {
  return (
    <div
      role="note"
      aria-label="Who runs this feature"
      className={cx(RAISED, 'flex h-10 min-w-0 animate-rise-in items-center gap-2.5 pr-3 pl-3.5 text-sm')}
    >
      <IconOrchestrator size={16} className="shrink-0 text-icon" />
      <span className="min-w-0 flex-1 truncate text-text-secondary">
        {asking ? (
          <>
            <span className="inline-block max-w-1/3 truncate align-bottom text-text">{chat}</span> is asking you about this feature.
          </>
        ) : (
          <>
            <span className="inline-block max-w-1/3 truncate align-bottom text-text">{chat}</span> runs this feature. Sending makes it yours.
          </>
        )}
      </span>
      <button type="button" onClick={onOpenChat} className={cx(BARE_BUTTON, LINK, 'max-w-1/3 shrink-0 truncate p-0 text-sm')}>
        Open {chat}
      </button>
    </div>
  )
}
