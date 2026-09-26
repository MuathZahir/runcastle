import type { ReactNode } from 'react'
import { useProjectNav } from '../lib/use-project-nav'
import { ProjectShell } from './ProjectShell'
import { PortfolioHome } from './PortfolioHome'
import { OpenProject } from './OpenProject'
import { FirstRunWizard } from './first-run/FirstRunWizard'
import { UpdateBanner } from './UpdateBanner'
import { SetupCheckBanner } from './SetupCheckBanner'
import { Frame, FrameProvider } from './Frame'
import { Dialog, Page, Skeleton, SkeletonBar, cx } from '../ui'

/**
 * The runcastle app root (multi-project #45). Two levels: a portfolio *home*
 * and the in-project IDE. `useProjectNav` decides where to land — an unfinished
 * setup meets the first-run wizard; a finished one with nothing open gets the
 * open-a-project screen; exactly one open project goes straight into it; more
 * than one lands on the home. Switching between them is view-only, so
 * background runs keep going.
 *
 * Every screen sits in the same {@link Frame} — canvas, sidebar, content panel —
 * whose sidebar width and collapsed state are app-wide ({@link FrameProvider}).
 * The app-wide notices (update, setup check; issue #51) ride in through the
 * provider and are drawn as the panel's first row, above whichever view.
 */
export function Shell() {
  const nav = useProjectNav()

  let content
  let overlay: ReactNode = null

  // First load in flight. The list alone is not enough to place the user: until
  // the doctor answers too, showing anything risks showing onboarding to someone
  // who is past it. A doctor that FAILS has answered as far as this gate is
  // concerned — a broken probe never holds the project list.
  if (nav.loading || nav.projects === undefined) {
    // The frame is up at once, the page's shape in placeholder bars where the
    // page will be.
    content = (
      <Frame>
        <Page>
          <ProjectsSkeleton />
        </Page>
      </Frame>
    )
  } else if (nav.view === 'setup') {
    // The host still owes us a git identity or a coding agent: the full
    // first-run wizard (git identity → agents → AFK → project).
    content = (
      <Frame>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <FirstRunWizard onOpened={nav.enterProject} onCancel={nav.cancelOpen} />
        </div>
      </Frame>
    )
  } else if (nav.view === 'open' && nav.projects.length > 0) {
    // With somewhere to come back to, opening a project is a dialog over the
    // page it was asked for from — the portfolio, or the project the switcher
    // sits in — which stays mounted underneath, exactly as it was.
    // `content` stays in the same slot and type as it is without the dialog,
    // so opening it never remounts the page behind.
    content = nav.currentProjectId ? (
      <ProjectShell key={nav.currentProjectId} projectId={nav.currentProjectId} nav={nav} />
    ) : (
      <PortfolioHome nav={nav} />
    )
    overlay = (
      <Dialog open onClose={nav.cancelOpen} size="md" label="Open a project">
        <OpenProject variant="dialog" firstRun={false} onOpened={nav.enterProject} onCancel={nav.cancelOpen} />
      </Dialog>
    )
  } else if (nav.view === 'open') {
    // Setup is done, so this is the plain open screen — with nothing open there
    // is nowhere to cancel back to, which is all `firstRun` means here.
    content = (
      <Frame>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <OpenProject
            firstRun={nav.projects.length === 0}
            onOpened={nav.enterProject}
            onCancel={nav.cancelOpen}
          />
        </div>
      </Frame>
    )
  } else if (nav.view === 'project' && nav.currentProjectId) {
    content = <ProjectShell key={nav.currentProjectId} projectId={nav.currentProjectId} nav={nav} />
  } else {
    content = <PortfolioHome nav={nav} />
  }

  return (
    <FrameProvider
      notices={
        <>
          <UpdateBanner />
          <SetupCheckBanner error={nav.doctorError} onRecheck={nav.recheckDoctor} />
        </>
      }
    >
      <div className="h-full bg-canvas">
        {content}
        {overlay}
      </div>
    </FrameProvider>
  )
}

/** Name widths for the placeholder project rows. */
const SKELETON_ROW_WIDTHS = ['w-40', 'w-28', 'w-48'] as const

/**
 * The first load, before anything can be placed: the portfolio's shape — the
 * page title, its meta line, a divided list of project rows — on
 * `PageHeader`'s and `ListRow`'s metrics.
 */
export function ProjectsSkeleton() {
  return (
    <Skeleton label="Loading projects…">
      <div className="flex h-7 items-center" data-skeleton="title">
        <SkeletonBar className="h-5 w-32" />
      </div>
      <div className="mt-2 flex h-5 items-center">
        <SkeletonBar className="h-2.5 w-28" />
      </div>
      <div className="mt-8 flex flex-col">
        {SKELETON_ROW_WIDTHS.map((width, i) => (
          <div
            key={i}
            className="flex min-h-10 items-center gap-3 border-b border-border-subtle px-3 last:border-b-0"
            data-skeleton="project-row"
          >
            <SkeletonBar className="size-4" />
            <SkeletonBar className={cx('h-3', width)} />
            <SkeletonBar className="ml-auto h-2.5 w-16" />
          </div>
        ))}
      </div>
    </Skeleton>
  )
}
