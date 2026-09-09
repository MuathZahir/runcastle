import { describe, expect, it } from 'vitest'
import { formatExecFailureMessage } from '@ai-hero/sandcastle'
import { noSandbox } from '@ai-hero/sandcastle/sandboxes/no-sandbox'
import { buildGuardInstallCommand } from '../src/workflows/burn-guard'

/**
 * The second half of the `patches/@ai-hero%2Fsandcastle@0.12.0.patch` contract
 * (the first is `sandcastle-volume-mount.test.ts`).
 *
 * Sandcastle 0.12.0 renders a failed setup/verify command as
 * `Command failed (exit N): <command>\n<stderr>`. That loses a setup failure
 * twice over: Maven, Gradle and most JVM build tools write their diagnostics to
 * STDOUT, so a real failure arrived as a bare "exit 1" with nothing under it —
 * and the burn's `onSandboxReady` hook delivers the guard as base64 payloads
 * (`buildGuardInstallCommand`), so the echoed command buried whatever diagnostic
 * there was under kilobytes of noise.
 *
 * The patch renders the message through `formatExecFailureMessage`, exported so
 * these tests can drive the compiled function itself rather than a
 * re-implementation of it — the patch's whole risk is that a `bun install`
 * silently stops applying it.
 */

/** How much of the combined output the message keeps — sandcastle's own cap. */
const MAX_TAIL_CHARS = 64 * 1024

describe('sandcastle exec failure messages (patched)', () => {
  it('shows the stdout tail when the failure said nothing on stderr', () => {
    const message = formatExecFailureMessage('mvn -q verify', {
      exitCode: 1,
      stdout: '[ERROR] Failed to execute goal on project app: Could not resolve dependencies',
      stderr: '',
    })

    expect(message).toContain('[ERROR] Failed to execute goal on project app')
  })

  it('still shows stderr, and shows it after stdout', () => {
    const message = formatExecFailureMessage('bun install', {
      exitCode: 1,
      stdout: 'resolving dependencies',
      stderr: 'error: lockfile had changes, but lockfile is frozen',
    })

    expect(message).toContain('resolving dependencies')
    expect(message.indexOf('lockfile is frozen')).toBeGreaterThan(
      message.indexOf('resolving dependencies'),
    )
  })

  it('names the command and the exit code', () => {
    const message = formatExecFailureMessage('git checkout --detach', {
      exitCode: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
    })

    expect(message).toContain('git checkout --detach')
    expect(message).toContain('128')
  })

  // The payload is one unbroken token; everything around it is what a human
  // reads to know WHICH file the setup command was writing when it failed.
  it('elides the base64 payloads of the burn guard install command', () => {
    const command = buildGuardInstallCommand()
    const payload = /printf %s '([A-Za-z0-9+/=]{120,})'/.exec(command)?.[1]
    expect(payload).toBeDefined()

    const message = formatExecFailureMessage(command, {
      exitCode: 1,
      stdout: '',
      stderr: 'sh: base64: not found',
    })

    expect(message).not.toContain(payload)
    expect(message).toContain('| base64 -d > "$HOME/.claude/hooks/burn-guard.sh"')
  })

  // Elision is for the payload, not for length: a long URL, a JSON argument or
  // a generated id is often the very thing that explains the failure.
  it('keeps a long argument that is not a quoted payload', () => {
    const url = 'x'.repeat(120)

    const message = formatExecFailureMessage(`tool --url ${url}`, {
      exitCode: 1,
      stdout: '',
      stderr: 'failed',
    })

    expect(message).toContain(url)
  })

  it('bounds the combined tail so a whole build log cannot become the message', () => {
    const headline = 'Command failed (exit 1): gradle build'
    const message = formatExecFailureMessage('gradle build', {
      exitCode: 1,
      stdout: 'x'.repeat(MAX_TAIL_CHARS * 2),
      stderr: 'FAILURE: Build failed with an exception.',
    })

    expect(message.startsWith(`${headline}\n`)).toBe(true)
    expect(message.length - headline.length - 1).toBe(MAX_TAIL_CHARS)
    // The tail is kept, not the head — the last thing said is the diagnostic.
    expect(message).toContain('FAILURE: Build failed with an exception.')
  })

  // A provider given a smaller `maxOutputTailChars` asked for messages that fit
  // in it; the 64 KiB default is what it was overriding.
  it('bounds the combined tail by a caller-configured cap, not the default', () => {
    const headline = 'Command failed (exit 1): gradle build'
    const message = formatExecFailureMessage(
      'gradle build',
      {
        exitCode: 1,
        stdout: 'x'.repeat(500),
        stderr: 'FAILURE: Build failed with an exception.',
      },
      100,
    )

    expect(message.startsWith(`${headline}\n`)).toBe(true)
    expect(message.length - headline.length - 1).toBe(100)
    expect(message).toContain('FAILURE: Build failed with an exception.')
  })
})

/**
 * The other half of honouring that cap: the value is configured on a PROVIDER,
 * and has to reach the formatter. Every provider publishes its resolved bound
 * on the handle it creates, and `makeSandboxFromHandle` carries it to the
 * `execOk2` that renders a failed setup/verify command.
 *
 * `noSandbox` is the provider that can be driven here — its `create` spawns
 * nothing, so no container engine and no mock is needed to observe the handle.
 */
describe('sandcastle providers publish their configured output bound (patched)', () => {
  const createOptions = { worktreePath: process.cwd(), env: {} }

  it('carries a configured maxOutputTailChars onto the handle it creates', async () => {
    const handle = await noSandbox({ maxOutputTailChars: 100 }).create(createOptions)

    expect(handle.maxOutputTailChars).toBe(100)
  })

  it('publishes the default when the provider was configured without one', async () => {
    const handle = await noSandbox().create(createOptions)

    expect(handle.maxOutputTailChars).toBe(MAX_TAIL_CHARS)
  })
})
