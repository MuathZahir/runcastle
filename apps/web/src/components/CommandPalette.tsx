import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FeatureListItem } from '../lib/api'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { matchesPreparation, matchesProjectChat } from '../lib/project-workspace'
import { shortcut } from '../lib/platform'
import { useTheme } from '../lib/theme'
import { cx, Kbd } from '../ui'
import { FLOATING_ITEM, FLOATING_ITEM_DEFAULT, FLOATING_LABEL } from '../ui/floating'
import {
  IconFolder,
  IconHome,
  IconMoon,
  IconPanelLeft,
  IconPanelRight,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShield,
  IconSun,
  PHASE_NAME,
  PhaseIcon,
} from '../icons'

/**
 * ⌘K command palette (decision 12). Three labeled groups — Features, Projects,
 * Actions — over one flat row list, with Linear/Raycast keyboarding: ↑↓ wrap,
 * ↵ activates, esc closes. The query filters features by slug/title, projects
 * by name, and actions by their match terms; switching a project from here
 * never disturbs background runs.
 *
 * The palette opens on its whole hand. Every action is listed on an empty query
 * — hiding Preparation and Settings until the right noun was typed is what made
 * preparation unfindable in the first place, and a palette whose job is
 * discovery cannot ask you to already know the word. The group labels are
 * always drawn for the same reason: they say what the palette can find.
 */

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  features: FeatureListItem[]
  selectedFeatureId: string | null
  onSelect: (featureId: string) => void
  onOpenSettings: () => void
  /** Give the panel over to preparation (findings, evidence, the conversation). */
  onOpenPreparation: () => void
  /** Give the panel over to the project home — its conversation list. */
  onOpenProjectChat: () => void
  /** Open the note capture popover — the third door onto it (decisions #3). */
  onOpenNote: () => void
  /** Collapse or expand the sidebar (also ⌘/Ctrl B). */
  onToggleSidebar?: () => void
  /** Show or hide the feature's details panel — offered only on a feature. */
  onToggleDetails?: () => void
  nav: ProjectNavApi
}

type ActionKind =
  | 'home'
  | 'openProject'
  | 'settings'
  | 'preparation'
  | 'projectChat'
  | 'newNote'
  | 'theme'
  | 'sidebar'
  | 'details'

type Row =
  | { kind: 'feature'; feature: FeatureListItem }
  | { kind: 'project'; id: string; name: string }
  | { kind: 'action'; action: Action }

interface Action {
  kind: ActionKind
  glyph: ReactNode
  label: string
  kbd?: string
  run: () => void
}

/** Does a typed query find this row's words? An empty query finds everything. */
const finds = (q: string, terms: string) => q === '' || terms.includes(q)

