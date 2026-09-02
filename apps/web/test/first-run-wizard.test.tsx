// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRunWizard } from '../src/components/first-run/FirstRunWizard'
import { ToastProvider } from '../src/lib/toast'

/**
 * Walking the wizard the way a first-time user does (decision 4): forward, back,
 * and out the far side. The component is all tRPC, so the client is stubbed with
 * a doctor report the test chooses per case — that report is what decides which
 * step comes first, which is the whole of the Back behaviour under test.
 */

type Probe = { id?: string; status: string; detail: string; runtime?: string; check?: string }

const stub = vi.hoisted(() => ({
  /** What `setup.doctor` answers this test. */
  probes: [] as Probe[],
  /** Every `setup.seedModelDefaults` call, in order. */
  seeded: [] as { runtimes: string[] }[],
}))

vi.mock('../src/trpc', () => {
  const query = (data: () => unknown) => ({
    useQuery: () => ({
      data: data(),
      isLoading: false,
      isError: false,
      error: null,
      refetch: () => undefined,
    }),
  })
  /** A mutation that resolves at once, so an `onSuccess` that advances runs. */
  const mutation = (onCall: (input: never) => void = () => undefined) => ({
    useMutation: (opts?: { onSuccess?: (out: unknown) => void }) => ({
      isPending: false,
      error: null,
      reset: () => undefined,
      mutate: (input: never) => {
        onCall(input)
        opts?.onSuccess?.({ sessionId: 'session-1' })
      },
    }),
  })
  const invalidate = async () => undefined
  return {
    trpc: {
      useUtils: () => ({
        setup: { doctor: { invalidate } },
        project: { list: { invalidate } },
      }),
      setup: {
        doctor: query(() => ({ results: stub.probes })),
        runtimeGuide: query(() => undefined),
        gitIdentity: mutation(),
        startTerminal: mutation(),
        afkToken: mutation(),
        seedModelDefaults: mutation((input) => stub.seeded.push(input)),
      },
      project: {
        open: mutation(),
        roots: query(() => []),
        browse: query(() => undefined),
      },
    },
  }
})

const identity = (status: string): Probe => ({
  id: 'git-identity',
  status,
  detail: status === 'ok' ? 'Ada Lovelace <ada@example.com>' : 'user.email not set',
})
const codexSignedIn: Probe[] = [
  { status: 'ok', detail: 'codex 0.9', runtime: 'codex', check: 'binary' },
  { status: 'ok', detail: 'signed in', runtime: 'codex', check: 'auth' },
]

const onOpened = vi.fn()
const onCancel = vi.fn()

function open(probes: Probe[]) {
  stub.probes = probes
  return render(
    <ToastProvider>
      <FirstRunWizard onOpened={onOpened} onCancel={onCancel} />
    </ToastProvider>,
  )
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
const rail = () => screen.queryByRole('list', { name: 'Setup progress' })

describe('FirstRunWizard', () => {
  beforeEach(() => {
    stub.seeded = []
    onOpened.mockClear()
    onCancel.mockClear()
  })
  afterEach(cleanup)

  // The intro is the screen that was missing (finding F13): it is not a setup
  // step, so it carries neither the rail nor a Back.
  it('opens on the intro, with no rail and nowhere back', () => {
    open([identity('unset')])
    expect(screen.getByRole('heading', { name: /driven through a pipeline/ })).toBeTruthy()
    expect(rail()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('shows the rail from the first setup step on', () => {
    open([identity('unset')])
    click('Set up runcastle →')
    expect(screen.getByRole('heading', { name: 'Set your git identity' })).toBeTruthy()
    expect(rail()?.textContent).toContain('Coding agents')
  })

  it('goes back to the intro from the first step it showed', () => {
    open([identity('unset')])
    click('Set up runcastle →')
    click('Back')
    expect(screen.getByRole('heading', { name: /driven through a pipeline/ })).toBeTruthy()
  })

  // The bug decision 4 removes in reverse: Back onto a step the host satisfied
  // would ask for an identity git already has.
  it('never walks back onto an identity the host already had', () => {
    open([identity('ok'), ...codexSignedIn])
    click('Set up runcastle →')
    expect(screen.getByRole('heading', { name: 'Connect a coding agent' })).toBeTruthy()
    expect(rail()?.textContent).toContain('Git identity')

    click('Back')
    expect(screen.getByRole('heading', { name: /driven through a pipeline/ })).toBeTruthy()
  })

  it('goes back a step from the middle of setup', () => {
    open([identity('ok'), ...codexSignedIn])
    click('Set up runcastle →')
    click('Continue')
    expect(screen.getByRole('heading', { name: 'Run burns unattended?' })).toBeTruthy()

    click('Back')
    expect(screen.getByRole('heading', { name: 'Connect a coding agent' })).toBeTruthy()
  })

  it('asks about unattended burns instead of showing their settings card', () => {
    open([identity('ok'), ...codexSignedIn])
    click('Set up runcastle →')
    click('Continue')

    expect(screen.getByText(/An AFK burn is a burn you walk away from/)).toBeTruthy()
    expect(screen.queryByText('Ready for unattended burns')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue to your first project' })).toBeNull()
  })

  it('reveals the settings card in place, and takes the two answers away with it', () => {
    open([identity('ok'), ...codexSignedIn])
    click('Set up runcastle →')
    click('Continue')
    click('Set up now')

    // The card's own "Set up later" is now the step's single continue. The card
    // is the prerequisites checklist Settings owns (flow-redesign-settings); its
    // summary line is what says it arrived.
    expect(screen.getByText('Ready for unattended burns')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Set up now' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Set up later' })).toBeTruthy()
  })

  it('skips AFK setup into the first-project screen, seeding the ready runtimes', () => {
    open([identity('ok'), ...codexSignedIn])
    click('Set up runcastle →')
    click('Continue')
    click('Skip for now')

    expect(stub.seeded).toEqual([{ runtimes: ['codex'] }])
    expect(screen.getByRole('heading', { name: 'Open your first project' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('leaves through the card the same way', () => {
    open([identity('ok'), ...codexSignedIn])
    click('Set up runcastle →')
    click('Continue')
    click('Set up now')
    click('Set up later')

    expect(stub.seeded).toEqual([{ runtimes: ['codex'] }])
    expect(screen.getByRole('heading', { name: 'Open your first project' })).toBeTruthy()
  })

  // Legacy rules are unlayered and beat utilities (apps/web/STYLE.md), so a
  // leftover class name would silently override the new styling.
  it('carries no retired class names on any step', () => {
    const retired = /class="[^"]*\b(wizard-|op-|open-project)/
    const walk = (probes: Probe[], steps: string[]) => {
      const { container } = open(probes)
      expect(container.innerHTML).not.toMatch(retired)
      for (const step of steps) {
        click(step)
        expect(container.innerHTML).not.toMatch(retired)
      }
      cleanup()
    }
    // Intro → identity, then intro → runtimes → AFK on a host that has one.
    walk([identity('unset')], ['Set up runcastle →'])
    walk([identity('ok'), ...codexSignedIn], ['Set up runcastle →', 'Continue'])
  })
})
