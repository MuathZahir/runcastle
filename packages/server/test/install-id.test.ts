import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installIdPath } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getInstallId } from '../src/services/install-id'

/**
 * The anonymous install ID the boot update-check carries. Read-or-create over
 * `<dataDir>/install-id`; the data dir is pinned at a temp tree per test so
 * nothing here touches a real `~/.runcastle/`.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('getInstallId', () => {
  let previous: string | undefined

  beforeEach(() => {
    previous = process.env.RUNCASTLE_DATA_DIR
    process.env.RUNCASTLE_DATA_DIR = mkdtempSync(join(tmpdir(), 'runcastle-install-'))
  })

  afterEach(() => {
    if (previous === undefined) delete process.env.RUNCASTLE_DATA_DIR
    else process.env.RUNCASTLE_DATA_DIR = previous
  })

  it('creates the file with a UUID on the first call', () => {
    const id = getInstallId()
    expect(id).toMatch(UUID_RE)
    expect(readFileSync(installIdPath(), 'utf8').trim()).toBe(id)
  })

  it('returns the identical value on later calls', () => {
    const first = getInstallId()
    expect(getInstallId()).toBe(first)
    expect(getInstallId()).toBe(first)
  })

  it('regenerates when the stored value is not UUID-shaped', () => {
    getInstallId()
    writeFileSync(installIdPath(), 'not-a-uuid\n')

    const repaired = getInstallId()
    expect(repaired).toMatch(UUID_RE)
    expect(readFileSync(installIdPath(), 'utf8').trim()).toBe(repaired)
  })

  it('creates the data dir when it does not exist yet', () => {
    process.env.RUNCASTLE_DATA_DIR = join(
      mkdtempSync(join(tmpdir(), 'runcastle-install-')),
      'never-created',
    )
    expect(getInstallId()).toMatch(UUID_RE)
  })
})
