import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { type Project, RuncastleConfig } from '@runcastle/core'
import { reviewGateLogDir, reviewGateLogPath } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type GateExecResult,
  type WithGateSandbox,
  reviewGateBranch,
  runReviewGates,
} from '../src/workflows/review-gates'
import { withTempDataDir } from './helpers/data-dir'
import { rmTemp, tmpRepo } from './helpers/fixtures'

/**
 * The server's gate run (gates-mode-review decisions #1-#3), observed at its
 * seam with the sandbox faked: which commit the sandbox was handed, what ran in
 * it and in what order, what the record says, and what is left on disk — the
 * logs under the review dir, and nothing at all in the repo.
 */

const TICKET = 'tkt_review1'

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}

/** A repo on `main` with a `feature/x` branch one commit ahead; returns the feature tip. */
function seedRepo(repo: string): string {
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@runcastle.invalid')
  git(repo, 'config', 'user.name', 'test')
  writeFileSync(join(repo, 'a.txt'), 'main\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'base')
  git(repo, 'checkout', '-q', '-b', 'feature/x')
  writeFileSync(join(repo, 'a.txt'), 'feature\n')
  git(repo, 'commit', '-q', '-am', 'feature work')
  const tip = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'checkout', '-q', 'main')
  return tip
}

interface FakeSandbox {
  withSandbox: WithGateSandbox
  /** The branch each open was handed, and the sha it pointed at when opened. */
  opened: { branch: string; sha: string }[]
  ran: string[]
}

/** A sandbox that answers each command from `script`, or hangs on `'hang'`. */
function fakeSandbox(
  repo: string,
  script: Record<string, GateExecResult | 'hang' | Error>,
): FakeSandbox {
  const fake: FakeSandbox = {
    opened: [],
    ran: [],
    withSandbox: async (branch, use) => {
      fake.opened.push({ branch, sha: git(repo, 'rev-parse', branch) })
      return use({
        exec: (command) => {
          fake.ran.push(command)
          const answer = script[command]
          if (answer === 'hang') return new Promise(() => {})
          if (answer instanceof Error) return Promise.reject(answer)
          return Promise.resolve(answer ?? { exitCode: 0, stdout: '', stderr: '' })
        },
      })
    },
  }
  return fake
}

