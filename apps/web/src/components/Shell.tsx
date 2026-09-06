import { useProjectNav } from '../lib/use-project-nav'
import { ProjectShell } from './ProjectShell'
import { PortfolioHome } from './PortfolioHome'
import { OpenProject } from './OpenProject'
import { FirstRunWizard } from './first-run/FirstRunWizard'
import { UpdateBanner } from './UpdateBanner'
import { DimLine } from '../ui'

/**
 * The runcastle app root (multi-project #45). Two levels: a portfolio *home* (a
 * card per open project) and the in-project IDE. `useProjectNav` decides where
 * to land — an unfinished setup meets the first-run wizard; a finished one with
 * nothing open gets the open-a-project screen; exactly one open project goes
 * straight into it; more than one lands on the home. Switching between them is
 * view-only, so background runs keep going.
 *
 * The update banner (issue #51) is an app-wide notice, so it lives at the root
 * rather than inside any single project — as the frame's own first ROW, above
 * whichever view is showing. It used to float fixed and top-center over
 * everything, covering doc-peek and Settings headers, the palette and feature
 * titles (findings F7); a row pushes content down instead of hiding it.
 */
export function Shell() {
  const nav = useProjectNav()

  let content

  // First load in flight — one quiet line, per the empty-state house style. The
  // list alone is not enough to place the user: until the doctor answers too,
  // showing anything risks showing onboarding to someone who is past it.
  if (nav.loading || nav.projects === undefined) {
    content = (
      <div className="app-loading">
        <DimLine>loading projects…</DimLine>
      </div>
    )
  } else if (nav.view === 'setup') {
    // The host still owes us a git identity or a coding agent: the full first-run
    // wizard (git identity → agents → AFK → project).
    content = <FirstRunWizard onOpened={nav.enterProject} onCancel={nav.cancelOpen} />
  } else if (nav.view === 'open') {
    // Setup is done, so this is the plain open screen — with nothing open there
    // is nowhere to cancel back to, which is all `firstRun` means here.
    content = (
      <OpenProject
        firstRun={nav.projects.length === 0}
        onOpened={nav.enterProject}
        onCancel={nav.cancelOpen}
      />
    )
  } else if (nav.view === 'project' && nav.currentProjectId) {
    content = <ProjectShell key={nav.currentProjectId} projectId={nav.currentProjectId} nav={nav} />
  } else {
    content = <PortfolioHome nav={nav} />
  }

  return (
    <div className="flex h-full flex-col">
      <UpdateBanner />
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  )
}
