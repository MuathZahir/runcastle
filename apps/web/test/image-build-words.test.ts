import { describe, expect, it } from 'vitest'
import { imageBuildWords } from '../src/lib/feature-ui'

const started = (need: string, runId = 'run_1') => ({
  type: 'burn.image_build_started',
  runId,
  data: { need },
})

describe('imageBuildWords', () => {
  it('says nothing for a run that is not building', () => {
    expect(imageBuildWords([{ type: 'burn.summary', runId: 'run_1' }], 'run_1')).toBeUndefined()
    expect(imageBuildWords([started('missing')], undefined)).toBeUndefined()
  })

  it('calls a first build a first build', () => {
    expect(imageBuildWords([started('missing')], 'run_1')).toBe(
      'Building the sandbox image · first time only, a few minutes',
    )
    expect(imageBuildWords([started('unadopted')], 'run_1')).toContain('first time only')
  })

  it('does not promise "first time only" for a rebuild', () => {
    expect(imageBuildWords([started('dockerfile-changed')], 'run_1')).toBe(
      'Rebuilding the sandbox image · a few minutes',
    )
    expect(imageBuildWords([started('wrong-uid')], 'run_1')).not.toContain('first time')
  })

  it('stops once the build has ended, however it ended', () => {
    const built = { type: 'burn.image_built', runId: 'run_1' }
    const failed = { type: 'burn.image_build_failed', runId: 'run_1' }
    expect(imageBuildWords([started('missing'), built], 'run_1')).toBeUndefined()
    expect(imageBuildWords([started('missing'), failed], 'run_1')).toBeUndefined()
  })

  it('reads only the running run', () => {
    expect(imageBuildWords([started('missing', 'run_0')], 'run_1')).toBeUndefined()
  })
})
