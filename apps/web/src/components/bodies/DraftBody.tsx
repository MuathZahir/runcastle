import type { FeatureFull } from '../../lib/api'
import { DRAFT_GLYPH } from '../../lib/feature-ui'
import { DimLine } from '../../ui'
import { Markdown } from '../Markdown'

/**
 * The parked-draft body (decision 9). A draft is a DB row and nothing else — no
 * branch, no docs on disk — so there is nothing to peek at and no session to
 * host: what it holds is the idea itself, and that is what this shows. The
 * next-step bar above owns both Start and the base it forks from. This body only
 * shows the parked idea: its title, one-liner, and optional notes.
 */
export function DraftBody({ full }: { full: FeatureFull }) {
  const { feature } = full

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-6">
      <div className="mt-8 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold tracking-[0.09em] text-text-4">
          <span className="text-sm leading-none" aria-hidden="true">
            {DRAFT_GLYPH}
          </span>
          PARKED
        </div>
        <div className="text-lg font-semibold text-text">{feature.title}</div>
        {feature.oneLiner && <div className="text-base leading-relaxed text-text-2">{feature.oneLiner}</div>}
      </div>

      {feature.brief ? (
        <div>
          <Markdown source={feature.brief} />
        </div>
      ) : (
        <div>
          <DimLine>No notes.</DimLine>
        </div>
      )}
    </div>
  )
}
