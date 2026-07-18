import { useProjectNav } from '../lib/use-project-nav'
import { ProjectShell } from './ProjectShell'
import { PortfolioHome } from './PortfolioHome'
import { OpenProject } from './OpenProject'
import { DimLine } from '../ui'

/**
 * The runcastle app root (multi-project #45). Two levels: a portfolio *home* (a
 * card per open project) and the in-project IDE. `useProjectNav` decides where
 * to land — a fresh install (no projects) drops straight into the open-a-project
 * flow; exactly one open project goes straight into it; more than one lands on
 * the home. Switching between them is view-only, so background runs keep going.
 */
export function Shell() {
  const nav = useProjectNav()

  // First list load in flight — one quiet line, per the empty-state house style.
  if (nav.projects === undefined) {
    return (
      <div className="app-loading">
        <DimLine>loading projects…</DimLine>
      </div>
    )
  }

  if (nav.view === 'open') {
    return (
      <OpenProject
        firstRun={nav.projects.length === 0}
        onOpened={nav.enterProject}
        onCancel={nav.cancelOpen}
      />
    )
  }

  if (nav.view === 'project' && nav.currentProjectId) {
    return <ProjectShell key={nav.currentProjectId} projectId={nav.currentProjectId} nav={nav} />
  }

  return <PortfolioHome nav={nav} />
}
