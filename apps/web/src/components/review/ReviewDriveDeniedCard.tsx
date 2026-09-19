import { useState } from 'react'
import { Button, FailureNote, SectionTitle } from '../../ui'
import { trpc } from '../../trpc'
import type { ReviewDriveDenial } from '../../lib/feature-ui'
import { fmtDateTime, relTimeAgo } from '../../lib/format'

/**
 * The dirty-tree refusal, in the alert slot (decision 5).
 *
 * A review that cannot drive falls back to the repo-only pass and says so in a
 * digest the human reads long afterwards — which is the whole complaint this
 * feature answers. The refusal is the moment they can still act, so it is a
 * banner naming the files that were in the way, with the one thing that fixes
 * it once they are gone: another review pass, minted fresh on this lap and
 * burned (decision 7). The denied pass is not reset — it stays in the lap trail
 * as what it was.
 *
 * The mint needs no ticket of its own, so the action is unconditional now —
 * where the old retry had to be handed the refused ticket and went missing
 * when this lap had emitted none.
 *
 * Hook-free so its anatomy is testable without a tRPC provider, like its
 * neighbours in the slot; {@link ReviewDriveDeniedAlert} is the wired half.
 * `readonly` is answered here as well as at the orchestrator (decision 33a).
 */
export function ReviewDriveDeniedCard({
  denial,
  readonly,
  primary,
  busy,
  refusal,
  onReview,
  onDismiss,
}: {
  denial: ReviewDriveDenial
  /** Looking back at review on a shipped feature — history, never an action. */
  readonly: boolean
  /**
   * Whether this mint is the page's primary — exactly one `solid` button is
   * visible per view (STYLE.md). False when the nothing-verified banner is up
   * beside this one: both mints are the same verb, so the loud banner keeps the
   * solid and this one steps down to ghost rather than asking which primary is
   * the primary.
   */
  primary: boolean
  busy: boolean
  /** Why the mint was turned down, in the server's words, or null. */
  refusal: string | null
  /** Mint another review pass for this lap and burn it. */
  onReview: () => void
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
        repo-only — the gates and the diff, with no app to walk. Commit or discard the files below,
        then run another review: a fresh pass is minted for this lap and burns with the drive
        available to it.
      </p>
      {denial.dirtyFiles.length > 0 ? (
        <ul className="mt-3 flex list-none flex-col gap-1 p-0">
          {denial.dirtyFiles.map((f) => (
            <li key={f} className="rounded-sm bg-warn/8 px-2 py-0.5 font-mono text-xs text-warn">
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
          way, which is the only thing that gets the human to a working retry —
          and it stays put, where a toast would fade off the list of files they
          have yet to deal with. */}
      {refusal && (
        <div className="mt-3">
          <FailureNote message={refusal} />
        </div>
      )}
      <div className="mt-4 flex items-center gap-2">
        <Button variant={primary ? 'solid' : 'ghost'} disabled={busy} onClick={onReview}>
          {busy ? 'Starting…' : 'Agentic review'}
        </Button>
        <Button onClick={onDismiss}>Dismiss</Button>
      </div>
    </div>
  )
}

/**
 * {@link ReviewDriveDeniedCard} with the mint wired to it.
 *
 * The action is the Agentic review mutation every other Agentic review button
 * calls (decision 7) — the narrow `retryingDeniedReview` special case that used
 * to reset the refused `done` ticket is gone, and `ticket.retry` is failed
 * tickets only again. The endpoint refuses while the tree is still dirty,
 * naming what is still in the way; that refusal is held here rather than pushed
 * to a toast, because it is a list of files the human has to go and deal with
 * before the button can work, and a toast that has faded is a list they no
 * longer have.
 */
export function ReviewDriveDeniedAlert({
  featureId,
  denial,
  readonly,
  primary,
  onDismiss,
}: {
  featureId: string
  denial: ReviewDriveDenial
  readonly: boolean
  /** Whether this banner holds the page's one solid button — see the card. */
  primary: boolean
  onDismiss: () => void
}) {
  const utils = trpc.useUtils()
  const [refusal, setRefusal] = useState<string | null>(null)
  const review = trpc.feature.agenticReview.useMutation({
    onSuccess: () => {
      // The banner reads the feed and the run list to know it is over, so the
      // burn this just minted has to land before it can clear itself.
      void utils.feature.get.invalidate({ id: featureId })
      void utils.events.invalidate()
    },
    onError: (e) => setRefusal(e.message),
  })

  return (
    <ReviewDriveDeniedCard
      denial={denial}
      readonly={readonly}
      primary={primary}
      busy={review.isPending}
      refusal={refusal}
      onReview={() => {
        setRefusal(null)
        review.mutate({ featureId })
      }}
      onDismiss={onDismiss}
    />
  )
}
