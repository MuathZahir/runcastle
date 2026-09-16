import { Button, CheckLine, Dialog, SectionTitle } from '../ui'
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
      label={`Burn the tickets on ${branch}`}
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
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="text-sm font-semibold text-text">Burn tickets</span>
        <button
          className="cursor-pointer border-0 bg-transparent p-1 text-base text-text-3 hover:text-text"
          onClick={onCancel}
          aria-label="Close (Esc)"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-6 overflow-y-auto p-4">
        <p className="m-0 text-base leading-relaxed text-text-2">
          Burn <strong className="font-semibold text-text">{title}</strong> on{' '}
          <code className="font-mono">{branch}</code>? Each ticket runs as its own sandboxed agent.
        </p>

        <div>
          <SectionTitle>What burns</SectionTitle>
          {summary.rows.map((row) => (
            <CheckLine key={row.key} row={row} />
          ))}
        </div>

        {summary.warnings.length > 0 && (
          <ul className="m-0 list-disc rounded-sm border border-warn/40 bg-warn/7 py-2.5 pr-3 pl-6 text-sm leading-relaxed text-warn">
            {summary.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}

        {/* Said rather than waited for: a dialog that withheld its button until
            the warnings landed would be disabling by another name. */}
        {warningsPending && (
          <p className="m-0 text-sm leading-relaxed text-text-3">Still checking for warnings…</p>
        )}

        {/* The last moment to say what the button does. */}
        <p className="m-0 text-sm leading-relaxed text-text-3">{summary.next}</p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="solid" onClick={onConfirm} disabled={busy}>
            {busy ? 'Burning…' : 'Burn'}
          </Button>
        </div>
      </div>
    </>
  )
}
