import { useEffect, useRef, useState } from 'react'
import type { FeatureFull } from '../../../lib/api'
import { countDecisions } from '../../../lib/feature-ui'
import { useLivePoll } from '../../../lib/live'
import { trpc } from '../../../trpc'
import { EmptyState, SectionTitle } from '../../../ui'
import { DocsMenu } from '../../DocsMenu'
import { Markdown } from '../../Markdown'

export function ArtifactPane({ featureId, kind, docs, collapsed, onToggle, mapped = false }: { featureId: string; kind: 'decisions' | 'spec'; docs: FeatureFull['docs']; collapsed: boolean; onToggle: () => void; mapped?: boolean }) {
  const defaultPath = docs.find((doc) => doc.relPath.endsWith(`${kind}.md`))?.relPath
  const [selectedPath, setSelectedPath] = useState(defaultPath)
  const [updating, setUpdating] = useState(false)
  const previousContent = useRef<string | undefined>(undefined)
  useEffect(() => setSelectedPath(defaultPath), [kind, defaultPath])
  const query = trpc.docs.read.useQuery({ featureId, relPath: selectedPath ?? `${kind}.md` }, { enabled: !!selectedPath, refetchInterval: useLivePoll() })
  const content = query.data?.content ?? ''
  useEffect(() => {
    if (query.data === undefined) return
    if (previousContent.current !== undefined && previousContent.current !== content && kind === 'spec') {
      setUpdating(true)
      const timer = window.setTimeout(() => setUpdating(false), 3000)
      previousContent.current = content
      return () => window.clearTimeout(timer)
    }
    previousContent.current = content
  }, [content, kind, query.data])
  const count = countDecisions(content)
  if (collapsed) return <button type="button" className="flex w-10 flex-none items-center justify-center rounded-lg border border-hairline bg-panel-2 font-mono text-xs text-text-3 [writing-mode:vertical-rl]" title={`Expand the ${kind} pane`} onClick={onToggle}>{kind === 'decisions' ? count : 'spec'}</button>
  const showingPrimary = selectedPath === defaultPath
  return (
    <aside className="flex min-h-0 w-(--artifact-w) flex-none flex-col rounded-lg border border-hairline bg-panel-2">
      <div className="flex min-h-12 items-center gap-2 border-b border-hairline px-3">
        <SectionTitle>{showingPrimary && kind === 'decisions' ? 'Decisions so far' : showingPrimary ? 'Spec' : selectedPath?.split(/[\\/]/).pop()}</SectionTitle>
        {showingPrimary && kind === 'decisions' && <span className="font-mono text-xs text-text-3">· {count}</span>}
        {showingPrimary && kind === 'spec' && updating && <span className="font-mono text-xs text-ok">updating</span>}
        <DocsMenu docs={docs} value={selectedPath} onPick={setSelectedPath} />
        <button type="button" className="size-8 rounded-md text-text-3 hover:bg-panel-3 hover:text-text" title={`Collapse the ${kind} pane`} onClick={onToggle}>‹</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {query.isLoading && <span className="font-mono text-sm text-text-3">loading…</span>}
        {query.error && <span className="font-mono text-sm text-danger">could not read {selectedPath}</span>}
        {content ? <Markdown source={content} /> : showingPrimary ? <EmptyState compact title={kind === 'decisions' ? 'No decisions yet' : 'No spec yet'} hint={kind === 'decisions' ? 'They land here one by one as the session settles them.' : mapped ? 'The converge session writes it here from the map and the decisions.' : "The session is drafting the spec — it appears here as it's written."} /> : null}
      </div>
    </aside>
  )
}
