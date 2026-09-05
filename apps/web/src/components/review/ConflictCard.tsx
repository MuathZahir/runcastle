import { Button, SectionTitle } from '../../ui'
import { ONE_TERMINAL_WARNING, type MergeConflictState } from '../../lib/feature-ui'
import { fmtDateTime, relTimeAgo } from '../../lib/format'
import { useResolveConflict } from '../../lib/use-resolve-conflict'

/**
 * The merge-conflict card (CONTEXT decision #9), now the resident of the review
 * page's alert slot (decision 30b): the loudest thing on the page, but never
 * above the evidence stage.
 *
 * Its button NEVER hides (decisions #10). It used to disappear whenever any
 * session was live — the one-terminal rule, enforced by the launcher's
 * `assertSpawnable` — which read as the button randomly not existing until the
 * chat was ended. With a session live it becomes "End session & resolve",
 * performs that dance in one click, and says so underneath.
 *
 * Hook-free so its anatomy is testable without a tRPC provider, exactly as
 * `OpenDefectsCard` is; {@link ConflictAlert} is the wired half.
 *
 * `readonly` is answered here as well as at the orchestrator (decision 33a): a
 * live agent-launching button on a shipped feature's history view was the walked
 * bug, and a card that refuses to render one itself cannot regain it by being
 * mounted somewhere new.
 */
export function ConflictCard({
  branch,
  conflict,
  readonly,
  liveSessionId,
  busy,
  onResolve,
}: {
  branch: string
  conflict: MergeConflictState
  /** Looking back at review on a shipped feature — history, never an action. */
  readonly: boolean
  /** The terminal the resolve has to close first, or null when none is open. */
  liveSessionId: string | null
  busy: boolean
  onResolve: () => void
}) {
  if (readonly) return null

  return (
    <div className="rounded-lg border border-danger/45 bg-panel p-4" role="alert">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle>Merge conflict</SectionTitle>
        {/* When, because a red panel with no date reads as "right now" — the
            audit found one that was fifteen days stale (findings F8). */}
        <span className="font-mono text-xs text-text-3" title={fmtDateTime(conflict.at)}>
          recorded {relTimeAgo(conflict.at)}
        </span>
      </div>
      <p className="mt-2 mb-0 text-sm leading-relaxed text-text-2">
        Merging <code className="font-mono">{conflict.base}</code> into{' '}
        <code className="font-mono">{branch}</code> hit conflicts. An agent can merge the base into
        this branch in the talk worktree, resolve with full spec context, and commit — then retry
        Merge &amp; ship.
      </p>
      {conflict.files.length > 0 && (
        <ul className="mt-3 flex list-none flex-col gap-1 p-0">
          {conflict.files.map((f) => (
            <li
              key={f}
              className="rounded-sm bg-danger/9 px-2 py-0.5 font-mono text-xs text-danger"
            >
              {f}
            </li>
          ))}
        </ul>
      )}
      <Button variant="solid" className="mt-4" disabled={busy} onClick={onResolve}>
        {liveSessionId ? 'End session & resolve' : 'Resolve with agent'}
      </Button>
      {/* What the compound costs, said before the click — the honesty that
          replaces the button hiding itself. */}
      {liveSessionId && <div className="mt-2 text-xs leading-normal text-text-3">{ONE_TERMINAL_WARNING}</div>}
      {/* TODO(ticket 11): decision 30d's "the resolve session ended but the merge
          hasn't landed — resolve by hand or retry" state belongs here. */}
    </div>
  )
}

/** {@link ConflictCard} with the resolve session wired to it. */
export function ConflictAlert({
  featureId,
  branch,
  conflict,
  readonly,
  liveSessionId,
}: {
  featureId: string
  branch: string
  conflict: MergeConflictState
  readonly: boolean
  liveSessionId: string | null
}) {
  const resolve = useResolveConflict(featureId, branch)

  return (
    <ConflictCard
      branch={branch}
      conflict={conflict}
      readonly={readonly}
      liveSessionId={liveSessionId}
      busy={resolve.pending}
      onResolve={() => void resolve.resolve(conflict, liveSessionId ?? undefined)}
    />
  )
}
