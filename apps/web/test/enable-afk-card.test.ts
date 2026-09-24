// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The prerequisites checklist (flow-redesign-settings, decision 9). Tier 2: the
 * summary counts what the doctor report says, a failed probe run has to offer a
 * Retry that actually refetches, and "exactly one solid button" is a question
 * about the whole card rather than about any one row.
 *
 * `setup.doctor` and friends are the seam — the card is a view over one report,
 * so the report is a fixture and the hooks are stubs.
 */
const server = vi.hoisted(() => ({
  results: [] as Record<string, unknown>[],
  error: null as { message: string } | null,
  refetches: 0,
  cancels: 0,
  /** The id `setup.startTerminal` hands back, and the terminal it mounted. */
  sessionId: 'build-image-1',
  terminal: null as { sessionId: string; onEnded?: () => void } | null,
  /** What the card asked `setup.doctor` about — the image row is per-project. */
  doctorInput: undefined as unknown,
  /** What `setup.imageBuildTarget` answers, and how it failed when it did. */
  imageTarget: {
    kind: 'stock',
    dockerfile: '/opt/runcastle/assets/sandbox/Dockerfile',
    tag: 'sandcastle:runcastle',
  } as Record<string, unknown> | undefined,
  imageTargetError: null as { message: string } | null,
  /** The notices `setup.startTerminal` hands back with its session id. */
  notices: [] as string[],
  /** Every message the card pushed through the toast hook. */
  toasts: [] as string[],
}))

vi.mock('../src/trpc', () => {
  const mutation = () => ({ isPending: false, mutate: () => undefined })
  return {
    trpc: {
      useUtils: () => ({
        setup: {
          doctor: {
            invalidate: () => undefined,
            cancel: () => {
              server.cancels += 1
              return Promise.resolve()
            },
          },
        },
        system: { burnCache: { status: { invalidate: () => undefined } } },
      }),
      setup: {
        doctor: {
          useQuery: (input: unknown) => {
            server.doctorInput = input
            return {
              data: server.error ? undefined : { results: server.results, ok: false, tier1Ok: true },
              isLoading: false,
              error: server.error,
              refetch: () => {
                server.refetches += 1
              },
            }
          },
        },
        runtimeGuide: { useQuery: () => ({ data: undefined }) },
        imageBuildTarget: {
          useQuery: () => ({ data: server.imageTarget, error: server.imageTargetError }),
        },
        startTerminal: {
          useMutation: (
            opts?: { onSuccess?: (r: { sessionId: string; notices: string[] }) => void },
          ) => ({
            isPending: false,
            mutate: () => opts?.onSuccess?.({ sessionId: server.sessionId, notices: server.notices }),
          }),
        },
        afkToken: { useMutation: mutation },
      },
      system: {
        burnCache: {
          status: { useQuery: () => ({ data: undefined }) },
          clear: { useMutation: mutation },
        },
      },
    } as unknown as typeof import('../src/trpc').trpc,
  }
})

vi.mock('../src/lib/toast', () => ({
  useToast: () => ({
    push: (message: string) => {
      server.toasts.push(message)
    },
  }),
}))

// xterm wants a laid-out canvas; the card only cares that the terminal is
// mounted and that it reports the PTY's exit, so the view is a stub that hands
// its props back to the test.
vi.mock('../src/components/TerminalView', () => ({
  TerminalView: (props: { sessionId: string; onEnded?: () => void }) => {
    server.terminal = props
    return createElement('div', { 'data-terminal': props.sessionId })
  },
}))

import type { ImageTargetState, Probe } from '../src/components/EnableAfkCard'

const { BurnCacheRow, EnableAfkCard, ImageBuildAction } = await import(
  '../src/components/EnableAfkCard'
)

/** The stock image the target resolver names when no project Dockerfile wins. */
const STOCK_TARGET = {
  kind: 'stock',
  dockerfile: '/opt/runcastle/assets/sandbox/Dockerfile',
  tag: 'sandcastle:runcastle',
}

