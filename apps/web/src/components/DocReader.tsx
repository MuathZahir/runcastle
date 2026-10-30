import { useState, type ReactNode } from 'react'
import { humanizeTimestamps, relTimeAgo } from '../lib/format'
import { useFeatureDoc } from '../lib/use-feature-doc'
import { IconArrowLeft, IconChevronRight, IconDoc, IconExpand, IconX } from '../icons'
import { Button, Dialog, DimLine, IconButton } from '../ui'
import { ProseSkeleton } from './bodies/grill/ArtifactPane'
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
  /** The view the doc was opened from: "Details", "Work". */
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
