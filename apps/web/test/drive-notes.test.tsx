// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestNote } from '@runcastle/core'

/**
 * The notes beside a drive (test-drive-looks-the-part decisions 14–19): the
 * rail's list, its Send, and the page it sits on. Tier 2: what is asked is what
 * a click does. The server is the boundary, its mutations stubbed.
 */
let notes: TestNote[] = []
const add = vi.fn(async (input: { featureId: string; text: string }) => ({ id: 'note_new', ...input }))
const edit = vi.fn()
const remove = vi.fn()
const send = vi.fn()
const uploadScreenshot = vi.fn(async () => {})

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({
      notes: { list: { invalidate: vi.fn() }, delivery: { invalidate: vi.fn() } },
      feature: { driveInfo: { invalidate: vi.fn() } },
    }),
    notes: {
      list: { useQuery: () => ({ data: notes }) },
      add: { useMutation: () => ({ mutateAsync: add }) },
      edit: { useMutation: () => ({ mutate: edit }) },
      remove: { useMutation: () => ({ mutate: remove }) },
      send: { useMutation: () => ({ mutate: send, isPending: false }) },
    },
    feature: {
      driveInfo: { useQuery: () => ({ data: { featureId: 'feat_1', state: 'starting', branch: 'feature/x' } }) },
      driveScenarios: { useQuery: () => ({ data: { runnerConfigured: false, scenarios: [] } }) },
      runScenario: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      openScenarioChat: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      fixDrive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}))
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false }))
vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: vi.fn() }) }))
vi.mock('../src/lib/land-on-chat', () => ({ useLandOnChat: () => () => undefined }))
vi.mock('../src/lib/reviews', async (original) => ({
  ...(await original<typeof import('../src/lib/reviews')>()),
  uploadScreenshot,
}))
vi.mock('../src/components/TerminalView', () => ({ TerminalView: () => null }))

const { DriveNoteRow, DriveNotes, SendNotesLine } = await import('../src/components/review/DriveNotes')
const { DriveChatNotice } = await import('../src/components/review/DriveChatNotice')
const { FeatureDriveView } = await import('../src/components/review/FeatureDriveView')
const { featureNoteList } = await import('../src/components/review/drive-note-stores')

const note = (id: string, over: Partial<TestNote> = {}): TestNote => ({
  id,
  featureId: 'feat_1',
  text: `words of ${id}`,
  status: 'open',
  author: 'human',
  createdAt: 1_000,
  updatedAt: 1_000,
  ...over,
})

const actions = { onOpenPicture: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onPicture: vi.fn() }

