import type { BranchList, FeatureFull } from '../../lib/api'
import { DRAFT_GLYPH, type DraftBaseMissing } from '../../lib/feature-ui'
import { DimLine } from '../../ui'
import { BaseSelect } from '../BaseSelect'
import { Markdown } from '../Markdown'

/**
 * The parked-draft body (decision 9). A draft is a DB row and nothing else — no
 * branch, no docs on disk — so there is nothing to peek at and no session to
 * host: what it holds is the idea itself, and that is what this shows. The
 * next-step bar above owns the one action (Start), and the base Start forks from
 * sits here behind an Advanced disclosure, because the default — the branch the
 * project is checked out on — is right almost every time. When there is no
 * default at all the disclosure opens itself: nothing cuts a branch on a guess
 * (decision 8), so the pick the human owes has to be on screen.
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
  baseMissing,
  onPick,
}: {
  full: FeatureFull
  /** The project's branches, or undefined while the list is still loading. */
  branches: BranchList | undefined
  /** The base the picker shows — the explicit pick, else the client default. */
  base: string
  /** Why there is no base yet, when there is none ({@link DraftBaseMissing}). */
  baseMissing: DraftBaseMissing | undefined
  onPick: (base: string) => void
}) {
  const { feature } = full
  // The branch list arrived and offered no default (decision 8): the checkout is
  // not a base a feature can fork from, so Start is blocked and the disclosure
  // that normally hides the picker has to give it up — a control the human must
  // use cannot sit behind a summary reading "Advanced".
  const mustPick = baseMissing === 'unpicked'

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

      <details className="draft-advanced" open={mustPick}>
        <summary className="draft-advanced-summary">
          {mustPick ? 'Choose a branch to fork from' : 'Advanced'}
        </summary>
        <BaseSelect
          id="draft-base-select"
          label="Branch from"
          branches={branches}
          value={base}
          onPick={onPick}
          hint="Start forks off this branch — and merges back into it when shipped."
        />
      </details>
    </div>
  )
}
