import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simpleGit } from 'simple-git'
import { afterEach, describe, expect, it } from 'vitest'
import { driveBlockingPaths } from '../src/services/git'
import { rmTemp } from './helpers/fixtures'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmTemp(d)
})

describe('driveBlockingPaths', () => {
  // Regression: trimming the whole porcelain output ate the first line's leading
  // space, so ` M README.md` lost its first letter and the refusal named `EADME.md`.
  it('names a modified tracked file in full when it is the first line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-drive-blocking-'))
    dirs.push(dir)
    const g = simpleGit(dir)
    await g.init()
    await g.addConfig('user.email', 't@example.com')
    await g.addConfig('user.name', 'Test')
    writeFileSync(join(dir, 'README.md'), 'one\n')
    await g.add('README.md')
    await g.commit('init')
    writeFileSync(join(dir, 'README.md'), 'two\n')
    writeFileSync(join(dir, 'scratch.txt'), 'x\n')

    expect(await driveBlockingPaths(dir)).toEqual(['README.md', 'scratch.txt'])
  })
})
