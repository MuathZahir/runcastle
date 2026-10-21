import { useEffect, useRef, useState } from 'react'
import type { FeatureFull } from '../lib/api'
import { relTimeAgo } from '../lib/format'
import { PREVIEW_ESCAPE_MESSAGE, PREVIEW_SANDBOX, openDesignPath, previewDocument } from '../lib/preview-frame'
import { useTheme } from '../lib/theme'
import { useFeatureDoc } from '../lib/use-feature-doc'
import { IconExpand, IconX } from '../icons'
import { Dialog, DimLine, IconButton, PageSection, Skeleton, SkeletonBar, cx } from '../ui'

/**
 * The plan preview (plan-preview decisions 6, 7, 9): the feature's
 * `preview.html`, led by its written time and a control that opens it full
 * window, in a frame that runs the file's scripts and allows nothing else.
 * The caller renders it only when the feature has a preview — a feature with
 * none shows no panel and no placeholder.
 *
 * It refreshes through the shared `docs.read` key, which every pushed event
 * already invalidates; `live={false}` (the read-only Planning view) reads once.
 *
 * A designed screen's Open in design button (design-mode decision 7) posts out
 * of the frame; `onOpenDesign` receives its path.
 */
export function PreviewPanel({
  featureId,
  preview,
  live = true,
  onOpenDesign,
}: {
  featureId: string
  preview: NonNullable<FeatureFull['preview']>
  live?: boolean
  onOpenDesign?: (path: string) => void
}) {
  const doc = useFeatureDoc(featureId, preview.relPath, { live })
  const { resolved } = useTheme()
  const [fullWindow, setFullWindow] = useState(false)
  const srcDoc = doc.content === undefined ? undefined : previewDocument(doc.content, resolved)
  const updated = preview.updatedAt === undefined ? null : `updated ${relTimeAgo(preview.updatedAt)}`

  return (
    <PageSection
      title="Preview"
      action={
        <>
          {updated && <span className="mr-1 text-xs text-text-tertiary">{updated}</span>}
          <IconButton label="Open full window" icon={<IconExpand />} onClick={() => setFullWindow(true)} />
        </>
      }
    >
      {doc.failed ? (
        <DimLine>Could not read {preview.relPath}.</DimLine>
      ) : srcDoc === undefined ? (
        <Skeleton label="Loading the preview" className="h-[60vh] min-h-[360px] rounded-lg border border-border p-4">
          <SkeletonBar className="h-4 w-1/2" />
          <SkeletonBar className="mt-3 h-3 w-2/3" />
        </Skeleton>
      ) : (
        <PreviewFrame
          srcDoc={srcDoc}
          onOpenDesign={onOpenDesign}
          className="h-[60vh] min-h-[360px] w-full rounded-lg border border-border"
        />
      )}
      <Dialog
        open={fullWindow}
        onClose={() => setFullWindow(false)}
        labelledBy="preview-full-title"
        size="full"
        className="flex h-[86vh] flex-col overflow-hidden"
      >
        <div className="flex h-(--topbar-h) shrink-0 items-center gap-2 border-b border-border-subtle pr-2 pl-5">
          <h2 id="preview-full-title" className="m-0 text-sm font-medium text-text">
            Preview
          </h2>
          <span className="min-w-0 flex-1 truncate text-xs text-text-tertiary">{updated}</span>
          <IconButton label="Close" size="sm" icon={<IconX />} onClick={() => setFullWindow(false)} />
        </div>
        {srcDoc !== undefined && (
          <PreviewFrame
            srcDoc={srcDoc}
            onEscape={() => setFullWindow(false)}
            onOpenDesign={
              onOpenDesign &&
              ((path) => {
                setFullWindow(false)
                onOpenDesign(path)
              })
            }
            className="min-h-0 w-full flex-1 border-0"
          />
        )}
      </Dialog>
    </PageSection>
  )
}

/**
 * The locked-down frame: an opaque origin with scripts and nothing else — never
 * `allow-same-origin`, which would hand the preview the app's storage and API.
 *
 * Nothing stops a script navigating its own frame (spec, open question 1), so a
 * second load of the same document means the preview went somewhere else; the
 * frame is remounted to put the preview back.
 *
 * Focus inside the frame is out of the app's reach, so Escape pressed there
 * arrives as the frame document's relay message, and a designed-screen entry's
 * Open in design as its own message; both are heard only from this frame's
 * own window.
 */
function PreviewFrame({
  srcDoc,
  onEscape,
  onOpenDesign,
  className,
}: {
  srcDoc: string
  onEscape?: () => void
  onOpenDesign?: ((path: string) => void) | undefined
  className: string
}) {
  const [generation, setGeneration] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!onEscape && !onOpenDesign) return
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      if (event.data === PREVIEW_ESCAPE_MESSAGE) onEscape?.()
      const path = openDesignPath(event.data)
      if (path !== null) onOpenDesign?.(path)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onEscape, onOpenDesign])
  // Loads counted for one document in one mount; a new `srcDoc` (an edit, a
  // theme switch) or a remount starts the count again.
  const loads = useRef({ srcDoc, generation, count: 0 })

  const onLoad = () => {
    const seen = loads.current
    if (seen.srcDoc !== srcDoc || seen.generation !== generation) {
      loads.current = { srcDoc, generation, count: 1 }
      return
    }
    seen.count += 1
    if (seen.count > 1) setGeneration((g) => g + 1)
  }

  return (
    <iframe
      key={generation}
      ref={frame}
      title="Preview"
      sandbox={PREVIEW_SANDBOX}
      srcDoc={srcDoc}
      onLoad={onLoad}
      className={cx('block bg-surface-inset', className)}
    />
  )
}
