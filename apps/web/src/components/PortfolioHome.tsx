import { trpc } from '../trpc'
import { projectStats } from '../lib/projects'
import { useLivePoll, useLiveStatus } from '../lib/live'
import { SANDBOX_MODE } from '../lib/env'
import { useTheme } from '../lib/theme'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { Button, cx, List, NavItem, Page, PageHeader, PageTopbar } from '../ui'
import { IconHome, IconPlus } from '../icons'
import { ProjectCard } from './ProjectCard'
import { CollapseSidebarButton, Frame } from './Frame'
import { ProjectSwitcher } from './ProjectSwitcher'
import { SidebarFootChrome } from './Sidebar'
import { SidebarBackdrop } from './SidebarParts'

/**
 * The portfolio home (issue #45): the canonical cross-project surface. One row
 * per open project — its name, its repo path, and what it is doing (features,
 * runs in flight, what needs you) — and a click through into the project.
 *
 * It sits in the same frame as every project (DESIGN.md §Frame) so moving
 * between the two never re-lays the window out; its sidebar is the minimal one —
 * the switcher, the two places this level has, and the status foot.
 *
 * What is live sits on top in the Working bay's own material, as on the
 * Conversations page: waiting before running, its edge lit while something
 * runs. With nothing live the bay is not there at all.
 *
 * "Open a project" is the page's one primary (decision 7). Home is never reached
 * with no projects open (decision 3), so it has no empty state: the shell lands
 * on the first-project screen instead.
 */
export function PortfolioHome({ nav }: { nav: ProjectNavApi }) {
  const projects = nav.projects ?? []

  // One feature.list per project — the rows' runs/needs-you are derived
  // client-side from the same polling every other surface shares.
  const poll = useLivePoll()
  const featureQueries = trpc.useQueries((t) =>
    projects.map((p) => t.feature.list({ projectId: p.id }, { refetchInterval: poll })),
  )
  const stats = projects.map((_, i) => projectStats(featureQueries[i]?.data ?? []))
  const running = stats.reduce((n, s) => n + s.activeRuns, 0)
  const waiting = stats.reduce((n, s) => n + s.needsYou, 0)

  const rows = projects.map((project, i) => ({
    project,
    stats: stats[i]!,
    loading: featureQueries[i]?.data === undefined,
  }))
  const live = rows
    .filter((r) => r.stats.needsYou > 0 || r.stats.activeRuns > 0)
    .sort((a, b) => b.stats.needsYou - a.stats.needsYou || b.stats.activeRuns - a.stats.activeRuns)
  const quiet = rows.filter((r) => !live.includes(r))
  const row = (r: (typeof rows)[number], i: number) => (
    <ProjectCard
      key={r.project.id}
      index={i}
      project={r.project}
      stats={r.stats}
      loading={r.loading}
      onOpen={() => nav.enterProject(r.project.id)}
    />
  )

  return (
    <Frame sidebar={<PortfolioSidebar nav={nav} />}>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageTopbar crumbs={[{ label: 'Projects', icon: <IconHome /> }]} />
        <Page routeKey="portfolio" className="relative isolate">
          <SidebarBackdrop />
          <PageHeader
            title="Projects"
            meta={[
              { strong: projects.length, text: projects.length === 1 ? 'project open' : 'projects open' },
              running > 0 && { tone: 'live', strong: running, text: 'running' },
              waiting > 0 && { tone: 'warning', strong: waiting, text: waiting === 1 ? 'needs you' : 'need you' },
            ]}
            actions={
              <Button variant="primary" icon={<IconPlus />} onClick={nav.showOpen}>
                Open a project
              </Button>
            }
          />
          {live.length > 0 && (
            <List
              divided
              label="Live projects"
              className={cx('card relative mt-8 rounded-lg p-1', running > 0 && 'orbit-light')}
            >
              {live.map(row)}
            </List>
          )}
          {quiet.length > 0 && (
            <List divided label="Open projects" className={live.length > 0 ? 'mt-4 px-1' : 'mt-8'}>
              {quiet.map((r, i) => row(r, i + live.length))}
            </List>
          )}
        </Page>
      </section>
    </Frame>
  )
}

/** The home's sidebar: the switcher, this level's two places, the status foot. */
function PortfolioSidebar({ nav }: { nav: ProjectNavApi }) {
  const live = useLiveStatus()
  const theme = useTheme()
  return (
    <nav aria-label="Projects" className="relative isolate flex h-full min-h-0 flex-col p-2">
      <SidebarBackdrop />
      <div className="flex h-10 shrink-0 items-center gap-0.5">
        <div className="flex min-w-0 flex-1">
          <ProjectSwitcher nav={nav} />
        </div>
        <CollapseSidebarButton />
      </div>
      <div className="mt-2 flex flex-col gap-px">
        <NavItem icon={<IconHome />} label="All projects" meta={nav.projects?.length} active />
      </div>
      <div className="flex-1" />
      <SidebarFootChrome
        health={live === 'live' ? 'ok' : live === 'connecting' ? 'connecting' : 'reconnecting'}
        origin={typeof window === 'undefined' ? 'this machine' : window.location.origin}
        sandbox={SANDBOX_MODE}
        notify={null}
        theme={theme.resolved}
        onToggleTheme={theme.toggle}
      />
    </nav>
  )
}
