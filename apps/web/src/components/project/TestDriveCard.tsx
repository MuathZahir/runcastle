import type { ProjectDriveCard } from '../../lib/project-drive'
import type { ScenarioMenu } from '../../lib/feature-ui/scenarios'
import { IconArrowRight, IconPlay, IconShield, IconTerminal } from '../../icons'
import { Button, Disclosure, PropertyList, SplitButton, StatusLabel } from '../../ui'
import type { PropertyItem } from '../../ui'
import { ScenarioMenuItems } from '../review/ScenarioMenuItems'
import { SettingsLink } from '../settings/MessageWithSettingsLink'
import { ActionRow } from './ActionRow'

/** The fixed identity every project drive runs as (decision 8). */
const PROJECT_DRIVE_SLUG = 'project-drive'

/**
 * The resting page's door to a project drive (project-level-test-drive
 * decisions 4, 7), under New chat.
 *
 * A row like New chat's, its button secondary — New chat stays the page's one
 * primary. What a drive will do — the checkout it drives (no branch switch),
 * the identity it runs as, and the three commands, each unset one said as
 * "nothing set" with the way to set it — is read once and then known, so it
 * lives in a closed "Drive setup" disclosure under the row (DESIGN.md
 * principle 6), not as a table on every visit.
 */
export function TestDriveCard({
  card,
  branch,
  setupCommand,
  devCommand,
  stopCommand,
  starting,
  scenarios,
  onStart,
  onPrepare,
  onReturn,
}: {
  card: ProjectDriveCard
  /** The branch the checkout is on (or the live drive's), null while unknown. */
  branch: string | null
  setupCommand?: string
  devCommand?: string
  stopCommand?: string
  starting: boolean
  /** What the drive can land on, from `scenarioMenu` without an own section. */
  scenarios: ScenarioMenu
  /** Start the drive on a scenario file, or on the blank app with `null`. */
  onStart: (scenario: string | null) => void
  /** Neither command is set: preparation is where they are established. */
  onPrepare: () => void
  /** This project's drive is live: back to it. */
  onReturn: () => void
}) {
  if (card.state === 'hidden') return null
  const running = card.state === 'running'

  const plan: PropertyItem[] = [
    {
      label: 'Branch',
      value: branch ?? '…',
      mono: true,
      sub: 'your checkout, as it is — no branch switch',
    },
    { label: 'As', value: PROJECT_DRIVE_SLUG, mono: true },
    command('Setup', setupCommand, 'driveSetupCommand'),
    command('Dev', devCommand, 'devCommand'),
    command('Stop', stopCommand, 'driveStopCommand'),
  ]

  return (
    <section aria-label="Test drive">
      <ActionRow
        icon={<IconPlay />}
        title="Test drive"
        status={running ? <StatusLabel tone="live">Running</StatusLabel> : undefined}
        hint="Run everything that has shipped and jot what you notice. Notes land in Notes."
        actions={
          card.state === 'prepare' ? (
            <Button icon={<IconShield />} onClick={onPrepare}>
              Prepare drive
            </Button>
          ) : running ? (
            <Button icon={<IconArrowRight />} onClick={onReturn}>
              Return to drive
            </Button>
          ) : (
            // A project drive has no feature to own a scenario, so the main
            // click is always the blank app (drive-scenarios decision 7).
            <SplitButton
              icon={<IconPlay />}
              loading={starting}
              disabled={card.state === 'blocked'}
              title={card.state === 'blocked' ? card.reason : undefined}
              onClick={() => onStart(null)}
              menuLabel="Choose a scenario"
              menu={<ScenarioMenuItems menu={scenarios} onPick={onStart} />}
            >
              Test drive
            </SplitButton>
          )
        }
        caption={
          card.state === 'blocked'
            ? card.reason
            : card.state === 'prepare'
              ? 'No setup or dev command yet.'
              : undefined
        }
        rule={false}
      />
      <Disclosure
        title="Drive setup"
        icon={<IconTerminal />}
        aside={
          <span className="font-mono">
            {PROJECT_DRIVE_SLUG} · {branch ?? '…'}
          </span>
        }
      >
        <div className="rounded-md border border-border-subtle bg-surface-inset px-4 py-3">
          <PropertyList items={plan} className="gap-x-8" />
        </div>
      </Disclosure>
    </section>
  )
}

/** One command of the drive: the command itself, or "nothing set" and where to set it. */
function command(label: string, value: string | undefined, field: string): PropertyItem {
  if (value?.trim()) return { label, value, mono: true }
  return {
    label,
    value: (
      <span className="font-normal text-text-tertiary">
        Nothing set ·{' '}
        <SettingsLink location={{ page: 'project', field }}>Settings</SettingsLink>
      </span>
    ),
  }
}
