import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CommandPalette } from '../src/components/CommandPalette'
import type { FeatureListItem } from '../src/lib/api'
import type { ProjectNavApi } from '../src/lib/use-project-nav'

/**
 * What the palette shows, and when (decision 12). Tier-1 static markup
 * (apps/web/STYLE.md): the palette's opening hand is exactly the markup it
 * emits before anything is typed.
 *
 * The keyboarding — ↑↓ wrap, ↵, Escape above another dialog — is DOM behaviour
 * and lives in `command-palette.test.tsx`.
 */
const nav: ProjectNavApi = {
  projects: [
    { id: 'p1', name: 'runcastle', repoPath: '/repo/runcastle' },
    { id: 'p2', name: 'terminal-wait-game', repoPath: '/repo/twg' },
  ],
  loading: false,
  view: 'project',
  currentProjectId: 'p1',
  currentProject: { id: 'p1', name: 'runcastle', repoPath: '/repo/runcastle' },
  goHome: () => undefined,
  enterProject: () => undefined,
  showOpen: () => undefined,
  cancelOpen: () => undefined,
}

function listItem(over: Partial<FeatureListItem> = {}): FeatureListItem {
  return {
    id: 'feat_1',
    projectId: 'p1',
    slug: 'flow-redesign-project-shell',
    title: 'Flow redesign: project shell and navigation',
    oneLiner: '',
    mapped: false,
    phase: 'implementation',
    branch: 'feature/flow-redesign-project-shell',
    baseBranch: 'main',
    status: 'active',
    createdAt: 0,
    ticketCounts: { total: 0, pending: 0, burning: 0, done: 0, failed: 0, cancelled: 0 },
    activeRun: false,
    liveSession: null,
    lastActivityAt: 0,
    ...over,
  } as FeatureListItem
}

function palette(features: FeatureListItem[] = [], selectedFeatureId: string | null = null): string {
  return renderToStaticMarkup(
    createElement(CommandPalette, {
      open: true,
      onClose: () => undefined,
      features,
      selectedFeatureId,
      onSelect: () => undefined,
      onOpenSettings: () => undefined,
      onOpenPreparation: () => undefined,
      onOpenProjectChat: () => undefined,
      nav,
    }),
  )
}

/** The five rows that are not a feature or a project. */
const ACTIONS = [
  'Project chat',
  'Preparation',
  'Settings',
  'All projects (home)',
  'Open a project…',
]

describe('command palette on an empty query', () => {
  it('labels all three groups', () => {
    const html = palette([listItem()])

    expect(html).toContain('Features')
    expect(html).toContain('Projects')
    expect(html).toContain('Actions')
  })

  it('labels the groups even when a group has nothing in it', () => {
    const html = palette([])

    expect(html).toContain('Features')
    expect(html).toContain('Projects')
  })

  /**
   * Hiding Preparation and Settings until the right noun was typed defeats the
   * palette's discoverability role — the exact failure that made preparation
   * unfindable before it had a row at all.
   */
  it('shows its whole hand of actions', () => {
    const html = palette()

    for (const action of ACTIONS) expect(html).toContain(action)
  })

  it('offers every project but the one already open', () => {
    const html = palette()

    expect(html).toContain('terminal-wait-game')
  })
})

describe('command palette feature rows', () => {
  it('names the phase and marks the one already open', () => {
    const html = palette([listItem()], 'feat_1')

    expect(html).toContain('Flow redesign: project shell and navigation')
    expect(html).toContain('build') // PHASE_LABELS.implementation
    expect(html).toContain('open')
  })

  it('marks nothing as open when the palette is opened off a feature', () => {
    const html = palette([listItem()], null)

    expect(html).not.toContain('>open<')
  })

  it('gives the title the readable treatment it has in the rail', () => {
    const html = palette([listItem()])

    expect(html).toContain('truncate')
    expect(html).toContain('title="Flow redesign: project shell and navigation"')
  })
})
