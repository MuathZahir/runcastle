import { describe, expect, it } from 'vitest'
import { workerWhere } from '../src/components/workers/WorkerChat'

/** Where a worker runs, under its composer: its folder, by placement (workers-build-in-the-feature-s-folder). */
const base = { kind: 'with-you' as const, reviewMode: null, featureBranch: 'feature/demo' }

describe('workerWhere', () => {
  it('names the feature folder and its branch for a worker building there', () => {
    expect(workerWhere({ ...base, placement: 'feature-folder' }, 'feature/demo')).toBe('Feature folder · commits on feature/demo')
  })

  it('names its own folder and branch for a parallel worker', () => {
    expect(workerWhere({ ...base, placement: 'own-folder' }, 'feature/demo')).toBe('Own folder · its own branch off feature/demo')
  })

  it('names the feature folder for a gates review, and the drive for a drive review', () => {
    expect(workerWhere({ ...base, kind: 'review', reviewMode: 'gates', placement: 'feature-folder' }, 'feature/demo')).toBe('Feature folder · reviewing feature/demo')
    expect(workerWhere({ ...base, kind: 'review', reviewMode: 'drive', placement: null }, 'feature/demo')).toBe('Your checkout · reviewing feature/demo on the drive')
  })

  it('shows no Sandbox label for a worker from before, which has no placement', () => {
    expect(workerWhere({ ...base, placement: null }, 'feature/demo')).toBe('Its own branch off feature/demo')
    expect(workerWhere({ ...base, kind: 'review', reviewMode: 'gates', placement: null }, 'feature/demo')).toBe('Reviewing feature/demo')
  })

  it('keeps the drive worker case, whatever its placement', () => {
    expect(workerWhere({ ...base, kind: 'fix-drive', placement: null, featureBranch: 'main' }, 'feature/demo')).toBe('Your checkout · commits on main')
  })
})
