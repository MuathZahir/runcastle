import type { ProjectDriveCard } from '../../lib/project-drive'
import type { ScenarioMenu } from '../../lib/feature-ui/scenarios'
import { IconPlay, IconShield } from '../../icons'
import { Button, SplitButton } from '../../ui'
import { ScenarioMenuItems } from '../review/ScenarioMenuItems'

/**
 * The Orchestrator's door to a project drive, in its header: Test drive with
 * its scenarios behind the caret, disabled with its reason while another drive
 * holds the slot, or Prepare drive with no command set. Nothing on a born-empty
 * project, or while this project's drive runs: the panel toggle is the way to it.
 */
export function ProjectDriveButton({
  card,
  starting,
  scenarios,
  onStart,
  onPrepare,
}: {
  card: ProjectDriveCard
  starting: boolean
  /** What the drive can land on, from `scenarioMenu` without an own section. */
  scenarios: ScenarioMenu
  /** Start the drive on a scenario file, or on the blank app with `null`. */
  onStart: (scenario: string | null) => void
  /** Neither command is set: preparation is where they are established. */
  onPrepare: () => void
}) {
  if (card.state === 'prepare') {
    return (
      <Button size="sm" variant="ghost" icon={<IconShield />} className="mr-1" title="No setup or dev command yet" onClick={onPrepare}>
        Prepare drive
      </Button>
    )
  }
  if (card.state !== 'ready' && card.state !== 'blocked') return null
  return (
    // A project drive has no feature to own a scenario, so the main click is
    // always the blank app (drive-scenarios decision 7).
    <SplitButton
      size="sm"
      variant="ghost"
      icon={<IconPlay />}
      className="mr-1"
      loading={starting}
      disabled={card.state === 'blocked'}
      title={card.state === 'blocked' ? card.reason : 'Run everything that has shipped and jot what you notice'}
      onClick={() => onStart(null)}
      menuLabel="Choose a scenario"
      menu={<ScenarioMenuItems menu={scenarios} onPick={onStart} />}
    >
      Test drive
    </SplitButton>
  )
}
