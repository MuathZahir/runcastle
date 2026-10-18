import { Button, CheckLine, Dialog, DialogBody, DialogFooter, DialogHeader, SectionLabel, Spinner } from '../ui'
import { IconPlay } from '../icons'
import { ConfirmWarnings } from './MergeFeatureDialog'
import type { GoSummary } from '../lib/feature-ui'

/**
 * Confirmation for `feature.go` (`the-feature-lead-runs-rounds` decision 8) —
 * the human's one click that approves the plan and hands the feature to its
 * agent, which dispatches every round from here. Go replaces Burn.
 *
 * Shaped after {@link MergeFeatureDialog} on purpose: the same figures-then-warn-
 * box-then-one-line grammar, so the operator learns ONE confirmation pattern
 * for both clicks. The warnings are computed server-side and arrive verbatim;
 * the primary is never disabled behind them, and a plan with no tickets is not
 * refused — the agent may do a small feature itself.
 */
export function GoFeatureDialog({
  title,
  branch,
  summary,
  busy,
  warningsPending,
  onConfirm,
  onCancel,
}: {
  title: string
  branch: string
  summary: GoSummary
  busy: boolean
  /** The warnings query is still in flight — said, never waited for. */
  warningsPending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open
      onClose={onCancel}
      labelledBy="go-feature-title"
      size="sm"
      className="flex max-h-[82vh] flex-col overflow-hidden"
    >
      <GoConfirmation
        title={title}
        branch={branch}
        summary={summary}
        busy={busy}
        warningsPending={warningsPending}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </Dialog>
  )
}

/**
 * Everything inside the panel. Its own component for the same reason
 * {@link MergeConfirmation} is: {@link Dialog} portals into `<body>` and cannot
 * be rendered to static markup, and this is what the content is tested at
 * (tier 1), while the portal, Escape and backdrop mechanics stay covered once
 * in `dialog.test.tsx`.
 */
export function GoConfirmation({
  title,
  branch,
  summary,
  busy,
  warningsPending,
  onConfirm,
  onCancel,
}: {
  title: string
  branch: string
  summary: GoSummary
  busy: boolean
  warningsPending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <>
      <DialogHeader
        id="go-feature-title"
        title="Go"
        onClose={onCancel}
        description={
          <>
            Approve the plan for <span className="font-medium text-text">{title}</span> on{' '}
            <code className="font-mono text-xs">{branch}</code>? The agent takes it from here.
          </>
        }
      />

      <DialogBody className="flex min-h-0 flex-col gap-5 overflow-y-auto">
        <section>
          <SectionLabel>What you approve</SectionLabel>
          {summary.rows.map((row) => (
            <CheckLine key={row.key} row={row} />
          ))}
        </section>

        <ConfirmWarnings warnings={summary.warnings} />

        {/* Said rather than waited for: a dialog that withheld its button until
            the warnings landed would be disabling by another name. */}
        {warningsPending && (
          <p className="m-0 flex items-center gap-2 text-sm text-text-tertiary">
            <Spinner size="sm" />
            Still checking for warnings…
          </p>
        )}

        {/* The last moment to say what the button does. */}
        <p className="m-0 text-sm text-text-tertiary">{summary.next}</p>
      </DialogBody>

      <DialogFooter className="border-t border-border-subtle pt-4">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" icon={<IconPlay />} onClick={onConfirm} disabled={busy}>
          {busy ? 'Going…' : 'Go'}
        </Button>
      </DialogFooter>
    </>
  )
}