/** Every state the image row can be in, as the doctor reports them. */
type ImageStatus = 'missing' | 'stale' | 'ok' | 'not-built-yet' | 'custom'

/** Shaped like the real `sandcastle-image` probe: tier 2, AFK-only, an error. */
const probe = (status: ImageStatus, fix?: string): Probe => ({
  id: 'sandcastle-image',
  label: 'Sandcastle image',
  tier: 2,
  status,
  severity: status === 'custom' ? 'info' : 'error',
  detail: `${status} image detail`,
  ...(fix ? { fix } : {}),
})

describe('EnableAfkCard image action', () => {
  const renderAction = (
    status: ImageStatus,
    fix?: string,
    target: ImageTargetState = {
      kind: 'ready',
      dockerfile: '/opt/runcastle/assets/sandbox/Dockerfile',
      tag: 'sandcastle:runcastle',
    },
  ) =>
    renderToStaticMarkup(
      createElement(ImageBuildAction, {
        probe: probe(status, fix),
        target,
        runtimeOk: true,
        pending: false,
        onStart: () => undefined,
      }),
    )

  // The page's one solid button is "Save & verify" (decision 9), so building the
  // image — however badly it is needed — is a ghost like everything else.
  it('offers Build image as a secondary action when the image is missing', () => {
    const html = renderAction('missing')
    expect(html).not.toContain('bg-accent')
    expect(html).toContain('Build image')
  })

  /** The label the operator reads, with every tag and attribute taken out. */
  const text = (html: string) => html.replace(/<[^>]*>/g, '')

  it('offers Rebuild image once an image is there', () => {
    expect(renderAction('stale')).toContain('Rebuild image')
    expect(renderAction('stale')).toContain('sandcastle:runcastle')
    expect(renderAction('ok')).toContain('Rebuild image')
  })

  // The tag is what names the image; the Dockerfile path it is built from is
  // long enough to push everything else off the row, and the tooltip — which
  // has room for both — is where it belongs.
  it('names the tag in the label and keeps the Dockerfile path in the tooltip', () => {
    const html = renderAction('stale')

    expect(text(html)).toContain('Rebuild image · sandcastle:runcastle')
    expect(text(html)).not.toContain('/opt/runcastle/assets/sandbox/Dockerfile')
    expect(html).toContain('title="Dockerfile: /opt/runcastle/assets/sandbox/Dockerfile')
  })

  // The project ships `.runcastle/sandbox/Dockerfile` and nothing has built it
  // yet: there is no image to *re*build, so the row reads like a first build.
  it('offers Build image for a project Dockerfile that has never been built', () => {
    const html = renderAction('not-built-yet', undefined, {
      kind: 'ready',
      dockerfile: '/work/acme/.runcastle/sandbox/Dockerfile',
      tag: 'sandcastle:runcastle-proj_acme',
    })
    expect(html).toContain('Build image')
    expect(html).not.toContain('Rebuild image')
    expect(html).toContain('title="Dockerfile: /work/acme/.runcastle/sandbox/Dockerfile')
    expect(html).toContain('sandcastle:runcastle-proj_acme')
  })

  // A refusal is an answer, and the reason carries the way out of it — so the
  // row says it, the way the custom-probe row says its fix.
  it('says why a refused target is nobody to rebuild, in place of the button', () => {
    const reason = 'acme/sandbox:v3 is a custom image managed outside runcastle — clear it.'
    const html = renderAction('stale', undefined, { kind: 'refused', reason })

    expect(html).not.toContain('<button')
    expect(html).toContain(reason)
  })

  it('waits on the tag only while the target query is still out', () => {
    const html = renderAction('stale', undefined, { kind: 'loading' })

    expect(text(html)).toContain('Rebuild image · resolving…')
    expect(html).toContain('disabled')
  })

  // A failed query is settled, so the wait ends: the button says what it can
  // and the row says what went wrong instead of resolving forever.
  it('stops waiting and shows the error when the target query fails', () => {
    const message = 'imageBuildTarget: project not found'
    const html = renderAction('stale', undefined, { kind: 'error', message })

    expect(text(html)).not.toContain('resolving')
    expect(text(html)).toContain('Rebuild image')
    expect(html).toContain(message)
    expect(html).toContain('disabled')
  })

  // Decision 5 — the whole point: a Rebuild here would build the stock template
  // under the operator's own tag and destroy their image.
  it('disarms the button for an image runcastle does not manage, and says why', () => {
    const fix = 'clear the sandbox image setting, or commit a .runcastle/sandbox/Dockerfile'
    const html = renderAction('custom', fix)
    expect(html).not.toContain('<button')
    expect(html).toContain(fix)
  })
})

