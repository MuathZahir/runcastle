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
 * states what is about to land, what the human is shipping over is spelled out
 * as warnings, and one line says what the button will actually do. Escape and a
 * backdrop click cancel.
 *
 * Over a standing conflict it becomes a different dialog (decision 29): the red
 * row is the first thing in "what lands", the primary flips to the resolve act
 * the conflict card offers, and Merge demotes to an enabled "Retry merge anyway".
 * Nothing is ever disabled — `fix-merge-conflict-system` decisions 2b/3 stand,
 * because runcastle's conflict probe is best-effort and a human who resolved by
 * hand must still be able to land it.
 */
export function MergeFeatureDialog({
  title,
  branch,
  base,
  summary,
  busy,
  resolving,
  onConfirm,
  onResolve,
  onCancel,
}: {
  title: string
  branch: string
  /** The branch this will merge into, as git reported it. */
  base?: string
  summary: MergeSummary
  busy: boolean
  /** A resolve session is being launched — the conflict primary's own pending. */
  resolving?: boolean
  onConfirm: () => void
  /** Launch the resolve agent; the same act as the conflict card's button. */
  onResolve?: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open
      onClose={onCancel}
      label={`Merge and ship ${branch}`}
      size="sm"
      className="flex max-h-[82vh] flex-col overflow-hidden"
    >
      <MergeConfirmation
        title={title}
        branch={branch}
        base={base}
        summary={summary}
        busy={busy}
        resolving={resolving}
        onConfirm={onConfirm}
        onResolve={onResolve}
        onCancel={onCancel}
      />
    </Dialog>
  )
}

/**
 * Everything inside the panel. Its own component because {@link Dialog} portals
 * into `<body>` and so cannot be rendered to static markup — this is what the
 * dialog's content is tested at (decision 36, tier 1), while the portal, Escape
 * and backdrop mechanics stay covered once in `dialog.test.tsx`.
 */
export function MergeConfirmation({
  title,
  branch,
  base,
  summary,
  busy,
  resolving,
  onConfirm,
  onResolve,
  onCancel,
}: {
  title: string
  branch: string
  base?: string
  summary: MergeSummary
  busy: boolean
  resolving?: boolean
  onConfirm: () => void
  onResolve?: () => void
  onCancel: () => void
}) {
  const conflicted = !!summary.conflictRow && !!onResolve

  return (
    <>
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="text-sm font-semibold text-text">Merge &amp; ship</span>
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
          Merge <strong className="font-semibold text-text">{title}</strong> from{' '}
          <code className="font-mono">{branch}</code>
          {base ? (
            <>
              {' '}
              into <code className="font-mono">{base}</code>
            </>
          ) : null}
          ? This ships the feature.
        </p>

        <div>
          <SectionTitle>What lands</SectionTitle>
          {/* The loudest thing in the dialog, above the green rows rather than
              instead of them: the human still sees what lands IF it lands. */}
          {summary.conflictRow && (
            <p
              className="mt-2 mb-0 rounded-sm border border-danger/45 bg-danger/8 px-3 py-2 text-sm leading-relaxed text-danger"
              role="alert"
            >
              {summary.conflictRow}
            </p>
          )}
          {summary.rows.map((row) => (
            <CheckLine key={row.key} row={row} />
          ))}
        </div>

        {summary.warnings.length > 0 && (
          <ul className="m-0 list-disc rounded-sm border border-warn/40 bg-warn/7 py-2.5 pr-3 pl-6 text-sm leading-relaxed text-warn">
            {summary.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        {/* The last moment to say what the button does (decision 31c). */}
        <p className="m-0 text-sm leading-relaxed text-text-3">{summary.next}</p>

        <div className="flex flex-col gap-2">
          {/* Said before the click, because a retry over a conflict is a real
              choice rather than a mistake to be locked out of. */}
          {conflicted && (
            <p className="m-0 text-sm leading-relaxed text-text-3">
              Nothing here is disabled — if you resolved it by hand, retry lands it.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            {conflicted ? (
              <>
                <Button onClick={onConfirm} disabled={busy}>
                  {busy ? 'Merging…' : 'Retry merge anyway'}
                </Button>
                <Button variant="solid" onClick={onResolve} disabled={resolving}>
                  Resolve the merge conflict
                </Button>
              </>
            ) : (
              <Button variant="solid" onClick={onConfirm} disabled={busy}>
                {busy ? 'Merging…' : 'Merge & ship'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
