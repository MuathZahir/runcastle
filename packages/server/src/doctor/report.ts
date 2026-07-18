import type { DoctorMode, DoctorReport, ProbeResult, ProbeStatus } from './doctor'

/**
 * Human-readable rendering of a {@link DoctorReport} for the `doctor` CLI.
 * Kept separate from the probe library (which is pure data) so the output is
 * trivially testable and the library stays IO-free.
 */

const GLYPH: Record<ProbeStatus, string> = {
  ok: '✓',
  missing: '✗',
  'daemon-dead': '✗',
  'machine-stopped': '✗',
  unhealthy: '✗',
  unset: '!',
}

/** One-word status shown after the glyph, e.g. `MISSING`, `DAEMON-DEAD`. */
function statusWord(status: ProbeStatus): string {
  return status.toUpperCase()
}

function line(r: ProbeResult): string {
  const tier = `[T${r.tier}]`
  const head = `${GLYPH[r.status]} ${tier} ${r.label} — ${statusWord(r.status)}`
  const detail = `    ${r.detail}`
  if (r.status === 'ok' || !r.fix) return `${head}\n${detail}`
  return `${head}\n${detail}\n    fix: ${r.fix}`
}

/** Render the full report as a block of text, one stanza per probe. */
export function formatReport(report: DoctorReport, mode: DoctorMode = 'diagnostic'): string {
  const body = report.results.map(line).join('\n')
  const failing = report.results.filter((r) => r.status !== 'ok')
  const tier1Failing = failing.filter((r) => r.tier === 1)

  let summary: string
  if (report.ok) {
    summary = 'All prerequisites satisfied.'
  } else if (mode === 'gate') {
    summary = report.tier1Ok
      ? `Ready to boot — ${failing.length} warning(s) (Tier-2, non-blocking).`
      : `Cannot boot — ${tier1Failing.length} required (Tier-1) prerequisite(s) missing.`
  } else {
    summary = `${failing.length} issue(s): ${tier1Failing.length} required (Tier-1), ${
      failing.length - tier1Failing.length
    } warning(s).`
  }

  return `runcastle doctor\n\n${body}\n\n${summary}\n`
}
