// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenProject } from '../src/components/OpenProject'
import { ToastProvider } from '../src/lib/toast'

/**
 * The open-a-project screen (decision 5). The component is all tRPC, so the
 * client is stubbed with a mutation that behaves like the real one — an error
 * that appears when a path is rejected and clears on `reset()` — and the tests
 * drive the screen the way a user does: type, press Open, read what it says.
 */

const stub = vi.hoisted(() => ({
  /** What the next `project.open` rejects with, or null to succeed. */
  rejectWith: null as { message: string } | null,
  opened: [] as { repoPath: string }[],
}))

vi.mock('../src/trpc', async () => {
  const { useState } = await import('react')
  return {
    trpc: {
      useUtils: () => ({ project: { list: { invalidate: async () => undefined } } }),
      project: {
        open: {
          useMutation: () => {
            const [error, setError] = useState<{ message: string } | null>(null)
            return {
              error,
              isPending: false,
              reset: () => setError(null),
              mutate: (input: { repoPath: string }) => {
                stub.opened.push(input)
                setError(stub.rejectWith)
              },
            }
          },
        },
        // The picker browses the server's filesystem; an empty listing is enough
        // for the one question asked of it here (that Browse… opens it).
        roots: { useQuery: () => ({ data: [] }) },
        browse: {
          useQuery: () => ({ data: undefined, isError: false, isLoading: false, error: null }),
        },
      },
    },
  }
})

const onCancel = vi.fn()
const onOpened = vi.fn()

/**
 * The paths these tests type are POSIX, and the screen's own validation is
 * deliberately platform-aware (`isAbsolutePath`, findings F17.4): on a Windows
 * host `/tmp/notes` is refused before the stubbed mutation ever runs, and the
 * screen answers a question nobody asked here. So the platform is pinned and
 * the file asks the same thing on every machine — the Windows-vs-POSIX rule
 * itself is covered by the pure-function tests in `platform.test.ts`.
 */
function pinPosixPlatform(): void {
  Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true })
}

/** Drops the pin, leaving the environment's own `platform` getter in charge. */
function restorePlatform(): void {
  delete (navigator as { platform?: string }).platform
}

function open(firstRun = false) {
  return render(
    <ToastProvider>
      <OpenProject firstRun={firstRun} onOpened={onOpened} onCancel={onCancel} />
    </ToastProvider>,
  )
}

/** Type a path and press the Open button. */
function tryPath(path: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Repository path' }), {
    target: { value: path },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
}

describe('OpenProject', () => {
  beforeEach(() => {
    pinPosixPlatform()
    stub.rejectWith = null
    stub.opened = []
    onCancel.mockClear()
    onOpened.mockClear()
  })
  afterEach(() => {
    restorePlatform()
    cleanup()
  })

  it('is a kicker, a heading, a one-line lead and one row of controls', () => {
    const { container } = open()
    expect(screen.getByRole('heading', { name: 'Open a project' })).toBeTruthy()
    expect(screen.getByText(/Point runcastle at a local git repository/)).toBeTruthy()
    const row = screen.getByRole('textbox', { name: 'Repository path' }).parentElement
    expect(row?.textContent).toBe('Browse…Open')
    // Legacy rules are unlayered and beat utilities, so a leftover class name
    // would silently override the new styling (apps/web/STYLE.md).
    expect(container.innerHTML).not.toMatch(/class="[^"]*\b(op-|open-project)/)
  })

  // The kicker locates you; the heading names the action. Printing the
  // heading's own words above it in caps carries nothing (decision 1).
  it('does not repeat the heading in its kicker', () => {
    open()
    expect(screen.getByText('Your projects')).toBeTruthy()
    expect(screen.queryAllByText('Open a project')).toHaveLength(1)
  })

  it('welcomes a first run and gives it nowhere to cancel back to', () => {
    open(true)
    expect(screen.getByRole('heading', { name: 'Open your first project' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Repository path' }), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('lets everyone else back out, by button or by Escape', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Repository path' }), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('lets Escape back out after dismissing the picker', () => {
    open()
    const browse = screen.getByRole('button', { name: 'Browse…' })
    browse.focus()
    fireEvent.click(browse)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(browse)

    fireEvent.keyDown(browse, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('says a folder is not a repository once, with the path and git init', () => {
    stub.rejectWith = { message: 'not a git repository: /tmp/notes' }
    open()
    tryPath('/tmp/notes')

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Not a git repository')
    expect(alert.textContent).toContain('git init')
    // Said once: the server's message named the path, and the hint named it
    // again, which is the doubling decision 5 removes.
    expect(alert.textContent?.split('/tmp/notes')).toHaveLength(2)
  })

  it('says a missing path is missing, and points at Browse…', () => {
    stub.rejectWith = { message: 'path does not exist: /tmp/typo' }
    open()
    tryPath('/tmp/typo')

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Path does not exist')
    expect(alert.textContent).toContain('Browse')
  })

  it('clears a stale failure when the picker opens', () => {
    stub.rejectWith = { message: 'not a git repository: /tmp/notes' }
    open()
    tryPath('/tmp/notes')
    expect(screen.getByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Browse…' }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  // The server would resolve a relative path against its own working directory
  // and then report that directory back — an answer about a folder the user
  // never named (decision 5).
  it('refuses a relative path without asking the server', () => {
    open()
    tryPath('not-a-path')

    expect(screen.getByRole('alert').textContent).toContain('Enter an absolute path')
    expect(stub.opened).toEqual([])
  })

  it('sends an absolute path on', () => {
    open()
    tryPath('/home/you/repo')

    expect(stub.opened).toEqual([{ repoPath: '/home/you/repo' }])
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
