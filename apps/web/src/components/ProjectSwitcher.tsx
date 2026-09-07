import { repoFolderName } from '../lib/projects'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { IconCheck, IconChevronDown } from '../icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

/**
 * The breadcrumb's middle level (decision 11). Click the project name to drop a
 * menu of every open project (fast in-project switching that never disturbs
 * background runs), plus "All projects" (the portfolio home) and "Open a
 * project…". The command palette carries the same project mode for keyboarding.
 *
 * `min-w-0` runs all the way down to the name, or the flex default of
 * min-content wins and the ellipsis never engages (findings F20).
 *
 * Each project row carries its repo folder underneath (the onboarding flow's
 * decision 8): two projects can share a name — a fork and its original
 * routinely do — and the folder is the only thing on the row that tells them
 * apart.
 */

/*
 * The trigger states a background AND a border on purpose. There is no Tailwind
 * preflight while the legacy sheet lives (STYLE.md: "do not assume a reset:
 * style what you render"), so a `<button>` that names neither keeps the
 * user-agent `buttonface` — a light grey slab under this theme's near-white
 * text — and its outset border. It wants a border of its own to fade in on
 * hover, so it names a transparent one. The rows are the menu primitive's, and
 * are not buttons at all.
 */
const TRIGGER =
  'inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md border border-transparent px-1.5 ' +
  'bg-transparent transition-[border-color,background-color] duration-(--dur-1) ease-app ' +
  'hover:border-hairline hover:bg-panel-3'

/*
 * A project row reads at the app's 14px body scale — 11px is reserved for the
 * uppercase micro-labels (STYLE.md), and the menu that dropped at it read as a
 * different design system to the breadcrumb it hangs from.
 *
 * The size is stated here, on the row, rather than passed down to the menu
 * surface: the surface carries `DropdownMenuContent`'s own `text-xs` — the mono
 * 11px the docs menu wants — and Tailwind emits `text-xs` after `text-base`
 * whatever the class attribute says, so a size beside it silently loses. On the
 * row it is the row's own declaration and no ordering enters into it. Only the
 * family travels down (`font-sans` does sort after `font-mono`).
 *
 * The repo folder under each name keeps the 11px mono step of its own.
 */
const ROW = 'text-base'

export function ProjectSwitcher({ nav }: { nav: ProjectNavApi }) {
  const projects = nav.projects ?? []

  return (
    <div className="inline-flex min-w-0">
      <DropdownMenu>
        <DropdownMenuTrigger className={TRIGGER} title="Switch project">
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
        </DropdownMenuTrigger>

        <DropdownMenuContent className="min-w-60 font-sans">
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          {projects.map((p) => {
            const current = p.id === nav.currentProjectId
            return (
              <DropdownMenuItem
                key={p.id}
                className={ROW}
                aria-current={current ? 'true' : undefined}
                onSelect={() => nav.enterProject(p.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${current ? 'text-text' : ''}`}>{p.name}</span>
                  <span className="block truncate font-mono text-xs text-text-4">
                    {repoFolderName(p.repoPath)}
                  </span>
                </span>
                {current && (
                  <span className="inline-flex items-center text-accent-hi">
                    <IconCheck size={11} />
                  </span>
                )}
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem className={ROW} onSelect={() => nav.goHome()}>
            <span className="min-w-0 flex-1 truncate">All projects</span>
          </DropdownMenuItem>
          <DropdownMenuItem className={ROW} onSelect={() => nav.showOpen()}>
            <span className="min-w-0 flex-1 truncate">Open a project…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
