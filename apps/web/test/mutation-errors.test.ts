import { describe, expect, it } from 'vitest'
import { mutationErrorMessage, unhandledMutationError } from '../src/lib/mutation-errors'

/**
 * The global mutation-error net (findings guard-sweep note). Every call site
 * handles its own errors today; this is what catches the next one that forgets.
 */
describe('unhandledMutationError', () => {
  it('reports a mutation with no local onError', () => {
    expect(unhandledMutationError(new Error('branch already checked out'), { options: {} })).toBe(
      'branch already checked out',
    )
  })

  it('stays quiet when the call site handles the error itself', () => {
    expect(
      unhandledMutationError(new Error('boom'), { options: { onError: () => undefined } }),
    ).toBeNull()
  })

  it('still reports when onError is present but not callable', () => {
    expect(unhandledMutationError(new Error('boom'), { options: { onError: undefined } })).toBe(
      'boom',
    )
  })
})

describe('mutationErrorMessage', () => {
  it('uses the error message', () => {
    expect(mutationErrorMessage(new Error('not a git repository'))).toBe('not a git repository')
  })

  it('accepts a thrown string', () => {
    expect(mutationErrorMessage('nope')).toBe('nope')
  })

  it('falls back for a value that says nothing', () => {
    expect(mutationErrorMessage(new Error(''))).toBe('something went wrong')
    expect(mutationErrorMessage(null)).toBe('something went wrong')
    expect(mutationErrorMessage({ code: 500 })).toBe('something went wrong')
  })
})
