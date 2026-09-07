import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'

/**
 * The AFK card's token row read a stale answer: the tRPC doctor query probed
 * bare `process.env`, so a token "Save & verify" had just written to
 * `~/.runcastle/.env` stayed invisible and the row stayed amber forever. The
 * route now merges the env file in on every query — the file is written while
 * the server runs, so a boot-time snapshot would be just as stale.
 */
describe('setup.doctor', () => {
  it('reads the AFK token from the data-dir .env when the process has none', async () => {
    const home = mkdtempSync(join(tmpdir(), 'rc-doctor-env-'))
    const restoreDataDir = useDataDir(home)
    const previousToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    mkdirSync(join(home, '.runcastle'), { recursive: true })
    writeFileSync(
      join(home, '.runcastle', '.env'),
      'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-from-the-env-file\n',
    )
    try {
      const caller = createCallerFactory(appRouter)(await makeTestCtx())
      const report = await caller.setup.doctor()
      const afkToken = report.results.find((r) => r.id === 'afk-token')
      expect(afkToken?.status).toBe('ok')
    } finally {
      restoreDataDir()
      if (previousToken === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = previousToken
    }
    // Real probes: the route spawns a `--version` per tool, and a spawn that
    // fails costs more than one that succeeds — same budget as the CLI test.
  }, 20000)
})
