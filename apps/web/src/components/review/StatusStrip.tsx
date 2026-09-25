import type { TicketKind } from '@runcastle/core'
import { Button, CheckLine, Disclosure, PropertyList, type PropertyItem, type StatusTone } from '../../ui'
import { IconCube, IconList, IconPlay, IconShield, IconUndo } from '../../icons'
import type { CheckRow, CheckTone, LapChipFigure, ReviewArtifactFigure } from '../../lib/feature-ui'
import { statusProperties, type StatusProperty } from '../../lib/feature-ui/review'
import { Markdown } from '../Markdown'

/**
 * The returning human's TL;DR (decision 18b), as facts rather than pills
 * (DESIGN.md: facts are text, not boxes): Review · Checks · Test drive ·
 * Tickets · Laps, each a key and a glyph-plus-words value, from
 * {@link statusProperties} — so the words and their order live in one tested
 * derivation rather than in this markup.
 *
 * "No review ran this lap" is the review row's quiet limiting case, and the
 * unverified-drive caveat is the Test drive row's sub-note (the whole sentence
 * is its tooltip) — neither is a chip of its own any more.
 *
 * On review the list is the page's ONE state line (decision 8), so the two
 * things a human can start from here — their own Test drive and another
 * Agentic review — sit beside it, never as the page's primary (that is the
 * next-step bar's).
 */
const DOT: Record<CheckTone, StatusTone> = {
  ok: 'success',
  warn: 'warning',
  danger: 'danger',
  // Absence is quiet, never green — but it still takes the glyph column, so
  // every value down the list starts on the same line.
  idle: 'neutral',
}

/** One derived fact as a property row. */
function toItem(p: StatusProperty): PropertyItem {
  const tone = DOT[p.tone]
  // The value never wraps: a narrow column truncates the quiet sub-note instead.
  const value = (
    <span className="whitespace-nowrap" {...(p.detail ? { title: p.detail } : {})}>
      {p.value}
    </span>
  )
  const sub = p.sub && p.detail ? <span className="text-warning" title={p.detail}>{p.sub}</span> : p.sub
  const leading = p.key === 'tickets' ? <IconCube /> : p.key === 'laps' ? <IconUndo /> : undefined
  return {
    label: p.label,
    value,
    ...(sub ? { sub } : {}),
    ...(leading && p.tone === 'idle' ? { leading } : { tone }),
  }
}

