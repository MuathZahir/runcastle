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
          useQuery: () => ({
            data: server.error ? undefined : { results: server.results, ok: false, tier1Ok: true },
            isLoading: false,
            error: server.error,
            refetch: () => {
              server.refetches += 1
            },
          }),
        },
        runtimeGuide: { useQuery: () => ({ data: undefined }) },
        startTerminal: { useMutation: mutation },
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

vi.mock('../src/lib/toast', () => ({ useToast: () => ({ push: () => undefined }) }))

import type { Probe } from '../src/components/EnableAfkCard'

const { BurnCacheRow, EnableAfkCard, ImageBuildAction } = await import(
  '../src/components/EnableAfkCard'
)

/** Shaped like the real `sandcastle-image` probe: tier 2, AFK-only, an error. */
const probe = (status: 'missing' | 'stale' | 'ok', fix?: string): Probe => ({
  id: 'sandcastle-image',
  label: 'Sandcastle image',
  tier: 2,
  status,
  severity: 'error',
  detail: `${status} image detail`,
  ...(fix ? { fix } : {}),
})

describe('EnableAfkCard image action', () => {
  const renderAction = (status: 'missing' | 'stale' | 'ok') =>
    renderToStaticMarkup(
      createElement(ImageBuildAction, {
        probe: probe(status),
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

  it('offers Rebuild image once an image is there', () => {
    expect(renderAction('stale')).toContain('Rebuild image')
    expect(renderAction('ok')).toContain('Rebuild image')
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

  it('keeps "Set up later" for the first-run wizard, and drops it everywhere else', () => {
    open()
    expect(screen.queryByRole('button', { name: 'Set up later' })).toBeNull()
    cleanup()

    render(createElement(EnableAfkCard, { onDismiss: () => undefined }))
    expect(screen.getByRole('button', { name: 'Set up later' })).toBeTruthy()
  })
})
