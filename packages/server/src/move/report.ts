import { formatBytes } from './shell'
import type { DestinationAnswer, MoveInResult, MoveReport } from './types'

/** What the human reads. Every line is plain text, because this prints to a terminal. */

export function formatReport(
  report: MoveReport,
  destination: { answer: DestinationAnswer | null; detail: string } | undefined,
  cleared: string[],
): string {
  const blockers = [
    ...report.blockers,
    ...(destination?.answer?.blockers ?? []),
    ...(destination && !destination.answer ? [`the destination could not be checked: ${destination.detail}`] : []),
  ]
  const out: string[] = []

  if (blockers.length > 0) {
    out.push('Blocks', ...blockers.map((line) => `  x ${line}`), '')
  }

  const width = Math.max(10, ...report.projects.map((p) => p.name.length))
  out.push(`Moves${' '.repeat(width - 2)}branches  uncommitted  features  chats`)
  for (const p of report.projects) {
    const row = `${String(p.branches).padStart(8)}  ${String(p.uncommitted).padStart(11)}  ${String(p.features).padStart(8)}  ${String(p.chats).padStart(5)}`
    out.push(`  + ${p.name.padEnd(width)} ${row}${p.repoMoves ? '' : '  (repo stays)'}`)
  }
  out.push('')

  const attention = [...cleared, ...report.attention, ...(destination?.answer?.notes ?? [])]
  if (attention.length > 0) {
    out.push('Needs you afterwards', ...attention.map((line) => `  ! ${line}`), '')
  }

  out.push(`Stays behind  ${report.staysBehind.join(', ')}`, '')
  const size = `Pack holds about ${formatBytes(report.dataBytes + report.repoBytes)} before compression.`
  const free = destination?.answer?.freeBytes
  const where = destination?.answer ? ` Repos land in ${destination.answer.reposDir}.` : ''
  const room = free != null ? ` The destination has ${formatBytes(free)} free.` : ''
  const unchecked = destination ? '' : ' The destination was not checked; give a host to check it.'
  out.push(`${size}${where}${room}${unchecked}`)
  return out.join('\n')
}

/** Whether anything in the report stops a real run. */
export function isBlocked(
  report: MoveReport,
  destination: { answer: DestinationAnswer | null } | undefined,
): boolean {
  if (report.blockers.length > 0) return true
  if (!destination) return false
  return !destination.answer || destination.answer.blockers.length > 0
}

export function formatMoveInResult(result: MoveInResult): string {
  const out = ['Moved in.', '', 'Repos', ...result.repos.map((r) => `  ${r.name}: ${r.path}`)]
  if (result.wipApplied.length > 0) {
    out.push('', 'Uncommitted work put back', ...result.wipApplied.map((w) => `  ${w}`))
  }
  if (result.wipKept.length > 0) {
    out.push('', 'Uncommitted work that would not apply, kept here', ...result.wipKept.map((w) => `  ${w.project} (${w.key}): ${w.folder}`))
  }
  if (result.cleared.length > 0) {
    const projects = [...new Set(result.cleared.map((c) => c.project))]
    out.push('', 'Drive and reset commands cleared; run Prepare on', ...projects.map((p) => `  ${p}`))
  }
  if (result.setAside.length > 0) {
    out.push('', 'Set aside', ...result.setAside.map((s) => `  ${s.to}`))
  }
  if (result.unmappedPaths > 0) {
    out.push('', `${result.unmappedPaths} stored paths matched no known folder and were left as they were.`)
  }
  out.push(
    '',
    `Full report: ${result.reportPath}`,
    '',
    'Next: start runcastle here, run Prepare on each project, recreate the .env files.',
    'This machine is now the only home. Do not work on the old one.',
  )
  return out.join('\n')
}
