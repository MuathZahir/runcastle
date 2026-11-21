import { useEffect, useRef, useState } from 'react'
import type { FeatureFull } from '../lib/api'
import { relTimeAgo } from '../lib/format'
import { PREVIEW_ESCAPE_MESSAGE, PREVIEW_SANDBOX, previewDocument } from '../lib/preview-frame'
import { useTheme } from '../lib/theme'
import { useFeatureDoc } from '../lib/use-feature-doc'
import { useIsPhone } from '../lib/use-phone'
import { IconX } from '../icons'
import { Dialog, DimLine, IconButton, Skeleton, SkeletonBar, cx } from '../ui'

/**
 * A feature's plan page full window (plan-preview decisions 6, 7, 9;
 * building-starts-without-a-plan-approval decision 6): the feature's
 * `preview.html` in the locked-down frame, over the whole window. An old plan
 * card opens it; the caller renders it only when the feature has a page.
 * It refreshes through the shared `docs.read` key, which every pushed event
 * already invalidates.
 */
export function PlanPageDialog({
  featureId,
  preview,
  onClose,
}: {
  featureId: string
  preview: NonNullable<FeatureFull['preview']>
  onClose: () => void
}) {
  const doc = useFeatureDoc(featureId, preview.relPath)
  const { resolved } = useTheme()
  const srcDoc = doc.content === undefined ? undefined : previewDocument(doc.content, resolved)
  const updated = preview.updatedAt === undefined ? null : `updated ${relTimeAgo(preview.updatedAt)}`
  // Close is the one way out of a full-screen sheet, so on a phone it is thumb-sized.
  const control = useIsPhone() ? 'touch' : 'sm'
  return (
    <Dialog open onClose={onClose} labelledBy="plan-page-title" size="full" className="flex h-[86vh] flex-col overflow-hidden">
      <div className="flex h-(--topbar-h) shrink-0 items-center gap-2 border-b border-border-subtle pr-2 pl-5">
        <h2 id="plan-page-title" className="m-0 text-sm font-medium text-text">
          Plan page
        </h2>
        <span className="min-w-0 flex-1 truncate text-xs text-text-tertiary">{updated}</span>
        <IconButton label="Close" size={control} icon={<IconX />} onClick={onClose} />
      </div>
      {doc.failed ? (
        <div className="px-6 pt-4">
          <DimLine>Could not read {preview.relPath}.</DimLine>
        </div>
      ) : srcDoc === undefined ? (
        <Skeleton label="Loading the plan page" className="min-h-0 flex-1 px-6 pt-6">
          <SkeletonBar className="h-4 w-1/2" />
          <SkeletonBar className="mt-3 h-3 w-2/3" />
        </Skeleton>
      ) : (
        <PreviewFrame srcDoc={srcDoc} onEscape={onClose} className="min-h-0 w-full flex-1 border-0" />
      )}
    </Dialog>
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
 * arrives as the frame document's relay message, heard only from this frame's
 * own window.
 */
export function PreviewFrame({
  srcDoc,
  onEscape,
  className,
}: {
  srcDoc: string
  onEscape?: () => void
  className: string
}) {
  const [generation, setGeneration] = useState(0)
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!onEscape) return
    const onMessage = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.data === PREVIEW_ESCAPE_MESSAGE) onEscape()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onEscape])
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
      title="The plan"
      sandbox={PREVIEW_SANDBOX}
      srcDoc={srcDoc}
      onLoad={onLoad}
      className={cx('block bg-surface-inset', className)}
    />
  )
}
