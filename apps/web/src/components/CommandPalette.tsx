import { useEffect, useMemo, useRef, useState } from 'react'
import { phaseGlyph } from '../lib/feature-ui'
import type { FeatureListItem } from '../lib/api'
import type { ProjectNavApi } from '../lib/use-project-nav'

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
  onNewFeature: () => void
  nav: ProjectNavApi
}

type Row =
  | { kind: 'feature'; feature: FeatureListItem }
  | { kind: 'project'; id: string; name: string; branch: string; current: boolean }
  | { kind: 'newFeature' }
  | { kind: 'home' }
  | { kind: 'openProject' }

export function CommandPalette(props: CommandPaletteProps) {
  const { open, onClose, features, selectedFeatureId, onSelect, onNewFeature, nav } = props

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

  const showNewFeature = 'create new feature'.includes(q)
  const showHome = 'all projects home'.includes(q)
  const showOpen = 'open a project'.includes(q)

  const rows = useMemo<Row[]>(() => {
    const r: Row[] = filteredFeatures.map((f) => ({ kind: 'feature' as const, feature: f }))
    for (const p of filteredProjects)
      r.push({ kind: 'project', id: p.id, name: p.name, branch: p.mainBranch, current: false })
    if (showNewFeature) r.push({ kind: 'newFeature' })
    if (showHome) r.push({ kind: 'home' })
    if (showOpen) r.push({ kind: 'openProject' })
    return r
  }, [filteredFeatures, filteredProjects, showNewFeature, showHome, showOpen])

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
      case 'newFeature':
        onNewFeature()
        break
      case 'home':
        nav.goHome()
        break
      case 'openProject':
        nav.showOpen()
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
                    <span className={`phase-fg-${f.phase}`}>{phaseGlyph(f.phase)}</span>
                  </span>
                  <span className="cmdk-item-label">{f.title}</span>
                  <span className="cmdk-item-slug">{f.slug}</span>
                  <span className="cmdk-item-hint">
                    {f.id === selectedFeatureId ? 'current' : f.phase}
                  </span>
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
                    <span className="cmdk-item-glyph">◫</span>
                    <span className="cmdk-item-label">{p.name}</span>
                    <span className="cmdk-item-slug">⎇ {p.mainBranch}</span>
                    <span className="cmdk-item-hint">project</span>
                  </div>
                )
              })}
            </>
          )}

          {(showNewFeature || showHome || showOpen) && (
            <>
              <div className="cmdk-group-label">Actions</div>
              {showNewFeature && (
                <ActionRow
                  index={projectsEnd}
                  activeIndex={activeIndex}
                  bindRow={bindRow}
                  setActiveIndex={setActiveIndex}
                  activate={activate}
                  glyph="+"
                  label="Create new feature"
                />
              )}
              {showHome && (
                <ActionRow
                  index={projectsEnd + (showNewFeature ? 1 : 0)}
                  activeIndex={activeIndex}
                  bindRow={bindRow}
                  setActiveIndex={setActiveIndex}
                  activate={activate}
                  glyph="⊞"
                  label="All projects (home)"
                />
              )}
              {showOpen && (
                <ActionRow
                  index={projectsEnd + (showNewFeature ? 1 : 0) + (showHome ? 1 : 0)}
                  activeIndex={activeIndex}
                  bindRow={bindRow}
                  setActiveIndex={setActiveIndex}
                  activate={activate}
                  glyph="◌"
                  label="Open a project…"
                />
              )}
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
  glyph: string
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