/**
 * Decision 6 — the operator can see how much disk the project's burn cache
 * volume holds and drop it in one click, and is told why when a burn is using
 * it. The row exists only where the cache does: `burnCache: 'off'` (and any
 * sandbox that has no volumes) is exactly the behaviour that predates it.
 */
describe('EnableAfkCard burn cache row', () => {
  const volumeName = 'runcastle-proj_abc123def456'
  const renderRow = (
    status: Parameters<typeof BurnCacheRow>[0]['status'],
    over: { pending?: boolean; refusal?: string | null } = {},
  ) =>
    renderToStaticMarkup(
      createElement(BurnCacheRow, {
        status,
        pending: over.pending ?? false,
        refusal: over.refusal ?? null,
        onClear: () => undefined,
      }),
    )

  const volumeStatus = { mode: 'volume' as const, engine: 'docker' as const, volumeName }

  it('shows the volume, its size and a Clear button', () => {
    const html = renderRow({ ...volumeStatus, sizeBytes: 2_400_000_000 })
    expect(html).toContain(volumeName)
    expect(html).toContain('2.4 GB')
    expect(html).toContain('Clear')
    expect(html).toContain('data-field="burn-cache"')
  })

  it('reads a volume that does not exist yet as empty', () => {
    expect(renderRow({ ...volumeStatus, sizeBytes: null })).toContain('empty')
  })

  it('renders nothing when the cache is off', () => {
    const off = { mode: 'off' as const, engine: null, volumeName, sizeBytes: null }
    expect(renderRow(off)).toBe('')
    expect(renderRow(undefined)).toBe('')
  })

  // The refusal is the only feedback the click gives, and it names the slots
  // the operator has to stop — a toast that scrolls away would lose it.
  it('renders the refusal inline when a burn is holding the cache', () => {
    const refusal = 'burn cache is in use — slots 1, 2 are held'
    expect(renderRow({ ...volumeStatus, sizeBytes: 10 }, { refusal })).toContain(refusal)
  })
})

/** The four probes the checklist is built from, all healthy. */
const readyReport = () => [
  {
    id: 'container-runtime',
    label: 'Container runtime (Docker / Podman)',
    tier: 2,
    status: 'ok',
    severity: 'error',
    detail: 'Docker version 28.5.2',
  },
  {
    id: 'sandcastle-image',
    label: 'Sandcastle image',
    tier: 2,
    status: 'ok',
    severity: 'error',
    detail: 'sandcastle:runcastle present',
  },
  {
    id: 'afk-token',
    label: 'Claude Code AFK OAuth token (CLAUDE_CODE_OAUTH_TOKEN)',
    tier: 2,
    status: 'ok',
    severity: 'error',
    detail: 'OAuth token present',
    runtime: 'claude-code',
    check: 'afk-key',
  },
  {
    id: 'codex-auth',
    label: 'Codex login (interactive sessions)',
    tier: 2,
    status: 'ok',
    severity: 'error',
    detail: 'credentials found at ~/.codex/auth.json',
    runtime: 'codex',
    check: 'auth',
  },
]

