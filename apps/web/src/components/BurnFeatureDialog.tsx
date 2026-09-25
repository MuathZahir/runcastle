import { Button, CheckLine, Dialog, DialogBody, DialogFooter, DialogHeader, SectionLabel, Spinner } from '../ui'
import { IconFlame } from '../icons'
import { ConfirmWarnings } from './MergeFeatureDialog'
import type { BurnSummary } from '../lib/feature-ui'

/**
 * Confirmation for `feature.burn` (decisions §5) — the first of the two human
 * clicks, and the door every ex-gate now warns at instead of refusing at.
 *
 * Shaped after {@link MergeFeatureDialog} on purpose: the same figures-then-warn-
 * box-then-one-line grammar, so the operator learns ONE confirmation pattern
 * for both clicks. The warnings are computed server-side and arrive verbatim;
 * the primary is never disabled behind them, because the friction at Burn is
 * *reading*. The two things that genuinely refuse a burn — a run already
 * burning this feature, and git safety — are physics and surface as a launch
 * failure, not as a dead button here.
 */
export function BurnFeatureDialog({
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
  summary: BurnSummary
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
      labelledBy="burn-feature-title"
      size="sm"
      className="flex max-h-[82vh] flex-col overflow-hidden"
    >
      <BurnConfirmation
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
export function BurnConfirmation({
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
  summary: BurnSummary
  busy: boolean
  warningsPending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <>
      <DialogHeader
        id="burn-feature-title"
        title="Burn tickets"
        onClose={onCancel}
        description={
          <>
            Burn <span className="font-medium text-text">{title}</span> on{' '}
            <code className="font-mono text-xs">{branch}</code>? Each ticket runs as its own sandboxed agent.
          </>
        }
      />

      <DialogBody className="flex min-h-0 flex-col gap-5 overflow-y-auto">
        <section>
          <SectionLabel>What burns</SectionLabel>
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
        <Button variant="primary" icon={<IconFlame />} onClick={onConfirm} disabled={busy}>
          {busy ? 'Burning…' : 'Burn'}
        </Button>
      </DialogFooter>
    </>
  )
}
