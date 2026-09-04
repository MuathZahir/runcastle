import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The migration ratchet (decision 9, apps/web/STYLE.md).
 *
 * `src/styles.css` is the pre-Tailwind stylesheet the seven flow redesign
 * features are retiring between them: each one migrates its own surface's rules
 * to utilities as it redesigns that surface, deletes the rules it migrated, and
 * lowers the baseline below to whatever the file measures afterwards. Nothing
 * may be added to the file, so the number only ever goes down — the last flow to
 * land takes it to zero, deletes the file and the legacy alias block, and
 * deletes this test with them.
 *
 * A change that grows the sheet fails here rather than passing review on prose.
 */
const STYLES_CSS_LINE_BASELINE = 3654

describe('styles.css ratchet', () => {
  it('never grows past the recorded baseline', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/styles.css'), 'utf8')
    // `trimEnd` first so the count is the one `wc -l` reports, not one more for
    // the empty string after the file's trailing newline.
    const lines = css.trimEnd().split('\n').length

    expect(lines).toBeLessThanOrEqual(STYLES_CSS_LINE_BASELINE)
  })
})
