import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FeatureListItem } from '../lib/api'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { PHASE_LABELS } from '../lib/feature-ui'
import { matchesPreparation, matchesProjectChat } from '../lib/project-workspace'
import { Kbd, PhaseDot } from '../ui'
import { IconFolder, IconMessage, IconSettings } from '../icons'

/**
 * ⌘K command palette for the pipeline-first shell (decision 12). Three labeled
 * groups — Features, Projects, Actions — over one flat row list, with
 * Linear/Raycast keyboarding: ↑↓ wrap, ↵ activates, esc closes. Query filters
 * features by slug/title, projects by name, and actions by their match terms;
 * switching a project from here never disturbs background runs.
 *
 * The palette opens on its whole hand. Every action is listed on an empty query
 * — hiding Preparation and Settings until the right noun was typed is what made
 * preparation unfindable in the first place, and a palette whose job is
 * discovery cannot ask you to already know the word. The group labels are
 * always drawn for the same reason: they say what the palette can find, whether
 * or not this query found any of it.
 *
 * Dependency-free (React only).
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
  | { kind: 'project'; id: string; name: string; current: boolean }
  | { kind: 'action'; action: Action }

interface Action {
  kind: ActionKind
  glyph: ReactNode
  label: string
  run: () => void
}

/** One selectable row. The colour is on the spans inside — see apps/web/STYLE.md. */
const ITEM_CLASS = 'flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-2'

/** The 11px uppercase micro-label over each group. */
const GROUP_CLASS = 'px-2.5 pt-2.5 pb-1 text-xs font-semibold tracking-[0.09em] text-text-4 uppercase'

/** A row's trailing note — the phase, "project", or "action". */
const HINT_CLASS = 'shrink-0 text-xs text-text-3'

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
  // The three whose terms are written here answer to the same rule: an empty
  // query shows the row, a typed one has to be found in its terms.
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
        kind: 'preparation',
        shows: matchesPreparation(q),
        glyph: <IconSettings size={13} />,
        label: 'Preparation — establish this repo’s commands and baseline',
        run: onOpenPreparation,
      },
      {
        kind: 'settings',
        shows: q === '' || 'settings preferences'.includes(q),
        glyph: <IconSettings size={13} />,
        label: 'Settings',
        run: onOpenSettings,
      },
      {
        kind: 'home',
        shows: q === '' || 'all projects home'.includes(q),
        glyph: <IconFolder size={13} />,
        label: 'All projects (home)',
        run: nav.goHome,
      },
      {
        kind: 'openProject',
        shows: q === '' || 'open a project'.includes(q),
        glyph: <IconFolder size={13} />,
        label: 'Open a project…',
        run: nav.showOpen,
      },
    ]
    return all.filter((a) => a.shows)
  }, [q, onOpenProjectChat, onOpenSettings, onOpenPreparation, nav])

  const rows = useMemo<Row[]>(() => {
    const r: Row[] = filteredFeatures.map((f) => ({ kind: 'feature' as const, feature: f }))
    for (const p of filteredProjects)
      r.push({ kind: 'project', id: p.id, name: p.name, current: false })
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
      // The palette can sit above Dialog-owned overlays such as Settings.
      // Do not let this same Escape reach Dialog's window listener after the
      // palette unmounts and focus returns to the overlay underneath it.
      e.stopPropagation()
      onClose()
    }
  }

  // Group boundaries in the flat row list (features | projects | actions).
  const featuresEnd = filteredFeatures.length
  const projectsEnd = featuresEnd + filteredProjects.length

  const bindRow = (i: number) => (el: HTMLDivElement | null) => {
    rowRefs.current[i] = el
  }

  const rowClass = (i: number) =>
    `${ITEM_CLASS} ${i === activeIndex ? 'bg-panel-3 text-text' : 'text-text-2'}`

  return (
    <div
      className="fixed inset-0 z-[300] flex animate-[backdropIn_var(--dur-2)_var(--ease-out-app)] items-start justify-center bg-[rgba(4,6,10,0.55)] px-4 pt-[12vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] animate-[cmdkIn_var(--dur-2)_var(--ease-out-app)] overflow-hidden rounded-lg border border-hairline-strong bg-panel shadow-overlay"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="h-12 w-full border-0 border-b border-hairline bg-transparent px-4 text-base text-text outline-none placeholder:text-text-3"
          placeholder="Search features, projects, or jump to…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Search features, projects, or jump to"
        />
        <div className="max-h-[340px] overflow-y-auto p-1.5">
          <div className={GROUP_CLASS}>Features</div>
          {filteredFeatures.map((f, i) => (
            <div
              key={f.id}
              ref={bindRow(i)}
              className={rowClass(i)}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => activate(i)}
            >
              <span className="flex w-3.5 shrink-0 justify-center">
                <PhaseDot phase={f.phase} />
              </span>
              <span className="min-w-0 flex-1 truncate" title={f.title}>
                {f.title}
              </span>
              {/* The phase column used to read "current" for the selected
                  feature, which meant the one feature you were most likely to be
                  checking never showed its phase (findings F10.8). Being
                  selected is a separate fact — it gets its own mark. */}
              {f.id === selectedFeatureId && (
                <span className="shrink-0 rounded-pill border border-accent-line px-1.5 text-xs text-accent-hi">
                  open
                </span>
              )}
              <span className={HINT_CLASS}>{PHASE_LABELS[f.phase] ?? f.phase}</span>
            </div>
          ))}

          <div className={GROUP_CLASS}>Projects</div>
          {filteredProjects.map((p, j) => {
            const i = featuresEnd + j
            return (
              <div
                key={p.id}
                ref={bindRow(i)}
                className={rowClass(i)}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => activate(i)}
              >
                <span className="flex w-3.5 shrink-0 justify-center text-text-3">
                  <IconFolder size={13} />
                </span>
                <span className="min-w-0 flex-1 truncate" title={p.name}>
                  {p.name}
                </span>
                <span className={HINT_CLASS}>project</span>
              </div>
            )
          })}

          <div className={GROUP_CLASS}>Actions</div>
          {actions.map((action, j) => {
            const i = projectsEnd + j
            return (
              <div
                key={action.kind}
                ref={bindRow(i)}
                className={rowClass(i)}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => activate(i)}
              >
                <span className="flex w-3.5 shrink-0 justify-center text-text-3">
                  {action.glyph}
                </span>
                <span className="min-w-0 flex-1 truncate" title={action.label}>
                  {action.label}
                </span>
                <span className={HINT_CLASS}>action</span>
              </div>
            )
          })}

          {rows.length === 0 && (
            <div className="p-6 text-center text-base text-text-3">No matches</div>
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-hairline px-3.5 py-2 text-xs text-text-3">
          <span className="flex items-center gap-1.5">
            <Kbd>↑↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> select
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
