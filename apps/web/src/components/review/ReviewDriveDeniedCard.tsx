import { Button, SectionTitle } from '../../ui'
import { trpc } from '../../trpc'
import type { ReviewDriveDenial } from '../../lib/feature-ui'
import { fmtDateTime, relTimeAgo } from '../../lib/format'
import { useToast } from '../../lib/toast'

/**
 * The dirty-tree refusal, in the alert slot (decision 5).
 *
 * A review that cannot drive falls back to the repo-only pass and says so in a
 * digest the human reads long afterwards — which is the whole complaint this
 * feature answers. The refusal is the moment they can still act, so it is a
 * banner naming the files that were in the way, with the one thing that fixes
 * it once they are gone: re-burn the review, which resumes the same reviewer
 * and does only the drive pass it was blocked from.
 *
 * `onRetry` is null when there is no `done` review ticket to re-burn — the
 * retry path takes a ticket, and a button that could only be refused is worse
 * than no button (as `ConflictCard` says of its own).
 *
 * Hook-free so its anatomy is testable without a tRPC provider, like its
 * neighbours in the slot; {@link ReviewDriveDeniedAlert} is the wired half.
 * `readonly` is answered here as well as at the orchestrator (decision 33a).
 */
export function ReviewDriveDeniedCard({
  denial,
  readonly,
  busy,
  onRetry,
  onDismiss,
}: {
  denial: ReviewDriveDenial
  /** Looking back at review on a shipped feature — history, never an action. */
  readonly: boolean
  busy: boolean
  /** Re-burn the review, or null when there is no review ticket to re-burn. */
  onRetry: (() => void) | null
  onDismiss: () => void
}) {
  if (readonly) return null

  return (
    <div className="rounded-lg border border-warn/45 bg-panel p-4" role="alert">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle>Review couldn’t drive — uncommitted changes</SectionTitle>
        <span className="font-mono text-xs text-text-3" title={fmtDateTime(denial.at)}>
          denied {relTimeAgo(denial.at)}
        </span>
      </div>
      <p className="mt-2 mb-0 text-sm leading-relaxed text-text-2">
        The drive was refused because the working tree had uncommitted changes, so the review ran
        repo-only — the gates and the diff, with no app to walk. Commit or discard the files below
        and retry: the same reviewer picks its findings back up and does the drive pass it missed.
      </p>
      {denial.dirtyFiles.length > 0 && (
        <ul className="mt-3 flex list-none flex-col gap-1 p-0">
          {denial.dirtyFiles.map((f) => (
            <li key={f} className="rounded-sm bg-warn/8 px-2 py-0.5 font-mono text-xs text-warn">
              {f}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex items-center gap-2">
        {onRetry && (
          <Button variant="solid" disabled={busy} onClick={onRetry}>
            Retry review
          </Button>
        )}
        <Button onClick={onDismiss}>Dismiss</Button>
      </div>
    </div>
  )
}

/**
 * {@link ReviewDriveDeniedCard} with the re-burn wired to it.
 *
 * The retry is the ordinary per-ticket one (`ticket.retry`), which the service
 * loosened to accept a `done` review ticket whose drive was refused this way —
 * so there is no second retry flow here, only the one door with the review's
 * own ticket handed to it. The endpoint refuses while the tree is still dirty,
 * naming what is still in the way; that refusal is a toast, because the human
 * asked for it by clicking and the banner is already saying the rest.
 */
export function ReviewDriveDeniedAlert({
  featureId,
  reviewTicketId,
  denial,
  readonly,
  onDismiss,
}: {
  featureId: string
  /** The review ticket to re-burn, or null when this lap emitted none. */
  reviewTicketId: string | null
  denial: ReviewDriveDenial
  readonly: boolean
  onDismiss: () => void
}) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const retry = trpc.ticket.retry.useMutation({
    onSuccess: () => void utils.feature.get.invalidate({ id: featureId }),
    onError: (e) => toast.push(e.message),
  })

  return (
    <ReviewDriveDeniedCard
      denial={denial}
      readonly={readonly}
      busy={retry.isPending}
      onRetry={reviewTicketId ? () => retry.mutate({ ticketId: reviewTicketId }) : null}
      onDismiss={onDismiss}
    />
  )
}
