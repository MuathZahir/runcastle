import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TitlebarChrome } from '../src/components/Titlebar'
import { StatusBarChrome, type StatusBarState } from '../src/components/StatusBar'
import type { ProjectNavApi } from '../src/lib/use-project-nav'
import type { WorkspaceView } from '../src/lib/project-workspace'

/**
 * The two bars as they render (decisions 7, 8, 11). Tier-1 static markup
 * (apps/web/STYLE.md): both surfaces are pure markup once their queries have
 * answered, which is exactly what `TitlebarChrome` and `StatusBarChrome` take.
 *
 * What is pinned here is what each bar *states* — a truthful third breadcrumb
 * level, one health indicator, one run count that says whose runs it is, and a
 * branch bound to the view rather than to whatever was selected last.
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

function titlebar(over: {
  view: WorkspaceView
  featureTitle?: string | null
  runsElsewhere?: number
}): string {
  return renderToStaticMarkup(
    createElement(TitlebarChrome, {
      nav,
      featureTitle: null,
      runsElsewhere: 0,
      onOpenCmdk: () => undefined,
      onOpenSettings: () => undefined,
      onGoToProjectHome: () => undefined,
      onToggleInspector: () => undefined,
      inspectorCollapsed: false,
      ...over,
    }),
  )
}

function statusbar(over: Partial<StatusBarState> = {}): string {
  return renderToStaticMarkup(
    createElement(StatusBarChrome, {
      branch: null,
      onCopyBranch: () => undefined,
      driving: null,
      onStopDrive: () => undefined,
      stopPending: false,
      notify: {
        state: 'off',
        label: 'notify off',
        title: 'Notify me when agents finish a run',
        onToggle: () => undefined,
      },
      live: 'live',
      healthy: true,
      origin: 'http://localhost:4513',
      ...over,
    }),
  )
}

describe('titlebar breadcrumb', () => {
  it('names the selected feature as the third level', () => {
    const html = titlebar({ view: 'feature', featureTitle: 'Flow redesign: project shell' })

    expect(html).toContain('runcastle')
    expect(html).toContain('Flow redesign: project shell')
    expect(html).toContain('Back to the project home')
  })

  it('names the chat and preparation views instead of a feature', () => {
    expect(titlebar({ view: 'project' })).toContain('Chat')
    expect(titlebar({ view: 'prepare' })).toContain('Preparation')
  })

  it('states only two levels where there is no current thing', () => {
    const html = titlebar({ view: 'empty' })

    expect(html).not.toContain('Back to the project home')
    expect(html).toContain('runcastle')
  })

  it('keeps the wide search field and its mod-key chip', () => {
    const html = titlebar({ view: 'empty' })

    expect(html).toContain('Search or jump to…')
    expect(html).toMatch(/<kbd[^>]*>(⌘K|Ctrl\+K)<\/kbd>/)
  })
})

/**
 * Decision 7 — the frame stated server health twice from two different queries
 * that could disagree, and counted runs four times with three meanings.
 */
describe('titlebar runs pill', () => {
  it('is absent when nothing is running elsewhere', () => {
    expect(titlebar({ view: 'empty', runsElsewhere: 0 })).not.toContain('running elsewhere')
  })

  it('says whose runs it is counting', () => {
    expect(titlebar({ view: 'empty', runsElsewhere: 3 })).toContain('3 running elsewhere')
  })

  it('carries no health dot of its own — the status bar owns that', () => {
    const html = titlebar({ view: 'feature', featureTitle: 'A feature' })

    expect(html).not.toMatch(/server (ok|down)/)
    expect(html).not.toContain('server healthy')
  })
})

/** Decision 5 — off a feature there is no inspector column to toggle. */
describe('titlebar inspector toggle', () => {
  it('is offered on a feature view', () => {
    expect(titlebar({ view: 'feature', featureTitle: 'A feature' })).toContain(
      'Hide details panel',
    )
  })

  it('is hidden everywhere else', () => {
    for (const view of ['project', 'prepare', 'create', 'empty'] as const)
      expect(titlebar({ view })).not.toContain('details panel')
  })
})

describe('status bar', () => {
  it('states the branch when the view has one, and click-copies it', () => {
    const html = statusbar({ branch: 'feature/flow-redesign' })

    expect(html).toContain('feature/flow-redesign')
    expect(html).toContain('Copy branch name')
  })

  /**
   * Decision 8 — the bar used to keep the previous feature's branch up on chat
   * and preparation, stating a stale fact as though it were current.
   */
  it('states no branch at all where the view has no feature', () => {
    const html = statusbar({ branch: null })

    expect(html).not.toContain('Copy branch name')
  })

  it('keeps the sandbox, notify, live and server segments', () => {
    const html = statusbar()

    expect(html).toContain('notify off')
    expect(html).toContain('Notify me when agents finish a run')
    expect(html).toContain('live')
    expect(html).toContain('server ok')
    expect(html).toContain('runcastle API at http://localhost:4513/api')
  })

  it('keeps the driving segment and its stop button', () => {
    const html = statusbar({ driving: { featureId: 'f1', branch: 'feature/x' } })

    expect(html).toContain('driving')
    expect(html).toContain('stop')
  })

  /** Decision 7 — the rail's "Agent working" lane already itemises these. */
  it('never counts the runs of the project it is in', () => {
    const html = statusbar({ branch: 'feature/x' })

    expect(html).not.toMatch(/\d+ runs?\b/)
  })
})
