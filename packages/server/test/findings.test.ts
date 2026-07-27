import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Project } from '@runcastle/core'
import { projects } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import {
  isOverwritable,
  isPreparedKey,
  preparedValue,
  recordFinding,
  recordHuman,
  unsetPreparedKeys,
} from '../src/services/findings'
import { applyFindings, keysToPrepare } from '../src/services/prep'
import { getSettings, updateSettings } from '../src/services/settings'
import { makeTestCtx } from './helpers/db'

/**
 * Provenance rules for prepared fields. The load-bearing one: a value a human
 * typed survives every later preparation run, and the ONLY way to hand a field
 * back to preparation is to clear it.
 */

let ctx: AppCtx
const PROJECT_ID = 'proj_1'

/** Per-test temp config file so a global write never touches the real one. */
let configFile: string
function tmpConfig(): string {
  return configFile
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    name: 'acme',
    repoPath: '/repo',
    mainBranch: 'main',
    ...over,
  }
}

beforeEach(async () => {
  ctx = await makeTestCtx()
  configFile = join(mkdtempSync(join(tmpdir(), 'rc-settings-')), 'config.json')
  ctx.db
    .insert(projects)
    .values({ id: PROJECT_ID, name: 'acme', repoPath: '/repo', mainBranch: 'main' })
    .run()
})

describe('isPreparedKey', () => {
  it('recognises prepared keys and nothing else', () => {
    expect(isPreparedKey('verifyCommands')).toBe(true)
    expect(isPreparedKey('dbResetCommand')).toBe(true)
    expect(isPreparedKey('model')).toBe(false)
    expect(isPreparedKey('burnConcurrency')).toBe(false)
  })
})

describe('recordFinding', () => {
  it('writes the value to the project and its provenance alongside', () => {
    recordFinding(ctx, PROJECT_ID, {
      key: 'verifyCommands',
      value: 'bun test',
      source: 'prep',
      evidence: 'ran it; exit 0',
      establishedSha: 'abc123',
    })
    expect(preparedValue(ctx, PROJECT_ID, 'verifyCommands')).toBe('bun test')
    expect(isOverwritable(ctx, PROJECT_ID, 'verifyCommands')).toBe(true)
  })

  it('a null value clears both the value and the provenance', () => {
    recordFinding(ctx, PROJECT_ID, { key: 'devCommand', value: 'bun dev', source: 'human' })
    expect(isOverwritable(ctx, PROJECT_ID, 'devCommand')).toBe(false)

    recordFinding(ctx, PROJECT_ID, { key: 'devCommand', value: null, source: 'human' })
    expect(preparedValue(ctx, PROJECT_ID, 'devCommand')).toBeNull()
    // Clearing hands the field back to preparation — this is the documented
    // escape hatch, and the only one.
    expect(isOverwritable(ctx, PROJECT_ID, 'devCommand')).toBe(true)
  })

  it('upserts rather than duplicating on the composite key', () => {
    recordFinding(ctx, PROJECT_ID, { key: 'setupCommand', value: 'a', source: 'prep' })
    recordFinding(ctx, PROJECT_ID, { key: 'setupCommand', value: 'b', source: 'prep' })
    expect(preparedValue(ctx, PROJECT_ID, 'setupCommand')).toBe('b')
  })
})

describe('human provenance', () => {
  it('locks a field a human set against later preparation runs', () => {
    recordHuman(ctx, PROJECT_ID, 'knownFailures', '2 red on main')
    expect(isOverwritable(ctx, PROJECT_ID, 'knownFailures')).toBe(false)
  })

  it('ignores keys that are not prepared fields', () => {
    expect(() => recordHuman(ctx, PROJECT_ID, 'model', 'claude-opus-5')).not.toThrow()
  })

  it('is stamped by a project-scoped settings write', () => {
    updateSettings(ctx, { projectId: PROJECT_ID, key: 'verifyCommands', value: 'my test cmd' })
    expect(isOverwritable(ctx, PROJECT_ID, 'verifyCommands')).toBe(false)
  })

  it('is dropped by clearing the override through settings', () => {
    updateSettings(ctx, { projectId: PROJECT_ID, key: 'verifyCommands', value: 'my test cmd' })
    updateSettings(ctx, { projectId: PROJECT_ID, key: 'verifyCommands', value: null })
    expect(isOverwritable(ctx, PROJECT_ID, 'verifyCommands')).toBe(true)
  })
})

