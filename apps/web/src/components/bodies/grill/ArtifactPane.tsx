import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { FeatureFull } from '../../../lib/api'
import { countDecisions } from '../../../lib/feature-ui'
import { useFeatureDoc } from '../../../lib/use-feature-doc'
import { IconDoc } from '../../../icons'
import { cx, DimLine, EmptyState, PageSection, Skeleton, SkeletonBar, StatusLabel } from '../../../ui'
import { DocsMenu } from '../../DocsMenu'
import { Markdown } from '../../Markdown'

/**
 * `live` is live planning's body — it polls, and its header carries the docs
 * menu. `static` is the same document in
 * a pinned phase (decision 10): read once, no controls, as a section of the
 * page, and empty copy that says what happened instead of what to do.
 */
export type ArtifactPaneMode = 'live' | 'static'

export function ArtifactPane({
  featureId,
  kind,
  docs,
  mode = 'live',
  children,
}: {
  featureId: string
  kind: 'decisions' | 'spec'
  docs: FeatureFull['docs']
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

  // A frozen pane has no docs menu, so it always shows the phase's own document.
  const showingPrimary = frozen || selectedPath === defaultPath
  const title = kind === 'spec' ? 'Spec' : frozen ? 'Decisions' : 'Decisions so far'
  const prose = (
    <>
      {doc.failed && <DimLine>Could not read {selectedPath}</DimLine>}
      {content ? (
        <Markdown source={content} size={frozen ? 'base' : 'sm'} />
      ) : doc.loading ? (
        // The skeleton stands where the document will be — never beside an
        // empty state that the first read is about to contradict.
        <ProseSkeleton label={`Loading ${selectedPath?.split(/[\\/]/).pop()}…`} />
      ) : showingPrimary ? (
        <ArtifactEmpty kind={kind} frozen={frozen} />
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
      className="flex min-h-0 min-w-0 flex-1 flex-col"
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
        </span>
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto border-t border-border-subtle pt-4 pr-3">{prose}</div>
    </section>
  )
}

/** Line widths for the placeholder prose: a heading, then two paragraphs. */
const SKELETON_PARAGRAPHS = [
  ['w-full', 'w-11/12', 'w-4/5', 'w-2/3'],
  ['w-full', 'w-5/6', 'w-1/2'],
] as const

/**
 * A document while its first read is in flight: a heading and two paragraphs
 * in placeholder bars, one bar per 20px line of `Markdown`.
 */
export function ProseSkeleton({ label }: { label: string }) {
  return (
    <Skeleton label={label}>
      <div className="flex h-6 items-center">
        <SkeletonBar className="h-3.5 w-1/3" />
      </div>
      {SKELETON_PARAGRAPHS.map((lines, p) => (
        <div key={p} className="mt-3" data-skeleton="paragraph">
          {lines.map((width, i) => (
            <div key={i} className="flex h-5 items-center">
              <SkeletonBar className={cx('h-2.5', width)} />
            </div>
          ))}
        </div>
      ))}
    </Skeleton>
  )
}

/**
 * A pinned phase states what happened; a live one states what is coming
 * (decisions 10 and 11). Neither ever tells the human to start a session — that
 * door is the next-step row's alone.
 */
function ArtifactEmpty({ kind, frozen }: { kind: 'decisions' | 'spec'; frozen: boolean }) {
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
          : "The session is drafting the spec — it appears here as it's written."
      }
    />
  )
}
