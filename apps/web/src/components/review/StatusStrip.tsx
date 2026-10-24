import type { TallyTicket } from '@runcastle/core'
import { Button, Disclosure, PropertyList, type PropertyItem, type StatusTone } from '../../ui'
import { IconCube, IconPlay, IconUndo } from '../../icons'
import type { CheckTone, ReviewArtifactFigure, TrailOutcome } from '../../lib/feature-ui'
import { statusProperties, type StatusBuilding, type StatusProperty } from '../../lib/feature-ui/review'
import { Markdown } from '../Markdown'

/**
 * The returning human's TL;DR (decision 18b), as facts rather than pills
 * (DESIGN.md: facts are text, not boxes): Review · Tickets · Test drive (·
 * Burn), or Burn · Tickets · Review while building, each a key and a
 * glyph-plus-words value, from
 * {@link statusProperties} — so the words and their order live in one tested
 * derivation rather than in this markup.
 *
 * Each row owns its facts (decision 4): there is no Checks tally restating
 * them, and the unverified-drive caveat is the Test drive row's sub-note (the
 * whole sentence is its tooltip).
 *
 * On review the list is the page's ONE state line (decision 8), so the human's
 * own Test drive sits beside it, never as the page's primary.
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
  const leading = p.key === 'tickets' ? <IconCube /> : undefined
  return {
    label: p.label,
    value,
    ...(sub ? { sub } : {}),
    ...(leading && p.tone === 'idle' ? { leading } : { tone }),
  }
}

export function StatusStrip({
  artifact,
  outcome,
  currentLap,
  landedSince,
  tickets,
  runState,
  verification,
  driveLap,
  unverifiedKeys,
  testDrive,
  shipped = false,
  driving,
  noWalkthrough = false,
  building,
}: {
  /** The latest COMPLETED review pass, or null when none has finished. */
  artifact: Pick<ReviewArtifactFigure, 'lap' | 'gateRun'> | null
  /** What that pass amounted to — the Review row's verdict ({@link stampedOutcome}). */
  outcome?: TrailOutcome
  currentLap: number
  /** Implementation tickets that landed after that pass — decision 19's stamp. */
  landedSince: number
  tickets: readonly TallyTicket[]
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
   * The shipped record's own strip: the rows state what shipped rather than
   * where the feature stands, and the chips are statements — the open-work and
   * full-accounts bands this strip anchors into are not on that page.
   */
  shipped?: boolean
  /** A drive of this feature is up (the live page's Test drive row). */
  driving?: boolean
  /** No recording exists — the shipped record's Test drive row says why. */
  noWalkthrough?: boolean
  /** The building page's strip: Burn · Tickets · Review (decision 9a). */
  building?: StatusBuilding
}) {
  const properties = statusProperties({
    artifact,
    ...(outcome ? { outcome } : {}),
    currentLap,
    landedSince,
    tickets,
    ...(shipped ? {} : { runState }),
    ...(verification ? { verification } : {}),
    ...(driveLap === undefined ? {} : { driveLap }),
    ...(driving === undefined ? {} : { driving }),
    ...(noWalkthrough ? { noWalkthrough } : {}),
    ...(unverifiedKeys ? { unverifiedKeys } : {}),
    shipped,
    ...(building ? { building } : {}),
  })

  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
      <PropertyList className="min-w-0 flex-1" items={properties.map(toItem)} />

      {testDrive && (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            icon={<IconPlay />}
            disabled={!!testDrive.blocked}
            {...(testDrive.blocked ? { title: testDrive.blocked } : {})}
            onClick={testDrive.onStart}
          >
            Test drive
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * The scope the spec deliberately left out, in the spec's own words — closed
 * by default.
 */
export function DeferredScope({ deferred, readonly }: { deferred: string | null; readonly: boolean }) {
  if (!deferred) return null
  return (
    <Disclosure title="Deferred scope" icon={<IconUndo />}>
      <p className="m-0 text-text-tertiary">
        {readonly
          ? 'The spec kept this out on purpose, and it was still deferred when this feature shipped.'
          : 'The spec kept this out on purpose. Tell the agent to take it on — or merge what landed, if that is enough.'}
      </p>
      <Markdown source={deferred} className="mt-2" />
    </Disclosure>
  )
}
