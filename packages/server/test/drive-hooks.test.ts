import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DRIVE_HOOK_TIMEOUT_MS,
  describeHookResult,
  runDriveHook,
  tailLines,
} from '../src/services/drive-hooks'

/**
 * Test-drive hooks: the project's own "bring my environment up" command.
 *
 * These run REAL commands rather than a mocked spawn, because the thing most
 * likely to break is the shell hosting — a `&&` chain, or a Windows `cmd /c`
 * exit code — and a fake spawn tests none of it. Every command here is chosen
 * to mean the same thing under `cmd.exe` and `sh`.
 */

const cwd = (): string => mkdtempSync(join(tmpdir(), 'rc-hook-'))

/** A command that hangs, spelled for whichever shell is hosting it. */
const HANG = process.platform === 'win32' ? 'ping -n 30 127.0.0.1' : 'sleep 30'

describe('tailLines', () => {
  it('keeps the end, which is where the error is', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const tail = tailLines(text, 3)
    expect(tail).toBe('line 97\nline 98\nline 99')
  })

  it('normalises CRLF so Windows output is not double-spaced', () => {
    expect(tailLines('a\r\nb\r\n', 10)).toBe('a\nb')
  })

  it('drops trailing blank lines rather than counting them as content', () => {
    expect(tailLines('real\n\n\n\n', 2)).toBe('real')
  })

  it('is empty for empty output', () => {
    expect(tailLines('   \n  \n')).toBe('')
  })
})

describe('runDriveHook', () => {
  it('reports success with the command output', async () => {
    const res = await runDriveHook('echo hook-ran', { cwd: cwd() })
    expect(res.ok).toBe(true)
    expect(res.exitCode).toBe(0)
    expect(res.timedOut).toBe(false)
    expect(res.output).toContain('hook-ran')
  })

  it('reports a non-zero exit as a failure, not a throw', async () => {
    const res = await runDriveHook('exit 3', { cwd: cwd() })
    expect(res.ok).toBe(false)
    expect(res.exitCode).toBe(3)
  })

  // The whole reason hooks are an opaque string: a user pastes the same
  // `&&` chain they run by hand, and it has to short-circuit the same way.
  it('hosts the command in a shell, so `&&` chains short-circuit', async () => {
    const res = await runDriveHook('exit 1 && echo should-not-appear', { cwd: cwd() })
    expect(res.ok).toBe(false)
    expect(res.output).not.toContain('should-not-appear')
  })

  it('captures stderr as well as stdout — a failure explains itself there', async () => {
    const res = await runDriveHook('echo to-stderr 1>&2 && exit 2', { cwd: cwd() })
    expect(res.ok).toBe(false)
    expect(res.output).toContain('to-stderr')
  })

  // `spawn` escapes an embedded quote as `\"`, which cmd.exe does not unescape —
  // so without verbatim args a command quoting a path with spaces arrives at the
  // shell mangled. Paths with spaces are the norm on Windows.
  it('passes a command containing quotes through to the shell intact', async () => {
    const dir = cwd()
    const target = join(dir, 'name with spaces.txt')
    const res = await runDriveHook(`echo quoted-ok > "${target}"`, { cwd: dir })
    expect(res.ok).toBe(true)
    expect(readFileSync(target, 'utf8')).toContain('quoted-ok')
  })

  // A command that cannot resolve at all is a failure like any other. The user
  // gets the shell's own "not found" text, which names the missing binary.
  it('treats an unresolvable command as a failure rather than throwing', async () => {
    const res = await runDriveHook('rc-definitely-not-a-real-binary-xyz', { cwd: cwd() })
    expect(res.ok).toBe(false)
    expect(res.exitCode).not.toBe(0)
  })

  // The spawn call itself can throw before the timeout is armed; the failure
  // path must not trip over a timer that does not exist yet.
  it('reports a synchronous spawn throw as a failure', async () => {
    const res = await runDriveHook('anything', {
      cwd: cwd(),
      spawnFn: (() => {
        throw new Error('spawn exploded')
      }) as unknown as typeof import('node:child_process').spawn,
    })
    expect(res.ok).toBe(false)
    expect(res.exitCode).toBeNull()
    expect(res.output).toContain('spawn exploded')
  })

  it('kills a hook that overruns its timeout and says so', async () => {
    const res = await runDriveHook(HANG, { cwd: cwd(), timeoutMs: 300 })
    expect(res.timedOut).toBe(true)
    expect(res.ok).toBe(false)
  }, 15_000)

  /**
   * The timeout used to kill only the shell, leaving whatever it started alive —
   * a `docker compose` still holding its port, a seed script still holding the
   * db. The grandchild here proves it by appending to a file: after the timeout
   * the file must stop growing.
   *
   * POSIX only. The tree the kill walks is a process GROUP here and the child
   * list on Windows, and this container has no way to observe the latter; that
   * half is covered per backend in dev-pane.test.ts. `& wait` is load-bearing —
   * without it `sh` exec-replaces itself with the ticker, and there is no
   * grandchild left to leak.
   */
  it('kills the whole hook process tree on timeout, not just the shell', async () => {
    if (process.platform === 'win32') return
    const dir = cwd()
    const log = join(dir, 'tick.log')
    writeFileSync(
      join(dir, 'ticker.mjs'),
      `import { appendFileSync } from 'node:fs'\nsetInterval(() => appendFileSync(${JSON.stringify(log)}, 'x'), 50)\n`,
    )

    const res = await runDriveHook(`"${process.execPath}" ticker.mjs & wait`, {
      cwd: dir,
      timeoutMs: 1500,
    })
    expect(res.timedOut).toBe(true)

    const ticksAtKill = statSync(log).size
    expect(ticksAtKill).toBeGreaterThan(0)
    await new Promise((r) => setTimeout(r, 700))
    expect(statSync(log).size, 'the grandchild outlived the timeout kill').toBe(ticksAtKill)
  }, 20_000)

  it('gives a cold image pull room to finish by default', () => {
    expect(DRIVE_HOOK_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * 60_000)
  })
})

describe('describeHookResult', () => {
  const base = { exitCode: 0, timedOut: false, output: '', durationMs: 4200 }

  it('distinguishes the three outcomes a user must tell apart', () => {
    expect(describeHookResult('make up', { ...base, ok: true })).toBe('`make up` finished in 4s')
    expect(describeHookResult('make up', { ...base, ok: false, exitCode: 7 })).toBe(
      '`make up` exited 7 after 4s',
    )
    expect(describeHookResult('make up', { ...base, ok: false, exitCode: null, timedOut: true })).toBe(
      '`make up` timed out after 4s',
    )
  })

  // A killed process reports no code; "exited without a code" beats "exited null".
  it('does not print a null exit code at the user', () => {
    const msg = describeHookResult('x', { ...base, ok: false, exitCode: null })
    expect(msg).toContain('without a code')
    expect(msg).not.toContain('null')
  })
})
