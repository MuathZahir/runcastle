import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GIT_REPO_ENV, guardRepo, repoChanges, snapshotRepo } from '../../../vitest.git-guard'
import { rmTemp, tmpRepo } from './helpers/fixtures'

/**
 * The test-run guard (small-fixes decisions 6 and 8): no test inherits git's
 * repo-location variables, and a run that changes the [core] config or the
 * stash of the repo it runs from fails loudly. Exercised on scratch repos only.
 */

let root: string
let repo: string

function git(cwd: string, ...args: string[]): void {
  const run = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  })
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`)
}

beforeEach(() => {
  root = tmpRepo()
  repo = join(root, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'a.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first')
})

afterEach(() => rmTemp(root))

describe('the test-run guard', () => {
  it('leaves no repo-location git variable for a test to inherit', () => {
    expect(GIT_REPO_ENV.filter((key) => key in process.env)).toEqual([])
  })

  it('passes a run that changed nothing, and one that only wrote outside [core]', () => {
    const check = guardRepo(repo)
    git(repo, 'config', 'receive.denyCurrentBranch', 'ignore')
    git(repo, 'config', 'branch.main.remote', 'origin')
    expect(check).toBeDefined()
    expect(() => check?.()).not.toThrow()
  })

  it('fails a run that made the repo bare, naming the entry', () => {
    const check = guardRepo(repo)
    git(repo, 'config', 'core.bare', 'true')
    expect(() => check?.()).toThrow(/config added: {3}core\.bare true[\s\S]*config removed: core\.bare false[\s\S]*Nothing was repaired/)
  })

  it('fails a run that left a stash, from a worktree too, since the stash is the main repo’s', () => {
    const worktree = join(root, 'wt')
    git(repo, 'worktree', 'add', '-q', '--detach', worktree)
    const check = guardRepo(worktree)
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    git(repo, 'stash', 'push', '-q', '-m', 'keep me')
    expect(() => check?.()).toThrow(/stash added: {3}[0-9a-f]{40} On main: keep me/)
  })

  it('names a stash that vanished', () => {
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    git(repo, 'stash', 'push', '-q', '-m', 'keep me')
    const before = snapshotRepo(repo)
    git(repo, 'stash', 'drop', '-q')
    const after = snapshotRepo(repo)
    expect(before && after && repoChanges(before, after)).toEqual([expect.stringMatching(/^stash removed: [0-9a-f]{40} On main: keep me$/)])
  })

  it('guards nothing outside a repo', () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    const prev = process.env.GIT_CEILING_DIRECTORIES
    process.env.GIT_CEILING_DIRECTORIES = root
    try {
      expect(snapshotRepo(outside)).toBeNull()
      expect(guardRepo(outside)).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.GIT_CEILING_DIRECTORIES
      else process.env.GIT_CEILING_DIRECTORIES = prev
    }
  })
})
