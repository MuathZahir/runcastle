// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectoryPicker } from '../src/components/DirectoryPicker'

/**
 * The repo picker (decision 6). It is all tRPC, so the client is stubbed with a
 * small filesystem that answers `project.browse` the way the server does — a
 * listing for a directory that exists, and its own wording for one that does
 * not — and the tests drive the dialog the way a user does.
 *
 * The stub drops the real query's `placeholderData`, so an error here clears the
 * listing rather than leaving the previous one painted. Nothing tested below
 * turns on which of the two it is: an errored listing disables the primary
 * button either way.
 */

const fsStub = vi.hoisted(() => {
  const entry = (dir: string, name: string, extra: { isRepo?: boolean; isSymlink?: boolean } = {}) => ({
    name,
    path: `${dir}/${name}`,
    isRepo: false,
    isSymlink: false,
    ...extra,
  })
  return {
    home: '/home/you',
    tree: {
      '/home/you': [entry('/home/you', 'code')],
      '/home/you/code': [
        entry('/home/you/code', 'runcastle', { isRepo: true }),
        entry('/home/you/code', 'mirror', { isSymlink: true }),
      ],
      '/home/you/code/runcastle': [],
      '/home/you/huge': [entry('/home/you/huge', 'first-of-many')],
    } as Record<string, ReturnType<typeof entry>[] | undefined>,
    /** The one directory the stub reports as more than it would list. */
    truncatedDir: '/home/you/huge',
  }
})

vi.mock('../src/trpc', () => ({
  trpc: {
    project: {
      roots: {
        useQuery: () => ({ data: [{ label: '~', path: '/home/you', kind: 'home' }] }),
      },
      browse: {
        useQuery: ({ dir, showHidden }: { dir?: string; showHidden: boolean }) => {
          const target = dir ?? fsStub.home
          const fail = (message: string) => ({
            data: undefined,
            isError: true as const,
            isLoading: false,
            error: { message },
          })
          if (!target.startsWith('/')) return fail(`path is not absolute: ${target}`)
          const entries = fsStub.tree[target]
          if (!entries) return fail(`path does not exist: ${target}`)
          const segments = target.split('/')
          return {
            data: {
              dir: target,
              parent: segments.length > 2 ? segments.slice(0, -1).join('/') : '/',
              crumbs: segments.map((name, i) => ({
                name: name || '/',
                path: segments.slice(0, i + 1).join('/') || '/',
              })),
              entries: entries.filter((e) => showHidden || !e.isSymlink),
              isRepo: false,
              truncated: target === fsStub.truncatedDir,
            },
            isError: false as const,
            isLoading: false,
            error: null,
          }
        },
      },
    },
  },
}))

const onPick = vi.fn()
const onCancel = vi.fn()

const show = (initialPath?: string) =>
  render(<DirectoryPicker initialPath={initialPath} onPick={onPick} onCancel={onCancel} />)

const openButton = () => screen.getByRole('button', { name: 'Open this folder' }) as HTMLButtonElement

describe('DirectoryPicker', () => {
  beforeEach(() => {
    onPick.mockClear()
    onCancel.mockClear()
  })
  afterEach(cleanup)

  it('opens on the path it was handed and lists it', () => {
    show('/home/you/code')

    expect(screen.getByRole('dialog', { name: 'Choose a repository' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /runcastle/ })).toBeTruthy()
    expect(openButton().disabled).toBe(false)
  })

  it('walks up to the nearest listable ancestor and keeps what was typed', () => {
    show('/home/you/code/typo')

    // Landed one segment up, on the folder that does exist.
    expect(screen.getByRole('button', { name: /runcastle/ })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Current path' }).textContent).toContain('code')

    // …and the path that was not there is still the thing being edited, so it
    // can be corrected rather than retyped.
    fireEvent.click(screen.getByRole('button', { name: 'Edit path' }))
    expect((screen.getByRole('textbox', { name: 'Path' }) as HTMLInputElement).value).toBe(
      '/home/you/code/typo',
    )
  })

  it('will not submit a folder the server refused to read', () => {
    // Not a missing path, so there is no ancestor to walk to — the failure is
    // shown and the primary button stops offering to send it anyway.
    show('code/typo')

    expect(screen.getByText(/path is not absolute/)).toBeTruthy()
    expect(openButton().disabled).toBe(true)
  })

  it('navigates on a single click and picks a repo on a double click', () => {
    show('/home/you')

    fireEvent.click(screen.getByRole('button', { name: /code/ }))
    const repo = screen.getByRole('button', { name: /runcastle/ })
    expect(repo.textContent).toContain('git')

    fireEvent.doubleClick(repo)
    expect(onPick).toHaveBeenCalledWith('/home/you/code/runcastle')
  })

  it('types a path in the header instead of clicking down to it', () => {
    show('/home/you')

    fireEvent.click(screen.getByRole('group', { name: 'Current path' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Path' }), {
      target: { value: '/home/you/code' },
    })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Path' }), { key: 'Enter' })

    expect(screen.getByRole('button', { name: /runcastle/ })).toBeTruthy()
  })

  it('keeps symlinks out of the listing until Hidden is ticked', () => {
    show('/home/you/code')
    expect(screen.queryByRole('button', { name: /mirror/ })).toBeNull()

    fireEvent.click(screen.getByRole('checkbox'))

    const mirror = screen.getByRole('button', { name: /mirror/ })
    expect(mirror.textContent).toContain('link')
  })

  it('jumps to a root from the rail', () => {
    show('/home/you/code')
    expect(screen.getByRole('button', { name: /runcastle/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '~' }))

    expect(screen.queryByRole('button', { name: /runcastle/ })).toBeNull()
    expect(screen.getByRole('button', { name: /code/ })).toBeTruthy()
  })

  it('says so when a folder has nothing to descend into', () => {
    show('/home/you/code/runcastle')
    expect(screen.getByText(/No subfolders here/)).toBeTruthy()
  })

  it('owns up when the server stopped short of listing everything', () => {
    show('/home/you/huge')
    expect(screen.getByText(/Listing truncated/)).toBeTruthy()
  })

  it('commits the folder it is showing', () => {
    show('/home/you/code')
    fireEvent.click(openButton())

    expect(onPick).toHaveBeenCalledWith('/home/you/code')
  })

  it('backs out by Cancel and by Escape', () => {
    show('/home/you/code')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('carries no legacy class names the deleted rules would have beaten', () => {
    show('/home/you/code')
    // Unlayered legacy CSS wins over utilities whatever the specificity, so a
    // leftover `.dir-*` name would silently override the new styling.
    expect(screen.getByRole('dialog').outerHTML).not.toMatch(/class="[^"]*\b(dir-|peek)/)
  })
})
