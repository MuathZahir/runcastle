import type { DocSummary } from '../../lib/api'
import { relTimeAgo } from '../../lib/format'
import { IconDoc } from '../../icons'
import { EmptyState, List, ListRow, PageSection } from '../../ui'

/** The outcome once merged, then the plan's own documents, lead the list in this order. */
const PLAN_ORDER = ['outcome.md', 'brief.md', 'decisions.md', 'spec.md'] as const

function basename(relPath: string): string {
  return relPath.split(/[\\/]/).pop() ?? relPath
}

/** The folder a doc sits in under the feature's docs dir, or '' at its root. */
function folderOf(relPath: string): string {
  const parts = relPath.split(/[\\/]/)
  return parts.slice(0, -1).join('/')
}

/**
 * The docs the sessions write, as documents rather than files
 * (the-feature-s-right-panel decision 8): each by its title with its age, the
 * plan's documents first, the rest after with their folder as a quiet second
 * line. A row opens the doc in the panel's reader.
 */
export function Knowledge({ docs, onOpen }: { docs: DocSummary[]; onOpen: (doc: DocSummary) => void }) {
  const rank = (doc: DocSummary) => {
    const at = PLAN_ORDER.indexOf(doc.relPath as (typeof PLAN_ORDER)[number])
    return at === -1 ? PLAN_ORDER.length : at
  }
  const ordered = [...docs].sort((a, b) => rank(a) - rank(b) || a.relPath.localeCompare(b.relPath))
  return (
    <PageSection title="Docs">
      {docs.length === 0 ? (
        <EmptyState
          compact
          icon={<IconDoc />}
          title="No docs yet"
          hint="The brief, the decisions and the spec collect here as the agent writes them."
        />
      ) : (
        <List label="Feature docs" className="-mx-3">
          {ordered.map((doc, i) => {
            const folder = folderOf(doc.relPath)
            const title = doc.title || basename(doc.relPath)
            // Two docs with one title: only the file name tells them apart.
            const shared = ordered.some((d) => d !== doc && (d.title || basename(d.relPath)) === title)
            const where = shared ? doc.relPath : folder
            return (
              <ListRow
                key={doc.relPath}
                index={i}
                leading={<IconDoc />}
                title={title}
                {...(where ? { description: where } : {})}
                tooltip={doc.relPath}
                meta={doc.updatedAt !== undefined ? relTimeAgo(doc.updatedAt) : undefined}
                onClick={() => onOpen(doc)}
              />
            )
          })}
        </List>
      )}
    </PageSection>
  )
}
