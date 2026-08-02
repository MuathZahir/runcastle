import { describe, expect, it } from 'vitest'
import {
  STALE_COMMIT_THRESHOLD,
  describeField,
  describeFinding,
  isStale,
  projectRows,
  relativeAge,
  unverifiedDriveKeys,
  verificationBadge,
} from '../src/lib/settings'
import type { SettingField, SettingsView } from '../src/lib/api'

/**
 * Presentation of prepared-field provenance. The question every one of these
 * answers is "should I trust this value" — who established it, whether it was
 * measured or merely read, and how far the repo has moved since.
 */

const HOUR = 3600_000
const DAY = 24 * HOUR

const finding = (over: Partial<Parameters<typeof describeFinding>[0]> = {}) => ({
  key: 'verifyCommands',
  source: 'prep',
  establishedAt: Date.now(),
  ...over,
})

const field = (over: Partial<SettingField>): SettingField =>
  ({
    key: 'verifyCommands',
    value: 'bun test',
    source: 'project',
    editable: true,
    restartRequired: false,
    scope: 'project',
    ...over,
  }) as SettingField

describe('relativeAge', () => {
  it('reads coarsely, which is all staleness needs', () => {
    const now = Date.now()
    expect(relativeAge(now, now)).toBe('just now')
    expect(relativeAge(now - 5 * 60_000, now)).toBe('5m ago')
    expect(relativeAge(now - 3 * HOUR, now)).toBe('3h ago')
    expect(relativeAge(now - 5 * DAY, now)).toBe('5d ago')
  })
})

describe('describeFinding', () => {
  it('credits the human when they set it, and never mentions staleness', () => {
    const note = describeFinding(finding({ source: 'human', staleCommits: 900 }))
    expect(note).toMatch(/^You set this/)
    expect(note).not.toContain('main has moved')
  })

  it('says a measured value was measured', () => {
    expect(describeFinding(finding({ staleCommits: 0 }))).toContain('Established by preparation')
  })

  // devCommand/dbResetCommand are read from config, never executed — a sandbox
  // is not the developer's machine. Saying so stops a proposal being read as a
  // measurement.
  it('marks host-only keys as proposed rather than established', () => {
    const note = describeFinding(finding({ key: 'dbResetCommand', staleCommits: 0 }))
    expect(note).toContain('Proposed by preparation from config (not executed)')
  })

  it('reports how far main has moved since the measurement', () => {
    expect(describeFinding(finding({ staleCommits: 1 }))).toContain('1 commit since')
    expect(describeFinding(finding({ staleCommits: 42 }))).toContain('42 commits since')
    expect(describeFinding(finding({ staleCommits: 0 }))).toContain('has not moved since')
  })

  // A sha that was rebased out of history cannot be measured against. Reporting
  // that as "0 commits behind" would present the riskiest case as the safest.
  it('says unknown — never "fresh" — when the distance cannot be computed', () => {
    const note = describeFinding(finding({ establishedSha: 'gone', staleCommits: undefined }))
    expect(note).toContain('unknown')
    expect(note).not.toContain('has not moved')
  })
})

describe('isStale', () => {
  it('flags a finding only past the threshold', () => {
    expect(isStale(finding({ staleCommits: STALE_COMMIT_THRESHOLD - 1 }))).toBe(false)
    expect(isStale(finding({ staleCommits: STALE_COMMIT_THRESHOLD }))).toBe(true)
  })

  it('never flags a value the human owns', () => {
    expect(isStale(finding({ source: 'human', staleCommits: 5000 }))).toBe(false)
  })
})

describe('describeField with provenance', () => {
  it('replaces the generic override note with real provenance', () => {
    const row = describeField(field({}), finding({ staleCommits: 3, evidence: 'exit 0 in 48s' }))
    expect(row.note).toContain('Established by preparation')
    expect(row.note).not.toBe('Overridden for this project')
    expect(row.evidence).toBe('exit 0 in 48s')
    expect(row.stale).toBe(false)
  })

  it('falls back to the scope note when nothing was established', () => {
    expect(describeField(field({})).note).toBe('Overridden for this project')
    expect(describeField(field({ source: 'default' })).note).toBe('Inherited from global')
  })

  // An env var outranks everything: the value on screen came from neither the
  // human's settings write nor the prep run, so provenance would misattribute.
  it('keeps the env lock note ahead of provenance', () => {
    const row = describeField(field({ source: 'env', editable: false }), finding({}))
    expect(row.note).toContain('RUNCASTLE_VERIFY_COMMANDS')
  })

  it('marks a long-unmeasured finding stale', () => {
    expect(describeField(field({}), finding({ staleCommits: 500 })).stale).toBe(true)
  })
})

// A settings key with no META entry silently renders as a bare text input with
// no help — and driveEnv is multi-line, so a text input would eat the newlines
// that separate its variables.
describe('drive field presentation', () => {
  it('gives every prepared key a label, help text and the right control', () => {
    const rows = projectRows({
      projectId: 'proj_1',
      fields: [
        field({ key: 'driveSetupCommand', value: 'make up' }),
        field({ key: 'driveStopCommand', value: 'make down' }),
        field({ key: 'driveEnv', value: 'DATABASE_URL=x' }),
      ],
    } as SettingsView)

    for (const row of rows) {
      expect(row.label).not.toBe(row.key)
      expect(row.help.length).toBeGreaterThan(0)
    }
    expect(rows.find((r) => r.key === 'driveEnv')?.control).toBe('textarea')
  })

  it('marks the drive fields as proposed, not measured', () => {
    const note = describeFinding(finding({ key: 'driveEnv', staleCommits: 0 }))
    expect(note).toContain('not executed')
  })
})

