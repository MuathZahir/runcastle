import { useState } from 'react'
import { Button, FailureNote, SectionTitle } from '../../ui'
import type { ReviewDriveDenial } from '../../lib/feature-ui'
import { fmtDateTime, relTimeAgo } from '../../lib/format'
import { trpc } from '../../trpc'

/**
 * A review drive the working tree would not let start, in the alert slot
 * (decision 5).
 *
 * The denial used to reach the human only through the review's digest, hours
 * after the moment they could have done anything about it — so it says so here,
 * naming their own uncommitted files, while cleaning them up still helps. The
 * review itself did not fail: it fell back to a repo-only pass, which is why
 * this is a warning rather than the red of {@link ConflictCard}, and why the
 * button offers the drive pass again rather than the whole review.
 *
 * Hook-free like its neighbours in the slot, so its anatomy is testable without
 * a tRPC provider; {@link DeniedDriveAlert} is the wired half. `readonly`
 * answers itself here for the same reason (decision 33a).
 */
export function DeniedDriveCard({
  denial,
  readonly,
  busy,
  refusal,
  onRetry,
  onDismiss,
}: {
  denial: ReviewDriveDenial
  /** Looking back at review on a shipped feature — history, never an action. */
  readonly: boolean
  busy: boolean
  /** Why the retry was turned down, in the server's words, or null. */
  refusal: string | null
  onRetry: () => void
  onDismiss: () => void
}) {
  if (readonly) return null

  return (
    <div className="rounded-lg border border-warn/45 bg-panel p-4" role="alert">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle>Review drive denied — dirty working tree</SectionTitle>
        <span className="font-mono text-xs text-text-3" title={fmtDateTime(denial.at)}>
          {relTimeAgo(denial.at)}
        </span>
      </div>
      <p className="mt-2 mb-0 text-sm leading-relaxed text-text-2">
        The reviewer could not drive the app — uncommitted changes were in the way — so it
        reviewed the repo alone. Commit or discard them, then retry: the same reviewer picks up
        where it left off and does the drive pass it was blocked from.
      </p>
      {denial.dirtyFiles.length > 0 ? (
        <ul className="mt-3 flex list-none flex-col gap-1 p-0">
          {denial.dirtyFiles.map((f) => (
            <li key={f} className="rounded-sm bg-warn/9 px-2 py-0.5 font-mono text-xs text-warn">
              {f}
            </li>
          ))}
        </ul>
      ) : (
        // A denial the server recorded without a file list still names them in
        // its own sentence, and that sentence is the point of the banner.
        <p className="mt-3 mb-0 font-mono text-xs break-words text-text-3">{denial.message}</p>
      )}
      {/* The refusal is the server's, verbatim: it names what is STILL in the
          way, which is the only thing that gets the human to a working retry. */}
      {refusal && (
        <div className="mt-3">
          <FailureNote message={refusal} />
        </div>
      )}
      <div className="mt-4 flex items-center gap-2">
        <Button variant="solid" disabled={busy} onClick={onRetry}>
          {busy ? 'Retrying…' : 'Retry review'}
        </Button>
        <Button onClick={onDismiss}>Dismiss</Button>
      </div>
    </div>
  )
}

/**
 * {@link DeniedDriveCard} with the per-ticket retry wired to it.
 *
 * The refusal is held here rather than pushed to a toast: it is a list of files
 * the human has to go and deal with before the button can work, and a toast
 * that has faded is a list they no longer have.
 */
export function DeniedDriveAlert({
  featureId,
  ticketId,
  denial,
  readonly,
  onDismiss,
}: {
  featureId: string
  /** The review ticket the retry re-burns. */
  ticketId: string
  denial: ReviewDriveDenial
  readonly: boolean
  onDismiss: () => void
}) {
  const utils = trpc.useUtils()
  const [refusal, setRefusal] = useState<string | null>(null)
  const retry = trpc.ticket.retry.useMutation({
    onSuccess: () => {
      // The banner reads the run list to know it is over, so the run this just
      // minted has to land before it can clear itself.
      void utils.feature.get.invalidate({ id: featureId })
      void utils.events.invalidate()
    },
    onError: (e) => setRefusal(e.message),
  })

  return (
    <DeniedDriveCard
      denial={denial}
      readonly={readonly}
      busy={retry.isPending}
      refusal={refusal}
      onRetry={() => {
        setRefusal(null)
        retry.mutate({ ticketId })
      }}
      onDismiss={onDismiss}
    />
  )
}
