import { repoFolderName } from '../lib/projects'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { IconCheck, IconChevronDown, IconFolder, IconHome, IconPlus, LogoMark } from '../icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

/**
 * The sidebar's head (DESIGN.md §Frame): the neutral mark, the current
 * project's name and a chevron — a menu of every open project (switching never
 * disturbs background runs), then "All projects" (the portfolio home) and
 * "Open a project…". The command palette carries the same project rows for
 * keyboarding.
 *
 * A project row carries its repo folder underneath when it tells the row apart
 * (the onboarding flow's decision 8): two projects can share a name — a fork
 * and its original routinely do — and the folder is then the only thing that
 * tells them apart. Where the folder is just the name again, it is left off.
 *
 * On the portfolio home there is no current project, and the trigger names the
 * app instead.
 */

/*
 * The trigger states a background AND a border: there is no preflight
 * (STYLE.md), so a `<button>` that names neither keeps the user agent's grey
 * slab and outset border. `min-w-0` runs all the way down to the name, or the
 * flex default of min-content wins and the ellipsis never engages (findings F20).
 */
const TRIGGER =
  'group flex h-8 min-w-0 cursor-pointer items-center gap-2 rounded-md border border-transparent bg-transparent pr-1.5 pl-2 ' +
  'text-text transition-colors duration-(--dur-1) ease-app hover:bg-surface-hover aria-expanded:bg-surface-selected'

/** A menu row reads at the UI default, like every other menu in the app. */
const ROW = 'text-sm'

export function ProjectSwitcher({ nav }: { nav: ProjectNavApi }) {
  const projects = nav.projects ?? []
  const name = nav.currentProject?.name ?? 'runcastle'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={TRIGGER} aria-label={`${name} — switch project`}>
        <LogoMark size={16} className="shrink-0" />
        {/* Truncated before it can push the row's buttons off (findings F20) —
            the title carries the whole name. */}
        <span className="max-w-56 min-w-0 truncate text-sm font-semibold" title={name}>
          {name}
        </span>
        <IconChevronDown
          size={14}
          className="shrink-0 text-icon transition-transform duration-(--dur-2) ease-app group-aria-expanded:rotate-180"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        {projects.map((p) => {
          const current = p.id === nav.currentProjectId
          const folder = repoFolderName(p.repoPath)
          // The folder says nothing a row's name has not already said, unless
          // the name is shared or the folder is called something else.
          const showFolder = folder !== p.name || projects.some((o) => o.id !== p.id && o.name === p.name)
          return (
            <DropdownMenuItem
              key={p.id}
              className={ROW}
              icon={<IconFolder />}
              aria-current={current ? 'true' : undefined}
              onSelect={() => nav.enterProject(p.id)}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                {showFolder && (
                  <span className="block truncate font-mono text-xs text-text-tertiary">{folder}</span>
                )}
              </span>
              {current && <IconCheck size={14} className="text-text" />}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem className={ROW} icon={<IconHome />} onSelect={() => nav.goHome()}>
          <span className="min-w-0 flex-1 truncate">All projects</span>
        </DropdownMenuItem>
        <DropdownMenuItem className={ROW} icon={<IconPlus />} onSelect={() => nav.showOpen()}>
          <span className="min-w-0 flex-1 truncate">Open a project…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
