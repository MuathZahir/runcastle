import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { InvalidInputError } from '../src/errors'
import { initProjectRepo } from '../src/services/projects'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { rmTemp, tmpRepo } from './helpers/fixtures'

/**
 * The initialize-repository offer (born-empty-projects, decisions 2–3): the
 * open screen's "Not a git repository" refusal is answered on the spot by
 * `project.initRepo`, which inits the picked folder and leaves the one empty
 * commit every downstream branch cut needs — after which `project.open`
 * succeeds against the same path.
 *
 * `git init` reads `init.defaultBranch` from the machine git runs on, so these
 * tests pin a git config of their own: the branch the offer produces has to be
 * a fact about runcastle, not about whoever's laptop the suite runs on. The
 * commit identity lives there too — a folder that is not a repository yet has
 * nowhere to carry local config.
 */

const tmpDirs: string[] = []
const savedEnv: Record<string, string | undefined> = {}

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}

/** Point git at a config of our own, holding `body` and nothing else. */
function pinGitConfig(body: string): void {
  const home = mkTmp('rc-gitconfig-')
  const globalPath = join(home, 'gitconfig')
  const systemPath = join(home, 'system-gitconfig')
  writeFileSync(globalPath, body)
  writeFileSync(systemPath, '')
  process.env.GIT_CONFIG_GLOBAL = globalPath
  process.env.GIT_CONFIG_SYSTEM = systemPath
}

const IDENTITY = '[user]\n\tname = Runcastle Test\n\temail = test@runcastle.dev\n'

function callerFor(ctx: AppCtx) {
  return createCallerFactory(appRouter)(ctx)
}

describe("project.initRepo — the open screen's initialize offer", () => {
  let caller: ReturnType<typeof callerFor>

  beforeEach(async () => {
    for (const key of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM']) savedEnv[key] = process.env[key]
    pinGitConfig(IDENTITY)
    caller = callerFor(await makeTestCtx())
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    while (tmpDirs.length) rmTemp(tmpDirs.pop() as string)
  })

  it('leaves a resolvable HEAD: one empty commit on main', async () => {
    const folder = tmpRepo()
    tmpDirs.push(folder)

    const { repoPath } = await caller.project.initRepo({ repoPath: folder })

    expect(repoPath).toBe(folder)
    const g = simpleGit(folder)
    expect((await g.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('main')
    expect((await g.raw(['rev-list', '--count', 'HEAD'])).trim()).toBe('1')
    expect((await g.raw(['log', '-1', '--format=%s'])).trim()).toBe('runcastle: initial commit')
    // The repo is initialized, never the stack: no README, no `.gitignore`.
    expect(readdirSync(folder)).toEqual(['.git'])
  })

  it('keeps the default branch name the user configured', async () => {
    pinGitConfig(`${IDENTITY}[init]\n\tdefaultBranch = trunk\n`)
    const folder = tmpRepo()
    tmpDirs.push(folder)

    await caller.project.initRepo({ repoPath: folder })

    expect((await simpleGit(folder).raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('trunk')
  })

  it('refuses a folder that is already a repository', async () => {
    const folder = tmpRepo()
    tmpDirs.push(folder)
    await simpleGit(folder).init(['-b', 'main'])

    const failure = await initProjectRepo(folder).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(InvalidInputError)
    await expect(caller.project.initRepo({ repoPath: folder })).rejects.toThrow(
      /already a git repository/,
    )
  })

  it('refuses a path that is not there', async () => {
    const missing = join(tmpRepo(), 'nope')
    tmpDirs.push(missing)

    await expect(caller.project.initRepo({ repoPath: missing })).rejects.toThrow(
      /path does not exist/,
    )
  })

  // Runcastle never manufactures an identity: the failure names the two
  // commands and stops there (decision 3).
  it('names both git config commands when the identity is unset', async () => {
    pinGitConfig('[user]\n\tuseConfigOnly = true\n')
    const folder = tmpRepo()
    tmpDirs.push(folder)

    const failure = await caller.project
      .initRepo({ repoPath: folder })
      .catch((error: unknown) => error)

    expect(String(failure)).toContain('git config --global user.name')
    expect(String(failure)).toContain('git config --global user.email')
  })

  it('opens as a project on the retry that follows', async () => {
    const folder = tmpRepo()
    tmpDirs.push(folder)

    const { repoPath } = await caller.project.initRepo({ repoPath: folder })
    const project = await caller.project.open({ repoPath })

    expect(project.repoPath).toBe(folder)
  })
})
