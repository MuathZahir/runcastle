/**
 * Tell a burn iteration that the one before it died mid-command.
 *
 * sandcastle runs a ticket's iterations as fresh agents with the same prompt,
 * so an agent that was OOM-killed inside `bun run test` leaves its successor no
 * trace of why it stopped: the successor re-runs the same full suite and dies
 * the same way, until max iterations fails the ticket with no commits. The burn
 * guard's "run only the test files your change touches" advice never reaches
 * it, because the guard only speaks to a tool call — and here the whole agent
 * process is what got killed.
 *
 * The evidence is already on the host: the stream sandcastle hands us. Both
 * runtimes surface a shell command as a `Bash` tool call (Claude Code on its
 * `tool_use`, Codex on `item.started`), and a command that finished is always
 * followed by something — the agent's next text or next tool call. An
 * iteration whose LAST recorded action is a `Bash` call therefore stopped while
 * that command was still running. No runtime-specific result parsing needed.
 */

import type { AgentCommandOptions, AgentProvider, AgentStreamEvent } from '@ai-hero/sandcastle'

/** The shell command an iteration had started and never came back from. */
export interface LastCommandRecord {
  command: string
}

/** The tool name both runtimes' stream parsers give a shell command. */
const SHELL_TOOL = 'Bash'

/**
 * Follow one `run()`'s stream and remember whether the latest action was a
 * still-running shell command. Any later text or tool call clears it — that
 * command came back. `raw` lines are ignored: they are runtime-specific JSON,
 * and reading them would couple this to one CLI's stream format.
 */
export function trackLastCommand(): {
  onEvent(event: AgentStreamEvent): void
  /** The latest action, if it was a shell command still running. */
  last(): LastCommandRecord | undefined
  /** Forget everything — call it before each `run()`. */
  reset(): void
} {
  let record: LastCommandRecord | undefined
  return {
    onEvent: (event) => {
      if (event.type === 'raw') return
      record =
        event.type === 'toolCall' && event.name === SHELL_TOOL
          ? { command: event.formattedArgs ?? '' }
          : undefined
    },
    last: () => record,
    reset: () => {
      record = undefined
    },
  }
}

/**
 * The prompt addition for the iteration after one that died mid-command, or
 * `undefined` when the previous iteration's last action was not a running
 * command. Pure: a function of the record alone.
 *
 * The command is rendered as an indented code block rather than a fence, so a
 * command containing backticks cannot close it early.
 */
export function buildInterruptedCommandNotes(
  record: LastCommandRecord | undefined,
): string | undefined {
  if (!record || record.command.trim().length === 0) return undefined
  const block = record.command
    .trim()
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
  return [
    '## Recovery context — the previous iteration died mid-command',
    '',
    'The previous agent on THIS SAME ticket ended without signalling completion, and its last recorded action was this command, still running:',
    '',
    block,
    '',
    'It never came back. The process was most likely killed for memory (several burns share this machine, and a full test suite sizes its worker pool from every host CPU) or it timed out. Everything that agent had not committed is gone — run `git log --oneline -15` and `git status` before anything else.',
    '',
    'Do NOT run that command again as it was: it will die the same way and cost this iteration too. Where it was running tests, run only the test files your change touches instead, and say in your final message that the full command was killed for memory in an earlier iteration.',
  ].join('\n')
}

/**
 * Wrap a provider so every print command after the first in a `run()` carries
 * the notes for whatever the previous iteration was running when it stopped.
 * sandcastle builds one print command per iteration and only starts another
 * when the previous one ended without the completion signal — so the first
 * call gets the prompt untouched, and every later call is exactly "the
 * previous iteration did not finish". Runtime-agnostic: it edits the prompt
 * before the runtime's own command builder sees it.
 *
 * Appended after everything else, so the byte-identical prefix the burner
 * prompt keeps for caching is unchanged.
 */
export function withInterruptedCommandNotes(
  agent: AgentProvider,
  tracker: { last(): LastCommandRecord | undefined },
): AgentProvider {
  let calls = 0
  return {
    ...agent,
    buildPrintCommand: (o: AgentCommandOptions) => {
      const notes = calls++ > 0 ? buildInterruptedCommandNotes(tracker.last()) : undefined
      return agent.buildPrintCommand(notes ? { ...o, prompt: `${o.prompt}\n\n${notes}` } : o)
    },
  }
}