/**
 * Ticket 3 / decision 10 — the dry-run stamp reaches settings, the surface where
 * a human edits the value and the edit clears it. Only the four drive-loop keys
 * have an observable a host drive produces; on everything else the absence of a
 * badge means "unverifiable", not "failed", so no wording appears at all.
 */
describe('verificationBadge', () => {
  const now = Date.now()

  it('ages a stamped drive-loop key', () => {
    expect(verificationBadge({ key: 'devCommand', verifiedAt: now - 3 * HOUR }, now)).toBe(
      'verified 3h ago',
    )
  })

  it('calls an unstamped drive-loop key unverified', () => {
    expect(verificationBadge({ key: 'driveSetupCommand' }, now)).toBe('unverified')
  })

  it('says nothing at all about a key no dry run can prove', () => {
    for (const key of ['dbResetCommand', 'setupCommand', 'verifyCommands', 'knownFailures']) {
      expect(verificationBadge({ key, verifiedAt: now }, now)).toBeNull()
    }
  })

  // The stamp records that this exact value was seen working, not who chose it.
  it('badges a human-set value like any other', () => {
    expect(verificationBadge({ key: 'driveEnv', verifiedAt: now }, now)).toBe('verified just now')
  })
})

describe('unverifiedDriveKeys', () => {
  it('lists the drive-loop keys with a finding row and no stamp, in key order', () => {
    expect(
      unverifiedDriveKeys([
        finding({ key: 'driveEnv' }),
        finding({ key: 'devCommand', verifiedAt: Date.now() }),
        finding({ key: 'driveSetupCommand' }),
      ]),
    ).toEqual(['driveSetupCommand', 'driveEnv'])
  })

  // A key with no value is not part of the drive at all — a checkout-only drive
  // has nothing to doubt, so it must warn about nothing.
  it('ignores keys nothing was ever established for', () => {
    expect(unverifiedDriveKeys([])).toEqual([])
    expect(unverifiedDriveKeys([finding({ key: 'verifyCommands' })])).toEqual([])
  })

  it('is empty once every established drive key is stamped', () => {
    const now = Date.now()
    expect(
      unverifiedDriveKeys([
        finding({ key: 'devCommand', verifiedAt: now }),
        finding({ key: 'driveStopCommand', verifiedAt: now }),
      ]),
    ).toEqual([])
  })
})

describe('describeFinding — the dry-run stamp', () => {
  it('appends the stamp to a verified drive-loop key', () => {
    const note = describeFinding(
      finding({ key: 'driveStopCommand', staleCommits: 0, verifiedAt: Date.now() }),
    )
    expect(note).toContain('Verified just now by a dry run')
  })

  it('says an unstamped drive-loop key was never proven', () => {
    const note = describeFinding(finding({ key: 'driveSetupCommand', staleCommits: 0 }))
    expect(note).toContain('Unverified — never proven by a dry run')
  })

  // Provenance and verification are orthogonal (decision 6) — the human branch
  // returns early on its own sentence, and the stamp still has to land.
  it('stamps a human-set drive-loop key too', () => {
    const note = describeFinding(
      finding({ key: 'devCommand', source: 'human', verifiedAt: Date.now() }),
    )
    expect(note).toMatch(/^You set this/)
    expect(note).toContain('Verified just now by a dry run')
  })

  it('leaves an unverifiable key’s note exactly as it was', () => {
    const note = describeFinding(finding({ key: 'verifyCommands', staleCommits: 0 }))
    expect(note).toBe('Established by preparation just now — main has not moved since.')
  })
})

describe('projectRows', () => {
  it('carries the stamp into the prepared field’s note', () => {
    const view = {
      projectId: 'proj_1',
      fields: [field({ key: 'devCommand', value: 'bun dev' })],
    } as SettingsView

    const stamped = projectRows(view, [finding({ key: 'devCommand', verifiedAt: Date.now() })])
    expect(stamped[0]?.note).toContain('Verified just now by a dry run')

    // The server clears the stamp on any write, so the refetched view is the
    // same finding minus `verifiedAt` — and the note has to follow it back.
    const cleared = projectRows(view, [finding({ key: 'devCommand' })])
    expect(cleared[0]?.note).toContain('Unverified — never proven by a dry run')
  })

  it('attaches each finding to its own field only', () => {
    const view = {
      projectId: 'proj_1',
      fields: [field({}), field({ key: 'devCommand', value: 'bun dev' })],
    } as SettingsView

    const rows = projectRows(view, [finding({ key: 'devCommand', source: 'human' })])
    expect(rows.find((r) => r.key === 'devCommand')?.note).toMatch(/^You set this/)
    expect(rows.find((r) => r.key === 'verifyCommands')?.note).toBe('Overridden for this project')
  })

  it('is unchanged when no findings exist', () => {
    const view = { projectId: 'proj_1', fields: [field({})] } as SettingsView
    expect(projectRows(view)).toHaveLength(1)
  })
})
