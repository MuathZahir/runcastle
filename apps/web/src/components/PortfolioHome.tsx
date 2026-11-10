import { portfolioEntries, portfolioTotals, type PortfolioEntry } from '../lib/portfolio'
import { useProjectFeatureLists } from '../lib/use-notifications'
import { useIsPhone } from '../lib/use-phone'
import type { ProjectNavApi } from '../lib/use-project-nav'
import { Button, cx, Page, PageHeader, PageTopbar } from '../ui'
import { IconHome, IconPlus } from '../icons'
import { ProjectCard, QuietProject } from './ProjectCard'
import { Frame } from './Frame'
import { SidebarBackdrop } from './SidebarParts'
import { PhoneRail } from './ProjectRail'

/**
 * All projects, the portfolio home (route `/`), as approved in
 * `preview/all-projects.html` (a-better-way-to-move-between-projects,
 * decision 4): a card for each project with something waiting on the human or
 * running, listing what waits and what runs; then one line for each quiet
 * project. Everything stays in the rail's order — the order `project.list`
 * returns — so a project sits in the same spot here as on the rail.
 *
 * It sits in the same frame as every project (DESIGN.md §Frame), right beside
 * the rail with no sidebar, as designed (the human dropped the slim sidebar it
 * once had; the theme toggle and status foot live in every project's sidebar).
 *
 * "Open a project" is the page's one primary (decision 7). Home is never reached
 * with no projects open (decision 3), so it has no empty state: the shell lands
 * on the first-project screen instead.
 */
export function PortfolioHome({ nav }: { nav: ProjectNavApi }) {
  const phone = useIsPhone()
  const projects = nav.projects ?? []

  // One feature.list per project — the same queries the tab title and the
  // rail read, so nothing here polls twice.
  const featureLists = useProjectFeatureLists(projects)
  const entries = portfolioEntries(projects, featureLists)

  const content = <PortfolioContent entries={entries} nav={nav} phone={phone} />

  // A phone has room for the list alone: no sidebar, no topbar, and no Open a
  // project, which needs the computer's folders. The rail's phone row sits
  // above the list, as on the project list screen.
  if (phone) {
    return (
      <div className="relative isolate flex h-dvh min-h-0 flex-col bg-canvas p-2">
        <SidebarBackdrop />
        <PhoneRail />
        <main className="-mx-2 min-h-0 flex-1 overflow-y-auto px-3 pt-4 pb-6">{content}</main>
      </div>
    )
  }

  return (
    <Frame rail>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageTopbar crumbs={[{ label: 'Projects', icon: <IconHome /> }]} />
        <Page routeKey="portfolio" width="wide" className="relative isolate">
          <SidebarBackdrop />
          {content}
        </Page>
      </section>
    </Frame>
  )
}

function PortfolioContent({ entries, nav, phone }: { entries: PortfolioEntry[]; nav: ProjectNavApi; phone: boolean }) {
  const totals = portfolioTotals(entries)
  const cards = entries.filter((e) => e.kind === 'card')
  const quiet = entries.filter((e) => e.kind === 'line')
  const grid = phone ? 'grid-cols-1' : 'grid-cols-3'
  return (
    <>
      <PageHeader
        title="Projects"
        meta={[
          { strong: totals.projects, text: totals.projects === 1 ? 'project open' : 'projects open' },
          totals.running > 0 && { tone: 'live', strong: totals.running, text: 'running' },
          totals.waiting > 0 && { tone: 'warning', strong: totals.waiting, text: totals.waiting === 1 ? 'needs you' : 'need you' },
        ]}
        actions={
          !phone && (
            <Button variant="primary" icon={<IconPlus />} onClick={nav.showOpen}>
              Open a project
            </Button>
          )
        }
      />
      {cards.length > 0 ? (
        <section aria-label="Busy projects" className={cx('mt-8 grid gap-3', grid)}>
          {cards.map((e) => (
            <ProjectCard
              key={e.project.id}
              entry={e}
              onOpen={() => nav.enterProject(e.project.id)}
              onOpenFeature={(slug) => nav.enterProject(e.project.id, slug)}
            />
          ))}
        </section>
      ) : (
        <p className="m-0 mt-8 px-3 text-sm text-text-tertiary">Nothing needs you and nothing is running.</p>
      )}
      {quiet.length > 0 && (
        <section aria-labelledby="portfolio-quiet">
          <h2 id="portfolio-quiet" className="m-0 mt-8 px-3 text-xs font-medium text-text-tertiary">
            Quiet
          </h2>
          <div className={cx('mt-1 grid gap-x-3', grid)}>
            {quiet.map((e) => (
              <QuietProject key={e.project.id} entry={e} onOpen={() => nav.enterProject(e.project.id)} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
