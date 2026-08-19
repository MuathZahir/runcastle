import { describe, expect, it } from 'vitest'
import { formatReport } from '../src/doctor/report'
import type { DoctorReport } from '../src/doctor/doctor'

const report: DoctorReport = {
  ok: false,
  tier1Ok: false,
  results: [
    { id: 'bun', label: 'Bun runtime', tier: 1, status: 'ok', severity: 'error', detail: '1.3.14' },
    {
      id: 'git',
      label: 'Git',
      tier: 1,
      status: 'missing',
      severity: 'error',
      detail: 'git not found on PATH',
      fix: 'Install Git: apt install git',
    },
    {
      id: 'container-runtime',
      label: 'Container runtime (Docker / Podman)',
      tier: 2,
      status: 'daemon-dead',
      severity: 'error',
      detail: 'docker CLI is installed but the daemon is not responding',
      fix: 'Start Docker Desktop',
    },
  ],
}

describe('formatReport', () => {
  it('renders one line per probe with its label, detail, and fix', () => {
    const out = formatReport(report)
    expect(out).toContain('Bun runtime')
    expect(out).toContain('Git')
    expect(out).toContain('git not found on PATH')
    expect(out).toContain('Install Git: apt install git')
    expect(out).toContain('Container runtime')
    expect(out).toContain('Start Docker Desktop')
  })

  it('does not print a fix line for a healthy probe', () => {
    const healthy: DoctorReport = {
      ok: true,
      tier1Ok: true,
      results: [
        { id: 'bun', label: 'Bun runtime', tier: 1, status: 'ok', severity: 'error', detail: '1.3.14' },
      ],
    }
    const out = formatReport(healthy)
    expect(out).not.toMatch(/fix/i)
  })

  // A runtime nothing the operator configured resolves to is context, not a
  // defect: it must not wear a ✗, demand a fix, or be counted as an issue.
  it('renders a runtime nothing runs on as informational, outside the issue count', () => {
    const withInfo: DoctorReport = {
      ok: true,
      tier1Ok: true,
      results: [
        { id: 'bun', label: 'Bun runtime', tier: 1, status: 'ok', severity: 'error', detail: '1.3.14' },
        {
          id: 'codex',
          label: 'Codex CLI',
          tier: 1,
          status: 'missing',
          severity: 'info',
          detail: 'codex not found on PATH',
          fix: 'Install Codex: npm install -g @openai/codex',
          runtime: 'codex',
          check: 'binary',
        },
      ],
    }
    const out = formatReport(withInfo)
    expect(out).toContain('Codex CLI')
    expect(out).toContain('not in use')
    expect(out).not.toMatch(/fix:/)
    expect(out).toContain('All prerequisites satisfied.')
  })
})
