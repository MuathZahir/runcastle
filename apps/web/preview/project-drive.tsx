import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { ToastProvider } from '../src/lib/toast'
import { applyStoredTheme } from '../src/lib/theme'
import { Page as PageColumn } from '../src/ui'
import { ProjectDriveView } from '../src/components/project/ProjectDriveView'
import { TestDriveCard } from '../src/components/project/TestDriveCard'
import { scenarioMenu } from '../src/lib/feature-ui/scenarios'
import type { SlotDrive } from '../src/lib/use-project-drive'
import { installSilentEventSource } from '../../../.runcastle/preview/event-source'
import { PROJECT_ID, project, withShell } from '../../../.runcastle/preview/shell-fakes'
import { DRIVE_MOMENTS, PROJECT_DRIVE, PROJECT_NOTES, SCENARIOS } from './drive-data'
import { Api, MomentBar, useClickAfterLoad, useMoment } from './drive-kit'

/**
 * The Orchestrator's test drive (docs/features/test-drive-looks-the-part): the
 * project page's Test drive row with its scenario picker, and the project drive
 * as the page, the same page a feature's drive is. Real components over faked
 * server answers; a dead end on purpose.
 */

applyStoredTheme()
installSilentEventSource()
document.addEventListener(
  'click',
  (e) => {
    if ((e.target as Element | null)?.closest?.('a[href]')) e.preventDefault()
  },
  true,
)

const noop = () => {}

interface Moment {
  key: string
  label: string
  /** The live drive, or null for the resting page with its Test drive row. */
  drive: SlotDrive | null
  click?: string
}

const asProject = (d: SlotDrive | null): SlotDrive =>
  ({ ...PROJECT_DRIVE, ...d, featureId: undefined, branch: 'main', projectDrive: true }) as SlotDrive

const MOMENTS: Moment[] = [
  { key: 'running', label: 'Driving main', drive: PROJECT_DRIVE },
  { key: 'picker', label: 'Picking a scenario', drive: PROJECT_DRIVE, click: '[data-scenario-trigger]' },
  { key: 'starting', label: 'Starting', drive: asProject(DRIVE_MOMENTS.find((m) => m.key === 'starting')!.drive) },
  { key: 'setup-failed', label: 'Setup failed', drive: asProject(DRIVE_MOMENTS.find((m) => m.key === 'setup-failed')!.drive) },
  { key: 'rest', label: 'Before the drive', drive: null, click: '[aria-label="Choose a scenario"]' },
]

function fakesFor(moment: Moment) {
  const notes = PROJECT_NOTES(Date.now())
  return withShell({
    feature: {
      driveInfo: () => moment.drive,
      driveScenarios: () => ({ scenarios: SCENARIOS, runnerConfigured: true }),
    },
    projectNotes: { openCount: () => notes.length, list: () => notes },
  } as Parameters<typeof withShell>[0])
}

function Body({ moment }: { moment: Moment }) {
  useClickAfterLoad(moment.click)
  if (!moment.drive) {
    return (
      <div className="flex min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-surface">
        <PageColumn routeKey="rest">
          <h1 className="m-0 mb-8 text-xl font-semibold text-text">{project.name}</h1>
          <TestDriveCard
            card={{ state: 'ready' }}
            branch="main"
            setupCommand="bun run db:reset"
            devCommand="bun run dev"
            starting={false}
            scenarios={scenarioMenu(SCENARIOS, { withOwnSection: false, runnerConfigured: true })}
            onStart={noop}
            onPrepare={noop}
            onReturn={noop}
          />
        </PageColumn>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface">
      <ProjectDriveView
        projectId={PROJECT_ID}
        repoPath={project.repoPath}
        drive={moment.drive}
        onBack={noop}
        onStop={noop}
        stopping={false}
        onOpenPreparation={noop}
      />
    </div>
  )
}

function Root() {
  const [moment, setMoment] = useMoment(MOMENTS)
  return (
    <div className="flex h-screen flex-col bg-canvas">
      <MomentBar moments={MOMENTS} current={moment.key} onPick={setMoment} />
      <div className="flex min-h-0 flex-1 p-2">
        <Api key={moment.key} fakes={fakesFor(moment)}>
          <Body moment={moment} />
        </Api>
      </div>
    </div>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root not found')
createRoot(rootEl).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
)
