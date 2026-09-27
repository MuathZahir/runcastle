import type { AgentCommandOptions, AgentProvider, AgentStreamEvent } from '@ai-hero/sandcastle'
import { describe, expect, it } from 'vitest'
import {
  buildInterruptedCommandNotes,
  trackLastCommand,
  withInterruptedCommandNotes,
} from '../src/workflows/interrupted-command'
import {
  buildRetryNotes,
  classifyTicketRunError,
  errorHeadline,
} from '../src/workflows/ticket-burner'

/**
 * A burn iteration that died mid-command (OOM-killed full suite) must be named
 * in the next iteration's prompt, so the successor does not re-run the same
 * command and die the same way.
 */

const FULL_SUITE = 'bun run typecheck; env -u GIT_ASKPASS bun run test'

function text(message: string, iteration = 1): AgentStreamEvent {
  return { type: 'text', message, iteration, timestamp: new Date() }
}
function tool(name: string, formattedArgs: string, iteration = 1): AgentStreamEvent {
  return { type: 'toolCall', name, formattedArgs, iteration, timestamp: new Date() }
}
function raw(line: string, iteration = 1): AgentStreamEvent {
  return { type: 'raw', line, iteration, timestamp: new Date() }
}

describe('buildInterruptedCommandNotes — the prompt addition', () => {
  it('names the command the previous iteration was running when it died', () => {
    const notes = buildInterruptedCommandNotes({ command: FULL_SUITE })
    expect(notes).toContain('## Recovery context — the previous iteration died mid-command')
    expect(notes).toContain(`    ${FULL_SUITE}`)
  })

  it('says it was probably killed for memory or timed out, and to run only the touched test files', () => {
    const notes = buildInterruptedCommandNotes({ command: FULL_SUITE }) ?? ''
    expect(notes).toContain('most likely killed for memory')
    expect(notes).toContain('timed out')
    expect(notes).toContain('Do NOT run that command again')
    expect(notes).toContain('run only the test files your change touches')
  })

  it('indents every line of a multi-line command, so backticks cannot break out of the block', () => {
    const notes = buildInterruptedCommandNotes({ command: 'cd /repo &&\n  echo `date`' }) ?? ''
    expect(notes).toContain('    cd /repo &&\n      echo `date`')
  })

  it('adds nothing when the previous iteration was not mid-command', () => {
    expect(buildInterruptedCommandNotes(undefined)).toBeUndefined()
    expect(buildInterruptedCommandNotes({ command: '  ' })).toBeUndefined()
  })
})

describe('trackLastCommand — reading the record off the stream', () => {
  it('records a shell command that is the last action', () => {
    const t = trackLastCommand()
    t.onEvent(text('targeted test passes, now the full suite'))
    t.onEvent(tool('Bash', FULL_SUITE))
    expect(t.last()).toEqual({ command: FULL_SUITE })
  })

  it('ignores raw lines, which are runtime-specific', () => {
    const t = trackLastCommand()
    t.onEvent(tool('Bash', FULL_SUITE))
    t.onEvent(raw('{"type":"user","message":{}}'))
    expect(t.last()).toEqual({ command: FULL_SUITE })
  })

  it('clears once the agent acts again — the command came back', () => {
    const t = trackLastCommand()
    t.onEvent(tool('Bash', FULL_SUITE))
    t.onEvent(text('all green'))
    expect(t.last()).toBeUndefined()

    t.onEvent(tool('Bash', FULL_SUITE))
    t.onEvent(tool('Read', 'src/a.ts'))
    expect(t.last()).toBeUndefined()
  })

  it('does not treat a non-shell tool as a running command', () => {
    const t = trackLastCommand()
    t.onEvent(tool('Edit', 'src/a.ts'))
    expect(t.last()).toBeUndefined()
  })

  it('forgets on reset, so a fresh run() starts clean', () => {
    const t = trackLastCommand()
    t.onEvent(tool('Bash', FULL_SUITE))
    t.reset()
    expect(t.last()).toBeUndefined()
  })
})