describe('EnableAfkCard prerequisites checklist', () => {
  beforeEach(() => {
    server.results = readyReport()
    server.error = null
    server.refetches = 0
    server.cancels = 0
    server.imageTarget = { ...STOCK_TARGET }
    server.imageTargetError = null
  })
  afterEach(cleanup)

  const open = () => render(createElement(EnableAfkCard, {}))

  it('opens on the summary and one named row per prerequisite', () => {
    open()

    expect(screen.getByText('Ready for unattended burns')).toBeTruthy()
    for (const label of ['Container runtime', 'Sandcastle image', 'Claude Code token', 'Codex']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    // The kicker, the title and the paragraph that opened the old card are gone.
    expect(screen.queryByText('ENABLE AFK BURNS')).toBeNull()
    expect(screen.queryByText('Run features unattended')).toBeNull()
    expect(screen.queryByText(/AFK burns run each feature to completion/)).toBeNull()
  })

  it('counts what is ready and names the first thing in the way', () => {
    server.results = readyReport().map((r) =>
      r.id === 'afk-token' ? { ...r, status: 'unset', detail: 'no CLAUDE_CODE_OAUTH_TOKEN' } : r,
    )
    open()

    expect(screen.getByText(/3 of 4/).parentElement?.textContent).toContain(
      '3 of 4 ready — burns with Claude Code need a token',
    )
  })

  it('gives every row a deep-link target', () => {
    const { container } = open()

    expect([...container.querySelectorAll('[data-field]')].map((el) => el.getAttribute('data-field'))).toEqual([
      'container-runtime',
      'sandcastle-image',
      'afk-key-claude-code',
      'auth-codex',
    ])
  })

  it('shows exactly one solid button — the token this whole list exists for', () => {
    const { container } = open()

    const solid = [...container.querySelectorAll('button')].filter((b) =>
      b.className.includes('bg-accent'),
    )
    expect(solid.map((b) => b.textContent)).toEqual(['Save & verify'])
  })

  it('offers a Retry rather than a dead end when the probe run fails', async () => {
    server.error = { message: 'docker: no such host' }
    open()

    expect(screen.getByText('docker: no such host')).toBeTruthy()
    // Cancel first: a re-check has to be able to interrupt a probe still out.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })
    expect(server.cancels).toBe(1)
    expect(server.refetches).toBe(1)
  })

  // The image a burn runs in is a fact about the repo, so the row has to ask
  // about the open project — the wizard, which may run before any project
  // exists, asks the machine-wide question instead.
  it('asks the doctor about the open project, and about no project in the wizard', () => {
    render(createElement(EnableAfkCard, { projectId: 'proj_java' }))
    expect(server.doctorInput).toEqual({ projectId: 'proj_java' })
    cleanup()

    open()
    expect(server.doctorInput).toBeUndefined()
  })

  // An image the operator tagged and manages themselves is not a gap in their
  // setup — a burn has an image, it is simply not one runcastle can rebuild.
  it('counts an image managed outside runcastle as ready', () => {
    server.results = readyReport().map((r) =>
      r.id === 'sandcastle-image'
        ? {
            ...r,
            status: 'custom',
            severity: 'info',
            detail: 'acme/sandbox:v3 is a custom image, managed outside runcastle',
          }
        : r,
    )
    open()

    expect(screen.getByText('Ready for unattended burns')).toBeTruthy()
  })

  // …but one that is not built is still in the way, even though runcastle
  // cannot build it: the burn will not find an image at all.
  it('still counts a custom image that is not built as a gap', () => {
    server.results = readyReport().map((r) =>
      r.id === 'sandcastle-image'
        ? { ...r, status: 'custom', detail: 'acme/sandbox:v3 … is not built locally' }
        : r,
    )
    open()

    expect(screen.queryByText('Ready for unattended burns')).toBeNull()
    expect(screen.getByText(/3 of 4/)).toBeTruthy()
  })

  // The bug this row was rewritten for: a refused target used to be mapped to
  // undefined on its way into the button, which left it disabled and reading
  // "resolving Dockerfile → resolving tag" over an answer the server had given.
  // The probe need not agree — that divergence is what produced the report.
  it('renders a refused build target instead of waiting on it', () => {
    const reason = 'acme/sandbox:v3 is a custom image — clear the sandbox image setting.'
    server.imageTarget = { kind: 'refused', imageName: 'acme/sandbox:v3', reason }
    open()

    expect(screen.getByText(reason)).toBeTruthy()
    expect(screen.queryByText(/resolving/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Rebuild image' })).toBeNull()
  })

  it('names the failure rather than resolving forever when the target query errors', () => {
    server.imageTarget = undefined
    server.imageTargetError = { message: 'imageBuildTarget: project not found' }
    open()

    expect(screen.getByText('imageBuildTarget: project not found')).toBeTruthy()
    expect(screen.queryByText(/resolving/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Rebuild image' }).hasAttribute('disabled')).toBe(
      true,
    )
  })

  it('keeps "Set up later" for the first-run wizard, and drops it everywhere else', () => {
    open()
    expect(screen.queryByRole('button', { name: 'Set up later' })).toBeNull()
    cleanup()

    render(createElement(EnableAfkCard, { onDismiss: () => undefined }))
    expect(screen.getByRole('button', { name: 'Set up later' })).toBeTruthy()
  })
})

/**
 * The image build runs in a server-owned PTY, and the PTY already tells the
 * client when its process exits — so the card re-checks itself rather than
 * waiting for the operator to notice the build finished and click. The button
 * stays: an exit that never arrives (a socket that dies mid-build) still needs
 * a way out.
 */
describe('EnableAfkCard image build terminal', () => {
  beforeEach(() => {
    server.results = readyReport().map((r) =>
      r.id === 'sandcastle-image' ? { ...r, status: 'missing', detail: 'no sandcastle image' } : r,
    )
    server.error = null
    server.refetches = 0
    server.cancels = 0
    server.terminal = null
    server.imageTarget = { ...STOCK_TARGET }
    server.imageTargetError = null
    server.notices = []
    server.toasts = []
  })
  afterEach(cleanup)

  /** Open the card and start the build, so its terminal is mounted. */
  const build = () => {
    const rendered = render(createElement(EnableAfkCard, {}))
    fireEvent.click(screen.getByRole('button', { name: 'Build image' }))
    return rendered
  }

  it('re-checks the doctor report when the build process exits, without a click', async () => {
    build()
    expect(server.terminal?.sessionId).toBe('build-image-1')
    expect(server.refetches).toBe(0)

    await act(async () => {
      server.terminal?.onEnded?.()
    })

    expect(server.cancels).toBe(1)
    expect(server.refetches).toBe(1)
  })

  // The build output is what says *why* a build failed, so an exit re-checks in
  // place and leaves the log up; dismissing it stays the operator's call.
  it('keeps the terminal and its manual re-check up after the exit', async () => {
    const { container } = build()

    await act(async () => {
      server.terminal?.onEnded?.()
    })

    expect(container.querySelector('[data-terminal]')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done — re-check' }))
    })
    expect(container.querySelector('[data-terminal]')).toBeNull()
    expect(server.refetches).toBe(2)
  })

  // A host CLI version the server could not read does not stop the build — it
  // goes ahead unpinned — but the human hears why, next to the build they started.
  it('names each build notice as a toast while the build still starts', () => {
    server.notices = ["Could not read the host's Codex version (`codex --version` exited 1)"]
    build()
    expect(server.terminal?.sessionId).toBe('build-image-1')
    expect(server.toasts).toEqual(server.notices)
  })
})
