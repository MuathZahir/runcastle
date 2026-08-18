import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FeatureListItem } from '../lib/api'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { PHASE_LABELS } from '../lib/feature-ui'
import { matchesPreparation, matchesProjectChat } from '../lib/project-workspace'
import { IconFolder, IconMessage, IconSettings } from '../icons'

/**
 * ⌘K command palette for the pipeline-first shell (app-redesign, multi-project
 * #45). A single flat list of navigable rows — features, then projects, then
 * actions — with Linear/Raycast keyboarding: ↑↓ wrap, ↵ activates, esc closes.
 * Query filters features by slug/title and projects by name; switching a project
 * from here never disturbs background runs. Dependency-free (React only).
 */

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  features: FeatureListItem[]
  selectedFeatureId: string | null
  onSelect: (featureId: string) => void
  onOpenSettings: () => void
  /** Give the workspace over to preparation (findings, evidence, the conversation). */
  onOpenPreparation: () => void
  /** Give the workspace over to the project chat — its conversation list. */
  onOpenProjectChat: () => void
  nav: ProjectNavApi
}

/** The rows that are not a feature or a project: the palette's action list. */
type ActionKind = 'home' | 'openProject' | 'settings' | 'preparation' | 'projectChat'

type Row =
  | { kind: 'feature'; feature: FeatureListItem }
  | { kind: 'project'; id: string; name: string; branch: string; current: boolean }
  | { kind: 'action'; action: Action }