describe('withInterruptedCommandNotes — per-iteration prompts', () => {
  const prompts: string[] = []
  const fake: AgentProvider = {
    name: 'fake',
    env: {},
    captureSessions: false,
    parseStreamLine: () => [],
    buildPrintCommand: (o: AgentCommandOptions) => {
      prompts.push(o.prompt)
      return { command: 'agent --print' }
    },
  }

  const print = (agent: AgentProvider): void => {
    agent.buildPrintCommand({ prompt: 'do the ticket', dangerouslySkipPermissions: true })
  }

  it('leaves the first iteration untouched and tells the next one what the previous died running', () => {
    prompts.length = 0
    const t = trackLastCommand()
    const agent = withInterruptedCommandNotes(fake, t)

    print(agent)
    t.onEvent(tool('Bash', FULL_SUITE, 1))
    print(agent)

    expect(prompts[0]).toBe('do the ticket')
    expect(prompts[1]).toBe(`do the ticket\n\n${buildInterruptedCommandNotes({ command: FULL_SUITE })}`)
  })

  it('adds nothing when the previous iteration ended on text rather than a running command', () => {
    prompts.length = 0
    const t = trackLastCommand()
    const agent = withInterruptedCommandNotes(fake, t)

    print(agent)
    t.onEvent(tool('Bash', FULL_SUITE, 1))
    t.onEvent(text('I will check back on the suite', 1))
    print(agent)

    expect(prompts[1]).toBe('do the ticket')
  })
})

/**
 * An attempt whose `run()` rejects (idle timeout, agent CLI OOM-killed) never
 * reaches a second in-run iteration, so the burner's attempt retry is the only
 * place the command can cross over — before the next attempt resets the tracker.
 */
describe('a retried attempt — run() rejected mid-command', () => {
  function idleTimeout(): Error {
    const err = new Error(
      'Agent idle for 600 seconds — no output received. Consider increasing the idle timeout with --idle-timeout.',
    )
    err.name = 'AgentIdleTimeoutError'
    return err
  }

  /** The burner's attempt loop in miniature: run, and on a retryable death build the next prompt. */
  async function nextAttemptPrompt(
    events: AgentStreamEvent[],
    failure: unknown,
  ): Promise<string> {
    const lastCommand = trackLastCommand()
    const run = async (): Promise<never> => {
      for (const event of events) lastCommand.onEvent(event)
      throw failure
    }
    let retryNotes: string | undefined
    try {
      lastCommand.reset() // beginSetupSpan
      await run()
    } catch (err) {
      expect(classifyTicketRunError(err, 'claude-code')).toBe('retryable')
      const msg = err instanceof Error ? err.message : String(err)
      retryNotes = buildRetryNotes({
        error: errorHeadline(msg),
        commitCount: 0,
        lastCommand: lastCommand.last(),
      })
    }
    lastCommand.reset() // the next attempt's beginSetupSpan
    return retryNotes ? `do the ticket\n\n${retryNotes}` : 'do the ticket'
  }

  it('names the command an idle-timed-out attempt died running', async () => {
    const prompt = await nextAttemptPrompt([tool('Bash', 'bun run test')], idleTimeout())
    expect(prompt).toContain('## Recovery context — a previous attempt was interrupted')
    expect(prompt).toContain('## Recovery context — the previous iteration died mid-command')
    expect(prompt).toContain('    bun run test')
  })

  it('names it when the agent CLI itself was killed', async () => {
    const prompt = await nextAttemptPrompt(
      [text('targeted test passes'), tool('Bash', FULL_SUITE)],
      new Error('claude-code exited with code 137:\nKilled'),
    )
    expect(prompt).toContain(`    ${FULL_SUITE}`)
  })

  it('adds only the generic notes when the attempt was not mid-command', async () => {
    const prompt = await nextAttemptPrompt(
      [tool('Bash', FULL_SUITE), text('all green')],
      idleTimeout(),
    )
    expect(prompt).toContain('## Recovery context — a previous attempt was interrupted')
    expect(prompt).not.toContain('died mid-command')
  })
})
