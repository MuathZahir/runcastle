import { trpc } from '../trpc'
import { projectStats, runsElsewhere } from '../lib/projects'
import { useLivePoll } from '../lib/live'
import { modKey } from '../lib/platform'
import type { ProjectNavApi } from '../lib/use-project-nav'
import type { WorkspaceView } from '../lib/project-workspace'
import { Kbd } from '../ui'
import { IconPanelRight, IconSearch, IconSettings, LogoMark, LogoWordmark } from '../icons'
import { ProjectSwitcher } from './ProjectSwitcher'

/**
 * Every titlebar button says this for itself: there is no preflight, so an
 * unstyled `<button>` is grey and bordered, and the unlayered
 * `button { color: inherit }` beats a `text-*` utility written on the button
 * itself — the colour goes on a span inside (apps/web/STYLE.md).
 *
 * The *background* is not here, because the inspector toggle has two of them:
 * two utilities for one property on one element are a coin flip without
 * `tailwind-merge`, which this app deliberately does not have. Each button
 * states its own, exactly once.
 */
const TB_BUTTON =
  'group inline-flex cursor-pointer items-center rounded-md border-0 ' +
  'transition-colors duration-(--dur-1) ease-app hover:bg-panel-3'

/** The third crumb for the views that are not a feature (decision 11). */
const CRUMB_LABEL: Partial<Record<WorkspaceView, string>> = {
  project: 'Chat',
  prepare: 'Preparation',
}

/**
 * The IDE title bar (decision 11): a truthful three-level breadcrumb — brand ·
 * project switcher · the current thing — then a wide search launcher, the
 * cross-project runs pill, Settings, and the inspector toggle.
 *
 * The third level is the point. With real URLs underneath (decision 1) the
 * chrome has exactly one place that states location, which is what let the rail
 * rows drop their slugs; it names the selected feature, the chat or preparation,
 * and clicking it goes up to the project home.
 *
 * There is no health dot here any more (decision 7). The frame stated server
 * health twice, from two different queries that could disagree, and the status
 * bar's chip is the one that can name the origin it is talking to.
 */
export function Titlebar(props: TitlebarProps) {
  const projects = props.nav.projects ?? []

  // The pill counts runs in the OTHER projects (decision 7) — this project's
  // running work is already itemised by name in the rail's "Agent working"
  // lane, and a frame that repeats it is how four run counts with three
  // meanings happened.
  const poll = useLivePoll()
  const featureQueries = trpc.useQueries((t) =>
    projects.map((p) => t.feature.list({ projectId: p.id }, { refetchInterval: poll })),
  )
  const elsewhere = runsElsewhere(
    projects.map((p, i) => ({ projectId: p.id, ...projectStats(featureQueries[i]?.data ?? []) })),
    props.nav.currentProjectId,
  )

  return <TitlebarChrome {...props} runsElsewhere={elsewhere} />
}

interface TitlebarProps {
  nav: ProjectNavApi
  /**
   * Which surface owns the workspace body. The seam the titlebar redesign
   * consumes (decisions 5 and 11): the third breadcrumb level names the current
   * thing, and the inspector toggle is hidden where there is no inspector.
   */
  view: WorkspaceView
  /** The selected feature's title — the third crumb on a feature view. */
  featureTitle: string | null
  onOpenCmdk: () => void
  onOpenSettings: () => void
  /** Up one level from the third crumb: this project with nothing selected. */
  onGoToProjectHome: () => void
  onToggleInspector: () => void
  inspectorCollapsed: boolean
}

/**
 * The bar as markup, with every query already resolved to a value — the seam
 * the rendered-chrome tests observe it at (apps/web/STYLE.md, tier 1).
 */
