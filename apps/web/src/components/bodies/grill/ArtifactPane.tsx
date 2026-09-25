import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { FeatureFull } from '../../../lib/api'
import { countDecisions } from '../../../lib/feature-ui'
import { useFeatureDoc } from '../../../lib/use-feature-doc'
import { IconDoc, IconPanelLeft } from '../../../icons'
import { DimLine, EmptyState, IconButton, Loading, PageSection, StatusLabel } from '../../../ui'
import { DocsMenu } from '../../DocsMenu'
import { Markdown } from '../../Markdown'

/**
 * `live` is the artifact beside a running session — it polls, it collapses to a
 * strip, and its header carries the docs menu. `static` is the same document in
 * a pinned phase (decision 10): read once, no controls, as a section of the
 * page, and empty copy that says what happened instead of what to do.
 */
export type ArtifactPaneMode = 'live' | 'static'

export function ArtifactPane({
  featureId,
  kind,
  docs,
  collapsed = false,
  onToggle,
  mapped = false,
  mode = 'live',
  children,
}: {
  featureId: string
  kind: 'decisions' | 'spec'
  docs: FeatureFull['docs']
  collapsed?: boolean
  onToggle?: () => void
  mapped?: boolean
  mode?: ArtifactPaneMode
  children?: ReactNode
}) {
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

  if (collapsed && onToggle)
    return (
      <div className="flex w-9 flex-none flex-col items-center gap-2 pt-0.5">
        <IconButton label={`Expand the ${kind} pane`} icon={<IconPanelLeft />} onClick={onToggle} tooltipSide="right" />
        <span className="text-xs text-text-tertiary tabular-nums [writing-mode:vertical-rl]">
          {kind === 'decisions' ? `${count} decisions` : 'Spec'}
        </span>
      </div>
    )

  // A frozen pane has no docs menu, so it always shows the phase's own document.
  const showingPrimary = frozen || selectedPath === defaultPath
  const title = kind === 'spec' ? 'Spec' : frozen ? 'Decisions' : 'Decisions so far'
  const prose = (
    <>
      {doc.loading && <Loading>Loading…</Loading>}
      {doc.failed && <DimLine>Could not read {selectedPath}</DimLine>}
      {content ? (
        <Markdown source={content} size={frozen ? 'base' : 'sm'} />
      ) : showingPrimary ? (
        <ArtifactEmpty kind={kind} mapped={mapped} frozen={frozen} />
      ) : null}
      {children}
    </>
  )

  if (frozen)
    return (
      <PageSection
        title={title}
        action={
          <span className="font-mono text-xs text-text-tertiary">
            {kind}.md{kind === 'decisions' && count > 0 ? ` · ${count}` : ''}
          </span>
        }
      >
        {prose}
      </PageSection>
    )

  return (
    <section
      aria-label={showingPrimary ? title : selectedPath}
      className="flex min-h-0 w-(--artifact-w) flex-none flex-col"
    >
      <div className="flex h-8 shrink-0 items-center gap-2">
        <h2 className="m-0 min-w-0 truncate text-sm font-medium text-text">
          {showingPrimary ? title : selectedPath?.split(/[\\/]/).pop()}
        </h2>
        {showingPrimary && kind === 'decisions' && (
          <span className="text-xs text-text-tertiary tabular-nums">{count}</span>
        )}
        {showingPrimary && kind === 'spec' && updating && (
          <StatusLabel tone="live" className="animate-fade-in">
            Updating
          </StatusLabel>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          <DocsMenu docs={docs} value={selectedPath} onPick={setSelectedPath} />
          {onToggle && (
            <IconButton label={`Collapse the ${kind} pane`} size="sm" icon={<IconPanelLeft />} onClick={onToggle} />
          )}
        </span>
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto border-t border-border-subtle pt-4 pr-3">{prose}</div>
    </section>
  )
}

/**
 * A pinned phase states what happened; a live one states what is coming
 * (decisions 10 and 11). Neither ever tells the human to start a session — that
 * door is the next-step row's alone.
 */
function ArtifactEmpty({ kind, mapped, frozen }: { kind: 'decisions' | 'spec'; mapped: boolean; frozen: boolean }) {
  const skipped = 'This feature was created as a quick change and skipped ideation.'
  if (frozen)
    return (
      <EmptyState
        compact
        icon={<IconDoc />}
        title={kind === 'decisions' ? 'No decisions were recorded' : 'No spec'}
        hint={skipped}
      />
    )
  return (
    <EmptyState
      compact
      icon={<IconDoc />}
      title={kind === 'decisions' ? 'No decisions yet' : 'No spec yet'}
      hint={
        kind === 'decisions'
          ? 'They land here one by one as the session settles them.'
          : mapped
            ? 'The converge session writes it here from the map and the decisions.'
            : "The session is drafting the spec — it appears here as it's written."
      }
    />
  )
}