interface Action {
  kind: ActionKind
  glyph: ReactNode
  label: string
  run: () => void
}

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
    nav,
  } = props

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])

  // Reset query + selection and grab focus each time the palette opens.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.focus()
  }, [open])

  // Any filter change snaps the active row back to the top.
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const q = query.trim().toLowerCase()

  const filteredFeatures = useMemo(
    () =>
      q === ''
        ? features
        : features.filter(
            (f) => f.slug.toLowerCase().includes(q) || f.title.toLowerCase().includes(q),
          ),
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

  // Both project-scoped rows earn their place the same way: neither surface has
  // a home in the feature pipeline, so neither is reachable except through the
  // rail row someone has to already know about. Their terms live in lib/ because
  // they are the searchable half of that discoverability, and are tested there.
  const actions = useMemo<Action[]>(() => {
    const all: (Action & { shows: boolean })[] = [
      {
        // The palette used to open the NEW FEATURE overlay from a create row of
        // its own. That overlay is retired (decisions.md #12) and this row is
        // what replaced it: New is a conversation now, and the chat's terms
        // already answer to the words someone types looking to start one.
        kind: 'projectChat',
        shows: matchesProjectChat(q),
        glyph: <IconMessage size={13} />,
        label: 'Project chat — talk an idea through, or reopen a past conversation',
        run: onOpenProjectChat,
      },
      {
        kind: 'home',
        shows: 'all projects home'.includes(q),
        glyph: <IconFolder size={13} />,
        label: 'All projects (home)',
        run: nav.goHome,
      },
      {
        kind: 'openProject',
        shows: 'open a project'.includes(q),
        glyph: <IconFolder size={13} />,
        label: 'Open a project…',
        run: nav.showOpen,
      },
      {
        kind: 'settings',
        shows: 'settings preferences'.includes(q),
        glyph: <IconSettings size={13} />,
        label: 'Settings',
        run: onOpenSettings,
      },
      {
        kind: 'preparation',
        shows: matchesPreparation(q),
        glyph: <IconSettings size={13} />,
        label: 'Preparation — establish this repo’s commands and baseline',
        run: onOpenPreparation,
      },
    ]
    return all.filter((a) => a.shows)
  }, [q, onOpenProjectChat, onOpenSettings, onOpenPreparation, nav])

  const rows = useMemo<Row[]>(() => {
    const r: Row[] = filteredFeatures.map((f) => ({ kind: 'feature' as const, feature: f }))
    for (const p of filteredProjects)
      r.push({ kind: 'project', id: p.id, name: p.name, branch: p.mainBranch, current: false })
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
      onClose()
    }
  }

  // Group boundaries in the flat row list (features | projects | actions).
  const featuresEnd = filteredFeatures.length
  const projectsEnd = featuresEnd + filteredProjects.length

  const bindRow = (i: number) => (el: HTMLDivElement | null) => {
    rowRefs.current[i] = el
  }

  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Search features, projects, or jump to…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Search features, projects, or jump to"
        />
        <div className="cmdk-list">
          {filteredFeatures.length > 0 && (
            <>
              <div className="cmdk-group-label">Features</div>
              {filteredFeatures.map((f, i) => (
                <div
                  key={f.id}
                  ref={bindRow(i)}
                  className={`cmdk-item${i === activeIndex ? ' is-active' : ''}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => activate(i)}
                >
                  <span className="cmdk-item-glyph">
                    <span className={`feature-dot phase-bg-${f.phase}`} />
                  </span>
                  <span className="cmdk-item-label">{f.title}</span>
                  <span className="cmdk-item-slug">{f.slug}</span>
                  {/* The phase column used to read "current" for the selected
                      feature, which meant the one feature you were most likely
                      to be checking never showed its phase (findings F10.8).
                      Being selected is a separate fact — it gets its own mark. */}
                  {f.id === selectedFeatureId && <span className="cmdk-item-current">open</span>}
                  <span className="cmdk-item-hint">{PHASE_LABELS[f.phase] ?? f.phase}</span>
                </div>
              ))}
            </>
          )}

          {filteredProjects.length > 0 && (
            <>
              <div className="cmdk-group-label">Switch project</div>
              {filteredProjects.map((p, j) => {
                const i = featuresEnd + j
                return (
                  <div
                    key={p.id}
                    ref={bindRow(i)}
                    className={`cmdk-item${i === activeIndex ? ' is-active' : ''}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => activate(i)}
                  >
                    <span className="cmdk-item-glyph">
                      <IconFolder size={13} />
                    </span>
                    <span className="cmdk-item-label">{p.name}</span>
                    <span className="cmdk-item-slug">{p.mainBranch}</span>
                    <span className="cmdk-item-hint">project</span>
                  </div>
                )
              })}
            </>
          )}

          {actions.length > 0 && (
            <>
              <div className="cmdk-group-label">Actions</div>
              {actions.map((action, j) => (
                <ActionRow
                  key={action.kind}
                  index={projectsEnd + j}
                  activeIndex={activeIndex}
                  bindRow={bindRow}
                  setActiveIndex={setActiveIndex}
                  activate={activate}
                  glyph={action.glyph}
                  label={action.label}
                />
              ))}
            </>
          )}

          {rows.length === 0 && <div className="cmdk-empty">No matches</div>}
        </div>
        <div className="cmdk-foot">
          <span>
            <span className="kbd">↑↓</span> navigate
          </span>
          <span>
            <span className="kbd">↵</span> select
          </span>
          <span>
            <span className="kbd">esc</span> close
          </span>
        </div>
      </div>
    </div>
  )
}

function ActionRow({
  index,
  activeIndex,
  bindRow,
  setActiveIndex,
  activate,
  glyph,
  label,
}: {
  index: number
  activeIndex: number
  bindRow: (i: number) => (el: HTMLDivElement | null) => void
  setActiveIndex: (i: number) => void
  activate: (i: number) => void
  glyph: ReactNode
  label: string
}) {
  return (
    <div
      ref={bindRow(index)}
      className={`cmdk-item${index === activeIndex ? ' is-active' : ''}`}
      onMouseEnter={() => setActiveIndex(index)}
      onClick={() => activate(index)}
    >
      <span className="cmdk-item-glyph">{glyph}</span>
      <span className="cmdk-item-label">{label}</span>
      <span className="cmdk-item-hint">action</span>
    </div>
  )
}
