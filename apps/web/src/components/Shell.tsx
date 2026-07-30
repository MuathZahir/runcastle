import { useProjectNav } from '../lib/use-project-nav'
import { ProjectShell } from './ProjectShell'
import { PortfolioHome } from './PortfolioHome'
import { OpenProject } from './OpenProject'
import { FirstRunWizard } from './FirstRunWizard'
import { UpdateBanner } from './UpdateBanner'
import { DimLine } from '../ui'

/**
 * The runcastle app root (multi-project #45). Two levels: a portfolio *home* (a
 * card per open project) and the in-project IDE. `useProjectNav` decides where
 * to land — a fresh install (no projects) drops straight into the open-a-project
 * flow; exactly one open project goes straight into it; more than one lands on
 * the home. Switching between them is view-only, so background runs keep going.
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

  // First list load in flight — one quiet line, per the empty-state house style.
  if (nav.projects === undefined) {
    content = (
      <div className="app-loading">
        <DimLine>loading projects…</DimLine>
      </div>
    )
  } else if (nav.view === 'open' && nav.projects.length === 0) {
    // Fresh data dir: the full first-run wizard (git identity → AFK → project).
    content = <FirstRunWizard onOpened={nav.enterProject} onCancel={nav.cancelOpen} />
  } else if (nav.view === 'open') {
    content = (
      <OpenProject
        firstRun={false}
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
    <div className="app-frame">
      <UpdateBanner />
      <div className="app-frame-body">{content}</div>
    </div>
  )
}
