import { useState } from 'react'
import { IconChevronDown, IconChevronRight, IconDoc, IconDownload, IconExternalLink, IconImage } from '../../../icons'
import { fmtBytes } from '../../../lib/format'
import { Button, ListRow, cx } from '../../../ui'
import { FileViewer, downloadUrl } from './FileViewer'
import { WELL } from './surfaces'

/**
 * What the server decided a file is when it was shown (agents-show-files-in-chat
 * decision 6): inline, read in the viewer, handed to the browser, or downloaded.
 */
export type ShownAs = 'image' | 'markdown' | 'html' | 'text' | 'browser' | 'download'

/** One file an agent showed: a copy in the thread's folder, named by `src`. */
export interface ShownFile {
  id: string
  src: string
  name: string
  /** Where it was when shown, for the viewer's header. */
  path: string
  size: number
  as: ShownAs
  caption?: string
}

/** Everything one turn showed, as the thread lists it. */
export interface ShownItem {
  kind: 'shown'
  id: string
  files: ShownFile[]
}

/** How many files a group shows before "Show N more". */
const GROUP_MAX = 4

/** An image past this shows as a card, so a chat opens quickly on phone data. */
const INLINE_IMAGE_MAX = 10_000_000

/** Whether the file shows as a picture in the chat. */
function isInlineImage(file: ShownFile): boolean {
  return file.as === 'image' && file.size <= INLINE_IMAGE_MAX
}

/** A file's kind in a word: its extension, or what it was sorted as. */
function kindWord(file: ShownFile): string {
  if (file.as === 'markdown') return 'Markdown'
  if (file.as === 'html') return 'HTML'
  const dot = file.name.lastIndexOf('.')
  const ext = dot > 0 ? file.name.slice(dot + 1) : ''
  if (ext.length > 0 && ext.length <= 5) return ext.toUpperCase()
  return file.as === 'text' ? 'Text' : 'File'
}

/** A picture in the chat at the column's width; a click opens it large. */
function ShownImage({ file, onOpen }: { file: ShownFile; onOpen: () => void }) {
  return (
    <figure className="m-0 flex min-w-0 flex-col items-start gap-1.5">
      <button type="button" onClick={onOpen} aria-label={`Open ${file.name}`} className="block max-w-full cursor-zoom-in rounded-lg">
        <img
          src={file.src}
          alt={file.caption ?? file.name}
          className="block max-h-[420px] max-w-full rounded-lg bg-surface-inset object-contain ring-1 ring-border-subtle"
        />
      </button>
      {file.caption && <figcaption className="text-sm text-text-secondary">{file.caption}</figcaption>}
    </figure>
  )
}

/** Any other file: a row saying what it is and, by its trailing glyph, what a click does. */
function FileCard({ file, onOpen }: { file: ShownFile; onOpen: () => void }) {
  const viewer = file.as !== 'browser' && file.as !== 'download'
  const trailing = viewer ? <IconChevronRight /> : file.as === 'browser' ? <IconExternalLink /> : <IconDownload />
  return (
    <div className={cx(WELL, 'overflow-hidden')}>
      <ListRow
        leading={file.as === 'image' ? <IconImage /> : <IconDoc />}
        title={file.name}
        description={file.caption ?? `${kindWord(file)} · ${fmtBytes(file.size)}`}
        meta={<span className="inline-flex text-icon">{trailing}</span>}
        label={`${viewer ? 'Open' : file.as === 'browser' ? 'Open in a new tab:' : 'Download'} ${file.name}`}
        onClick={onOpen}
      />
    </div>
  )
}

/** Runs of neighbouring pictures and cards, in the order they were shown. */
function runsOf(files: ShownFile[]): { images: boolean; files: ShownFile[] }[] {
  const runs: { images: boolean; files: ShownFile[] }[] = []
  for (const file of files) {
    const images = isInlineImage(file)
    const last = runs.at(-1)
    if (last?.images === images) last.files.push(file)
    else runs.push({ images, files: [file] })
  }
  return runs
}

/**
 * What a turn showed: pictures inline, anything else as a card, in the order
 * shown. It stays in view when the turn's work folds (decision 8). The first
 * four show; the rest open in place behind "Show N more" (decision 10), so a
 * long group never pushes the agent's question off a phone's screen.
 */
export function ShownFiles({ files }: { files: ShownFile[] }) {
  const [all, setAll] = useState(false)
  const [viewing, setViewing] = useState<ShownFile | null>(null)
  const hidden = all ? 0 : Math.max(0, files.length - GROUP_MAX)
  const open = (file: ShownFile) => {
    if (file.as === 'browser') window.open(file.src, '_blank', 'noopener')
    else if (file.as === 'download') window.location.assign(downloadUrl(file))
    else setViewing(file)
  }
  return (
    <div className="flex min-w-0 flex-col gap-3 animate-fade-in">
      {runsOf(hidden ? files.slice(0, GROUP_MAX) : files).map((run) =>
        run.images ? (
          <div key={run.files[0].id} className="grid min-w-0 gap-3">
            {run.files.map((file) => (
              <ShownImage key={file.id} file={file} onOpen={() => open(file)} />
            ))}
          </div>
        ) : (
          <div key={run.files[0].id} className="flex min-w-0 flex-col gap-2">
            {run.files.map((file) => (
              <FileCard key={file.id} file={file} onOpen={() => open(file)} />
            ))}
          </div>
        ),
      )}
      {hidden > 0 && (
        <Button variant="ghost" size="sm" icon={<IconChevronDown />} onClick={() => setAll(true)} className="-ml-2 self-start">
          Show {hidden} more
        </Button>
      )}
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
