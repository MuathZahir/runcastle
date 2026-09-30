import { shortSha } from '../format'
import type { ReviewGateRunWire } from '../reviews'
import type { CheckTone } from './review'

/**
 * A review pass's Checks, from the gate record the server kept — never from the
 * agent's prose (decision 6). The server ran the project's verify commands on
 * the feature branch before the pass started; this says what it found, on
 * which commit, and nothing it did not find: a line reads "passed" only when
 * the record reports that command passed.
 */

export type GateCheckState = 'passed' | 'failed' | 'couldnt_run'

/** One verify command as its Checks line renders it. */
export interface GateCheckLine {
  /** The command, as configured. */
  label: string
  state: GateCheckState
  /** The exit code of a failure, or why a command could not run. */
  detail?: string
  /** The captured output — offered only for a line that is not green. */
  outputUrl?: string
}

export interface GateChecks {
  /** The whole run in one sentence, as the trail's Checks block leads with it. */
  summary: string
  /** The same, compact, for the headline Review row's sub-note. */
  short: string
  /** The 7-char sha the commands ran against, or null when nothing ran. */
  commit: string | null
  /**
   * `ok` only when every command ran and passed; `danger` when one failed on
   * the branch; `warn` when something could not run; `idle` when nothing ran.
   */
  tone: CheckTone
  lines: GateCheckLine[]
  /** The captured output of a run that could not complete, when there is one. */
  outputUrl?: string
}

function commandLine(command: Extract<ReviewGateRunWire, { status: 'ran' }>['commands'][number]): GateCheckLine {
  const line = { label: command.command, state: command.outcome }
  if (command.outcome === 'passed') return line
  const detail =
    command.outcome === 'failed'
      ? command.exitCode === null ? undefined : `exit ${command.exitCode}`
      : command.reason?.trim() || undefined
  return { ...line, ...(detail ? { detail } : {}), outputUrl: command.outputUrl }
}

/** A gate run as the Checks section and the Review row say it. */
export function gateCheckLines(gateRun: ReviewGateRunWire): GateChecks {
  switch (gateRun.status) {
    case 'none_configured':
      return {
        summary: 'No checks configured for this project',
        short: 'no checks configured',
        commit: null,
        tone: 'idle',
        lines: [],
      }
    case 'couldnt_run':
      return {
        summary: `Checks couldn't run: ${gateRun.reason}`,
        short: "checks couldn't run",
        // '' when the feature branch never resolved — no commit to show
        commit: gateRun.commit ? shortSha(gateRun.commit) : null,
        tone: 'warn',
        lines: [],
        ...(gateRun.outputUrl ? { outputUrl: gateRun.outputUrl } : {}),
      }
    case 'ran': {
      const lines = gateRun.commands.map(commandLine)
      const passed = lines.filter((l) => l.state === 'passed').length
      const commit = shortSha(gateRun.commit)
      return {
        summary: `${passed} of ${lines.length} checks passed`,
        short: `checks ${passed}/${lines.length} passed @${commit}`,
        commit,
        tone: lines.some((l) => l.state === 'failed')
          ? 'danger'
          : lines.some((l) => l.state === 'couldnt_run')
            ? 'warn'
            : lines.length > 0 ? 'ok' : 'idle',
        lines,
      }
    }
  }
}
