import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * The intake copy, enforced. Both doors are one click apart on two surfaces —
 * the rail head and the project home — and each surface used to describe the
 * second door as "Quick … no conversation". The door is Draft now, and New is
 * the only way work is born, so the words are pinned here: prose drifts back, a
 * rendering sweep does not (same reasoning as `vocabulary-retired`).
 *
 * Tier-1 static markup (apps/web/STYLE.md): what is asserted is the words two
 * surfaces render, which the string already shows, so no DOM is opted into.
 */

// The SSE stream is a true boundary, and its status hook reads an external
// store with no server snapshot — the same stand-in `vocabulary-retired` uses.
vi.mock('../src/lib/live', () => ({ useLivePoll: () => false as const, useLiveStatus: () => 'live' }))
vi.mock('../src/trpc', () => ({
  trpc: {
    useUtils: () => ({ feature: { list: { invalidate: vi.fn() } } }),
    feature: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
      archive: { useMutation: () => ({ mutate: vi.fn() }) },
      unarchive: { useMutation: () => ({ mutate: vi.fn() }) },
      delete: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
    },
    project: {
      prep: { useQuery: () => ({ data: { prepared: true, pendingKeys: [], findings: [] } }) },
      list: { useQuery: () => ({ data: [{ id: 'project-1', name: 'Project' }] }) },
    },
  },
}))

import { EmptyWorkspace } from '../src/components/ProjectShell'
import { Sidebar } from '../src/components/Sidebar'
import { ToastProvider } from '../src/lib/toast'

/** The rail head, where the two doors sit side by side. */
function rail(): string {
  return renderToStaticMarkup(
    createElement(
      ToastProvider,
      null,
      createElement(Sidebar, {
        projectId: 'project-1',
        selectedFeatureId: null,
        projectSelected: false,
        width: 300,
        talk: { state: 'none' } as never,
        onSelect: () => undefined,
        onSelectProject: () => undefined,
        onNewChat: () => undefined,
        onDraft: () => undefined,
        onOpenPreparation: () => undefined,
        onResize: () => undefined,
      }),
    ),
  )
}

/** The project home, where the same two doors are said again. */
function home(): string {
  return renderToStaticMarkup(
    createElement(EmptyWorkspace, { onNewChat: () => undefined, onDraft: () => undefined }),
  )
}

/** Every tooltip the rail head hands out, in source order. */
function tooltips(html: string): string[] {
  return [...html.matchAll(/title="([^"]*)"/g)].map(([, title]) => title)
}

/** The one tooltip that opens with a door's name. */
function tooltipFor(door: string, html: string): string {
  const found = tooltips(html).filter((title) => title.startsWith(`${door} —`))
  expect(found, `${door} tooltip`).toHaveLength(1)
  return found[0]!
}

describe('the two intake doors', () => {
  it('sends features and quick changes through the conversation, on both surfaces', () => {
    expect(tooltipFor('New', rail())).toMatch(/conversation.+quick changes.+burn-ready tickets/)
    expect(home()).toMatch(/New is the door for both features and quick changes/)
  })

  it('offers the second door as a place to park an idea, not a shortcut past the chat', () => {
    expect(tooltipFor('Draft', rail())).toBe('Draft — write an idea down now, work it out later')

    const html = home()
    expect(html).toMatch(/<button[^>]*>Draft<\/button>/)
    expect(html).toMatch(/Draft writes an idea down now, to work out later/)
  })

  it('describes no door as Quick on either surface', () => {
    // Lower-case "quick changes" is the kind of work New takes, not a door.
    const railTooltips = tooltips(rail())
    expect(railTooltips.length).toBeGreaterThan(1)
    for (const tooltip of railTooltips) expect.soft(tooltip).not.toMatch(/\bQuick\b/)

    expect(home()).not.toMatch(/\bQuick\b/)
  })
})