export function TitlebarChrome({
  nav,
  view,
  featureTitle,
  runsElsewhere: elsewhere,
  onOpenCmdk,
  onOpenSettings,
  onGoToProjectHome,
  onToggleInspector,
  inspectorCollapsed,
}: TitlebarProps & { runsElsewhere: number }) {
  const projects = nav.projects ?? []
  const mod = modKey()
  const here = view === 'feature' ? featureTitle : (CRUMB_LABEL[view] ?? null)

  return (
    <header className="flex items-center gap-2 border-b border-hairline bg-panel px-3 text-base">
      <nav className="flex min-w-0 items-center gap-2" aria-label="Breadcrumb">
        <button
          className={`${TB_BUTTON} shrink-0 gap-2 bg-transparent px-2 py-1`}
          onClick={nav.goHome}
          title={projects.length > 1 ? 'All projects' : 'runcastle'}
        >
          <span className="inline-flex shrink-0 items-center">
            <LogoMark size={17} />
          </span>
          <LogoWordmark />
        </button>
        <Crumb />
        <ProjectSwitcher nav={nav} />
        {here && (
          <>
            <Crumb />
            <button
              className={`${TB_BUTTON} min-w-0 max-w-[34vw] bg-transparent px-2 py-1`}
              onClick={onGoToProjectHome}
              title="Back to the project home"
            >
              <span className="truncate text-base font-medium text-text">{here}</span>
            </button>
          </>
        )}
      </nav>

      <span className="flex-1" />

      {/* The shortcut is ⌘K on a Mac and Ctrl+K everywhere else, and the hint
          used to claim ⌘K for everyone (findings F17.4). */}
      <button
        className={
          'group inline-flex h-8 w-[300px] shrink-0 cursor-pointer items-center gap-2 rounded-md ' +
          'border border-hairline bg-panel-inset px-2.5 transition-colors duration-(--dur-1) ' +
          'ease-app hover:border-hairline-strong hover:bg-panel-3'
        }
        onClick={onOpenCmdk}
        title={`Search or jump to (${mod})`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-text-3 group-hover:text-text-2">
          <IconSearch size={13} />
          <span className="truncate">Search or jump to…</span>
        </span>
        <Kbd>{mod}</Kbd>
      </button>

      {elsewhere > 0 && (
        <button
          className={
            'inline-flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-pill border ' +
            'border-hairline bg-transparent px-2.5 transition-colors duration-(--dur-1) ease-app ' +
            'hover:border-hairline-strong hover:bg-panel-3'
          }
          onClick={nav.goHome}
          title="Runs in flight in other projects — open the portfolio"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-needs">
            <span className="spin-ring" />
            {elsewhere} running elsewhere
          </span>
        </button>
      )}

      <button
        className={`${TB_BUTTON} size-8 shrink-0 justify-center bg-transparent`}
        title="Settings"
        aria-label="Settings"
        onClick={onOpenSettings}
      >
        <span className="flex items-center text-text-3 group-hover:text-text">
          <IconSettings size={14} />
        </span>
      </button>

      {/* Feature views only: everywhere else the grid drops the column outright,
          so a toggle would offer to show a rail that does not exist (decision 5). */}
      {view === 'feature' && (
        <button
          className={`${TB_BUTTON} size-8 shrink-0 justify-center ${
            inspectorCollapsed ? 'bg-transparent' : 'bg-panel-3'
          }`}
          title={inspectorCollapsed ? 'Show details panel' : 'Hide details panel'}
          aria-label={inspectorCollapsed ? 'Show details panel' : 'Hide details panel'}
          onClick={onToggleInspector}
        >
          <span
            className={`flex items-center group-hover:text-text ${
              inspectorCollapsed ? 'text-text-3' : 'text-text-2'
            }`}
          >
            <IconPanelRight size={14} />
          </span>
        </button>
      )}
    </header>
  )
}

/** The separator between two breadcrumb levels. */
function Crumb() {
  return (
    <span className="shrink-0 text-sm text-text-4" aria-hidden="true">
      /
    </span>
  )
}
