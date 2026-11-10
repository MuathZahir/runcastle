import { IconPlay } from '../../icons'
import { Button, cx } from '../../ui'
import { OrchestratorTile } from '../SidebarParts'
import { Term } from '../Term'

/** The Orchestrator card's material (SidebarParts `OrchestratorCard`), grown to a page's one card. */
const CARD_GROUND =
  'bg-[linear-gradient(115deg,color-mix(in_oklab,var(--color-accent)_14%,var(--color-surface)),color-mix(in_oklab,var(--color-accent)_4%,var(--color-surface))_65%)]'
const CARD_EDGE =
  'ring-1 ring-inset ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)] shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-text)_8%,transparent)]'
/** The card's grid: the sidebar card's 12px lattice, fading in from the right. */
const CARD_GRID =
  '[background-image:linear-gradient(to_right,color-mix(in_oklab,var(--color-accent)_13%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--color-accent)_13%,transparent)_1px,transparent_1px)] [background-size:12px_12px] [mask-image:linear-gradient(to_left,black,transparent_75%)]'
/** The page behind it: the same lattice, wider and fainter, gone by the edges. */
const PAGE_GRID =
  '[background-image:linear-gradient(to_right,color-mix(in_oklab,var(--color-text)_5%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--color-text)_5%,transparent)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_60%)]'

/**
 * The page a new project opens on (the-orchestrator-prepares-the-project
 * decision 1): one card in the Orchestrator's own material, naming the project,
 * saying what happens next, and holding the one button that starts the
 * Orchestrator's first chat. The Orchestrator speaks first, so there is no
 * composer here: the click is the whole first move.
 *
 * The card is still at rest. On hover it does what the sidebar's Orchestrator
 * card does (its hub's nodes light in turn, one sheen crosses it); while the
 * chat starts, a light travels its edge, the app's mark for something live.
 */
export function StartTheProject({
  name,
  repoPath,
  empty,
  starting,
  onStart,
}: {
  /** The project's name, the page's one title. */
  name: string
  /** Where it lives on disk, as a quiet second line. */
  repoPath?: string
  /** Born empty: nothing to read or prepare yet. */
  empty: boolean
  starting: boolean
  onStart: () => void
}) {
  return (
    <div className="relative isolate flex h-full min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-10">
      <span aria-hidden className={cx('pointer-events-none absolute inset-0 -z-10', PAGE_GRID)} />
      <div
        className={cx(
          'orchestrator-beat relative isolate w-full max-w-[440px] animate-rise-in overflow-hidden rounded-lg',
          CARD_GROUND,
          CARD_EDGE,
          starting && 'orbit-light',
        )}
      >
        <span aria-hidden className={cx('pointer-events-none absolute inset-y-0 right-0 -z-10 w-3/5', CARD_GRID)} />
        <span
          aria-hidden
          data-sheen
          className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-1/2 -translate-x-[120%] bg-[linear-gradient(100deg,transparent,color-mix(in_oklab,var(--color-text)_7%,transparent),transparent)]"
        />
        <div className="flex flex-col gap-5 p-6">
          <div className="flex animate-rise-in items-center gap-3.5"
            style={{ animationDelay: '60ms' }}>
            <OrchestratorTile large />
            <div className="flex min-w-0 flex-col gap-0.5">
              <h1 className="m-0 truncate text-xl font-semibold tracking-tight text-text">{name}</h1>
              {repoPath && <span className="truncate font-mono text-xs text-text-tertiary">{repoPath}</span>}
            </div>
          </div>
          <p className="m-0 animate-rise-in text-sm text-pretty text-text-secondary"
            style={{ animationDelay: '120ms' }}>
            {empty ? (
              <>
                The repo is empty, so there is nothing to set up yet. The first{' '}
                <Term id="orchestrator">epic</Term> starts by asking what we’re building.
              </>
            ) : (
              <>
                The first <Term id="orchestrator">epic</Term> reads the repo, gets test drives working with you, then
                asks what we’re building.
              </>
            )}
          </p>
          <div className="flex animate-rise-in"
            style={{ animationDelay: '180ms' }}>
            <Button
              variant="primary"
              size="lg"
              className="w-full justify-center"
              icon={<IconPlay />}
              loading={starting}
              disabled={starting}
              onClick={onStart}
            >
              Start the project
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
