import { useProjectNav } from '../lib/use-project-nav'
import { ProjectShell } from './ProjectShell'
import { PortfolioHome } from './PortfolioHome'
import { OpenProject } from './OpenProject'
import { UpdateBanner } from './UpdateBanner'
import { DimLine } from '../ui'

/**
 * The runcastle app root (multi-project #45). Two levels: a portfolio *home* (a
 * card per open project) and the in-project IDE. `useProjectNav` decides where
 * to land — a fresh install (no projects) drops straight into the open-a-project
 * flow; exactly one open project goes straight into it; more than one lands on
 * the home. Switching between them is view-only, so background runs keep going.
 *
 * The update banner (issue #51) floats above every view — it's a fixed-position,
 * app-wide notice, so it lives at the root rather than inside any single project.
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
  } else if (nav.view === 'open') {
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
    <>
      <UpdateBanner />
      {content}
    </>
  )
}
