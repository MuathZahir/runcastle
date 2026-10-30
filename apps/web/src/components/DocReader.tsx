import { useState, type ReactNode } from 'react'
import { humanizeTimestamps, relTimeAgo } from '../lib/format'
import { useFeatureDoc } from '../lib/use-feature-doc'
import { IconArrowLeft, IconChevronRight, IconDoc, IconExpand, IconX } from '../icons'
import { Button, Dialog, DimLine, IconButton, Skeleton, SkeletonBar, cx } from '../ui'
import { Markdown } from './Markdown'
import { PanelViewBar } from './workspace/PanelViewBar'

/**
 * A feature doc as prose in the panel (the-feature-s-right-panel decisions 6,
 * 7): read at the reading width, the only thing that scrolls. Agents stamp
 * docs the way a program does ("Created: 2026-07-14T14:58:23.231Z"), so the
 * timestamps are humanized; nobody reads milliseconds.
 */
export function DocProse({
  featureId,
  relPath,
  live = true,
  empty,
  children,
}: {
  featureId: string
  relPath: string | undefined
  live?: boolean
  /** What an empty or missing doc says instead. */
  empty?: ReactNode
  /** Above the prose, inside the reading column: the reader's path line. */
  children?: ReactNode
}) {
  const doc = useFeatureDoc(featureId, relPath, { live })
  const name = relPath?.split(/[\\/]/).pop()
  return (
    <div className="mx-auto w-full max-w-[680px] px-6 pt-4 pb-12">
      {children}
      {doc.failed ? (
        <DimLine>Could not read {relPath}.</DimLine>
      ) : doc.content ? (
        <Markdown source={humanizeTimestamps(doc.content)} size="base" />
      ) : doc.loading || doc.content === undefined ? (
        relPath ? <ProseSkeleton label={`Loading ${name}…`} /> : empty
      ) : (
        empty
      )}
    </div>
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
 * One doc opened in the panel (decision 7): the view it was opened from gives
 * way to this, with the way back to that view on the bar, the doc's title, its
 * path and age as one quiet line, then the prose. Open full window gives a wide
 * doc the whole window.
 */
export function DocReader({
  featureId,
  doc,
  backLabel,
  onBack,
}: {
  featureId: string
  doc: { relPath: string; title: string; updatedAt?: number }
  /** The view the doc was opened from: "Details", "Tickets". */
  backLabel: string
  onBack: () => void
}) {
  const [fullWindow, setFullWindow] = useState(false)
  const title = doc.title || doc.relPath.split(/[\\/]/).pop() || doc.relPath
  const path = (
    <p className="m-0 mb-6 flex min-w-0 items-center gap-2 text-xs text-text-tertiary">
      <span className="truncate font-mono" title={doc.relPath}>
        {doc.relPath}
      </span>
      {doc.updatedAt !== undefined && <span className="shrink-0">· {relTimeAgo(doc.updatedAt)}</span>}
    </p>
  )
  return (
    <div className="flex min-h-full flex-col">
      <PanelViewBar
        className="sticky top-0 z-10 bg-surface"
        aside={<IconButton label="Open full window" size="sm" icon={<IconExpand />} onClick={() => setFullWindow(true)} />}
      >
        <Button variant="ghost" size="sm" icon={<IconArrowLeft />} onClick={onBack} className="-ml-2 shrink-0">
          {backLabel}
        </Button>
        <IconChevronRight size={12} className="shrink-0 text-text-disabled" />
        <h2 className="m-0 min-w-0 truncate pl-1 text-sm font-medium text-text">{title}</h2>
      </PanelViewBar>
      <DocProse featureId={featureId} relPath={doc.relPath}>
        {path}
      </DocProse>
      <Dialog
        open={fullWindow}
        onClose={() => setFullWindow(false)}
        labelledBy="doc-full-title"
        size="full"
        className="flex h-[86vh] flex-col overflow-hidden"
      >
        <div className="flex h-(--topbar-h) shrink-0 items-center gap-2 border-b border-border-subtle pr-2 pl-5">
          <IconDoc size={16} className="shrink-0 text-icon" />
          <h2 id="doc-full-title" className="m-0 min-w-0 truncate text-sm font-medium text-text">
            {title}
          </h2>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-tertiary">{doc.relPath}</span>
          <IconButton label="Close" size="sm" icon={<IconX />} onClick={() => setFullWindow(false)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DocProse featureId={featureId} relPath={doc.relPath} />
        </div>
      </Dialog>
    </div>
  )
}
