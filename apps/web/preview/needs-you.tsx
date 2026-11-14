import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '../src/theme.css'
import '../src/styles.css'
import { TooltipProvider } from '../src/ui/tooltip'
import { SidebarFeatureRow } from '../src/components/SidebarParts'
import { WorkerStatusLine } from '../src/components/workers/WorkerParts'
import { FeatureStatusLine } from '../src/components/workspace/FeatureStatusLine'
import { featureStatus } from '../src/lib/feature-ui/status-line'
import { workerStatusWhy } from '../src/lib/workers'
import { applyStoredTheme } from '../src/lib/theme'
import { featuresWith, mixed, OPEN_TITLE } from './workers-sidebar-data'

/**
 * Needs you is the agent's call (docs/features/needs-you-is-the-agent-s-call):
 * a feature's row with its workers nested under it, each worker row reading
 * its own need, else Working while a turn runs, else Idle; beside it the
 * status lines a feature and a worker show. A dead end: nothing opens.
 */

applyStoredTheme()

const noop = () => {}
const open = featuresWith(1).find((f) => f.title === OPEN_TITLE)!
const header = mixed[0]!
const needs = featureStatus({ feature: open, need: open.need, working: true, agentWorking: true, workersWorking: 2, driving: false, selfPlanning: false, declared: false })
const lines: { label: string; line: React.ReactNode }[] = [
  { label: 'Feature, a worker needs you (beats Working)', line: <FeatureStatusLine status={needs} onOpenThread={noop} /> },
  { label: 'Feature, working', line: <FeatureStatusLine status={featureStatus({ feature: open, need: null, working: true, agentWorking: false, workersWorking: 0, driving: false, selfPlanning: false, declared: false })} /> },
  { label: 'Feature, idle', line: <FeatureStatusLine status={featureStatus({ feature: open, need: null, working: false, agentWorking: false, workersWorking: 0, driving: false, selfPlanning: false, declared: false })} /> },
  { label: 'Feature, merged', line: <FeatureStatusLine status={featureStatus({ feature: { status: 'shipped' }, need: null, working: false, agentWorking: false, workersWorking: 0, driving: false, selfPlanning: false, declared: false })} /> },
  { label: 'Worker header, needing you', line: <WorkerStatusLine status={header.status} why={workerStatusWhy(header)!} /> },
  { label: 'Worker header, idle', line: <WorkerStatusLine status="idle" /> },
]

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <div className="flex h-screen gap-6 bg-canvas p-3">
        <div className="flex w-[264px] shrink-0 flex-col">
          <SidebarFeatureRow
            f={open}
            active
            onSelect={noop}
            actions={[]}
            onNewThread={noop}
            workers={{ entries: mixed, withDone: true, current: null, onOpen: noop, actionsFor: () => [] }}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4 pt-4">
          {lines.map(({ label, line }) => (
            <div key={label} className="flex flex-col gap-1">
              <span className="text-xs text-text-tertiary">{label}</span>
              {line}
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  </StrictMode>,
)
