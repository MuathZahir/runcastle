// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The update banner's slot carries the update notice and nothing else: the
 * usage ping is on by default and nobody is asked about it
 * (the-orchestrator-prepares-the-project decision 16), so no usage notice ever
 * takes the slot. The tRPC client is the one boundary.
 */

const stub = vi.hoisted(() => ({
  /** What `system.checkUpdate` answers. */
  update: undefined as
    | { current: string; latest: string | null; updateAvailable: boolean; command: string }
    | undefined,
}))

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))

vi.mock('../src/trpc', () => ({
  trpc: {
    system: { checkUpdate: { useQuery: () => ({ data: stub.update }) } },
  } as unknown as typeof import('../src/trpc').trpc,
}))

const { UpdateBanner } = await import('../src/components/UpdateBanner')

describe('UpdateBanner', () => {
  beforeEach(() => {
    stub.update = { current: '1.0.0', latest: '1.0.0', updateAvailable: false, command: 'bun add -g runcastle@latest' }
    localStorage.clear()
  })
  afterEach(cleanup)

  it('shows nothing while runcastle is up to date — no usage notice either', () => {
    render(<UpdateBanner />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(/counts this install/)).toBeNull()
  })

  it('names the newer version when one is available, and leaves nothing behind once dismissed', () => {
    stub.update = { current: '1.0.0', latest: '1.1.0', updateAvailable: true, command: 'bun add -g runcastle@latest' }
    render(<UpdateBanner />)
    expect(screen.getByText('runcastle 1.1.0 is available')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notice' }))
    expect(screen.queryByText('runcastle 1.1.0 is available')).toBeNull()
    expect(screen.queryByText(/counts this install/)).toBeNull()
  })
})
