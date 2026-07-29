import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  configPath,
  dataDir,
  dbPath,
  devDataDir,
  envPath,
  prodDataDir,
  projectWorktreesDir,
  sameDataDir,
  worktreeDir,
} from '../src/paths'

/**
 * The dev/prod data-dir split. `bun run dev` must not read or write the tree a
 * published `runcastle` owns, and the whole separation rests on one function —
 * everything else in paths.ts derives from `dataDir()`.
 */

const ENV_KEYS = ['RUNCASTLE_DATA_DIR', 'RUNCASTLE_DEV_DATA_DIR'] as const

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

describe('dataDir', () => {
  it('defaults to the production tree when nothing is set', () => {
    expect(dataDir()).toBe(prodDataDir())
    expect(prodDataDir()).toBe(join(homedir(), '.runcastle'))
  })

  it('follows RUNCASTLE_DATA_DIR, resolved to an absolute path', () => {
    process.env.RUNCASTLE_DATA_DIR = join(homedir(), '.runcastle-dev')
    expect(dataDir()).toBe(join(homedir(), '.runcastle-dev'))
    process.env.RUNCASTLE_DATA_DIR = 'relative-tree'
    expect(dataDir()).toBe(resolve('relative-tree'))
  })

  it('relocates the db, config, env file and worktrees together', () => {
    process.env.RUNCASTLE_DATA_DIR = join(homedir(), '.runcastle-dev')
    const root = join(homedir(), '.runcastle-dev')
    expect(dbPath()).toBe(join(root, 'runcastle.db'))
    expect(configPath()).toBe(join(root, 'config.json'))
    expect(envPath()).toBe(join(root, '.env'))
    expect(worktreeDir('proj_1', 'my-feature')).toBe(
      join(root, 'worktrees', 'proj_1', 'my-feature'),
    )
    expect(projectWorktreesDir('proj_1')).toBe(join(root, 'worktrees', 'proj_1'))
  })

  it('reads the env var per call, so pinning it after import still works', () => {
    expect(dataDir()).toBe(prodDataDir())
    process.env.RUNCASTLE_DATA_DIR = join(homedir(), '.runcastle-dev')
    expect(dataDir()).toBe(join(homedir(), '.runcastle-dev'))
  })
})

describe('devDataDir', () => {
  it('is a sibling tree, never the production one', () => {
    expect(devDataDir()).toBe(join(homedir(), '.runcastle-dev'))
    expect(devDataDir()).not.toBe(prodDataDir())
  })

  it('follows RUNCASTLE_DEV_DATA_DIR', () => {
    process.env.RUNCASTLE_DEV_DATA_DIR = join(homedir(), 'scratch', 'rc')
    expect(devDataDir()).toBe(join(homedir(), 'scratch', 'rc'))
  })

  it('is independent of RUNCASTLE_DATA_DIR (the tool pins the latter from it)', () => {
    process.env.RUNCASTLE_DATA_DIR = prodDataDir()
    expect(devDataDir()).toBe(join(homedir(), '.runcastle-dev'))
  })
})

describe('sameDataDir', () => {
  it('ignores a trailing separator', () => {
    expect(sameDataDir(prodDataDir(), `${prodDataDir()}${process.platform === 'win32' ? '\\' : '/'}`)).toBe(true)
  })

  it('separates the dev tree from the production one', () => {
    expect(sameDataDir(devDataDir(), prodDataDir())).toBe(false)
  })

  it.runIf(process.platform === 'win32')('folds Windows case and slash direction', () => {
    expect(sameDataDir('C:\\Users\\x\\.runcastle', 'c:/users/x/.runcastle')).toBe(true)
  })

  it.runIf(process.platform !== 'win32')('stays case-sensitive on POSIX', () => {
    expect(sameDataDir('/home/x/.runcastle', '/home/x/.RUNCASTLE')).toBe(false)
  })
})
