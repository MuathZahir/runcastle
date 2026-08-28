// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Button } from '../src/ui'

/**
 * The tier-2 pattern, and the file to copy from (apps/web/STYLE.md).
 *
 * Tier 1 — `createElement` + `renderToStaticMarkup`, no dependencies — is the
 * default and covers anything whose whole behaviour is the markup it emits (see
 * lap-sections.test.ts). Tier 2 is for behaviour that a string cannot show:
 * portals, Escape handling, focus restore, events. It costs a DOM, so it is
 * opted into per file by the pragma on line 1 rather than switched on globally —
 * the ~6,000 lines of existing tests keep running in `node` exactly as before.
 *
 * Auto-cleanup is wired to a global `afterEach`, which this suite does not have
 * (`globals` is off in vitest.config.ts), so tier-2 files unmount their own
 * renders. Forgetting to leaks the previous test's DOM into the next one.
 */
describe('tier-2 DOM environment', () => {
  afterEach(cleanup)

  it('renders a real element into a document and reads it back by role', () => {
    render(<Button>Burn tickets</Button>)

    expect(screen.getByRole('button', { name: 'Burn tickets' })).toBeTruthy()
  })

  it('dispatches a real click to the handler', () => {
    let clicks = 0
    render(<Button onClick={() => clicks++}>Burn tickets</Button>)

    screen.getByRole('button').click()

    expect(clicks).toBe(1)
  })
})
