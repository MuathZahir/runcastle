import { IconButton } from '../../ui'
import { IconX } from '../../icons'
import { Notice } from './Notice'
import type { ReviewDriveDenial } from '../../lib/feature-ui'
import { fmtDateTime, relTimeAgo } from '../../lib/format'

/**
 * The dirty-tree refusal, in the alert slot (decision 5).
 *
 * A review that cannot drive falls back to the repo-only pass and says so in a
 * digest the human reads long afterwards — which is the whole complaint this
 * feature answers. The refusal is the moment they can still act, so it is a
 * banner naming the files that were in the way. Another review is the agent's
 * to run once they are gone, so the human asks in the chat
 * (tickets-and-review-are-tools-not-phases decision 12); the denied pass stays
 * in the trail as what it was.
 *
 * Hook-free so its anatomy is testable without a tRPC provider, like its
 * neighbours in the slot. `readonly` is answered here as well as at the
 * orchestrator (decision 33a).
 */
export function ReviewDriveDeniedCard({
  denial,
  readonly,
  onDismiss,
}: {
  denial: ReviewDriveDenial
  /** Looking back at review on a shipped feature — history, never an action. */
  readonly: boolean
  onDismiss: () => void
}) {
  if (readonly) return null

  return (
    <Notice
      tone="accent"
      title="Review couldn’t drive — uncommitted changes"
      meta={<span title={fmtDateTime(denial.at)}>denied {relTimeAgo(denial.at)}</span>}
      actions={<IconButton size="sm" label="Dismiss" icon={<IconX />} onClick={onDismiss} />}
    >
      <p className="m-0">
        The drive was refused because the working tree had uncommitted changes, so the review ran
        repo-only — the gates and the diff, with no app to walk. Commit or discard the files below,
        then ask the agent for another review: a fresh pass gets the drive.
      </p>
      {denial.dirtyFiles.length > 0 ? (
        <ul className="m-0 mt-2 flex list-none flex-col gap-0.5 p-0">
          {denial.dirtyFiles.map((f) => (
            <li key={f} className="truncate font-mono text-xs text-text" title={f}>
              {f}
            </li>
          ))}
        </ul>
      ) : (
        // A denial the server recorded without a file list still names them in
        // its own sentence, and that sentence is the point of the notice.
        <p className="m-0 mt-2 font-mono text-xs break-words text-text-tertiary">{denial.message}</p>
      )}
    </Notice>
  )
}
