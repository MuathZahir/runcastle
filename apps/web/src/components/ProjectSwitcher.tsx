import { useEffect, useRef, useState } from 'react'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { IconCheck, IconChevronDown } from '../icons'

/**
 * There is no preflight, so every button here states its own reset; and the
 * unlayered `button { color: inherit }` beats a `text-*` utility written on the
 * button, so the colour lives on a span inside (apps/web/STYLE.md).
 */
const SWITCHER_BUTTON =
  'group inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md border-0 ' +
  'bg-transparent px-2 py-1 transition-colors duration-(--dur-1) ease-app hover:bg-panel-3'

/** A row in the dropped menu. */
const MENU_ITEM =
  'group flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent ' +
  'px-2 py-1.5 text-left transition-colors duration-(--dur-1) ease-app hover:bg-panel-3'

/**
 * The breadcrumb's middle level (decision 11). Click the project name to drop a
 * menu of every open project (fast in-project switching that never disturbs
 * background runs), plus "All projects" (the portfolio home) and "Open a
 * project…". The command palette carries the same project mode for keyboarding.
 *
 * `min-w-0` runs all the way down to the name, or the flex default of min-content
 * wins and the ellipsis never engages (findings F20).
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
    <div className="relative inline-flex min-w-0" ref={ref}>
      <button
        className={SWITCHER_BUTTON}
        onClick={() => setOpen((v) => !v)}
        title="Switch project"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {/* Truncated when long (findings F20) — the title carries the whole
            name so nothing is unreadable, only unshown. */}
        <span
          className="truncate font-medium text-text-2 group-hover:text-text"
          title={nav.currentProject?.name}
        >
          {nav.currentProject?.name ?? '…'}
        </span>
        <span className="flex shrink-0 items-center text-text-4">
          <IconChevronDown size={11} />
        </span>
      </button>

      {open && (
        <div
          className="absolute top-8 left-0 z-40 min-w-60 rounded-lg border border-hairline bg-panel p-1 shadow-menu"
          role="menu"
        >
          <div className="px-2 pt-1.5 pb-1 text-xs tracking-[0.08em] text-text-4 uppercase">
            Projects
          </div>
          {projects.map((p) => (
            <button
              key={p.id}
              className={MENU_ITEM}
              role="menuitem"
              onClick={() => {
                nav.enterProject(p.id)
                setOpen(false)
              }}
            >
              <span
                className={`min-w-0 flex-1 truncate group-hover:text-text ${
                  p.id === nav.currentProjectId ? 'text-text' : 'text-text-2'
                }`}
              >
                {p.name}
              </span>
              {p.id === nav.currentProjectId && (
                <span className="flex shrink-0 items-center text-accent-hi">
                  <IconCheck size={11} />
                </span>
              )}
            </button>
          ))}
          <div className="mx-1 my-1.5 h-px bg-hairline-soft" />
          <button
            className={MENU_ITEM}
            role="menuitem"
            onClick={() => {
              nav.goHome()
              setOpen(false)
            }}
          >
            <span className="min-w-0 flex-1 truncate text-text-2 group-hover:text-text">
              All projects
            </span>
          </button>
          <button
            className={MENU_ITEM}
            role="menuitem"
            onClick={() => {
              nav.showOpen()
              setOpen(false)
            }}
          >
            <span className="min-w-0 flex-1 truncate text-text-2 group-hover:text-text">
              Open a project…
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
