import { useEffect, useState } from 'react'
import type { DriveScenario } from '@runcastle/core'
import { Button, IconButton, LINK, SegmentedControl, StatusLabel, cx } from '../../ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../ui/dropdown-menu'
import { IconChevronDown, IconPlus, IconTerminal, IconX } from '../../icons'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { callMenu, hasCalls } from '../../lib/feature-ui/api-call'
import { scenarioFailureLine, scenarioMenu, scenarioTarget, showsScenarioNudge } from '../../lib/feature-ui/scenarios'
import { ErrorBoundary } from '../ErrorBoundary'
import { TerminalView } from '../TerminalView'
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
 * Where a door from outside the drive asked it to land (the map's Open in
 * drive / Try it): the App or API side, and the scenario whose call the API
 * side selects. `seq` is new on every ask, so asking again re-applies it.
 */
export interface DriveFocus {
  side: 'app' | 'api'
  scenario: string
  seq: number
}

/** What the docked chat was opened for, named in its header: ＋ New scenario, or Fix it on one. */
type ChatErrand = { kind: 'new' } | { kind: 'fix'; name: string }

/**
 * A human's running drive with its scenarios (drive-scenarios decisions 3, 7,
 * 8): the Scenario menu in the panel's toolbar switches scenario without a
 * restart, the panel follows each landing, a running scenario shows its output
 * and a failed one its actual error with Fix it, and the scenario chat docks
 * beside the panel — never in the Chat tab, which would hide the panel the
 * result lands in. Lap 2 (decisions 11, 14): an App | API toggle when some
 * scenario has a call, and the Blank app nudge while the project has none.
 *
 * `featureId` is set on a feature drive (its own scenarios list first, notes
 * land on the feature); absent on a project drive.
 */
export function ScenarioDrive({
  projectId,
  featureId,
  drive,
  focus,
}: {
  projectId: string
  featureId?: string
  drive: ScenarioDriveInfo
  focus?: DriveFocus
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
  // Set on the click, so Fix it renames the header even when the server
  // briefs an already-live chat instead of opening a new one.
  const [errand, setErrand] = useState<ChatErrand>({ kind: 'new' })
  // Blank app: back to the plain URL, until the next landing takes it again.
  const [blankOver, setBlankOver] = useState<string | null>(null)
  // App | API: the app stays mounted (hidden) under the API view, so it is not reloaded.
  const [view, setView] = useState<'app' | 'api'>(focus?.side ?? 'app')
  useEffect(() => {
    if (focus) setView(focus.side)
  }, [focus])
  // The nudge's ✕, held by the drive it was clicked on.
  const [nudgeHiddenFor, setNudgeHiddenFor] = useState<string | null>(null)

  const scenario = drive.scenario
  const blank = !!scenario?.landingId && scenario.landingId === blankOver
  const target = blank ? { url: drive.devUrl, key: 'plain' } : scenarioTarget(drive.devUrl, scenario)
  // This browser's own open is the newest; the drive's id covers a chat opened
  // elsewhere, or before a reload.
  const sessionId = opened && !ended.includes(opened) ? opened : drive.scenarioSessionId
  const docked = !!sessionId && sessionId !== hidden && !ended.includes(sessionId)
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
  const newScenario = () => {
    setErrand({ kind: 'new' })
    openChat.mutate({ projectId })
  }
  const fix = (failed: DriveScenario) => {
    setErrand({ kind: 'fix', name: failed.name })
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
    <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row">
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
            // A new ask starts the view over on its call.
            key={focus?.seq ?? 0}
            preselected={focus?.side === 'api' ? focus.scenario : undefined}
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
      {docked && (
        <aside
          aria-label="Scenario chat"
          className="flex min-h-80 min-w-0 flex-col overflow-hidden rounded-md bg-surface-inset md:basis-2/5"
        >
          <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
              {errand.kind === 'fix' ? (
                <>
                  <span className="font-medium text-text">Fix scenario</span> · {errand.name}
                </>
              ) : (
                <>
                  <span className="font-medium text-text">New scenario</span> · Describe the state you want to land in
                </>
              )}
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
