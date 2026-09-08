import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTION_KINDS } from '../src/lib/feature-ui/next-step/types'

/**
 * The next-step bar's dispatcher, checked against the kinds the resolvers may
 * emit. "Continue to review" was offered with `kind: 'advance'` and the switch
 * in `Workspace.tsx` had no case for it, so the button rendered, clicked, and
 * did nothing — for a whole flow, with nothing on screen or in the log to say
 * why.
 *
 * The switch's `never` default makes that a typecheck error now. This guards the
 * guard: deleting that one line is a green diff, and the next kind added after
 * it would die exactly the same silent death.
 */
const SOURCE = readFileSync(join(import.meta.dirname, '../src/components/Workspace.tsx'), 'utf8')

/**
 * Just the `runAction` switch — the phase-body switch further down the file
 * carries `case` labels of its own, and counting those would let a missing
 * action kind pass. A slice that finds nothing fails below rather than reading
 * as "everything handled".
 */
function handledKinds(): string[] {
  const from = SOURCE.indexOf('const runAction =')
  const to = SOURCE.indexOf('const runMerge =')
  const body = from >= 0 && to > from ? SOURCE.slice(from, to) : ''
  return [...body.matchAll(/^\s*case '([A-Za-z]+)':/gm)].map((m) => m[1] as string)
}

describe('the next-step dispatcher', () => {
  it('has a case for every action kind the resolvers can emit', () => {
    const handled = new Set(handledKinds())

    expect(ACTION_KINDS.filter((kind) => !handled.has(kind))).toEqual([])
  })
})
