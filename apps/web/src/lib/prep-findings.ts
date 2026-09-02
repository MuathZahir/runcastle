import { DRIVE_LOOP_KEYS } from '@runcastle/core'
import type { SettingsView } from './api'

/**
 * Prepared-field provenance, as presented anywhere in the app.
 *
 * These helpers used to live in `settings.ts` because settings was the only
 * surface that showed them; preparation, review and the next-step bar now import
 * them too, and the settings redesign turns them into a chip plus an evidence
 * popover rather than the sentence they started as. They are their own module so
 * the question they answer — "should I trust this value" — has one home.
 *
 * `settings.ts` may import from here; never the reverse.
 */

/**
 * Human labels for prepared fields, used by the preparation card (which lists
 * findings by key, not by settings row). Kept in sync with the settings
 * `FIELD_META` labels — hand-maintained, since settings imports this module.
 */
export const PREPARED_LABEL: Record<string, string> = {
  setupCommand: 'Setup',
  verifyCommands: 'Verify',
  knownFailures: 'Known failing tests',
  devCommand: 'Dev server',
  dbResetCommand: 'Reset dev database',
  driveSetupCommand: 'Before a test drive',
  driveStopCommand: 'After a test drive',
}

/**
 * Keys preparation proposes from configuration WITHOUT executing them — they
 * describe the developer's own machine, which a throwaway sandbox cannot stand
 * in for. Surfaced so a proposed value is never mistaken for a measured one.
 */
export const HOST_ONLY_PREPARED = new Set([
  'devCommand',
  'dbResetCommand',
  'driveSetupCommand',
  'driveStopCommand',
])

/** Coarse "3 days ago" for a finding's age. Exact enough to judge staleness by. */
export function relativeAge(ts: number, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - ts) / 1000))
  if (secs < 90) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 36) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * Whether a dry run can prove this key at all. Only the three drive-loop keys
 * have an observable a host drive produces; the rest carry no verification
 * wording anywhere, which reads as "unverifiable", not "failed" (decision 10).
 */
export function isVerifiable(key: string): boolean {
  return (DRIVE_LOOP_KEYS as readonly string[]).includes(key)
}

/**
 * The verification badge for a finding — `null` for a key no dry run can prove.
 *
 * Deliberately independent of `source`: the stamp records that this exact value
 * was seen working by the real drive machinery, not who chose it, so a value the
 * human typed carries a badge exactly like one preparation measured.
 */
export function verificationBadge(
  f: { key: string; verifiedAt?: number },
  now = Date.now(),
): string | null {
  if (!isVerifiable(f.key)) return null
  return f.verifiedAt === undefined ? 'unverified' : `verified ${relativeAge(f.verifiedAt, now)}`
}

/**
 * The drive-loop keys a test drive is about to depend on that no dry run has
 * ever proven — what the next-step bar warns about (decision 7), in the canonical
 * key order so the sentence is stable between polls.
 *
 * A key with no finding row has no value, and a drive that runs nothing for it
 * has nothing to doubt: a checkout-only drive warns about nothing at all.
 */
export function unverifiedDriveKeys(
  findings: readonly { key: string; verifiedAt?: number }[],
): string[] {
  return DRIVE_LOOP_KEYS.filter((k) =>
    findings.some((f) => f.key === k && f.verifiedAt === undefined),
  )
}

/** Which halves of a test drive this project has actually configured. */
export interface DriveCapabilities {
  /** `driveSetupCommand` — run before the dev server starts. */
  setup: boolean
  /** `devCommand` — the dev pane, and the "Open app" URL sniffed out of it. */
  dev: boolean
  /** `driveStopCommand` — run on stop, while the feature branch is still checked out. */
  teardown: boolean
}

/**
 * What a test drive on this project will do, read off the settings view.
 *
 * Mirrors the emptiness checks the drive itself makes — a hook step returns
 * early on a blank command and the dev pane is spawned only when `devCommand`
 * is set — so the review page describes the drive the human is about to get
 * rather than the fully-prepared one we wish they had. `undefined` while the
 * settings query is in flight: unknown is not the same answer as "none".
 */
export function driveCapabilities(view: SettingsView | undefined): DriveCapabilities | undefined {
  if (!view) return undefined
  const set = (key: string): boolean => {
    const value = view.fields.find((f) => f.key === key)?.value
    return typeof value === 'string' && value.trim().length > 0
  }
  return {
    setup: set('driveSetupCommand'),
    dev: set('devCommand'),
    teardown: set('driveStopCommand'),
  }
}

/**
 * The one-line provenance note under a prepared field.
 *
 * The staleness half is the point: a value measured 200 commits ago is not
 * obviously wrong, which is exactly why it needs saying out loud — a test
 * baseline that has silently rotted gets trusted by every agent that reads it.
 * An unknown distance (rebased-away sha) says "unknown", never "fresh".
 *
 * A drive-loop key's note also carries its dry-run stamp, because settings is
 * where a human edits the value and any edit clears the stamp (decision 6) — the
 * place it goes away has to be the place it was visible.
 */
export function describeFinding(f: {
  source: string
  establishedAt: number
  establishedSha?: string
  staleCommits?: number
  verifiedAt?: number
  key: string
}): string {
  return `${provenanceNote(f)}${verificationNote(f)}`
}

/** The dry-run half of the note; empty for a key no dry run can prove. */
function verificationNote(f: { key: string; verifiedAt?: number }): string {
  if (!isVerifiable(f.key)) return ''
  return f.verifiedAt === undefined
    ? ' Unverified — never proven by a dry run.'
    : ` Verified ${relativeAge(f.verifiedAt)} by a dry run.`
}

/** Who established the value and how far the repo has moved since. */
function provenanceNote(f: {
  source: string
  establishedAt: number
  establishedSha?: string
  staleCommits?: number
  key: string
}): string {
  if (f.source === 'human') return `You set this ${relativeAge(f.establishedAt)}.`

  // A `session` value was established on the developer's own machine with them
  // present, so the host-only caveat does not apply to it — that caveat exists
  // because a container cannot execute those keys, and this one can.
  const how =
    f.source === 'session'
      ? 'Established in a conversation on this machine'
      : HOST_ONLY_PREPARED.has(f.key)
        ? 'Proposed by preparation from config (not executed)'
        : 'Established by preparation'
  const when = relativeAge(f.establishedAt)

  if (f.staleCommits === undefined) {
    return `${how} ${when}${f.establishedSha ? ' — age against main unknown' : ''}.`
  }
  if (f.staleCommits === 0) return `${how} ${when} — main has not moved since.`
  return `${how} ${when} — main has moved ${f.staleCommits} commit${f.staleCommits === 1 ? '' : 's'} since.`
}

/**
 * How many commits of drift before a finding is worth flagging rather than just
 * reporting. Under this, movement is normal churn; over it, a re-prepare is the
 * suggestion. A round number by design — there is no principled threshold, and
 * pretending otherwise would be false precision.
 */
export const STALE_COMMIT_THRESHOLD = 100

/** Whether a finding is stale enough to nudge about. Human values never are. */
export function isStale(f: { source: string; staleCommits?: number }): boolean {
  return f.source !== 'human' && (f.staleCommits ?? 0) >= STALE_COMMIT_THRESHOLD
}

/** The provenance a prepared field carries, when one has been established. */
export interface FindingLike {
  key: string
  source: string
  evidence?: string
  establishedAt: number
  establishedSha?: string
  staleCommits?: number
  /** When a dry run last proved this value; drive-loop keys only (decision 10). */
  verifiedAt?: number
}
