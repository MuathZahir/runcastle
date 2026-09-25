import type { FeatureFull } from '../../lib/api'
import { PageSection } from '../../ui'
import { Markdown } from '../Markdown'

/**
 * The parked-draft body (decision 9). A draft is a DB row and nothing else — no
 * branch, no docs on disk — so there is nothing to peek at and no session to
 * host: what it holds is the idea itself, and that is what this shows. The page
 * header above already names it and says it is parked; the next-step row owns
 * Start and the base it forks from. This is the one-liner and the notes.
 */
export function DraftBody({ full }: { full: FeatureFull }) {
  const { feature } = full

  return (
    <>
      {feature.oneLiner && (
        <p className="mt-0 mb-10 text-base text-pretty text-text-secondary">{feature.oneLiner}</p>
      )}
      <PageSection title="Notes">
        {feature.brief ? (
          <Markdown source={feature.brief} size="base" />
        ) : (
          <p className="m-0 text-sm text-text-tertiary">
            No notes. Start writes the brief from whatever is parked here.
          </p>
        )}
      </PageSection>
    </>
  )
}
