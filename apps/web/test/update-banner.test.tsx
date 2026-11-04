// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The update banner's slot also carries the one-time usage-ping notice
 * (decision 18): an install from before the switch is told once what the ping
 * sends, and either answer records `usageSignal` so the server stops asking.
 * The tRPC client is the one boundary; the server's answers are chosen per case.
 */

const stub = vi.hoisted(() => ({
  /** What `system.checkUpdate` answers. */
  update: undefined as
    | { current: string; latest: string | null; updateAvailable: boolean; command: string }
    | undefined,
  /** What `system.usageNotice` answers. */
  notice: { show: false },
  /** Every `settings.update` call, in order. */
  writes: [] as { key: string; value: unknown }[],
  invalidated: 0,
}))

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))

vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({
      system: {
        usageNotice: {
          invalidate: async () => {
            stub.invalidated += 1
          },
        },
      },
    }),
    system: {
      checkUpdate: { useQuery: () => ({ data: stub.update }) },
      usageNotice: { useQuery: () => ({ data: stub.notice }) },
    },
    settings: {
      update: {
        useMutation: (opts?: { onSettled?: () => void }) => ({
          isPending: false,
          mutate: (input: { key: string; value: unknown }) => {
            stub.writes.push(input)
            opts?.onSettled?.()
          },
        }),
      },
    },
  } as unknown as typeof import('../src/trpc').trpc,
}))

const { UpdateBanner } = await import('../src/components/UpdateBanner')

const NOTICE = /counts this install as active once per boot/

describe('UpdateBanner — the one-time usage notice', () => {
  beforeEach(() => {
    stub.update = { current: '1.0.0', latest: '1.0.0', updateAvailable: false, command: 'bun add -g runcastle@latest' }
    stub.notice = { show: true }
    stub.writes = []
    stub.invalidated = 0
    localStorage.clear()
  })
  afterEach(cleanup)

  it('tells an install that has never answered what the ping sends', () => {
    render(<UpdateBanner />)
    expect(screen.getByText(NOTICE)).toBeTruthy()
    expect(screen.getByText(/a random ID, the version and the platform/)).toBeTruthy()
  })

  it.each([
    ['Turn off', 'off'],
    ['OK', 'on'],
  ])('“%s” records %s and takes the notice down', (button, value) => {
    render(<UpdateBanner />)
    fireEvent.click(screen.getByRole('button', { name: button }))

    expect(stub.writes).toEqual([{ key: 'usageSignal', value }])
    expect(screen.queryByText(NOTICE)).toBeNull()
    expect(stub.invalidated).toBe(1)
  })

  it('stays away once the server no longer asks for it — after a reload too', () => {
    stub.notice = { show: false }
    render(<UpdateBanner />)
    expect(screen.queryByText(NOTICE)).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('gives the slot to an update when one is available', () => {
    stub.update = { current: '1.0.0', latest: '1.1.0', updateAvailable: true, command: 'bun add -g runcastle@latest' }
    render(<UpdateBanner />)
    expect(screen.getByText('runcastle 1.1.0 is available')).toBeTruthy()
    expect(screen.queryByText(NOTICE)).toBeNull()
  })

  it('shows the notice once the update banner has been dismissed', () => {
    stub.update = { current: '1.0.0', latest: '1.1.0', updateAvailable: true, command: 'bun add -g runcastle@latest' }
    render(<UpdateBanner />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss update notice' }))
    expect(screen.getByText(NOTICE)).toBeTruthy()
  })
})