export function CommandPalette(props: CommandPaletteProps) {
  const {
    open,
    onClose,
    features,
    selectedFeatureId,
    onSelect,
    onOpenSettings,
    onOpenPreparation,
    onOpenProjectChat,
    onOpenNote,
    onToggleSidebar,
    onToggleDetails,
    nav,
  } = props
  const theme = useTheme()

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  // Reset query + selection and grab focus each time the palette opens — again
  // a frame later, because a menu closing as the palette opens (Radix hands the
  // focus back to its trigger) would otherwise take it straight back.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.focus()
    const retry = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(retry)
  }, [open])

  // Escape closes the palette wherever the focus has wandered. The input's own
  // handler stops the key first (so a Dialog underneath never sees it); this
  // catches the rest.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Any filter change snaps the active row back to the top.
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const q = query.trim().toLowerCase()

  const filteredFeatures = useMemo(
    () =>
      q === ''
        ? features
        : features.filter((f) => f.slug.toLowerCase().includes(q) || f.title.toLowerCase().includes(q)),
    [features, q],
  )

  const otherProjects = useMemo(
    () => (nav.projects ?? []).filter((p) => p.id !== nav.currentProjectId),
    [nav.projects, nav.currentProjectId],
  )
  const filteredProjects = useMemo(
    () => (q === '' ? otherProjects : otherProjects.filter((p) => p.name.toLowerCase().includes(q))),
    [otherProjects, q],
  )

  // The project-scoped rows' terms live in lib/ because they are the
  // searchable half of their discoverability, and are tested there.
  const actions = useMemo<Action[]>(() => {
    const nextTheme = theme.resolved === 'dark' ? 'light' : 'dark'
    const all: (Action & { shows: boolean })[] = [
      {
        // New is a conversation (decisions.md #12): the chat's terms already
        // answer to the words someone types looking to start one.
        kind: 'projectChat',
        shows: matchesProjectChat(q),
        glyph: <IconHome />,
        label: 'Project chat',
        run: onOpenProjectChat,
      },
      {
        kind: 'newNote',
        shows: finds(q, 'new note jot capture'),
        glyph: <IconPencil />,
        label: 'New note',
        kbd: shortcut('J'),
        run: onOpenNote,
      },
      {
        kind: 'preparation',
        shows: matchesPreparation(q),
        glyph: <IconShield />,
        label: 'Preparation',
        run: onOpenPreparation,
      },
      {
        kind: 'settings',
        shows: finds(q, 'settings preferences'),
        glyph: <IconSettings />,
        label: 'Settings',
        run: onOpenSettings,
      },
      {
        kind: 'theme',
        shows: finds(q, `toggle theme dark light appearance ${nextTheme}`),
        glyph: theme.resolved === 'dark' ? <IconSun /> : <IconMoon />,
        label: `Toggle theme — switch to ${nextTheme}`,
        run: theme.toggle,
      },
      ...(onToggleSidebar
        ? [
            {
              kind: 'sidebar' as const,
              shows: finds(q, 'toggle sidebar hide show collapse expand'),
              glyph: <IconPanelLeft />,
              label: 'Toggle sidebar',
              kbd: shortcut('B'),
              run: onToggleSidebar,
            },
          ]
        : []),
      ...(onToggleDetails
        ? [
            {
              kind: 'details' as const,
              shows: finds(q, 'toggle details panel inspector hide show'),
              glyph: <IconPanelRight />,
              label: 'Toggle details panel',
              run: onToggleDetails,
            },
          ]
        : []),
      {
        kind: 'home',
        shows: finds(q, 'all projects home'),
        glyph: <IconFolder />,
        label: 'All projects',
        run: nav.goHome,
      },
      {
        kind: 'openProject',
        shows: finds(q, 'open a project'),
        glyph: <IconPlus />,
        label: 'Open a project…',
        run: nav.showOpen,
      },
    ]
    return all.filter((a) => a.shows)
  }, [
    q,
    theme.resolved,
    theme.toggle,
    onOpenProjectChat,
    onOpenNote,
    onOpenSettings,
    onOpenPreparation,
    onToggleSidebar,
    onToggleDetails,
    nav,
  ])

  const rows = useMemo<Row[]>(() => {
    const r: Row[] = filteredFeatures.map((f) => ({ kind: 'feature' as const, feature: f }))
    for (const p of filteredProjects) r.push({ kind: 'project', id: p.id, name: p.name })
    for (const action of actions) r.push({ kind: 'action', action })
    return r
  }, [filteredFeatures, filteredProjects, actions])

  if (!open) return null

  const move = (delta: number) => {
    if (rows.length === 0) return
    const next = (activeIndex + delta + rows.length) % rows.length
    setActiveIndex(next)
    rowRefs.current[next]?.scrollIntoView({ block: 'nearest' })
  }

  const activate = (index: number) => {
    const row = rows[index]
    if (!row) return
    switch (row.kind) {
      case 'feature':
        onSelect(row.feature.id)
        break
      case 'project':
        nav.enterProject(row.id)
        break
      case 'action':
        row.action.run()
        break
    }
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(activeIndex)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // The palette can sit above Dialog-owned overlays such as Settings. Do
      // not let this same Escape reach Dialog's window listener after the
      // palette unmounts and focus returns to the overlay underneath it.
      e.stopPropagation()
      onClose()
    }
  }

  const featuresEnd = filteredFeatures.length
  const projectsEnd = featuresEnd + filteredProjects.length

  const item = (i: number, key: string, glyph: ReactNode, label: ReactNode, trailing: ReactNode, title?: string) => (
    <div
      key={key}
      ref={(el) => {
        rowRefs.current[i] = el
      }}
      role="option"
      aria-selected={i === activeIndex}
      data-selected={i === activeIndex}
      className={cx(FLOATING_ITEM, FLOATING_ITEM_DEFAULT, 'min-h-8 hover:bg-transparent')}
      onMouseMove={() => i !== activeIndex && setActiveIndex(i)}
      onClick={() => activate(i)}
    >
      <span className="inline-flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">{glyph}</span>
      <span className="min-w-0 flex-1 truncate" title={title}>
        {label}
      </span>
      {trailing}
    </div>
  )

  const group = (label: string) => <div className={cx(FLOATING_LABEL, 'pt-2.5')}>{label}</div>

  return (
    <div
      className="fixed inset-0 z-[300] flex animate-backdrop-in items-start justify-center bg-scrim px-4 pt-[12vh] pb-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="flex max-h-[min(520px,76vh)] w-full max-w-[560px] animate-dialog-in flex-col overflow-hidden rounded-lg bg-surface-raised text-text shadow-dialog"
      >
        <div className="flex h-13 shrink-0 items-center gap-3 border-b border-border-subtle px-4">
          <IconSearch size={16} className="shrink-0 text-icon" />
          <input
            ref={inputRef}
            // `font-sans` because there is no preflight: an `<input>` keeps the
            // UA's own face and size unless it is told otherwise.
            className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 font-sans text-base text-text outline-none placeholder:text-text-tertiary"
            placeholder="Search features, projects, or jump to…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search features, projects, or jump to"
          />
        </div>
        <div role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {group('Features')}
          {filteredFeatures.map((f, i) =>
            item(
              i,
              f.id,
              <PhaseIcon phase={f.status === 'draft' ? 'draft' : f.phase} label="" />,
              f.title,
              <span className="flex shrink-0 items-center gap-2 text-xs text-text-tertiary">
                {/* Being open is its own fact, apart from the phase (findings F10.8). */}
                {f.id === selectedFeatureId && <span className="text-text-secondary">Current</span>}
                <span>{f.status === 'draft' ? PHASE_NAME.draft : PHASE_NAME[f.phase]}</span>
              </span>,
              f.title,
            ),
          )}
          {filteredFeatures.length === 0 && q !== '' && (
            <div className="px-2 py-1.5 text-xs text-text-tertiary">No features match</div>
          )}

          {group('Projects')}
          {filteredProjects.map((p, j) =>
            item(
              featuresEnd + j,
              p.id,
              <IconFolder className="text-icon" />,
              p.name,
              <span className="shrink-0 text-xs text-text-tertiary">Switch</span>,
              p.name,
            ),
          )}

          {group('Actions')}
          {actions.map((action, j) =>
            item(
              projectsEnd + j,
              action.kind,
              action.glyph,
              action.label,
              action.kbd ? <Kbd>{action.kbd}</Kbd> : null,
              action.label,
            ),
          )}

          {rows.length === 0 && <div className="p-6 text-center text-sm text-text-tertiary">No matches</div>}
        </div>
        <div className="flex shrink-0 items-center gap-4 border-t border-border-subtle px-4 py-2 text-xs text-text-tertiary">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Enter</Kbd> to open
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd> to close
          </span>
        </div>
      </div>
    </div>
  )
}
