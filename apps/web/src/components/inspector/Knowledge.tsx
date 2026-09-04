import { useRef, useState } from 'react'
import type { DocSummary } from '../../lib/api'
import { IconDoc } from '../../icons'
import { DocPeek } from '../DocPeek'

function basename(relPath: string): string {
  return relPath.split(/[\\/]/).pop() ?? relPath
}

/** The docs the sessions write, each opening in a read-only peek. */
export function Knowledge({ featureId, docs }: { featureId: string; docs: DocSummary[] }) {
  const [peek, setPeek] = useState<{ relPath: string; title: string } | null>(null)
  const peekOpenerRef = useRef<HTMLButtonElement>(null)
  return (
    <section className="flex flex-col gap-2">
      <div className="text-xs font-semibold tracking-[0.09em] text-text-3 uppercase">Knowledge</div>
      {docs.length === 0 ? (
        <p className="text-sm leading-relaxed text-pretty text-text-3">
          Docs the sessions write — decisions, the spec, the map — collect here.
        </p>
      ) : (
        <ul className="-mx-2 m-0 list-none p-0">
          {docs.map((d) => (
            <li key={d.relPath}>
              {/* No preflight (apps/web/STYLE.md): the button names its own face
                  and size, and the list its own reset. */}
              <button
                className="flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-2 text-left font-sans text-sm hover:bg-panel-3"
                onClick={(event) => {
                  peekOpenerRef.current = event.currentTarget
                  setPeek({ relPath: d.relPath, title: d.title })
                }}
              >
                <span className="flex shrink-0 items-center text-text-4">
                  <IconDoc size={13} />
                </span>
                <span className="min-w-0 flex-1 truncate text-text">{d.title}</span>
                <span className="shrink-0 font-mono text-xs text-text-3">
                  {basename(d.relPath)}
                </span>
              </button>
            </li>
          ))}
        </ul>
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
