import { useEffect, useRef, useState } from 'react'
import type { ProjectNavApi } from '../lib/use-project-nav'

/**
 * Titlebar project switcher (issue #45). Click the project name to drop a menu
 * of every open project (fast in-project switching that never disturbs
 * background runs), plus "All projects" (the portfolio home) and "Open a
 * project…". The command palette carries the same project mode for keyboarding.
 */
export function ProjectSwitcher({ nav }: { nav: ProjectNavApi }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const projects = nav.projects ?? []

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="tb-switcher" ref={ref}>
      <button
        className="tb-switcher-btn"
        onClick={() => setOpen((v) => !v)}
        title="Switch project"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="tb-project">{nav.currentProject?.name ?? '…'}</span>
        <span className="tb-switcher-caret">▾</span>
      </button>

      {open && (
        <div className="tb-menu" role="menu">
          <div className="tb-menu-label">Projects</div>
          {projects.map((p) => (
            <button
              key={p.id}
              className={`tb-menu-item${p.id === nav.currentProjectId ? ' is-current' : ''}`}
              role="menuitem"
              onClick={() => {
                nav.enterProject(p.id)
                setOpen(false)
              }}
            >
              <span className="tb-menu-name">{p.name}</span>
              <span className="tb-menu-branch mono">⎇ {p.mainBranch}</span>
              {p.id === nav.currentProjectId && <span className="tb-menu-check">✓</span>}
            </button>
          ))}
          <div className="tb-menu-sep" />
          <button
            className="tb-menu-item"
            role="menuitem"
            onClick={() => {
              nav.goHome()
              setOpen(false)
            }}
          >
            <span className="tb-menu-name">All projects</span>
          </button>
          <button
            className="tb-menu-item"
            role="menuitem"
            onClick={() => {
              nav.showOpen()
              setOpen(false)
            }}
          >
            <span className="tb-menu-name">Open a project…</span>
          </button>
        </div>
      )}
    </div>
  )
}
