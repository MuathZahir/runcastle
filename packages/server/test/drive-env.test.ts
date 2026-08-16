import { describe, expect, it } from 'vitest'
import {
  driveIdentityEnv,
  driveProcessEnv,
  identifierSafe,
  parseEnvFile,
} from '../src/services/drive-env'

/**
 * The drive's environment contract: the server passes identity in as
 * `RUNCASTLE_*` variables, the project's setup script computes everything else
 * and writes it back as a `KEY=VALUE` file. Nothing here knows what a database
 * is — it only carries variables across the process boundary.
 */

const identity = { slug: 'add-billing', branch: 'feature/add-billing' }

describe('identifierSafe', () => {
  it('reduces a slug to something usable as a database name', () => {
    expect(identifierSafe('add-billing')).toBe('add_billing')
    expect(identifierSafe('PROJ-1284/Refactor Adapter')).toBe('proj_1284_refactor_adapter')
  })

  it('never starts with a digit, which most engines reject unquoted', () => {
    expect(identifierSafe('1984-cleanup')).toMatch(/^[a-z_]/)
  })

  it('survives a slug with nothing usable in it', () => {
    expect(identifierSafe('---')).toMatch(/^[a-z_]/)
    expect(identifierSafe('')).toMatch(/^[a-z_]/)
  })

  // Postgres truncates identifiers at 63 bytes, so two long branches sharing a
  // prefix would silently become the SAME database — the one failure mode here
  // that corrupts data rather than erroring.
  it('keeps truncated long slugs distinct with a hash suffix', () => {
    const prefix = 'refactor-the-billing-adapter-and-everything-around-it'
    const a = identifierSafe(`${prefix}-part-one`)
    const b = identifierSafe(`${prefix}-part-two`)
    expect(a.length).toBeLessThanOrEqual(40)
    expect(b.length).toBeLessThanOrEqual(40)
    expect(a).not.toBe(b)
  })

  it('is deterministic — the same branch resolves to the same database twice', () => {
    expect(identifierSafe('some-very-long-branch-name-that-will-be-truncated-here')).toBe(
      identifierSafe('some-very-long-branch-name-that-will-be-truncated-here'),
    )
  })
})

describe('driveIdentityEnv', () => {
  // The two things a script cannot work out for itself: which drive it serves,
  // and a form of that name a database will accept.
  it('names the drive with the raw slug, the branch and an identifier-safe form', () => {
    expect(driveIdentityEnv(identity)).toEqual({
      RUNCASTLE_SLUG: 'add-billing',
      RUNCASTLE_BRANCH: 'feature/add-billing',
      RUNCASTLE_ID: 'add_billing',
    })
  })
})

describe('parseEnvFile', () => {
  it('is empty for a missing or blank file', () => {
    expect(parseEnvFile(undefined)).toEqual({})
    expect(parseEnvFile('   \n  \n')).toEqual({})
  })

  it('reads several lines, ignoring blanks and comments', () => {
    expect(
      parseEnvFile(
        ['# written by drive-setup', 'DATABASE_URL=postgres:///app_add_billing', '', 'PORT=4137'].join('\n'),
      ),
    ).toEqual({ DATABASE_URL: 'postgres:///app_add_billing', PORT: '4137' })
  })

  it('tolerates the shapes a shell script really emits', () => {
    expect(parseEnvFile(['export FOO = bar', 'QUOTED="has spaces"', "SINGLE='x'"].join('\n'))).toEqual(
      { FOO: 'bar', QUOTED: 'has spaces', SINGLE: 'x' },
    )
  })

  // A connection string is full of `=` and `:`; only the first `=` separates.
  it('splits on the first = only', () => {
    expect(parseEnvFile('DATABASE_URL=postgres:///d?opts=a=b').DATABASE_URL).toBe(
      'postgres:///d?opts=a=b',
    )
  })

  it('drops lines that cannot mean anything rather than failing the drive', () => {
    expect(parseEnvFile(['no-equals-here', '=novalue', 'OK=1'].join('\n'))).toEqual({ OK: '1' })
  })

  // The script computed the value; templating it again is exactly the machinery
  // this contract retired, and a brace is a legal character in a password.
  it('takes values verbatim, substituting nothing', () => {
    expect(parseEnvFile('PASSWORD={{notatemplate}}').PASSWORD).toBe('{{notatemplate}}')
  })
})

describe('driveProcessEnv', () => {
  // The point is replacing a DATABASE_URL the shell already exports; inheriting
  // it would leave the drive on the shared database while looking configured.
  it('overrides an inherited variable rather than deferring to it', () => {
    const merged = driveProcessEnv(
      { DATABASE_URL: 'postgres:///branch_db' },
      { DATABASE_URL: 'postgres:///shared_db', PATH: '/usr/bin' },
    )
    expect(merged.DATABASE_URL).toBe('postgres:///branch_db')
    expect(merged.PATH).toBe('/usr/bin')
  })

  it('passes the rest of the environment through untouched', () => {
    const merged = driveProcessEnv({}, { HOME: '/home/me' })
    expect(merged.HOME).toBe('/home/me')
  })
})
