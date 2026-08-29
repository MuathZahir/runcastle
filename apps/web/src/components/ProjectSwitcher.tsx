import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { repoFolderName } from '../lib/projects'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { IconCheck, IconChevronDown } from '../icons'

/**
 * Titlebar project switcher (issue #45). Click the project name to drop a menu
 * of every open project (fast in-project switching that never disturbs
 * background runs), plus "All projects" (the portfolio home) and "Open a
 * project…". The command palette carries the same project mode for keyboarding.
 *
 * Each project row carries its repo folder underneath (decision 8): two projects
 * can share a name — a fork and its original routinely do — and the folder is
 * the only thing on the row that tells them apart.
 *
 * The titlebar around this belongs to the project-shell flow; only this
 * component's own root and its classes are migrated here.
 */

/*
 * Both button class lists below name `bg-transparent` on purpose. There is no
 * Tailwind preflight while the legacy sheet lives (STYLE.md: "do not assume a
 * reset: style what you render"), so a `<button>` with no background utility of
 * its own keeps the user-agent `buttonface` — a light grey slab under this
 * theme's near-white text, which is what these rows rendered as when they were
 * first migrated. Trigger and rows let the panel behind them show through, and
 * only hover paints.
 */

const TRIGGER =
  'inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md border border-transparent px-1.5 ' +
  'bg-transparent transition-[border-color,background-color] duration-(--dur-1) ease-app ' +
  'hover:border-hairline hover:bg-panel-3'

const MENU =
  'absolute top-7.5 left-0 z-40 flex min-w-60 flex-col gap-0.5 rounded-lg ' +
  'border border-hairline bg-panel p-1.5 shadow-overlay'

const MENU_ITEM =
  'flex w-full items-center gap-2 rounded-md bg-transparent px-2 py-1.5 text-left text-text-2 ' +
  'transition-[color,background-color] duration-(--dur-1) ease-app hover:bg-panel-3 hover:text-text'

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
    <div className="relative inline-flex min-w-0" ref={ref}>
      <button
        className={TRIGGER}
        onClick={() => setOpen((v) => !v)}
        title="Switch project"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {/* Truncated before it can push the search box off the row (findings
            F20) — the title carries the whole name, so nothing is unreadable,
            only unshown. */}
        <span
          className="max-w-56 min-w-0 truncate text-sm text-text-2"
          title={nav.currentProject?.name}
        >
          {nav.currentProject?.name ?? '…'}
        </span>
        <span className="inline-flex items-center text-text-4">
          <IconChevronDown size={11} />
        </span>
      </button>

      {open && (
        <div className={MENU} role="menu">
          <div className="px-2 pt-1 pb-1 text-xs tracking-[0.08em] text-text-4 uppercase">
            Projects
          </div>
          {projects.map((p) => {
            const current = p.id === nav.currentProjectId
            return (
              <MenuItem
                key={p.id}
                current={current}
                onSelect={() => {
                  nav.enterProject(p.id)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-base ${current ? 'text-text' : ''}`}>
                    {p.name}
                  </span>
                  <span className="block truncate font-mono text-xs text-text-4">
                    {repoFolderName(p.repoPath)}
                  </span>
                </span>
                {current && (
                  <span className="inline-flex items-center text-accent-hi">
                    <IconCheck size={11} />
                  </span>
                )}
              </MenuItem>
            )
          })}
          <div className="my-1 h-px bg-hairline-soft" />
          <MenuItem
            onSelect={() => {
              nav.goHome()
              setOpen(false)
            }}
          >
            <span className="min-w-0 flex-1 truncate text-base">All projects</span>
          </MenuItem>
          <MenuItem
            onSelect={() => {
              nav.showOpen()
              setOpen(false)
            }}
          >
            <span className="min-w-0 flex-1 truncate text-base">Open a project…</span>
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  current,
  onSelect,
  children,
}: {
  current?: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button
      className={MENU_ITEM}
      role="menuitem"
      aria-current={current ? 'true' : undefined}
      onClick={onSelect}
    >
      {children}
    </button>
  )
}
