import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  driveEngines,
  type DriveEngine,
  removeDriveContainers,
} from '../../../.runcastle/drive-containers.ts'
import { LABEL_DATA_DIR as DATA_DIR_LABEL } from '@runcastle/core'
import { rmTemp } from './helpers/fixtures'

/**
 * A drive's stop removes what its runcastle made in the container engine before
 * the data folder goes (cleanup decision 6), found by the data-dir label alone.
 */

const DIR = '/home/u/.runcastle-drive-abc'

function fakeEngine(held: Record<string, { containers: string[]; volumes: string[] }>) {
  const calls: [DriveEngine, ...string[]][] = []
  const exec = (engine: DriveEngine, args: string[]) => {
    calls.push([engine, ...args])
    const filter = args[args.indexOf('--filter') + 1]
    const mine = filter === `label=runcastle.data-dir=${DIR}`
    if (args[0] === 'ps') return mine ? (held[engine]?.containers ?? []).join('\n') : ''
    if (args[0] === 'volume' && args[1] === 'ls') return mine ? (held[engine]?.volumes ?? []).join('\n') : ''
    return ''
  }
  return { exec, calls }
}

describe('removeDriveContainers', () => {
  it('uses the label the server stamps', () => {
    expect(DATA_DIR_LABEL).toBe('runcastle.data-dir')
  })

  it('removes the labelled containers first, then the labelled volumes', () => {
    const engine = fakeEngine({ docker: { containers: ['c1', 'c2'], volumes: ['runcastle-proj_1'] } })

    const removed = removeDriveContainers(DIR, ['docker'], engine.exec)

    expect(removed).toEqual({ containers: ['c1', 'c2'], volumes: ['runcastle-proj_1'] })
    expect(engine.calls).toEqual([
      ['docker', 'ps', '-a', '-q', '--filter', `label=runcastle.data-dir=${DIR}`],
      ['docker', 'rm', '-f', 'c1', 'c2'],
      ['docker', 'volume', 'ls', '-q', '--filter', `label=runcastle.data-dir=${DIR}`],
      ['docker', 'volume', 'rm', '-f', 'runcastle-proj_1'],
    ])
  })

  it('removes nothing when nothing carries the label', () => {
    const engine = fakeEngine({})

    expect(removeDriveContainers(DIR, ['podman'], engine.exec)).toEqual({ containers: [], volumes: [] })
    expect(engine.calls.map((c) => c[1])).toEqual(['ps', 'volume'])
  })

  it('carries on when the engine is missing', () => {
    const exec = () => null

    expect(removeDriveContainers(DIR, ['docker', 'podman'], exec)).toEqual({ containers: [], volumes: [] })
  })
})

describe('driveEngines', () => {
  it('reads the engine from the drive’s config, docker by default, both when unreadable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runcastle-drive-engines-'))
    try {
      expect(driveEngines(join(dir, 'gone'))).toEqual(['docker', 'podman'])
      writeFileSync(join(dir, 'config.json'), JSON.stringify({ sandbox: 'podman' }))
      expect(driveEngines(dir)).toEqual(['podman'])
      writeFileSync(join(dir, 'config.json'), JSON.stringify({}))
      expect(driveEngines(dir)).toEqual(['docker'])
      writeFileSync(join(dir, 'config.json'), '{ not json')
      expect(driveEngines(dir)).toEqual(['docker', 'podman'])
    } finally {
      rmTemp(dir)
    }
  })
})
