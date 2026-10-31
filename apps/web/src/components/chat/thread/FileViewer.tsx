import { useEffect, useState, type ReactNode } from 'react'
import { IconDoc, IconDownload, IconImage, IconX } from '../../../icons'
import type { ShownFile } from '../../../lib/chat-thread'
import { previewDocument } from '../../../lib/preview-frame'
import { useTheme } from '../../../lib/theme'
import { fmtBytes } from '../../../lib/format'
import { Dialog, DimLine, IconButton } from '../../../ui'
import { ProseSkeleton } from '../../DocReader'
import { Markdown } from '../../Markdown'
import { PreviewFrame } from '../../PreviewPanel'

/** How much of a text file the viewer reads (decision 5). */
const TEXT_MAX = 1_000_000

/** The URL that hands the file over as a download, under its own name. */
export function downloadUrl(file: ShownFile): string {
  return `${file.src}?download=${encodeURIComponent(file.name)}`
}

type TextRead = { state: 'loading' } | { state: 'failed' } | { state: 'read'; text: string }

/** A shown file's text, its first {@link TEXT_MAX} bytes when it is longer. */
function useFileText(file: ShownFile, wanted: boolean): TextRead {
  const [read, setRead] = useState<TextRead>({ state: 'loading' })
  useEffect(() => {
    if (!wanted) return
    let live = true
    setRead({ state: 'loading' })
    const init = file.size > TEXT_MAX ? { headers: { Range: `bytes=0-${TEXT_MAX - 1}` } } : undefined
    fetch(file.src, init)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.text()
      })
      .then((text) => live && setRead({ state: 'read', text }))
      .catch(() => live && setRead({ state: 'failed' }))
    return () => {
      live = false
    }
  }, [file.src, file.size, wanted])
  return read
}

/** The file's text once it has been read; what stands in until then. */
function ReadText({ file, read, children }: { file: ShownFile; read: TextRead; children: (text: string) => ReactNode }) {
  if (read.state === 'failed') {
    return (
      <div className="px-6 pt-4">
        <DimLine>Could not read {file.name}.</DimLine>
      </div>
    )
  }
  if (read.state === 'loading') {
    return (
      <div className="mx-auto w-full max-w-[680px] px-6 pt-4">
        <ProseSkeleton label={`Loading ${file.name}…`} />
      </div>
    )
  }
  return <>{children(read.text)}</>
}

/** The file itself, by what it is. */
function FileBody({ file }: { file: ShownFile }) {
  const { resolved } = useTheme()
  const read = useFileText(file, file.as !== 'image')
  const cut = file.size > TEXT_MAX && (
    <p className="m-0 mb-3 text-xs text-text-tertiary">Showing the first {fmtBytes(TEXT_MAX)} of {fmtBytes(file.size)}. Download it for the rest.</p>
  )
  switch (file.as) {
    case 'image':
      return (
        <div className="min-h-0 flex-1 bg-surface-inset p-3">
          <img src={file.src} alt={file.caption ?? file.name} className="block h-full w-full object-contain" />
        </div>
      )
    case 'html':
      return (
        <ReadText file={file} read={read}>
          {(text) => <PreviewFrame srcDoc={previewDocument(text, resolved)} className="min-h-0 w-full flex-1" />}
        </ReadText>
      )
    case 'markdown':
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[680px] px-6 pt-4 pb-12">
            {cut}
            <ReadText file={file} read={read}>
              {(text) => <Markdown source={text} size="base" />}
            </ReadText>
          </div>
        </div>
      )
    default:
      return (
        <div className="min-h-0 flex-1 overflow-auto bg-surface-inset px-5 py-4">
          {cut}
          <ReadText file={file} read={read}>
            {(text) => <pre className="m-0 font-mono text-xs break-words whitespace-pre-wrap text-text-secondary">{text}</pre>}
          </ReadText>
        </div>
      )
  }
}

/**
 * A shown file opened large (decision 12): the app's full-window dialog, so it
 * works from every chat and on a phone. The file's name and where it came from,
 * Download, Close, then the file. A picture on the inset ground; Markdown as the
 * docs read; HTML in the plan preview's locked frame (decision 7); any other text
 * as it is.
 */
export function FileViewer({ file, onClose }: { file: ShownFile; onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} labelledBy="shown-file-title" size="full" className="flex h-[86vh] flex-col overflow-hidden">
      <div className="flex h-(--topbar-h) shrink-0 items-center gap-2 border-b border-border-subtle pr-2 pl-5">
        {file.as === 'image' ? <IconImage size={16} className="shrink-0 text-icon" /> : <IconDoc size={16} className="shrink-0 text-icon" />}
        <h2 id="shown-file-title" className="m-0 max-w-[50%] shrink-0 truncate text-sm font-medium text-text">
          {file.name}
        </h2>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-tertiary" title={file.path}>
          {file.path}
        </span>
        <IconButton label="Download" size="sm" icon={<IconDownload />} href={downloadUrl(file)} />
        <IconButton label="Close" size="sm" icon={<IconX />} onClick={onClose} />
      </div>
      {file.caption && <p className="m-0 shrink-0 border-b border-border-subtle px-5 py-2 text-sm text-text-secondary">{file.caption}</p>}
      <FileBody file={file} />
    </Dialog>
  )
}