beforeEach(() => {
  notes = []
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('a note on the rail', () => {
  const row = { id: 'n1', text: 'the total jumps', picture: 'blob:shot', when: '4m' }

  it('leads with its picture, and opens it from there', () => {
    render(<DriveNoteRow note={row} {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open the picture' }))
    expect(actions.onOpenPicture).toHaveBeenCalledWith('blob:shot')
  })

  it('changes its words in place: Enter saves, Escape leaves them', () => {
    render(<DriveNoteRow note={row} {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }))
    const field = screen.getByRole('textbox', { name: 'Edit note' })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(actions.onEdit).not.toHaveBeenCalled()
    expect(screen.getByText('the total jumps')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit note' }))
    const again = screen.getByRole('textbox', { name: 'Edit note' })
    fireEvent.change(again, { target: { value: 'the total jumps twice' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    expect(actions.onEdit).toHaveBeenCalledWith('n1', 'the total jumps twice')
  })

  it('asks in the row before deleting, and Keep leaves it', () => {
    render(<DriveNoteRow note={row} {...actions} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    expect(screen.getByText('Delete this note and its picture?')).toBeTruthy()
    expect(actions.onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(actions.onDelete).toHaveBeenCalledWith('n1')
  })

  it('offers nothing on a note already sent', () => {
    render(<DriveNoteRow note={row} readonly {...actions} />)
    expect(screen.queryByRole('button', { name: 'Edit note' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull()
  })
})

describe('the rail’s list', () => {
  it('says how to start when there is nothing yet', () => {
    render(<DriveNotes notes={[]} foot={null} {...actions} />)
    expect(screen.getByText('Nothing noted yet')).toBeTruthy()
  })

  it('puts the Orchestrator’s older notes above this drive’s', () => {
    render(
      <DriveNotes
        notes={[{ id: 'n', text: 'from this drive', when: 'now' }]}
        earlier={{ title: 'Already open', notes: [{ id: 'o', text: 'from before', when: '1d' }] }}
        foot={null}
        {...actions}
      />,
    )
    expect(within(screen.getByRole('region', { name: 'Already open' })).getByText('from before')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'This drive' })).getByText('from this drive')).toBeTruthy()
  })

  it('folds what has gone to the agent into one line', () => {
    render(<DriveNotes notes={[]} sent={[{ id: 's', text: 'gone', when: '1h' }]} foot={null} {...actions} />)
    expect(screen.getByText('1 sent to the agent')).toBeTruthy()
  })
})

describe('Send', () => {
  it('is not there with nothing to send: the rail never says all is good', () => {
    const { container } = render(<SendNotesLine count={0} onSend={vi.fn()} />)
    expect(container.textContent).toBe('')
  })

  it('files a feature’s notes: the human’s open ones oldest first, sent ones apart, the rest gone', () => {
    const { open, sent } = featureNoteList([
      note('newer', { createdAt: 2_000 }),
      note('older', { createdAt: 1_000 }),
      note('gone', { sentAt: 3_000 }),
      note('done', { status: 'done' }),
      note('promoted', { status: 'promoted' }),
      note('a finding', { author: 'agent' }),
    ])
    expect(open.map((n) => n.id)).toEqual(['older', 'newer'])
    expect(sent.map((n) => n.id)).toEqual(['gone'])
  })
})

describe('the feature’s drive page', () => {
  const page = (onBack = vi.fn()) => {
    render(
      <FeatureDriveView
        full={{ feature: { id: 'feat_1', projectId: 'proj_1', branch: 'feature/x', title: 'Coupons' }, sessions: [] } as never}
        stopping={false}
        onBack={onBack}
        onStop={vi.fn()}
      />,
    )
    return onBack
  }

  it('sends the notes and goes back to the chat at once, the drive left running', () => {
    notes = [note('n1')]
    const onBack = page()
    fireEvent.click(screen.getByRole('button', { name: 'Send to the agent' }))
    expect(send).toHaveBeenCalledWith({ featureId: 'feat_1' })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('saves a note from the box and clears it', async () => {
    page()
    const box = screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'the total jumps' } })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    expect(add).toHaveBeenCalledWith({ featureId: 'feat_1', text: 'the total jumps' })
    expect(uploadScreenshot).not.toHaveBeenCalled()
    expect(box.value).toBe('')
  })

  it('names what is driven and goes back from the head', () => {
    const onBack = page()
    expect(screen.getByText('Coupons')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the chat' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('folds the rail away and brings it back from the head', () => {
    page()
    fireEvent.click(screen.getByRole('button', { name: 'Hide notes' }))
    expect(screen.queryByRole('complementary', { name: 'Notes' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show notes' }))
    expect(screen.getByRole('complementary', { name: 'Notes' })).toBeTruthy()
  })

  it('keeps the rail clear of the head when it floats in a narrow window', () => {
    page()
    const slot = screen.getByRole('complementary', { name: 'Notes' }).parentElement!
    expect(slot.className).toContain('@max-4xl:top-(--topbar-h)')
  })
})

describe('the line over the chat', () => {
  const line = (driving: boolean) => {
    const onStop = vi.fn()
    const view = render(<DriveChatNotice featureId="feat_1" driving={driving} stopping={false} onStop={onStop} />)
    return { onStop, view }
  }

  it('says the agent is held while the drive runs, with the way to let it go', () => {
    const { onStop } = line(true)
    expect(screen.getByText(/the agent can’t start a round/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop drive' }))
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('offers what was left unsent once the drive has stopped', () => {
    notes = [note('n1'), note('n2')]
    line(false)
    expect(screen.getByText('2 notes not sent yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send to the agent' }))
    expect(send).toHaveBeenCalledWith({ featureId: 'feat_1' })
  })

  it('says nothing with no drive and nothing unsent', () => {
    expect(line(false).view.container.textContent).toBe('')
  })
})
