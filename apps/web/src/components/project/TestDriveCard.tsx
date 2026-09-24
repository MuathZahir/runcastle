import type { ReactNode } from 'react'
import type { ProjectDriveCard } from '../../lib/project-drive'
import { IconPlay } from '../../icons'
import { Button } from '../../ui'
import { SettingsLink } from '../settings/MessageWithSettingsLink'

/** The fixed identity every project drive runs as (decision 8). */
const PROJECT_DRIVE_SLUG = 'project-drive'

/**
 * The resting page's door to a project drive (project-level-test-drive
 * decisions 4, 7), between New chat and Notes.
 *
 * Before any click it says what a drive will do — the checkout it drives (no
 * branch switch), the identity it runs as, and the three commands, each unset
 * one said as "nothing set" with the way to set it. Its button is secondary:
 * New chat stays the page's one solid button.
 */
export function TestDriveCard({
  card,
  branch,
  setupCommand,
  devCommand,
  stopCommand,
  starting,
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
  onStart: () => void
  /** Neither command is set: preparation is where they are established. */
  onPrepare: () => void
  /** This project's drive is live: back to it. */
  onReturn: () => void
}) {
  if (card.state === 'hidden') return null
  const running = card.state === 'running'

  return (
    <section
      aria-label="Test drive"
      className="flex flex-wrap items-center gap-6 rounded-lg border border-hairline bg-panel px-6 py-5"
    >
      <div className="flex min-w-[240px] flex-1 flex-col gap-2">
        <h2 className="m-0 text-lg font-semibold text-text">
          Test drive
          {running && <span className="font-normal text-drive"> · running</span>}
        </h2>
        <p className="m-0 max-w-[56ch] text-sm text-text-2">
          Run everything that has shipped and jot what you notice. Notes land below.
        </p>
        <dl className="m-0 mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-sm">
          <PlanRow term="branch">
            <code className="font-mono text-text">{branch ?? '…'}</code> — your checkout, as it is.
            No branch switch.
          </PlanRow>
          <PlanRow term="as">
            <code className="font-mono text-text">{PROJECT_DRIVE_SLUG}</code>
          </PlanRow>
          <CommandRow term="setup" command={setupCommand} field="driveSetupCommand" />
          <CommandRow term="dev" command={devCommand} field="devCommand" />
          <CommandRow term="stop" command={stopCommand} field="driveStopCommand" />
        </dl>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {card.state === 'prepare' ? (
          <Button onClick={onPrepare}>Prepare drive</Button>
        ) : running ? (
          <Button onClick={onReturn}>Return to drive</Button>
        ) : (
          <Button
            className="gap-2"
            disabled={card.state === 'blocked' || starting}
            title={card.state === 'blocked' ? card.reason : undefined}
            onClick={onStart}
          >
            <IconPlay size={12} />
            {starting ? 'Starting…' : 'Test drive'}
          </Button>
        )}
        {card.state === 'blocked' && (
          <span className="max-w-[28ch] text-right text-xs text-text-3">{card.reason}</span>
        )}
        {card.state === 'prepare' && (
          <span className="max-w-[28ch] text-right text-xs text-text-3">
            no setup or dev command yet
          </span>
        )}
      </div>
    </section>
  )
}

function PlanRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="pt-px font-mono text-xs text-text-3">{term}</dt>
      <dd className="m-0 min-w-0 wrap-anywhere text-text-2">{children}</dd>
    </>
  )
}

function CommandRow({
  term,
  command,
  field,
}: {
  term: string
  command: string | undefined
  field: string
}) {
  return (
    <PlanRow term={term}>
      {command?.trim() ? (
        <code className="font-mono text-text">{command}</code>
      ) : (
        <span className="text-text-3">
          nothing set ·{' '}
          <SettingsLink location={{ page: 'project', field }}>Settings</SettingsLink>
        </span>
      )}
    </PlanRow>
  )
}
