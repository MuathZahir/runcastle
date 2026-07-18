import { describe, expect, it } from 'vitest'
import { formatReport } from '../src/doctor/report'
import type { DoctorReport } from '../src/doctor/doctor'

const report: DoctorReport = {
  ok: false,
  tier1Ok: false,
  results: [
    { id: 'bun', label: 'Bun runtime', tier: 1, status: 'ok', detail: '1.3.14' },
    {
      id: 'git',
      label: 'Git',
      tier: 1,
      status: 'missing',
      detail: 'git not found on PATH',
      fix: 'Install Git: apt install git',
    },
    {
      id: 'container-runtime',
      label: 'Container runtime (Docker / Podman)',
      tier: 2,
      status: 'daemon-dead',
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
      results: [{ id: 'bun', label: 'Bun runtime', tier: 1, status: 'ok', detail: '1.3.14' }],
    }
    const out = formatReport(healthy)
    expect(out).not.toMatch(/fix/i)
  })
})
