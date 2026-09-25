import { Button, CheckLine, Dialog, DialogBody, DialogFooter, DialogHeader, SectionLabel } from '../ui'
import { IconAlert, IconGitMerge, IconRefresh } from '../icons'
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
  // Over a standing conflict the footer carries three buttons, which the
  // small panel cannot hold on one line.
  const conflicted = !!summary.conflictRow && !!onResolve
  return (
    <Dialog
      open
      onClose={onCancel}
      labelledBy="merge-feature-title"
      size={conflicted ? 'md' : 'sm'}
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
 * What a confirmation is shipping over, one line each: a warning glyph and the
 * sentence. No tinted box — the glyph carries the tone (DESIGN.md: status is a
 * glyph and a word). Shared by the Burn and Merge confirmations, which teach
 * one pattern for both clicks.
 */
export function ConfirmWarnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null
  return (
    <ul
      aria-label="Warnings"
      className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-text-secondary [&>li]:relative [&>li]:pl-6"
    >
      {warnings.map((w) => (
        <li key={w}>
          <IconAlert size={16} className="absolute top-0.5 left-0 text-warning" />
          {w}
        </li>
      ))}
    </ul>
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
      <DialogHeader
        id="merge-feature-title"
        title="Merge & ship"
        onClose={onCancel}
        description={
          <>
            Merge <span className="font-medium text-text">{title}</span> from{' '}
            <code className="font-mono text-xs">{branch}</code>
            {base ? (
              <>
                {' '}
                into <code className="font-mono text-xs">{base}</code>
              </>
            ) : null}
            ? This ships the feature.
          </>
        }
      />

      <DialogBody className="flex min-h-0 flex-col gap-5 overflow-y-auto">
        <section>
          <SectionLabel>What lands</SectionLabel>
          {/* The loudest thing in the dialog, above the green rows rather than
              instead of them: the human still sees what lands IF it lands. */}
          {summary.conflictRow && (
            <p className="mt-1 mb-2 rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger" role="alert">
              {summary.conflictRow}
            </p>
          )}
          {summary.rows.map((row) => (
            <CheckLine key={row.key} row={row} />
          ))}
        </section>

        <ConfirmWarnings warnings={summary.warnings} />

        {/* The last moment to say what the button does (decision 31c). */}
        <p className="m-0 text-sm text-text-tertiary">{summary.next}</p>
        {/* Said before the click, because a retry over a conflict is a real
            choice rather than a mistake to be locked out of. */}
        {conflicted && (
          <p className="m-0 text-sm text-text-tertiary">
            Nothing here is disabled — if you resolved it by hand, retry lands it.
          </p>
        )}
      </DialogBody>

      <DialogFooter className="border-t border-border-subtle pt-4">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {conflicted ? (
          <>
            <Button variant="secondary" icon={<IconRefresh />} onClick={onConfirm} disabled={busy}>
              {busy ? 'Merging…' : 'Retry merge anyway'}
            </Button>
            <Button variant="primary" icon={<IconAlert />} onClick={onResolve} disabled={resolving}>
              Resolve the merge conflict
            </Button>
          </>
        ) : (
          <Button variant="primary" icon={<IconGitMerge />} onClick={onConfirm} disabled={busy}>
            {busy ? 'Merging…' : 'Merge & ship'}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}
