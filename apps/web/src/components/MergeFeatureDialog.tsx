import { Button, CheckLine, Dialog, SectionTitle } from '../ui'
import type { MergeSummary } from '../lib/feature-ui'

/**
 * Confirmation for `feature.merge` (findings F21). Merging is the pipeline's most
 * irreversible action and it used to fire on a single click — less friction than
 * deleting a throwaway feature, which has a type-the-slug dialog.
 *
 * Deliberately lighter than {@link DeleteFeatureDialog}: no type-to-arm, because
 * merging is the pipeline's intended ending and the risk is not "wrong feature"
 * but "merging something unfinished". So the friction is *reading* — the summary
 * states what is about to land (commits, run, test drive) and every gap in it is
 * spelled out as a warning above the button. Escape and a backdrop click cancel.
 */
export function MergeFeatureDialog({
  title,
  branch,
  base,
  summary,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string
  branch: string
  /** The branch this will merge into, as git reported it. */
  base?: string
  summary: MergeSummary
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open
      onClose={onCancel}
      label={`Merge and ship ${branch}`}
      backdropClassName="peek-backdrop"
      className="peek merge-dialog"
    >
      <div className="peek-head">
        <span className="merge-dialog-title">Merge &amp; ship</span>
        <button className="peek-close" onClick={onCancel} aria-label="Close (Esc)">
          ✕
        </button>
      </div>
      <div className="peek-body merge-dialog-body">
        <p className="merge-dialog-lead">
          Merge <strong>{title}</strong> from <code className="mono">{branch}</code>
          {base ? (
            <>
              {' '}
              into <code className="mono">{base}</code>
            </>
          ) : null}
          ? This ships the feature.
        </p>

        <SectionTitle>What lands</SectionTitle>
        {summary.rows.map((row) => (
          <CheckLine key={row.key} row={row} />
        ))}

        {summary.warnings.length > 0 && (
          <ul className="merge-dialog-warnings">
            {summary.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        <div className="merge-dialog-actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="solid" onClick={onConfirm} disabled={busy}>
            {busy ? 'Merging…' : 'Merge & ship'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
