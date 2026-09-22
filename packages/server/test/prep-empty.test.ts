import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { prepView } from '../src/services/prep'
import { makeTestCtx } from './helpers/db'

describe('prepView repository emptiness', () => {
  let ctx: AppCtx
  let repoPath: string
  let project: Project

  beforeEach(async () => {
    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'rc-prep-empty-'))
    await simpleGit(repoPath).init(['-b', 'main'])
    project = { id: 'proj_1', name: 'empty project', repoPath } as Project
  })

  afterEach(() => rmSync(repoPath, { recursive: true, force: true }))

  it('reports a repository with no working files as empty', async () => {
    expect((await prepView(ctx, project)).empty).toBe(true)
  })

  it('still reports runcastle docs scaffolding as empty', async () => {
    const featureDocs = join(repoPath, 'docs', 'features', 'first-feature')
    mkdirSync(featureDocs, { recursive: true })
    writeFileSync(join(featureDocs, 'brief.md'), '# First feature\n')

    expect((await prepView(ctx, project)).empty).toBe(true)
  })

  it('still reports runcastle ADRs as empty', async () => {
    const adrDir = join(repoPath, 'docs', 'adr')
    mkdirSync(adrDir, { recursive: true })
    writeFileSync(join(adrDir, '0001-first-decision.md'), '# ADR-0001\n')

    expect((await prepView(ctx, project)).empty).toBe(true)
  })

  it('reports project files under docs as non-empty', async () => {
    mkdirSync(join(repoPath, 'docs'), { recursive: true })
    writeFileSync(join(repoPath, 'docs', 'index.ts'), 'export {}\n')

    expect((await prepView(ctx, project)).empty).toBe(false)
  })

  it('reports tracked or untracked project files as non-empty', async () => {
    writeFileSync(join(repoPath, 'tracked.ts'), 'export {}\n')
    await simpleGit(repoPath).add(['tracked.ts'])
    expect((await prepView(ctx, project)).empty).toBe(false)

    rmSync(join(repoPath, 'tracked.ts'))
    await simpleGit(repoPath).reset()
    writeFileSync(join(repoPath, 'untracked.ts'), 'export {}\n')
    expect((await prepView(ctx, project)).empty).toBe(false)
  })

  it('recomputes emptiness when the working tree changes', async () => {
    expect((await prepView(ctx, project)).empty).toBe(true)

    mkdirSync(join(repoPath, 'src'))
    writeFileSync(join(repoPath, 'src', 'index.ts'), 'export {}\n')

    expect((await prepView(ctx, project)).empty).toBe(false)
  })
})
