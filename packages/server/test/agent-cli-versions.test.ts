import { describe, expect, it } from 'vitest'
import type { ExecFn, ExecOutcome } from '../src/doctor/doctor'
import { parseAgentCliVersion, resolveHostAgentVersions } from '../src/services/agent-cli-versions'

/** An exec answering `<bin> --version` from a per-binary table. */
function versionsExec(outcomes: Record<string, Partial<ExecOutcome>>): ExecFn {
  return async (command, args) => {
    expect(args).toEqual(['--version'])
    return { ok: true, code: 0, stdout: '', stderr: '', ...outcomes[command] }
  }
}

const everywhere = () => true

describe('parseAgentCliVersion', () => {
  it('extracts the bare semver from both CLIs', () => {
    expect(parseAgentCliVersion('2.1.280 (Claude Code)\n')).toBe('2.1.280')
    expect(parseAgentCliVersion('codex-cli 0.46.0\n')).toBe('0.46.0')
    expect(parseAgentCliVersion('codex-cli 0.47.0-alpha.2')).toBe('0.47.0-alpha.2')
  })

  it('returns null for empty or garbage output', () => {
    expect(parseAgentCliVersion('')).toBeNull()
    expect(parseAgentCliVersion('command not found')).toBeNull()
    expect(parseAgentCliVersion('v2.1')).toBeNull()
  })
})

describe('resolveHostAgentVersions', () => {
  it('reads each runtime version from its CLI', async () => {
    const exec = versionsExec({
      claude: { stdout: '2.1.280 (Claude Code)\n' },
      codex: { stdout: 'codex-cli 0.46.0\n' },
    })
    expect(await resolveHostAgentVersions(exec, everywhere)).toEqual({
      versions: { 'claude-code': '2.1.280', codex: '0.46.0' },
      problems: {},
    })
  })

  it('reads an absent CLI as null with no problem — not on host, not checked', async () => {
    const exec = versionsExec({ claude: { stdout: '2.1.280 (Claude Code)' } })
    const result = await resolveHostAgentVersions(exec, (bin) => bin === 'claude')
    expect(result).toEqual({ versions: { 'claude-code': '2.1.280', codex: null }, problems: {} })
  })

  it.each([
    ['a spawn failure', { ok: false, code: null }, 'could not be started'],
    ['a non-zero exit', { code: 1, stdout: '2.1.280' }, 'exited 1'],
    ['unparseable output', { stdout: 'something odd' }, 'printed no version'],
  ])('reads %s as null with a named PATH-fix problem', async (_case, outcome, why) => {
    const exec = versionsExec({ claude: outcome, codex: { stdout: 'codex-cli 0.46.0' } })
    const { versions, problems } = await resolveHostAgentVersions(exec, everywhere)
    expect(versions).toEqual({ 'claude-code': null, codex: '0.46.0' })
    expect(problems.codex).toBeUndefined()
    expect(problems['claude-code']).toContain(why)
    expect(problems['claude-code']).toContain('installs the latest Claude Code CLI')
    expect(problems['claude-code']).toContain('fix its "Claude Code CLI" probe')
    expect(problems['claude-code']).toContain('where `claude --version` works')
  })
})
