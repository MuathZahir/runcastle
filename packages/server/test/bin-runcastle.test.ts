import { describe, expect, it } from 'vitest'
import { parseCommand } from '../src/bin/runcastle'

/**
 * Issue #51 — the published `runcastle` bin dispatches subcommands. Bare
 * `runcastle` boots the server (serving the SPA); `runcastle doctor` runs the
 * pre-boot diagnostic and forwards its flags; `--version`/`--help` are handled
 * without booting anything. `parseCommand` is the pure dispatch so the routing
 * is tested without spawning a server.
 */
describe('parseCommand', () => {
  it('defaults to serve with no args', () => {
    expect(parseCommand([])).toEqual({ command: 'serve', args: [] })
  })

  it('routes the doctor subcommand and forwards its flags', () => {
    expect(parseCommand(['doctor'])).toEqual({ command: 'doctor', args: [] })
    expect(parseCommand(['doctor', '--gate'])).toEqual({ command: 'doctor', args: ['--gate'] })
  })

  it('routes the build-image subcommand', () => {
    expect(parseCommand(['build-image'])).toEqual({ command: 'build-image', args: [] })
  })

  it('routes setup, token and service, forwarding their arguments', () => {
    expect(parseCommand(['setup', '--yes'])).toEqual({ command: 'setup', args: ['--yes'] })
    expect(parseCommand(['token', '--stdin'])).toEqual({ command: 'token', args: ['--stdin'] })
    expect(parseCommand(['service', 'install'])).toEqual({ command: 'service', args: ['install'] })
  })

  it('handles --version / -v without booting', () => {
    expect(parseCommand(['--version']).command).toBe('version')
    expect(parseCommand(['-v']).command).toBe('version')
  })

  it('handles --help / -h', () => {
    expect(parseCommand(['--help']).command).toBe('help')
    expect(parseCommand(['-h']).command).toBe('help')
  })

  it('treats an unknown subcommand as help (never a silent boot)', () => {
    expect(parseCommand(['bogus']).command).toBe('help')
  })
})
