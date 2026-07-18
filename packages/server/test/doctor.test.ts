import { describe, expect, it } from 'vitest'
import {
  runDoctor,
  exitCodeFor,
  type ExecFn,
  type ExecOutcome,
  type ProbeResult,
} from '../src/doctor/doctor'

/**
 * A canned exec: maps `"cmd arg arg"` to an outcome. Anything not in the map is
 * a spawn failure (ENOENT) — i.e. the binary is not installed. This lets each
 * test describe an exact host environment without touching the real machine.
 */
function cannedExec(table: Record<string, Partial<ExecOutcome>>): ExecFn {
  return async (command, args) => {
    const key = [command, ...args].join(' ')
    const hit = table[key]
    if (!hit) return { ok: false, code: null, stdout: '', stderr: 'ENOENT' }
    return { ok: true, code: 0, stdout: '', stderr: '', ...hit }
  }
}

const ALL_HEALTHY: Record<string, Partial<ExecOutcome>> = {
  'bun --version': { stdout: '1.3.14' },
  'node --version': { stdout: 'v22.0.0' },
  'git --version': { stdout: 'git version 2.45.0' },
  'claude --version': { stdout: '1.0.0' },
  'git config --get user.email': { stdout: 'dev@example.com' },
  'git config --get user.name': { stdout: 'Dev' },
  'docker --version': { stdout: 'Docker version 27.0.0' },
  'docker info': { stdout: 'Server: ...' },
  'docker image inspect sandcastle:runcastle': { stdout: '[{}]' },
}

function byId(results: ProbeResult[], id: string): ProbeResult {
  const hit = results.find((r) => r.id === id)
  if (!hit) throw new Error(`no probe ${id}`)
  return hit
}

describe('runDoctor — canned environments', () => {
  const base = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-oauth-xxx' },
    platform: 'linux' as const,
    imageName: 'sandcastle:runcastle',
  }

  it('reports every probe healthy on a fully-provisioned host', async () => {
    const report = await runDoctor({ ...base, exec: cannedExec(ALL_HEALTHY) })
    expect(report.results.every((r) => r.status === 'ok')).toBe(true)
    expect(report.ok).toBe(true)
    expect(report.tier1Ok).toBe(true)
  })

  it('every probe carries a label and an actionable fix line when not ok', async () => {
    const report = await runDoctor({ ...base, exec: cannedExec({}) })
    for (const r of report.results) {
      expect(r.label.length).toBeGreaterThan(0)
      if (r.status !== 'ok') expect(r.fix && r.fix.length).toBeTruthy()
    }
  })

  it('classifies a missing Tier-1 binary as missing (not-installed)', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['git --version']
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(byId(report.results, 'git').status).toBe('missing')
    expect(report.tier1Ok).toBe(false)
  })

  it('distinguishes a dead docker daemon from a missing binary', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['docker info'] // CLI present, daemon not responding
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    const c = byId(report.results, 'container-runtime')
    expect(c.status).toBe('daemon-dead')
    expect(c.status).not.toBe('missing')
  })

  it('classifies a stopped podman machine as its own state', async () => {
    // Docker absent entirely; podman CLI present but its machine is not started.
    const table: Record<string, Partial<ExecOutcome>> = {
      ...ALL_HEALTHY,
      'podman --version': { stdout: 'podman version 5.0.0' },
    }
    delete table['docker --version']
    delete table['docker info']
    delete table['docker image inspect sandcastle:runcastle']
    // podman info returns non-zero -> machine not initialized/started
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    const c = byId(report.results, 'container-runtime')
    expect(c.status).toBe('machine-stopped')
    expect(c.fix).toMatch(/podman machine/i)
  })

  it('flags a container runtime that is completely absent as missing', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['docker --version']
    delete table['docker info']
    delete table['docker image inspect sandcastle:runcastle']
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(byId(report.results, 'container-runtime').status).toBe('missing')
  })

  it('detects unset git identity distinctly from a missing git binary', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['git config --get user.email'] // unset at every level -> exit 1
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(byId(report.results, 'git').status).toBe('ok')
    expect(byId(report.results, 'git-identity').status).toBe('unset')
  })

  it('reports a missing AFK token from the injected env, without spawning', async () => {
    const report = await runDoctor({
      ...base,
      env: {}, // no CLAUDE_CODE_OAUTH_TOKEN
      exec: cannedExec(ALL_HEALTHY),
    })
    expect(byId(report.results, 'afk-token').status).toBe('unset')
  })

  it('reports a missing sandcastle image when inspect fails', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['docker image inspect sandcastle:runcastle']
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(byId(report.results, 'sandcastle-image').status).toBe('missing')
  })
})

describe('exitCodeFor — gate vs diagnostic', () => {
  const base = {
    env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-oauth-xxx' },
    platform: 'linux' as const,
    imageName: 'sandcastle:runcastle',
  }

  it('gate mode passes when only Tier-2/warning checks fail', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['docker info'] // Tier-2 unhealthy only
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(exitCodeFor(report, 'gate')).toBe(0)
    // ...but diagnostic mode reflects the degraded overall health.
    expect(exitCodeFor(report, 'diagnostic')).not.toBe(0)
  })

  it('gate mode fails when a Tier-1 binary is missing', async () => {
    const table = { ...ALL_HEALTHY }
    delete table['bun --version']
    const report = await runDoctor({ ...base, exec: cannedExec(table) })
    expect(exitCodeFor(report, 'gate')).not.toBe(0)
    expect(exitCodeFor(report, 'diagnostic')).not.toBe(0)
  })

  it('both modes pass a fully-healthy host', async () => {
    const report = await runDoctor({ ...base, exec: cannedExec(ALL_HEALTHY) })
    expect(exitCodeFor(report, 'gate')).toBe(0)
    expect(exitCodeFor(report, 'diagnostic')).toBe(0)
  })
})
