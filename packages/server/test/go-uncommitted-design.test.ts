import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { worktreeDir } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GateError } from '../src/errors'
import type { AppCtx } from '../src/db/types'
import { go, hasUncommittedDesign } from '../src/services/features'
import { getFeatureRow } from '../src/services/repo'
import { useDataDir } from './helpers/data-dir'
import { makeTestCtx } from './helpers/db'
import { rmTemp, seedFeature, seedProject } from './helpers/fixtures'

/**
 * Go waits for a clean talk worktree (design mode, decision 6): uncommitted
 * changes outside `docs/features/` refuse it, override or not.
 */
const REASON = 'Uncommitted design work: ask the chat to commit or drop it'

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

describe('go() and uncommitted design work', () => {
  let ctx: AppCtx
  let home: string
  let restoreEnv: () => void
  let worktree: string
  let featureId: string

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'rc-home-'))
    restoreEnv = useDataDir(home)
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    featureId = seedFeature(ctx, project.id, { slug: 'dark-mode', ticketsReadyLap: 1 }).id
    worktree = worktreeDir(project.id, 'dark-mode')
    mkdirSync(worktree, { recursive: true })
    git(worktree, 'init', '-b', 'main')
    git(worktree, 'config', 'user.email', 'test@runcastle.dev')
    git(worktree, 'config', 'user.name', 'Runcastle Test')
    writeFileSync(join(worktree, 'README.md'), 'hi\n')
    git(worktree, 'add', '.')
    git(worktree, 'commit', '-m', 'init')
  })

  afterEach(() => {
    restoreEnv()
    rmTemp(home)
    rmTemp(dirname(worktree))
  })

  function write(rel: string): void {
    mkdirSync(dirname(join(worktree, rel)), { recursive: true })
    writeFileSync(join(worktree, rel), 'x\n')
  }

  it('refuses an untracked file outside the docs, even with an override reason', async () => {
    write('src/Button.tsx')
    await expect(go(ctx, featureId)).rejects.toThrow(REASON)
    await expect(go(ctx, featureId, { overrideReason: 'ship it' })).rejects.toThrow(GateError)
    expect(getFeatureRow(ctx, featureId).phase).toBe('planning')
  })

  it('refuses an unstaged edit to a tracked file', async () => {
    writeFileSync(join(worktree, 'README.md'), 'changed\n')
    await expect(go(ctx, featureId)).rejects.toThrow(REASON)
  })

  it('refuses a staged change', async () => {
    write('src/Card.tsx')
    git(worktree, 'add', 'src/Card.tsx')
    await expect(go(ctx, featureId)).rejects.toThrow(REASON)
  })

  it('is not blocked by changes inside docs/features/ only', async () => {
    write('docs/features/dark-mode/spec.md')
    expect(await hasUncommittedDesign(getFeatureRow(ctx, featureId))).toBe(false)
    await go(ctx, featureId)
    expect(getFeatureRow(ctx, featureId).phase).toBe('building')
  })

  it('is not blocked by a missing worktree', async () => {
    rmTemp(worktree)
    await go(ctx, featureId)
    expect(getFeatureRow(ctx, featureId).phase).toBe('building')
  })

  it('goes once the design work is committed', async () => {
    write('src/Button.tsx')
    git(worktree, 'add', '.')
    git(worktree, 'commit', '-m', 'design: button')
    await go(ctx, featureId)
    expect(getFeatureRow(ctx, featureId).phase).toBe('building')
  })
})
