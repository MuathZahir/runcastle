import { useRef, useState } from 'react'
import type { DocSummary } from '../../lib/api'
import { IconDoc } from '../../icons'
import { EmptyState, List, ListRow } from '../../ui'
import { DocPeek } from '../DocPeek'

function basename(relPath: string): string {
  return relPath.split(/[\\/]/).pop() ?? relPath
}

/** The docs the sessions write, each opening in a read-only peek. */
export function Knowledge({ featureId, docs }: { featureId: string; docs: DocSummary[] }) {
  const [peek, setPeek] = useState<{ relPath: string; title: string } | null>(null)
  const peekOpenerRef = useRef<HTMLElement | null>(null)
  return (
    <section aria-label="Knowledge">
      {docs.length === 0 ? (
        <EmptyState
          compact
          icon={<IconDoc />}
          title="No docs yet"
          hint="Docs the sessions write — decisions, the spec, the map — collect here."
        />
      ) : (
        <List label="Feature docs" className="-mx-2">
          {docs.map((d, i) => (
            <ListRow
              key={d.relPath}
              index={i}
              leading={<IconDoc />}
              title={d.title || basename(d.relPath)}
              meta={<span className="font-mono">{basename(d.relPath)}</span>}
              onClick={(event) => {
                peekOpenerRef.current = event.currentTarget
                setPeek({ relPath: d.relPath, title: d.title })
              }}
            />
          ))}
        </List>
      )}
      {peek && (
        <DocPeek
          featureId={featureId}
          relPath={peek.relPath}
          title={peek.title}
          returnFocusRef={peekOpenerRef}
          onClose={() => setPeek(null)}
        />
      )}
    </section>
  )
}
