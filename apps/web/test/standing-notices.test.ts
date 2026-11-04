import { describe, expect, it, vi } from 'vitest'
import {
  slotBlocker,
  standingNotices,
  type SlotDriveInfo,
  type SlotStop,
  type StandingActs,
  type StandingInput,
} from '../src/lib/standing-notices'

/**
 * the-feature-s-right-panel decision 21: what the retired Review view warned
 * about stands on the chat's notice strip while its condition holds.
 */
const NONE: StandingInput = {
  shipped: false,
  branch: 'feature/greetings',
  conflict: null,
  conflictResolved: false,
  resolveEnded: false,
  liveSessionId: null,
  denial: null,
  unverified: null,
  blockingDrive: null,
}
const CONFLICT = { base: 'main', files: ['index.html', 'src/App.tsx'], at: 1 }
const DENIAL = { eventId: 7, at: 1, dirtyFiles: ['a.ts'], message: 'review drive denied — 1 uncommitted file(s)' }
const PROJECT_STOP: SlotStop = { kind: 'project', projectId: 'p1' }
const UNVERIFIED ={ kind: 'unverified' as const, line: 'Nothing was verified', reason: 'no browser' }

function acts(over: Partial<StandingActs> = {}): StandingActs {
  return { resolve: vi.fn(), resolving: false, dismissDenial: vi.fn(), stopDrive: vi.fn(), stopping: false, ...over }
}
const rows = (over: Partial<StandingInput>, a = acts()) => standingNotices({ ...NONE, ...over }, a)

describe('standingNotices', () => {
  it('stands nothing while nothing is wrong', () => {
    expect(rows({})).toEqual([])
  })

  it('warns about nothing on a shipped feature', () => {
    expect(rows({ shipped: true, conflict: CONFLICT, denial: DENIAL, unverified: UNVERIFIED })).toEqual([])
  })

  it('stands a merge conflict in the danger hue, its files in the tooltip, resolved by the agent', () => {
    const a = acts()
    const [row] = rows({ conflict: CONFLICT }, a)
    expect(row).toMatchObject({ hue: 'danger', title: 'Merge conflict', subtitle: '2 files · main into feature/greetings' })
    expect(row.tooltip).toBe('index.html\nsrc/App.tsx')
    expect(row.action?.label).toBe('Resolve with agent')
    expect(row.onDismiss).toBeUndefined()
    row.action?.onClick()
    expect(a.resolve).toHaveBeenCalled()
  })

  it('offers to end a live session on the way in, and holds the button while the resolve launches', () => {
    const [row] = rows({ conflict: CONFLICT, liveSessionId: 'ses_1' }, acts({ resolving: true }))
    expect(row.action).toMatchObject({ label: 'End the chat & resolve', disabled: true })
    expect(row.tooltip).toContain('One terminal per feature')
  })

  it('says when a resolve session ended without the merge landing', () => {
    expect(rows({ conflict: CONFLICT, resolveEnded: true })[0].tooltip).toContain('merge hasn’t landed')
  })

  it('steps a resolved conflict down to a row with nothing to click', () => {
    const [row] = rows({ conflictResolved: true })
    expect(row).toMatchObject({ title: 'Conflict resolved', subtitle: 'ready to merge' })
    expect(row.action).toBeUndefined()
    expect(row.onDismiss).toBeUndefined()
  })

  it('lets a refused review drive be dismissed, its raw message in the tooltip', () => {
    const a = acts()
    const [row] = rows({ denial: DENIAL }, a)
    expect(row.title).toBe('Review couldn’t drive')
    expect(row.tooltip).toBe('review drive denied — 1 uncommitted file(s)\na.ts')
    expect(row.action).toBeUndefined()
    row.onDismiss?.()
    expect(a.dismissDenial).toHaveBeenCalled()
  })

  it('says nothing was verified with no button, the outcome in the tooltip', () => {
    const [row] = rows({ unverified: UNVERIFIED })
    expect(row).toMatchObject({ title: 'Nothing verified', subtitle: 'ask the agent for another review, or drive it yourself' })
    expect(row.tooltip).toBe('Nothing was verified\nno browser')
    expect(row.action).toBeUndefined()
    expect(row.onDismiss).toBeUndefined()
  })

  it('names a project drive holding the slot and offers to stop it', () => {
    const a = acts()
    const [row] = rows({ blockingDrive: { holderLabel: 'a project drive of main', cutOff: false, stop: PROJECT_STOP } }, a)
    expect(row.title).toBe('A project drive of main is running')
    row.action?.onClick()
    expect(a.stopDrive).toHaveBeenCalled()
    expect(rows({ blockingDrive: { holderLabel: 'x', cutOff: false, stop: PROJECT_STOP } }, acts({ stopping: true }))[0].action).toMatchObject({
      label: 'Stopping…',
      disabled: true,
    })
  })

  it('names a live review round’s drive with no stop, and says when it ends', () => {
    const [row] = rows({ blockingDrive: { holderLabel: "the review agent's drive of feature/x", cutOff: false, stop: null } })
    expect(row.title).toBe("The review agent's drive of feature/x is running")
    expect(row.subtitle).toContain('review round ends')
    expect(row.action).toBeUndefined()
  })

  it('says a cut-off drive holds the slot rather than runs, and offers to stop it', () => {
    const label = 'a test drive of feature/x (cut off by a restart)'
    const [row] = rows({ blockingDrive: { holderLabel: label, cutOff: true, stop: { kind: 'feature', featureId: 'f2' } } })
    expect(row.title).toBe('A test drive of feature/x (cut off by a restart) holds the drive slot')
    expect(row.action?.label).toBe('Stop it')
  })

  it('stands every warning at once, the conflict first', () => {
    const keys = rows({
      conflict: CONFLICT,
      denial: DENIAL,
      unverified: UNVERIFIED,
      blockingDrive: { holderLabel: 'x', cutOff: false, stop: PROJECT_STOP },
    }).map((r) => r.key)
    expect(keys).toEqual(['conflict', 'denial-7', 'unverified', 'slot-drive'])
  })
})

