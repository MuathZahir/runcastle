import type { ProjectDriveCard } from '../../lib/project-drive'
import type { ScenarioMenu } from '../../lib/feature-ui/scenarios'
import { IconArrowRight, IconPlay, IconShield } from '../../icons'
import { Button, SplitButton } from '../../ui'
import { ScenarioPickerContent } from '../review/ScenarioPicker'

/**
 * The Orchestrator's door to a project drive, in its header: Test drive with
 * the scenario picker on its caret, disabled with its reason while another
 * drive holds the slot; Prepare drive with no command set; Back to the drive
 * while this project's drive runs; nothing on a born-empty project.
 */
export function ProjectDriveButton({
  card,
  starting,
  scenarios,
  onStart,
  onPrepare,
  onReturn,
}: {
  card: ProjectDriveCard
  starting: boolean
  /** What the drive can land on, from `scenarioMenu` without an own section. */
  scenarios: ScenarioMenu
  /** Start the drive on a scenario file, or on the blank app with `null`. */
  onStart: (scenario: string | null) => void
  /** Neither command is set: preparation is where they are established. */
  onPrepare: () => void
  /** This project's drive is live: back to its page. */
  onReturn: () => void
}) {
  if (card.state === 'prepare') {
    return (
      <Button size="sm" variant="ghost" icon={<IconShield />} className="mr-1" title="No setup or dev command yet" onClick={onPrepare}>
        Prepare drive
      </Button>
    )
  }
  if (card.state === 'running') {
    return (
      <Button size="sm" variant="ghost" icon={<IconArrowRight />} className="mr-1" onClick={onReturn}>
        Back to the drive
      </Button>
    )
  }
  if (card.state === 'hidden') return null
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
      picker={<ScenarioPickerContent menu={scenarios} onPick={onStart} align="end" />}
    >
      Test drive
    </SplitButton>
  )
}
