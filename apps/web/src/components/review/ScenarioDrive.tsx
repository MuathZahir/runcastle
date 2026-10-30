import { useState, type ReactNode } from 'react'
import type { DriveScenario } from '@runcastle/core'
import { Button, IconButton, LINK, SegmentedControl, StatusLabel, cx } from '../../ui'
import { IconTerminal, IconX } from '../../icons'
import { trpc } from '../../trpc'
import { useToast } from '../../lib/toast'
import { callMenu, hasCalls } from '../../lib/feature-ui/api-call'
import { scenarioFailureLine, scenarioMenu, scenarioTarget, showsScenarioNudge } from '../../lib/feature-ui/scenarios'
import { useScenarioChatDoor } from '../chat/ScenarioChat'
import { ApiView } from './ApiView'
import { DrivePanel } from './DrivePanel'
import { ScenarioControl } from './ScenarioPicker'

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
 * 8): the scenario control in the head switches scenario without a
 * restart, the panel follows each landing, a running scenario shows its output
 * and a failed one its actual error with Fix it. ＋ New scenario and Fix it open
 * the scenario chat on the page's chat column (design-mode decision 9), with the
 * drive left running behind it (test-drive-looks-the-part decision 18). Lap 2 (decisions 11, 14): an
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
  leading,
  trailing,
  footer,
  onCapture,
  onToChat,
}: {
  projectId: string
  featureId?: string
  drive: ScenarioDriveInfo
  /** The head's two ends: the way back, and Stop with the notes toggle. */
  leading?: ReactNode
  trailing?: ReactNode
  /** The window's status line, under the page. */
  footer?: ReactNode
  onCapture?: (png: Blob) => void
  /** An errand opened a chat: it lives on the chat page, so go there. */
  onToChat?: () => void
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
      onToChat?.()
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

  const toolbar = (
    <>
      <ScenarioControl menu={menu} scenario={scenario} blank={blank} onPick={pick} onNew={newScenario} />
      {viewToggle}
    </>
  )

  // Under the toolbar, inside the window (decision 4): the scenario's run and
  // the hint, read where the app is rather than above the frame.
  const above = (
    <>
      {!api && strip}
      {nudge && (
        <p className="m-0 flex shrink-0 items-center gap-2 border-b border-border-subtle py-1 pr-1.5 pl-4 text-xs text-text-tertiary">
          <span className="min-w-0 flex-1">
            Setting this up by hand every time?{' '}
            <button type="button" className={cx(LINK, 'font-medium')} onClick={newScenario}>
              Make it a scenario.
            </button>
          </span>
          <IconButton size="sm" label="Hide this hint" icon={<IconX />} onClick={() => setNudgeHiddenFor(driveKey)} />
        </p>
      )}
    </>
  )

  return (
    <DrivePanel
      url={target.url}
      frameKey={target.key}
      leading={leading}
      toolbar={toolbar}
      trailing={trailing}
      strip={above}
      footer={footer}
      onCapture={onCapture}
      cover={
        api && (
          <ApiView projectId={projectId} calls={callMenu(menu)} scenario={scenario} strip={strip} onRun={pick} />
        )
      }
    />
  )
}

/** The live output of a scenario on its way to landing (decision 7). */
function ScenarioRunning({ scenario }: { scenario: DriveScenario }) {
  return (
    <div className="flex shrink-0 flex-col gap-1 border-b border-border-subtle px-4 py-2.5" role="status">
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
    <div className="flex shrink-0 flex-col gap-2 border-b border-border-subtle bg-danger-subtle px-4 py-3 text-sm" role="alert">
      <span className="font-medium text-danger-text">{scenarioFailureLine(scenario)}</span>
      {scenario.failure?.outputTail && (
        <pre className="m-0 max-h-40 overflow-auto rounded-md bg-surface-inset px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-text-secondary">
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
