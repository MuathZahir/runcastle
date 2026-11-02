import { formatBytes } from './shell'
import type { DestinationAnswer, MoveInResult, MoveReport } from './types'

/** What the human reads. Every line is plain text, because this prints to a terminal. */

export function formatReport(
  report: MoveReport,
  destination: { answer: DestinationAnswer | null; detail: string } | undefined,
  windowsCommands: string[],
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
  const reposDir = destination?.answer?.reposDir ?? '<repos folder>'
  out.push(`Moves${' '.repeat(width - 2)}branches  uncommitted  features  chats  repo size`)
  for (const p of report.projects) {
    const row = `${String(p.branches).padStart(8)}  ${String(p.uncommitted).padStart(11)}  ${String(p.features).padStart(8)}  ${String(p.chats).padStart(5)}  ${formatBytes(p.repoBytes).padStart(9)}`
    out.push(`  + ${p.name.padEnd(width)} ${row}${p.repoMoves ? '' : '  (repo stays)'}`)
    out.push(`      ${p.repoPath} -> ${reposDir}/${p.targetFolder}`)
  }
  out.push('')

  const attention = [...windowsCommands, ...report.attention, ...(destination?.answer?.notes ?? [])]
  if (attention.length > 0) {
    out.push('Worth a look', ...attention.map((line) => `  ! ${line}`), '')
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
  if (result.wipStuck.length > 0) {
    out.push(
      '',
      `Uncommitted work that could not be placed. Copy it out of ${result.stagingKept}/wip before anything else`,
      ...result.wipStuck.map((w) => `  ${w}`),
    )
  }
  if (result.commandsWindows.length > 0) {
    out.push('', 'Commands that only work on Windows; change these in the project settings')
    out.push(...result.commandsWindows.map((c) => `  ${c.project}, ${c.field}: ${c.value}`))
  }
  if (result.commandsChanged.length > 0) {
    out.push('', 'Commands with their paths rewritten')
    out.push(...result.commandsChanged.map((c) => `  ${c.project}, ${c.field}`))
  }
  if (result.claudeSetup) {
    if (result.claudeSetup.chatsKept) out.push('', 'Claude Code now keeps chats for 10 years, so it will not delete moved ones.')
    if (result.claudeSetup.failed.length > 0) {
      out.push('', 'Claude setup that did not go in', ...result.claudeSetup.failed.map((item) => `  ${item}`))
    }
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
    result.envCarried ? 'Next: start runcastle here.' : 'Next: start runcastle here, and recreate the .env files.',
    'This machine is now the only home. Do not work on the old one.',
  )
  return out.join('\n')
}
