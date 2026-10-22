import { useState } from 'react'
import type { DriveScenario } from '@runcastle/core'
import { Button, IconButton, LINK, SegmentedControl, StatusLabel, cx } from '../../ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../ui/dropdown-menu'
import { IconChevronDown, IconPlus, IconTerminal, IconX } from '../../icons'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { callMenu, hasCalls } from '../../lib/feature-ui/api-call'
import { scenarioFailureLine, scenarioMenu, scenarioTarget, showsScenarioNudge } from '../../lib/feature-ui/scenarios'
import { useScenarioChatDoor } from '../chat/ScenarioChat'
import { ApiView } from './ApiView'
import { DrivePanel } from './DrivePanel'
import { ScenarioMenuItems } from './ScenarioMenuItems'

/** The live drive as the scenario controls read it — `driveInfo`'s slice. */
export interface ScenarioDriveInfo {
  devUrl: string
  /** The branch under the wheel: a ✕ on the nudge holds for this drive only. */
  branch?: string
  scenario?: DriveScenario
  scenarioSessionId?: string
}

/**
 * A human's running drive with its scenarios (drive-scenarios decisions 3, 7,
 * 8): the Scenario menu in the panel's toolbar switches scenario without a
 * restart, the panel follows each landing, a running scenario shows its output
 * and a failed one its actual error with Fix it. ＋ New scenario and Fix it open
 * the scenario chat in the page's chat column (design-mode decision 9), so the
 * drive keeps the whole panel the result lands in. Lap 2 (decisions 11, 14): an
 * App | API toggle when some scenario has a call, and the Blank app nudge while
 * the project has none.
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
  // The chat an errand opens is the page's, in its chat column.
  const chat = useScenarioChatDoor()
  const openChat = trpc.feature.openScenarioChat.useMutation({
    onSuccess: (res) => {
      refresh()
      chat?.opened(res.sessionId)
    },
    onError: (e) => toast.push(e.message),
  })
  // Blank app: back to the plain URL, until the next landing takes it again.
  const [blankOver, setBlankOver] = useState<string | null>(null)
  // App | API: the app stays mounted (hidden) under the API view, so it is not reloaded.
  const [view, setView] = useState<'app' | 'api'>('app')
  // The nudge's ✕, held by the drive it was clicked on.
  const [nudgeHiddenFor, setNudgeHiddenFor] = useState<string | null>(null)

  const scenario = drive.scenario
  const blank = !!scenario?.landingId && scenario.landingId === blankOver
  const target = blank ? { url: drive.devUrl, key: 'plain' } : scenarioTarget(drive.devUrl, scenario)
  const withCalls = hasCalls(menu)
  const api = withCalls && view === 'api'
  const driveKey = drive.branch ?? drive.devUrl
  const nudge = showsScenarioNudge({
    scenario,
    scenarios: scenariosQ.data?.scenarios,
    dismissed: nudgeHiddenFor === driveKey,
  })

  const pick = (file: string | null) => {
    if (file) run.mutate({ projectId, file })
    else setBlankOver(scenario?.landingId ?? null)
  }
  // The errand is named on the click, so Fix it renames the chat even when the
  // server briefs an already-live one instead of opening a new one.
  const newScenario = () => {
    chat?.begin({ kind: 'new' })
    openChat.mutate({ projectId })
  }
  const fix = (failed: DriveScenario) => {
    chat?.begin({ kind: 'fix', name: failed.name })
    openChat.mutate({ projectId, fixFile: failed.file })
  }

  const strip =
    scenario?.status === 'running' ? (
      <ScenarioRunning scenario={scenario} />
    ) : scenario?.status === 'failed' ? (
      <ScenarioFailed scenario={scenario} fixing={openChat.isPending} onFix={() => fix(scenario)} />
    ) : null

  const viewToggle = withCalls && (
    <SegmentedControl
      size="sm"
      label="Drive view"
      className="w-24"
      items={[
        { value: 'app', label: 'App' },
        { value: 'api', label: 'API' },
      ]}
      value={api ? 'api' : 'app'}
      onChange={setView}
    />
  )

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
        <DropdownMenuItem icon={<IconPlus />} onSelect={newScenario}>
          New scenario
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const toolbar = (
    <>
      {viewToggle}
      {scenarioMenuControl}
    </>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      {!api && strip}
      {nudge && (
        <p className="m-0 flex items-center gap-2 px-1 text-xs text-text-tertiary">
          <span className="min-w-0 flex-1">
            Setting this up by hand every time?{' '}
            <button type="button" className={cx(LINK, 'font-medium')} onClick={newScenario}>
              Make it a scenario.
            </button>
          </span>
          <IconButton size="sm" label="Hide this hint" icon={<IconX />} onClick={() => setNudgeHiddenFor(driveKey)} />
        </p>
      )}
      {api && (
        <ApiView
          projectId={projectId}
          calls={callMenu(menu)}
          scenario={scenario}
          strip={strip}
          toolbar={toolbar}
          onRun={pick}
        />
      )}
      <div className={api ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
        <DrivePanel
          {...(featureId ? { featureId } : { projectId })}
          url={target.url}
          frameKey={target.key}
          toolbar={toolbar}
        />
      </div>
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