describe('applyFindings', () => {
  it('writes prep findings and reports which keys landed', () => {
    const applied = applyFindings(
      ctx,
      project(),
      {
        values: {
          verifyCommands: { value: 'bun test', evidence: 'exit 0' },
          knownFailures: { value: '0 failing' },
        },
      },
      'sha1',
    )
    expect(applied.sort()).toEqual(['knownFailures', 'verifyCommands'])
    expect(preparedValue(ctx, PROJECT_ID, 'knownFailures')).toBe('0 failing')
  })

  // The re-check matters because preparation takes minutes: a human can answer
  // a field in the settings UI while the agent is still measuring it.
  it('never overwrites a value a human set mid-run', () => {
    updateSettings(ctx, { projectId: PROJECT_ID, key: 'devCommand', value: 'bun run dev --port 1' })

    const applied = applyFindings(
      ctx,
      project(),
      { values: { devCommand: { value: 'npm start' } } },
      'sha1',
    )
    expect(applied).toEqual([])
    expect(preparedValue(ctx, PROJECT_ID, 'devCommand')).toBe('bun run dev --port 1')
  })
})

describe('keysToPrepare', () => {
  it('defaults to the fields that are empty', () => {
    const keys = keysToPrepare(ctx, project({ devCommand: 'bun dev' }))
    expect(keys).not.toContain('devCommand')
    expect(keys).toContain('verifyCommands')
  })

  it('excludes fields a human set, even when refreshing', () => {
    updateSettings(ctx, { projectId: PROJECT_ID, key: 'verifyCommands', value: 'mine' })
    const keys = keysToPrepare(ctx, project({ verifyCommands: 'mine' }), { refresh: true })
    expect(keys).not.toContain('verifyCommands')
  })

  it('refresh re-includes fields a previous prep run established', () => {
    recordFinding(ctx, PROJECT_ID, { key: 'knownFailures', value: '1 red', source: 'prep' })
    const withValue = project({ knownFailures: '1 red' })
    expect(keysToPrepare(ctx, withValue)).not.toContain('knownFailures')
    expect(keysToPrepare(ctx, withValue, { refresh: true })).toContain('knownFailures')
  })

  it('honours an explicit key list', () => {
    expect(keysToPrepare(ctx, project(), { keys: ['dbResetCommand'] })).toEqual(['dbResetCommand'])
  })
})

describe('unsetPreparedKeys', () => {
  it('counts blank values as unset', () => {
    expect(unsetPreparedKeys(project({ verifyCommands: '  ' }))).toContain('verifyCommands')
  })
})

describe('settings scope', () => {
  // These three used to be global-only, which made "which tests are already
  // red" a machine-wide answer — wrong the moment a second project is opened.
  it('exposes the prepared burn fields as project-overridable', () => {
    const view = getSettings(ctx, PROJECT_ID, { env: {} })
    for (const key of ['setupCommand', 'verifyCommands', 'knownFailures', 'dbResetCommand']) {
      expect(view.fields.find((f) => f.key === key)?.scope).toBe('project')
    }
  })

  it('falls back to the global value until the project overrides it', () => {
    updateSettings(ctx, { key: 'verifyCommands', value: 'global test' }, { env: {}, configFile: tmpConfig() })
    const inherited = getSettings(ctx, PROJECT_ID, { env: {}, configFile: tmpConfig() })
    expect(inherited.fields.find((f) => f.key === 'verifyCommands')?.source).not.toBe('project')

    updateSettings(ctx, { projectId: PROJECT_ID, key: 'verifyCommands', value: 'project test' })
    const overridden = getSettings(ctx, PROJECT_ID, { env: {}, configFile: tmpConfig() })
    const field = overridden.fields.find((f) => f.key === 'verifyCommands')
    expect(field?.source).toBe('project')
    expect(field?.value).toBe('project test')
  })
})

