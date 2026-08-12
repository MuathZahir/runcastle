import type { BranchList, FeatureFull } from '../../lib/api'
import { DRAFT_GLYPH } from '../../lib/feature-ui'
import { DimLine } from '../../ui'
import { Markdown } from '../Markdown'

/**
 * The parked-draft body (decision 9). A draft is a DB row and nothing else — no
 * branch, no docs on disk — so there is nothing to peek at and no session to
 * host: what it holds is the idea itself, and that is what this shows. The
 * next-step bar above owns the one action (Start), and the base Start forks from
 * sits here behind an Advanced disclosure, because the default is right almost
 * every time.
 *
 * The branch list and the chosen base belong to the workspace rather than to
 * this component: Start fires from the bar, so the base has to be readable at
 * that click. This renders the picker over what it is handed and reports picks
 * back — no query, no state of its own.
 */
export function DraftBody({
  full,
  branches,
  base,
  onPick,
}: {
  full: FeatureFull
  /** The project's branches, or undefined while the list is still loading. */
  branches: BranchList | undefined
  /** The base the picker shows — the explicit pick, else the client default. */
  base: string
  onPick: (base: string) => void
}) {
  const { feature } = full
  const branchList = branches?.branches ?? []
  // Remote-only branches (origin/…); picking one materializes a local base.
  const remoteList = branches?.remoteBranches ?? []
  const noBranches = branchList.length === 0 && remoteList.length === 0

  return (
    <div className="draft-body">
      <div className="draft-hero">
        <div className="draft-kick">
          <span className="draft-glyph" aria-hidden="true">
            {DRAFT_GLYPH}
          </span>
          PARKED
        </div>
        <div className="draft-title">{feature.title}</div>
        {feature.oneLiner && <div className="draft-oneliner">{feature.oneLiner}</div>}
        <div className="draft-sub">
          No branch has been cut and nothing has been written to the repo. Start cuts{' '}
          <span className="mono">{feature.branch}</span>, commits the brief, and opens the grill
          session.
        </div>
      </div>

      {feature.brief ? (
        <div className="draft-brief">
          <Markdown source={feature.brief} />
        </div>
      ) : (
        <div className="draft-brief is-empty">
          <DimLine>No brief yet — this draft is its title and one-liner.</DimLine>
        </div>
      )}

      <details className="draft-advanced">
        <summary className="draft-advanced-summary">Advanced</summary>
        <div className="nf-base">
          <label className="nf-base-label" htmlFor="draft-base-select">
            Branch from
          </label>
          <select
            id="draft-base-select"
            className="nf-base-select"
            value={base}
            disabled={!branches || noBranches}
            onChange={(e) => onPick(e.target.value)}
          >
            {branchList.map((b) => (
              <option key={b} value={b}>
                {b}
                {b === branches?.mainBranch ? ' (default)' : ''}
                {b === branches?.current && b !== branches?.mainBranch ? ' (current)' : ''}
              </option>
            ))}
            {remoteList.length > 0 && (
              <optgroup label="Remote (creates a local branch)">
                {remoteList.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <span className="size-hint">
            Start forks off this branch — and merges back into it when shipped.
          </span>
        </div>
      </details>
    </div>
  )
}
