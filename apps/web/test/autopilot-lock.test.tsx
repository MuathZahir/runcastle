// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutopilotLock } from '../src/components/autopilot/AutopilotLock'
import { ToastProvider } from '../src/lib/toast'
import { fakeTrpc } from './fake-trpc'
import { listItem } from './fixtures'

/**
 * The lock note on a locked feature's chat (docs/features/epics-on-autopilot
 * decisions 3, 8, 20; the design page "Feature chat on autopilot"): "Open the
 * epic" goes to the epic's chat; "End autopilot" asks once, naming the epic and
 * the features it gives back, and only the confirm calls
 * `feature.endAutopilot`. Tier 2: the confirm is a dialog in a portal, and the
 * call goes through the app's real tRPC hooks over a fake server.
 */

const EPIC = { epicId: 'chat_checkout', epicName: 'Checkout flow' }

const features = [
  { ...listItem({ id: 'f1' }), title: 'Checkout page', autopilot: EPIC },
  { ...listItem({ id: 'f2' }), title: 'Saved cards', autopilot: EPIC },
  { ...listItem({ id: 'f3' }), title: 'Status chip', autopilot: null },
  { ...listItem({ id: 'f4' }), title: 'Refunds', autopilot: { epicId: 'chat_other', epicName: 'Billing' } },
]

function setup() {
  const server = fakeTrpc({
    'feature.list': () => features,
    'feature.endAutopilot': () => ({ ok: true }),
  })
  const onOpenEpic = vi.fn()
  const wrap = ({ children }: { children: ReactNode }) => (
    <server.Wrapper>
      <ToastProvider>{children}</ToastProvider>
    </server.Wrapper>
  )
  render(<AutopilotLock projectId="proj_1" autopilot={EPIC} color="violet" onOpenEpic={onOpenEpic} />, { wrapper: wrap })
  return { server, onOpenEpic }
}

describe('the lock note', () => {
  afterEach(cleanup)

  it('says the epic runs the feature, and stands as a note', () => {
    setup()
    const note = screen.getByRole('note', { name: 'On autopilot: Checkout flow' })
    expect(note.textContent).toContain('Checkout flow runs this feature on autopilot')
  })

  it('“Open the epic” opens the epic’s chat', () => {
    const { onOpenEpic, server } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Open the epic' }))
    expect(onOpenEpic).toHaveBeenCalledWith('chat_checkout')
    expect(server.inputs('feature.endAutopilot')).toEqual([])
  })

  it('“End autopilot” is in the autopilot’s colour, not the accent’s blue', () => {
    setup()
    const link = within(screen.getByRole('note')).getByRole('button', { name: 'End autopilot' })
    expect(link.className).toContain('text-(--epic-text)')
    expect(link.className).not.toContain('accent')
  })

  it('“End autopilot” asks first, naming the epic and the features it gives back', async () => {
    const { server } = setup()
    fireEvent.click(within(screen.getByRole('note')).getByRole('button', { name: 'End autopilot' }))
    const dialog = await screen.findByRole('dialog', { name: 'End autopilot for “Checkout flow”?' })
    await waitFor(() => expect(within(dialog).getByText('You get 2 features back', { exact: false })).toBeTruthy())
    expect(within(dialog).getByText('Checkout page')).toBeTruthy()
    expect(within(dialog).getByText('Saved cards')).toBeTruthy()
    expect(within(dialog).queryByText('Status chip')).toBeNull()
    expect(within(dialog).queryByText('Refunds')).toBeNull()
    expect(server.inputs('feature.endAutopilot')).toEqual([])
  })

  it('“Keep autopilot” closes the confirm and ends nothing', async () => {
    const { server } = setup()
    fireEvent.click(within(screen.getByRole('note')).getByRole('button', { name: 'End autopilot' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep autopilot' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(server.inputs('feature.endAutopilot')).toEqual([])
  })

  it('the confirm calls feature.endAutopilot with the epic, once', async () => {
    const { server } = setup()
    fireEvent.click(within(screen.getByRole('note')).getByRole('button', { name: 'End autopilot' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'End autopilot' }))
    await waitFor(() => expect(server.inputs('feature.endAutopilot')).toEqual([{ epicId: 'chat_checkout' }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
