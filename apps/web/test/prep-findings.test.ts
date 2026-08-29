import { describe, expect, it } from 'vitest'
import { driveCapabilities } from '../src/lib/prep-findings'
import type { SettingField, SettingsView } from '../src/lib/api'

/**
 * The prepared-field helpers, moved out of `settings.ts` when the settings
 * redesign gave them their own module — preparation, review and the next-step
 * bar all import them, and settings is only one of their readers.
 */

const field = (over: Partial<SettingField>): SettingField =>
  ({
    key: 'model',
    value: 'claude',
    source: 'default',
    editable: true,
    restartRequired: false,
    scope: 'global',
    ...over,
  }) as SettingField

const view = (fields: Partial<SettingField>[], projectId?: string): SettingsView => ({
  projectId,
  fields: fields.map(field),
})

/**
 * What a test drive will actually do here, read off the same values the server
 * branches on. `runDriveHookStep` skips an empty command and the dev pane is
 * spawned only `if (project.devCommand)` — so "configured" has to mean a
 * non-blank string, or the review page promises a database nobody creates.
 */
describe('driveCapabilities', () => {
  it('reports nothing configured on a project with no drive fields set', () => {
    expect(driveCapabilities(view([{ key: 'model', value: 'claude' }]))).toEqual({
      setup: false,
      dev: false,
      teardown: false,
    })
  })

  it('reports each drive field that carries a command', () => {
    expect(
      driveCapabilities(
        view([
          { key: 'driveSetupCommand', value: 'bash .runcastle/drive-setup.sh' },
          { key: 'devCommand', value: 'bun dev' },
          { key: 'driveStopCommand', value: 'bash .runcastle/drive-stop.sh' },
        ]),
      ),
    ).toEqual({ setup: true, dev: true, teardown: true })
  })

  // A field cleared back to blank (or to whitespace) is a field the drive skips.
  it('treats a blank or whitespace-only value as not configured', () => {
    expect(
      driveCapabilities(
        view([
          { key: 'devCommand', value: '' },
          { key: 'driveSetupCommand', value: '   ' },
          { key: 'driveStopCommand', value: null },
        ]),
      ),
    ).toEqual({ setup: false, dev: false, teardown: false })
  })

  // Before settings land there is no answer, and guessing "false" would print
  // "this project has no drive commands" at every mount of the review page.
  it('has no answer until the settings view has loaded', () => {
    expect(driveCapabilities(undefined)).toBeUndefined()
  })
})
