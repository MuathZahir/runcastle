import { useContext, useRef, useState, type ReactNode } from 'react'
import { AsideLayout, Aside, Button, IconButton, SidebarDoorContext, cx } from '../../ui'
import { IconArrowLeft, IconPanelRight, IconPlus, IconStop } from '../../icons'
import { toPngBlob } from '../../lib/reviews'
import { useToast } from '../../lib/toast'
import { Composer } from '../chat/thread/Composer'
import { Lightbox } from './Lightbox'
import { DriveNotes, SendNotesLine, type DriveNote, type DriveNoteActions } from './DriveNotes'

/**
 * A test drive as the whole page (test-drive-looks-the-part decisions 13, 18):
 * the app flush beside a rail of notes, in place of the chat. The feature's
 * drive and the Orchestrator's are this one page; they differ only in the store
 * their notes live in.
 *
 * The app's column has one head, level with the rail's: the way back, what is
 * being driven, the scenario and the tools, Stop, and the rail's toggle.
 */

/** What a drive's notes are, wherever they are stored. */
export interface DriveNoteStore extends Omit<DriveNoteActions, 'onOpenPicture'> {
  /** The notes the rail lists, oldest first. */
  notes: DriveNote[]
  /** A group above them: the Orchestrator's notes from before this drive. */
  earlier?: { title: string; notes: DriveNote[] }
  /** What has already gone to the agent, folded. */
  sent?: DriveNote[]
  /** Save a note, with its picture if it has one; settles once `notes` holds it. */
  add: (text: string, picture: Blob | null) => Promise<void>
  /** A feature's notes go to its agent; with none waiting, no Send is offered. */
  send?: { count: number; run: () => void }
}

/** What the page hands the stage it frames. */
export interface DriveStageSlots {
  leading: ReactNode
  trailing: ReactNode
  onCapture: (png: Blob) => void
}

/** The picture waiting in the note box. */
interface Staged {
  png: Blob
  src: string
}

/** The words a note gets when the picture is all it has to say. */
const WORDLESS = 'Screenshot from the test drive'

export function DrivePage({
  title,
  store,
  hidden = false,
  stopping,
  onBack,
  onStop,
  stage,
}: {
  /** What is being driven: the feature's title, or "Driving main". */
  title: ReactNode
  store: DriveNoteStore
  /** The human is on the chat page: the drive stays mounted, so the app stays as it was left. */
  hidden?: boolean
  stopping: boolean
  /** Back to the chat, the drive still running. */
  onBack: () => void
  onStop: () => void
  stage: (slots: DriveStageSlots) => ReactNode
}) {
  const toast = useToast()
  const door = useContext(SidebarDoorContext)
  const [railOpen, setRailOpen] = useState(true)
  const [picture, setPicture] = useState<string | null>(null)
  // The box's draft outlives the rail being folded.
  const [draft, setDraft] = useState('')
  const [staged, setStaged] = useState<Staged | null>(null)
  // Notes on their way to the server. A slow server must not make one vanish
  // from the box and stay nowhere: it is on the list from the keystroke.
  const [saving, setSaving] = useState<DriveNote[]>([])
  const field = useRef<HTMLTextAreaElement>(null)

  const stagePicture = (png: Blob) => {
    setStaged({ png, src: URL.createObjectURL(png) })
    setRailOpen(true)
    // After the rail has had the chance to open.
    setTimeout(() => field.current?.focus(), 0)
  }
  const attach = (file: File) => {
    toPngBlob(file)
      .then(stagePicture)
      .catch((e: unknown) => toast.push(e instanceof Error ? e.message : 'that image could not be read'))
  }
  const addNote = () => {
    const text = draft.trim() || WORDLESS
    const png = staged?.png ?? null
    const id = `saving-${Date.now()}`
    setSaving((notes) => [...notes, { id, text, when: 'now', saving: true, ...(staged ? { picture: staged.src } : {}) }])
    setDraft('')
    setStaged(null)
    store
      .add(text, png)
      .catch((e: unknown) => {
        // Put it back: a note that failed to save is not lost.
        setDraft(text === WORDLESS ? '' : text)
        if (png) stagePicture(png)
        toast.push(e instanceof Error ? e.message : 'the note could not be saved')
      })
      .finally(() => setSaving((notes) => notes.filter((n) => n.id !== id)))
  }

  const leading = (
    <>
      {door}
      <IconButton label="Back to the chat" icon={<IconArrowLeft />} tooltipSide="bottom" onClick={onBack} />
      <span className="min-w-0 shrink-[2] truncate px-1 text-sm text-text-secondary">{title}</span>
      <span className="mx-1 h-4 w-px shrink-0 bg-border-subtle" />
    </>
  )
  const trailing = (
    <>
      <span className="mx-1 h-4 w-px shrink-0 bg-border-subtle" />
      <Button size="sm" icon={<IconStop />} loading={stopping} onClick={onStop}>
        Stop drive
      </Button>
      <IconButton
        label={railOpen ? 'Hide notes' : 'Show notes'}
        icon={<IconPanelRight />}
        active={railOpen}
        tooltipSide="bottom"
        onClick={() => setRailOpen((open) => !open)}
      />
    </>
  )

  return (
    <div className={cx('min-h-0 min-w-0 flex-1 animate-fade-in', hidden ? 'hidden' : 'flex')} data-drive-page>
      <AsideLayout
        // Floating in a narrow window, the rail stays clear of the head: Stop
        // and the toggle must stay clickable.
        asideClassName="@max-4xl:top-(--topbar-h)"
        aside={
          railOpen && (
            <Aside title="Notes" onClose={() => setRailOpen(false)} bodyClassName="flex flex-col">
              <DriveNotes
                notes={[...store.notes, ...saving]}
                earlier={store.earlier}
                sent={store.sent}
                onOpenPicture={setPicture}
                onEdit={store.onEdit}
                onDelete={store.onDelete}
                onPicture={store.onPicture}
                foot={
                  <>
                    {store.send && (
                      <SendNotesLine count={store.send.count} onSend={store.send.run} primary={!draft.trim() && !staged} />
                    )}
                    <Composer
                      value={draft}
                      onChange={setDraft}
                      attachments={staged ? [{ id: 'staged', name: 'the picture this note will carry', src: staged.src }] : []}
                      onAttach={(files) => {
                        if (files[0]) attach(files[0])
                      }}
                      onRemoveAttachment={() => setStaged(null)}
                      state="idle"
                      inputRef={field}
                      multiple={false}
                      label="Note"
                      sendLabel="Add note"
                      sendIcon={<IconPlus />}
                      placeholder="What did you just notice?"
                      onSend={addNote}
                    />
                  </>
                }
              />
            </Aside>
          )
        }
      >
        {stage({ leading, trailing, onCapture: stagePicture })}
      </AsideLayout>
      <Lightbox url={picture} onClose={() => setPicture(null)} />
    </div>
  )
}
