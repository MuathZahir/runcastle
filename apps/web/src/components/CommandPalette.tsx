import { useEffect, useMemo, useRef, useState } from 'react'
import { phaseGlyph } from '../lib/feature-ui'
import type { FeatureListItem } from '../lib/api'

/**
 * ⌘K command palette for the pipeline-first shell (app-redesign). A single flat
 * list of navigable rows — features first, then actions — with Linear/Raycast
 * keyboarding: ↑↓ wrap, ↵ activates, esc closes. Query filters features by slug
 * or title; the "Create new feature" action shows when it matches the query.
 * Dependency-free (React only) — styling lives in the `.cmdk-*` classes.
 */

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  features: FeatureListItem[]
  selectedFeatureId: string | null
  onSelect: (featureId: string) => void
  onNewFeature: () => void
}

type Row =
  | { kind: 'feature'; feature: FeatureListItem }
  | { kind: 'action' }

export function CommandPalette(props: CommandPaletteProps) {
  const { open, onClose, features, selectedFeatureId, onSelect, onNewFeature } = props

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

  const showCreate = 'create new feature'.includes(q)

  const rows = useMemo<Row[]>(() => {
    const r: Row[] = filteredFeatures.map((f) => ({ kind: 'feature', feature: f }))
    if (showCreate) r.push({ kind: 'action' })
    return r
  }, [filteredFeatures, showCreate])

  if (!open) return null

  const createIndex = filteredFeatures.length

  const move = (delta: number) => {
    if (rows.length === 0) return
    const next = (activeIndex + delta + rows.length) % rows.length
    setActiveIndex(next)
    rowRefs.current[next]?.scrollIntoView({ block: 'nearest' })
  }

  const activate = (index: number) => {
    const row = rows[index]
    if (!row) return
    if (row.kind === 'feature') onSelect(row.feature.id)
    else onNewFeature()
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

  return (
    <div className="cmdk-backdrop" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Search features or jump to…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Search features or jump to"
        />
        <div className="cmdk-list">
          {filteredFeatures.length > 0 && (
            <>
              <div className="cmdk-group-label">Features</div>
              {filteredFeatures.map((f, i) => (
                <div
                  key={f.id}
                  ref={(el) => {
                    rowRefs.current[i] = el
                  }}
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
          {showCreate && (
            <>
              <div className="cmdk-group-label">Actions</div>
              <div
                ref={(el) => {
                  rowRefs.current[createIndex] = el
                }}
                className={`cmdk-item${createIndex === activeIndex ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(createIndex)}
                onClick={() => activate(createIndex)}
              >
                <span className="cmdk-item-glyph">+</span>
                <span className="cmdk-item-label">Create new feature</span>
                <span className="cmdk-item-hint">action</span>
              </div>
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