export function StatusStrip({
  artifact,
  currentLap,
  landedSince,
  tickets,
  checks,
  runState,
  verification,
  driveLap,
  unverifiedKeys,
  testDrive,
  agenticReview,
  shipped = false,
  driving,
  noWalkthrough = false,
}: {
  /** The latest COMPLETED review pass, or null when none has finished. */
  artifact: Pick<ReviewArtifactFigure, 'lap'> | null
  currentLap: number
  /** Implementation tickets that landed after that pass — decision 19's stamp. */
  landedSince: number
  tickets: readonly { kind?: TicketKind; status: string; lap?: number }[]
  checks: readonly CheckRow[]
  runState: string
  verification?: { state: 'running' | 'failed'; reason?: string }
  /** The lap the branch was last driven in; omit where the strip is not to say. */
  driveLap?: number | null
  /** Drive-loop keys no dry run has ever proven — the Test drive row's caveat. */
  unverifiedKeys?: readonly string[]
  /**
   * Take your own test drive, beside the state it is about (decision 6) — this
   * is the entry point the empty stage used to hold. Omitted wherever no drive
   * can start from here: a history view, or a drive already at the wheel.
   */
  testDrive?: {
    onStart: () => void
    /** Why it cannot start right now, when something else holds the one slot. */
    blocked?: string
  }
  /**
   * Ask for another review pass, beside the drive the human would take
   * themselves (decision 6). Present in every review-page state — an agentic
   * review is always a thing to ask for, whatever the last one amounted to —
   * and disabled with its reason while a burn holds the feature, which is the
   * same idiom the Test drive control beside it uses for the occupied slot.
   * Omitted only where nothing on the page acts: the shipped record.
   */
  agenticReview?: {
    onStart: () => void
    /** Why it cannot start right now — a burn is running, or one is starting. */
    blocked?: string
  }
  /**
   * The shipped record's own strip: the lap chip states what shipped rather than
   * where the feature stands, and the chips are statements — the open-work and
   * full-accounts bands this strip anchors into are not on that page.
   */
  shipped?: boolean
  /** A drive of this feature is up (the live page's Test drive row). */
  driving?: boolean
  /** No recording exists — the shipped record's Test drive row says why. */
  noWalkthrough?: boolean
}) {
  const properties = statusProperties({
    artifact,
    currentLap,
    landedSince,
    tickets,
    checks: { passed: checks.filter((row) => row.tone === 'ok').length, total: checks.length },
    ...(shipped ? {} : { runState }),
    ...(verification ? { verification } : {}),
    ...(driveLap === undefined ? {} : { driveLap }),
    ...(driving === undefined ? {} : { driving }),
    ...(noWalkthrough ? { noWalkthrough } : {}),
    ...(unverifiedKeys ? { unverifiedKeys } : {}),
    shipped,
  })

  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
      <PropertyList className="min-w-0 flex-1" items={properties.map(toItem)} />

      {(testDrive || agenticReview) && (
        <div className="flex shrink-0 items-center gap-2">
          {testDrive && (
            <Button
              icon={<IconPlay />}
              disabled={!!testDrive.blocked}
              {...(testDrive.blocked ? { title: testDrive.blocked } : {})}
              onClick={testDrive.onStart}
            >
              Test drive
            </Button>
          )}
          {agenticReview && (
            <Button
              variant="ghost"
              icon={<IconShield />}
              disabled={!!agenticReview.blocked}
              {...(agenticReview.blocked ? { title: agenticReview.blocked } : {})}
              onClick={agenticReview.onStart}
            >
              Agentic review
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Every review figure behind the Checks row, read once — so it is a closed
 * disclosure at the foot of the page, not a popover on a pill.
 */
export function CheckDetails({ checks }: { checks: readonly CheckRow[] }) {
  if (checks.length === 0) return null
  // The count is the Checks property's, above — said once. This is its detail.
  return (
    <Disclosure title="Check details" icon={<IconList />}>
      {checks.map((row) => (
        <CheckLine key={row.key} row={row} />
      ))}
    </Disclosure>
  )
}

/**
 * Where this lap stands, and the scope the spec deliberately left for a later
 * one, in the spec's own words — closed by default.
 */
export function LapStory({
  lap,
  laterLaps,
  currentLap,
  readonly,
}: {
  lap: LapChipFigure
  laterLaps: string | null
  currentLap: number
  readonly: boolean
}) {
  if (!laterLaps) return null
  return (
    <Disclosure title="Deferred to a later lap" icon={<IconUndo />}>
      {/* Tense-accurate (decision 27a): the past tense only once the lap's own
          session has actually run. */}
      <p className="m-0">{lap.story}.</p>
      {lap.promotedFromEarlier > 0 && (
        <p className="m-0 mt-2 text-text-tertiary">
          Includes {lap.promotedFromEarlier} ticket{lap.promotedFromEarlier === 1 ? '' : 's'} promoted
          in an earlier lap.
        </p>
      )}
      <p className="m-0 mt-3 text-text-tertiary">
        {readonly
          ? `The spec kept this out of lap ${currentLap} on purpose, and it was still deferred when this feature shipped.`
          : `The spec kept this out of lap ${currentLap} on purpose. Start lap ${currentLap + 1} from the next step to take it on — or ship what landed, if lap ${currentLap} is enough.`}
      </p>
      <Markdown source={laterLaps} className="mt-2" />
    </Disclosure>
  )
}
