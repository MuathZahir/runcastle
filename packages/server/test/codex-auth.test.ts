import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexAuthFile, codexHomeDir, codexLoggedIn } from '../src/services/codex-auth'

/**
 * The one answer to "is this host logged in to Codex". Every surface that used
 * to have its own opinion — the doctor's AFK probe, the first-run wizard, the
 * burner's precheck — reads it from here, so these cases are the whole
 * definition of "Codex ready".
 */
describe('codexHomeDir / codexAuthFile', () => {
  it('honours CODEX_HOME over the home directory', () => {
    const env = { CODEX_HOME: join('/custom', 'codex'), HOME: '/home/someone' }

    expect(codexHomeDir(env)).toBe(join('/custom', 'codex'))
    expect(codexAuthFile(env)).toBe(join('/custom', 'codex', 'auth.json'))
  })

  it('falls back to $HOME/.codex', () => {
    expect(codexAuthFile({ HOME: '/home/someone' })).toBe(join('/home/someone', '.codex', 'auth.json'))
  })

  // Windows sets USERPROFILE and no HOME; the burner mounts whatever this says.
  it('falls back to %USERPROFILE% when there is no HOME', () => {
    const env = { USERPROFILE: join('C:', 'Users', 'user') }

    expect(codexAuthFile(env)).toBe(join('C:', 'Users', 'user', '.codex', 'auth.json'))
  })

  it('falls back to the OS home when the environment names neither', () => {
    expect(codexHomeDir({})).toBe(join(homedir(), '.codex'))
  })
})

describe('codexLoggedIn', () => {
  const env = { CODEX_HOME: join('/custom', 'codex') }

  it('is logged in when auth.json is present at the Codex home', () => {
    const seen: string[] = []
    const exists = (path: string): boolean => {
      seen.push(path)
      return true
    }

    expect(codexLoggedIn(env, exists)).toBe(true)
    // It is the credential file that decides, never the directory.
    expect(seen).toEqual([join('/custom', 'codex', 'auth.json')])
  })

  it('is logged out when the file is absent', () => {
    expect(codexLoggedIn(env, () => false)).toBe(false)
  })
})
