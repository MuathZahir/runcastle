import { useState } from 'react'
import type { DriveScenario } from '@runcastle/core'
import { Button, IconButton, StatusLabel } from '../../ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../ui/dropdown-menu'
import { IconChevronDown, IconPlus, IconTerminal, IconX } from '../../icons'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { scenarioFailureLine, scenarioMenu, scenarioTarget } from '../../lib/feature-ui/scenarios'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'
import { DrivePanel } from './DrivePanel'
import { ScenarioMenuItems } from './ScenarioMenuItems'

/** The live drive as the scenario controls read it — `driveInfo`'s slice. */
export interface ScenarioDriveInfo {
  devUrl: string
  scenario?: DriveScenario
  scenarioSessionId?: string
}

/**
 * A human's running drive with its scenarios (drive-scenarios decisions 3, 7,
 * 8): the Scenario menu in the panel's toolbar switches scenario without a
 * restart, the panel follows each landing, a running scenario shows its output
 * and a failed one its actual error with Fix it, and the scenario chat docks
 * beside the panel — never in the Chat tab, which would hide the panel the
 * result lands in.
 *
 * `featureId` is set on a feature drive (its own scenarios list first, notes
 * land on the feature); absent on a project drive.
 */
export function ScenarioDrive({
  projectId,
  featureId,
  drive,
}: {
  projectId: string
  featureId?: string
  drive: ScenarioDriveInfo
}) {
  const toast = useToast()
  const utils = trpc.useUtils()
  const scenariosQ = trpc.feature.driveScenarios.useQuery(
    featureId ? { projectId, featureId } : { projectId },
  )
  const menu = scenarioMenu(scenariosQ.data?.scenarios ?? [], {
    withOwnSection: !!featureId,
    runnerConfigured: scenariosQ.data?.runnerConfigured ?? false,
  })
  const refresh = () => void utils.feature.driveInfo.invalidate()
  const run = trpc.feature.runScenario.useMutation({
    onSuccess: (res) => {
      refresh()
      if (!res.ok) toast.push(res.denied)
    },
    onError: (e) => toast.push(e.message),
  })
  // The session this browser just opened, so the dock shows before the drive's
  // poll has caught up with it.
  const [opened, setOpened] = useState<string | null>(null)
  const openChat = trpc.feature.openScenarioChat.useMutation({
    onSuccess: (res) => {
      refresh()
      setOpened(res.sessionId)
      setHidden(null)
    },
    onError: (e) => toast.push(e.message),
  })
  // Closing the dock only hides it; ＋ New scenario brings the same chat back.
  const [hidden, setHidden] = useState<string | null>(null)
  const [ended, setEnded] = useState<readonly string[]>([])
  // Blank app: back to the plain URL, until the next landing takes it again.
  const [blankOver, setBlankOver] = useState<string | null>(null)

  const scenario = drive.scenario
  const blank = !!scenario?.landingId && scenario.landingId === blankOver
  const target = blank ? { url: drive.devUrl, key: 'plain' } : scenarioTarget(drive.devUrl, scenario)
  const sessionId = drive.scenarioSessionId ?? opened
  const docked = !!sessionId && sessionId !== hidden && !ended.includes(sessionId)

  const pick = (file: string | null) => {
    if (file) run.mutate({ projectId, file })
    else setBlankOver(scenario?.landingId ?? null)
  }

  const scenarioMenuControl = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" title="Land on another scenario, or write a new one">
          {scenario && !blank ? `Scenario: ${scenario.name}` : 'Scenario'}
          <IconChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <ScenarioMenuItems menu={menu} onPick={pick} />
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<IconPlus />} onSelect={() => openChat.mutate({ projectId })}>
          New scenario
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {scenario?.status === 'running' && <ScenarioRunning scenario={scenario} />}
        {scenario?.status === 'failed' && (
          <ScenarioFailed
            scenario={scenario}
            fixing={openChat.isPending}
            onFix={() => openChat.mutate({ projectId, fixFile: scenario.file })}
          />
        )}
        <DrivePanel
          {...(featureId ? { featureId } : { projectId })}
          url={target.url}
          frameKey={target.key}
          toolbar={scenarioMenuControl}
        />
      </div>
      {docked && (
        <aside
          aria-label="Scenario chat"
          className="flex min-h-80 min-w-0 flex-col overflow-hidden rounded-md bg-surface-inset md:basis-2/5"
        >
          <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
              <span className="font-medium text-text">New scenario</span> · Describe the state you want to land in
            </span>
            <IconButton size="sm" label="Hide the scenario chat" icon={<IconX />} onClick={() => setHidden(sessionId)} />
          </header>
          <div className="relative min-h-0 flex-1">
            <ErrorBoundary label="scenario chat">
              <TerminalView
                sessionId={sessionId}
                onEnded={() => {
                  setEnded((list) => [...list, sessionId])
                  refresh()
                }}
              />
            </ErrorBoundary>
          </div>
        </aside>
      )}
    </div>
  )
}

/** The live output of a scenario on its way to landing (decision 7). */
function ScenarioRunning({ scenario }: { scenario: DriveScenario }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-surface-inset px-3 py-2" role="status">
      <StatusLabel spinning size="sm">
        Running {scenario.name}…
      </StatusLabel>
      {scenario.output && (
        <pre className="m-0 max-h-24 overflow-auto font-mono text-xs whitespace-pre-wrap text-text-tertiary">
          {scenario.output}
        </pre>
      )}
    </div>
  )
}

/**
 * A failed scenario's actual error, where the human is looking (decision 3):
 * which one, why, and the tail of its output — and Fix it, which briefs the
 * scenario chat with exactly that. The app stays on its plain URL below.
 */
export function ScenarioFailed({
  scenario,
  fixing = false,
  onFix,
}: {
  scenario: DriveScenario
  fixing?: boolean
  onFix: () => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-danger-subtle px-3 py-2 text-sm" role="alert">
      <span className="font-medium text-danger">{scenarioFailureLine(scenario)}</span>
      {scenario.failure?.outputTail && (
        <pre className="m-0 max-h-40 overflow-auto rounded-md bg-surface-inset px-2 py-1.5 font-mono text-xs whitespace-pre-wrap text-text-secondary">
          {scenario.failure.outputTail}
        </pre>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" icon={<IconTerminal />} loading={fixing} onClick={onFix}>
          Fix it
        </Button>
        <span className="text-xs text-text-tertiary">Opens the scenario chat with this file and its output</span>
      </div>
    </div>
  )
}