/** ADR-0014: whatever holds the slot in a feature's way is named, and stopped by its own kind's mutation. */
describe('slotBlocker', () => {
  const FEATURE = { id: 'f1', projectId: 'p1' }
  const block = (drive: SlotDriveInfo | null, driveUp = false) => slotBlocker(drive, FEATURE, driveUp)

  it('stands nothing while the slot is free or held by this feature’s own live drive', () => {
    expect(block(null)).toBeNull()
    expect(block({ holderLabel: 'a test drive of feature/one', featureId: 'f1' }, true)).toBeNull()
  })

  it('stops another feature’s drive through that feature', () => {
    expect(block({ holderLabel: 'a test drive of feature/two', featureId: 'f2', purpose: 'human' })).toEqual({
      holderLabel: 'a test drive of feature/two',
      cutOff: false,
      stop: { kind: 'feature', featureId: 'f2' },
    })
  })

  it('stops a project drive and a dry run through the project', () => {
    expect(block({ holderLabel: 'a project drive of main', projectDrive: true, projectId: 'p1' })?.stop).toEqual(PROJECT_STOP)
    expect(block({ holderLabel: 'a preparation dry-run', dryRun: true })?.stop).toEqual({ kind: 'dryRun', projectId: 'p1' })
  })

  it('offers no stop for a live review agent’s drive', () => {
    const blocker = block({ holderLabel: "the review agent's drive of feature/two", featureId: 'f2', purpose: 'review' })
    expect(blocker).toMatchObject({ stop: null })
  })

  it('offers a stop for a cut-off drive of any purpose, this feature’s own included', () => {
    const own = { holderLabel: "the review agent's drive of feature/one (cut off by a restart)", featureId: 'f1', purpose: 'review' as const, cutOff: true }
    expect(block(own, true)).toEqual({ holderLabel: own.holderLabel, cutOff: true, stop: { kind: 'feature', featureId: 'f1' } })
  })
})
