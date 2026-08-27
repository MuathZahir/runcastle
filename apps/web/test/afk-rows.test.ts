import { describe, expect, it } from 'vitest'
import { afkCredentialRows } from '../src/lib/afk-rows'
import type { ProbeLike } from '../src/lib/first-run'

/**
 * The Enable-AFK card's promise: one row per agent you could burn with, each
 * asking for the thing that runtime actually needs — a token to paste for Claude
 * Code, a login to borrow for Codex (decision 4). Nothing here is about how the
 * row looks; it is about which probe gets to say whether that agent is ready.
 */

const probe = (runtime: string, check: string, status: string): ProbeLike => ({
  status,
  detail: `${runtime} ${check} ${status}`,
  runtime: runtime as ProbeLike['runtime'],
  check,
})

describe('afkCredentialRows', () => {
  const report = [
    probe('claude-code', 'binary', 'ok'),
    probe('claude-code', 'auth', 'ok'),
    probe('claude-code', 'afk-key', 'unset'),
    probe('codex', 'binary', 'ok'),
    probe('codex', 'auth', 'ok'),
  ]

  it('asks Claude Code for its token and Codex for its login', () => {
    expect(afkCredentialRows(report)).toEqual([
      { runtime: 'claude-code', kind: 'token', probe: probe('claude-code', 'afk-key', 'unset') },
      { runtime: 'codex', kind: 'sign-in', probe: probe('codex', 'auth', 'ok') },
    ])
  })

  // The row's state is the driving probe's: a signed-in Codex is done, a logged
  // out one is the only thing the card still has to ask for.
  it('reports Codex from its login probe, not its binary or a key', () => {
    const [, codex] = afkCredentialRows([...report.slice(0, 4), probe('codex', 'auth', 'unset')])
    expect(codex?.probe.status).toBe('unset')
  })

  // A server still reporting the retired Codex afk-key check must not resurrect
  // the paste row — the login decides, and nothing else gets a row.
  it('ignores a stray Codex afk-key probe', () => {
    const rows = afkCredentialRows([...report, probe('codex', 'afk-key', 'ok')])
    expect(rows.filter((r) => r.runtime === 'codex')).toEqual([
      { runtime: 'codex', kind: 'sign-in', probe: probe('codex', 'auth', 'ok') },
    ])
  })

  it('shows no rows while the report is still in flight', () => {
    expect(afkCredentialRows([])).toEqual([])
  })

  // Each runtime's row stands alone: a host with no Codex login still gets the
  // Claude row it can act on.
  it('drops only the runtime whose probe is absent', () => {
    const rows = afkCredentialRows([probe('claude-code', 'afk-key', 'ok')])
    expect(rows.map((r) => r.runtime)).toEqual(['claude-code'])
  })
})
