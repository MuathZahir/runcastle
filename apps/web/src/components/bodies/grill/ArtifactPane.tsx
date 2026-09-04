import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { FeatureFull } from '../../../lib/api'
import { countDecisions } from '../../../lib/feature-ui'
import { useFeatureDoc } from '../../../lib/use-feature-doc'
import { EmptyState, SectionTitle } from '../../../ui'
import { DocsMenu } from '../../DocsMenu'
import { Markdown } from '../../Markdown'

/**
 * `live` is the artifact beside a running session — it polls, it collapses to a
 * strip, and its header carries the docs menu. `static` is the same document in
 * a pinned phase (decision 10): read once, no controls, and empty copy that says
 * what happened instead of what to do.
 */
export type ArtifactPaneMode = 'live' | 'static'

export function ArtifactPane({ featureId, kind, docs, collapsed = false, onToggle, mapped = false, mode = 'live', children }: { featureId: string; kind: 'decisions' | 'spec'; docs: FeatureFull['docs']; collapsed?: boolean; onToggle?: () => void; mapped?: boolean; mode?: ArtifactPaneMode; children?: ReactNode }) {
  const defaultPath = docs.find((doc) => doc.relPath.endsWith(`${kind}.md`))?.relPath
  const [selectedPath, setSelectedPath] = useState(defaultPath)
  const [updating, setUpdating] = useState(false)
  const previousContent = useRef<string | undefined>(undefined)
  const frozen = mode === 'static'
  useEffect(() => setSelectedPath(defaultPath), [kind, defaultPath])
  const doc = useFeatureDoc(featureId, selectedPath, { live: !frozen })
  const content = doc.content ?? ''
  useEffect(() => {
    if (doc.content === undefined) return
    if (previousContent.current !== undefined && previousContent.current !== content && kind === 'spec') {
      setUpdating(true)
      const timer = window.setTimeout(() => setUpdating(false), 3000)
      previousContent.current = content
      return () => window.clearTimeout(timer)
    }
    previousContent.current = content
  }, [content, doc.content, kind])
  const count = countDecisions(content)
  if (collapsed && onToggle) return <button type="button" className="flex w-10 flex-none items-center justify-center rounded-lg border border-hairline bg-panel-2 font-mono text-xs text-text-3 [writing-mode:vertical-rl]" title={`Expand the ${kind} pane`} onClick={onToggle}>{kind === 'decisions' ? count : 'spec'}</button>
  const showingPrimary = selectedPath === defaultPath
  return (
    <aside className={`flex min-h-0 flex-col rounded-lg border border-hairline bg-panel-2 ${frozen ? 'min-w-0 flex-1' : 'w-(--artifact-w) flex-none'}`}>
      <div className="flex min-h-12 items-center gap-2 border-b border-hairline px-3">
        <SectionTitle>{!showingPrimary ? selectedPath?.split(/[\\/]/).pop() : kind === 'spec' ? 'Spec' : frozen ? 'Decisions' : 'Decisions so far'}</SectionTitle>
        {showingPrimary && frozen && <span className="font-mono text-xs text-text-3">{kind}.md{kind === 'decisions' ? ` · ${count}` : ''}</span>}
        {showingPrimary && !frozen && kind === 'decisions' && <span className="font-mono text-xs text-text-3">· {count}</span>}
        {showingPrimary && !frozen && kind === 'spec' && updating && <span className="font-mono text-xs text-ok">updating</span>}
        {!frozen && <DocsMenu docs={docs} value={selectedPath} onPick={setSelectedPath} />}
        {!frozen && onToggle && <button type="button" className="size-8 rounded-md text-text-3 hover:bg-panel-3 hover:text-text" title={`Collapse the ${kind} pane`} onClick={onToggle}>‹</button>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {doc.loading && <span className="font-mono text-sm text-text-3">loading…</span>}
        {doc.failed && <span className="font-mono text-sm text-danger">could not read {selectedPath}</span>}
        {content ? <Markdown source={content} /> : showingPrimary ? <ArtifactEmpty kind={kind} mapped={mapped} frozen={frozen} /> : null}
        {children}
      </div>
    </aside>
  )
}

/**
 * A pinned phase states what happened; a live one states what is coming
 * (decisions 10 and 11). Neither ever tells the human to start a session — that
 * door is the next-step bar's alone.
 */
function ArtifactEmpty({ kind, mapped, frozen }: { kind: 'decisions' | 'spec'; mapped: boolean; frozen: boolean }) {
  const skipped = 'This feature was created as a quick change and skipped ideation.'
  if (frozen) return <EmptyState compact title={kind === 'decisions' ? 'No decisions were recorded' : 'No spec'} hint={skipped} />
  return <EmptyState compact title={kind === 'decisions' ? 'No decisions yet' : 'No spec yet'} hint={kind === 'decisions' ? 'They land here one by one as the session settles them.' : mapped ? 'The converge session writes it here from the map and the decisions.' : "The session is drafting the spec — it appears here as it's written."} />
}
