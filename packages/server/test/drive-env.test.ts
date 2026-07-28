import { describe, expect, it } from 'vitest'
import {
  driveProcessEnv,
  driveVars,
  identifierSafe,
  parseDriveEnv,
  renderTemplate,
} from '../src/services/drive-env'

/**
 * Per-drive environment overrides — the generic half of "a database per
 * branch". runcastle renders the variables and injects them; creating the
 * database they name stays a project-supplied command, so nothing here knows
 * what a database is.
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

describe('driveVars', () => {
  it('exposes the raw slug, the branch, and an identifier-safe form', () => {
    expect(driveVars(identity)).toEqual({
      slug: 'add-billing',
      branch: 'feature/add-billing',
      id: 'add_billing',
    })
  })
})

describe('renderTemplate', () => {
  it('substitutes known placeholders, tolerating inner whitespace', () => {
    const { value } = renderTemplate('db_{{id}}_{{ slug }}', driveVars(identity))
    expect(value).toBe('db_add_billing_add-billing')
  })

  // Substituting a blank would produce a plausible connection string pointing at
  // the wrong database. Leaving it literal fails loudly instead.
  it('leaves an unknown placeholder literal and reports it', () => {
    const { value, unknown } = renderTemplate('db_{{nope}}', driveVars(identity))
    expect(value).toBe('db_{{nope}}')
    expect(unknown).toEqual(['nope'])
  })

  it('reports each unknown placeholder once', () => {
    expect(renderTemplate('{{a}}{{a}}{{b}}', {}).unknown).toEqual(['a', 'b'])
  })
})

describe('parseDriveEnv', () => {
  it('is empty for an unset or blank field', () => {
    expect(parseDriveEnv(undefined, identity).vars).toEqual({})
    expect(parseDriveEnv('   \n  \n', identity).vars).toEqual({})
  })

  it('renders the per-branch database URL that motivates the whole feature', () => {
    const { vars } = parseDriveEnv(
      'DATABASE_URL=postgres://localhost:5432/myapp_{{id}}',
      identity,
    )
    expect(vars.DATABASE_URL).toBe('postgres://localhost:5432/myapp_add_billing')
  })

  it('reads several lines, ignoring blanks and comments', () => {
    const { vars } = parseDriveEnv(
      ['# per-branch database', 'DATABASE_URL=postgres:///app_{{id}}', '', 'REDIS_DB=3'].join('\n'),
      identity,
    )
    expect(vars).toEqual({ DATABASE_URL: 'postgres:///app_add_billing', REDIS_DB: '3' })
  })

  it('tolerates the shapes people actually paste from a .env file', () => {
    const { vars } = parseDriveEnv(
      ['export FOO = bar', 'QUOTED="has spaces"', "SINGLE='x'"].join('\n'),
      identity,
    )
    expect(vars).toEqual({ FOO: 'bar', QUOTED: 'has spaces', SINGLE: 'x' })
  })

  // A connection string is full of `=` and `:`; only the first `=` separates.
  it('splits on the first = only', () => {
    const { vars } = parseDriveEnv('DATABASE_URL=postgres:///d?opts=a=b', identity)
    expect(vars.DATABASE_URL).toBe('postgres:///d?opts=a=b')
  })

  it('drops lines that cannot mean anything rather than failing the drive', () => {
    const { vars } = parseDriveEnv(['no-equals-here', '=novalue', 'OK=1'].join('\n'), identity)
    expect(vars).toEqual({ OK: '1' })
  })

  it('collects unknown placeholders across every line', () => {
    const { unknown } = parseDriveEnv(['A={{oops}}', 'B={{alsoBad}}'].join('\n'), identity)
    expect(unknown).toEqual(['oops', 'alsoBad'])
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