describe('runReviewGates', () => {
  let repo: string
  let tip: string
  let restoreDataDir: () => void

  function project(verifyCommands?: string): Project {
    return { id: 'proj_1', name: 'p', repoPath: repo, verifyCommands } as Project
  }

  const config = RuncastleConfig.parse({ sandbox: 'noSandbox' })

  beforeEach(() => {
    restoreDataDir = withTempDataDir()
    repo = tmpRepo()
    tip = seedRepo(repo)
  })

  afterEach(() => {
    restoreDataDir()
    rmTemp(repo)
  })

  it('reports none_configured without opening a sandbox when there are no verify commands', async () => {
    const fake = fakeSandbox(repo, {})

    for (const verifyCommands of [undefined, '  \n\n  \n']) {
      const run = await runReviewGates({
        config, project: project(verifyCommands), ticketId: TICKET, sha: tip,
        deps: { withSandbox: fake.withSandbox },
      })
      expect(run).toEqual({ status: 'none_configured' })
    }
    expect(fake.opened).toEqual([])
  })

  it('runs each command once, in order, on a throwaway branch at the sha, and records the outcomes', async () => {
    const fake = fakeSandbox(repo, {
      'bun run typecheck': { exitCode: 0, stdout: 'tsc ok', stderr: '' },
      'bun run test': { exitCode: 1, stdout: 'FAIL a.test.ts', stderr: 'boom' },
    })

    const run = await runReviewGates({
      config, project: project('bun run typecheck\n\n  bun run test  \n'), ticketId: TICKET, sha: tip,
      deps: { withSandbox: fake.withSandbox },
    })

    expect(fake.opened).toEqual([{ branch: 'runcastle/gates/tkt_review1', sha: tip }])
    expect(fake.ran).toEqual(['bun run typecheck', 'bun run test'])
    expect(run).toEqual({
      status: 'ran',
      commit: tip,
      commands: [
        { command: 'bun run typecheck', outcome: 'passed', exitCode: 0, log: '0.log' },
        { command: 'bun run test', outcome: 'failed', exitCode: 1, log: '1.log' },
      ],
    })
    expect(readFileSync(reviewGateLogPath(TICKET, '0.log'), 'utf8')).toContain('tsc ok')
    const failed = readFileSync(reviewGateLogPath(TICKET, '1.log'), 'utf8')
    expect(failed).toContain('FAIL a.test.ts')
    expect(failed).toContain('boom')
  })

  it('records a command over the time limit, or one that cannot start, as couldnt_run and carries on', async () => {
    const fake = fakeSandbox(repo, {
      'hangs': 'hang',
      'missing': new Error('spawn missing ENOENT'),
      'after': { exitCode: 0, stdout: '', stderr: '' },
    })

    const run = await runReviewGates({
      config, project: project('hangs\nmissing\nafter'), ticketId: TICKET, sha: tip,
      deps: { withSandbox: fake.withSandbox, commandTimeoutMs: 20 },
    })

    expect(fake.ran).toEqual(['hangs', 'missing', 'after'])
    expect(run).toMatchObject({
      status: 'ran',
      commands: [
        { command: 'hangs', outcome: 'couldnt_run', exitCode: null, reason: expect.stringContaining('timed out') },
        { command: 'missing', outcome: 'couldnt_run', exitCode: null, reason: expect.stringContaining('ENOENT') },
        { command: 'after', outcome: 'passed', exitCode: 0 },
      ],
    })
  })

  it('reports couldnt_run with the output in run.log when the sandbox or its install fails — never throws', async () => {
    const failing: WithGateSandbox = async () => {
      throw new Error('onSandboxReady hook failed\nbun install: lockfile had changes')
    }

    const run = await runReviewGates({
      config, project: project('bun run test'), ticketId: TICKET, sha: tip,
      deps: { withSandbox: failing },
    })

    expect(run).toEqual({
      status: 'couldnt_run',
      commit: tip,
      reason: expect.stringContaining('onSandboxReady hook failed'),
      log: 'run.log',
    })
    expect(readFileSync(reviewGateLogPath(TICKET, 'run.log'), 'utf8')).toContain('lockfile had changes')
  })

  it('reports couldnt_run without a log when the log directory cannot be written — never throws', async () => {
    const fake = fakeSandbox(repo, {})
    // A file where the log directory's parent should be: every write under it fails.
    const reviewDir = dirname(reviewGateLogDir(TICKET))
    mkdirSync(dirname(reviewDir), { recursive: true })
    writeFileSync(reviewDir, 'in the way')

    const run = await runReviewGates({
      config, project: project('bun run test'), ticketId: TICKET, sha: tip,
      deps: { withSandbox: fake.withSandbox },
    })

    expect(run).toMatchObject({ status: 'couldnt_run', commit: tip, log: null })
    expect(fake.ran).toEqual([])
    expect(git(repo, 'branch', '--list', reviewGateBranch(TICKET))).toBe('')
  })

  it('removes the throwaway branch on every path and never touches the feature branch or the checkout', async () => {
    const failing: WithGateSandbox = async () => {
      throw new Error('no docker')
    }
    for (const withSandbox of [fakeSandbox(repo, {}).withSandbox, failing]) {
      await runReviewGates({
        config, project: project('bun run test'), ticketId: TICKET, sha: tip, deps: { withSandbox },
      })

      expect(git(repo, 'branch', '--list', reviewGateBranch(TICKET))).toBe('')
      expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
      expect(git(repo, 'rev-parse', 'feature/x')).toBe(tip)
      expect(git(repo, 'status', '--porcelain')).toBe('')
      expect(git(repo, 'worktree', 'list', '--porcelain')).not.toContain('feature/x')
      expect(existsSync(join(repo, '.sandcastle'))).toBe(false)
    }
  })

  it('moves a throwaway branch a crashed earlier run left behind onto the new sha', async () => {
    git(repo, 'branch', reviewGateBranch(TICKET), 'main')
    const fake = fakeSandbox(repo, {})

    await runReviewGates({
      config, project: project('bun run test'), ticketId: TICKET, sha: tip,
      deps: { withSandbox: fake.withSandbox },
    })

    expect(fake.opened).toEqual([{ branch: reviewGateBranch(TICKET), sha: tip }])
  })
})
