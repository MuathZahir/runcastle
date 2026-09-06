import { describe, expect, it } from 'vitest'
import { mergeSummary } from '../src/lib/feature-ui'
import type { Freshness } from '../src/lib/feature-ui'

/**
 * The last door (findings F21, decisions 29 and 31). The walked dialog was the
 * right SHAPE — read to confirm, no type-to-arm — and told the wrong story: an
 * all-green "what lands" over a branch that would re-conflict, no mention of
 * work the human waived, and a review row that vouched for an earlier build.
 *
 * So what is asserted here is the inventory: every row present with its own
 * tone, every warning enumerated, and the conflict impossible to miss.
 */
const FRESH: Freshness = { tone: 'fresh', text: 'Reviewed ✓ · this build' }
const STALE: Freshness = {
  tone: 'stale',
  text: 'Reviewed 2 laps ago · 5 tickets landed since — evidence may be outdated',
}

const ticket = (status: string, lap = 2, kind: 'implementation' | 'review' = 'implementation') => ({
  kind,
  status,
  lap,
})

/** A clean merge: eight tickets landed, driven, reviewed against this build. */
const clean = {
  branch: 'feature/greetings-pages',
  base: 'main',
  delta: { commits: 12, files: 9 },
  tickets: [...Array(8)].map(() => ticket('done')),
  lap: 2,
  driveTaken: true,
  freshness: FRESH,
}

const row = (summary: ReturnType<typeof mergeSummary>, key: string) =>
  summary.rows.find((r) => r.key === key)

describe('mergeSummary', () => {
  describe('the green case', () => {
    it('states what lands as commits AND files — the scale a human senses', () => {
      expect(row(mergeSummary(clean), 'what lands')).toEqual({
        key: 'what lands',
        value: '12 commits · 9 files',
        tone: 'ok',
      })
    })

    it('renders every row, in reading order, with nothing to warn about', () => {
      const s = mergeSummary(clean)
      expect(s.rows.map((r) => r.key)).toEqual(['what lands', 'run', 'test drive', 'review'])
      expect(s.rows.every((r) => r.tone === 'ok')).toBe(true)
      expect(s.warnings).toEqual([])
      expect(s.conflictRow).toBeNull()
    })

    it('says what the button does, naming both branches', () => {
      expect(mergeSummary(clean).next).toBe(
        'Merges feature/greetings-pages into main, writes the outcome doc, and moves the feature to Shipped.',
      )
    })

    it('does not invent a base branch git could not name', () => {
      expect(mergeSummary({ ...clean, base: undefined }).next).toContain('into its base branch')
    })
  })

  /**
   * Never silently absent (decision 31a). Each of these used to be a row that
   * vanished or a green one over an empty fact.
   */
  describe('rows that used to go quiet', () => {
    it('says the scale is unknown rather than painting it as zero', () => {
      expect(row(mergeSummary({ ...clean, delta: undefined }), 'what lands')).toEqual({
        key: 'what lands',
        value: 'scale unknown',
        tone: 'warn',
      })
    })

    it('ambers a branch that carries no commits', () => {
      const r = row(mergeSummary({ ...clean, delta: { commits: 0, files: 0 } }), 'what lands')
      expect(r?.value).toBe('0 commits · 0 files')
      expect(r?.tone).toBe('warn')
    })

    it('reports commits alone when git could not count the files', () => {
      expect(row(mergeSummary({ ...clean, delta: { commits: 1 } }), 'what lands')?.value).toBe(
        '1 commit',
      )
    })

    it('says outright that no ticket ever burned on this branch', () => {
      expect(row(mergeSummary({ ...clean, tickets: [] }), 'run')).toEqual({
        key: 'run',
        value: 'no tickets burned',
        tone: 'warn',
      })
    })

    it('ambers the run row over waived work rather than reading 8/8 green', () => {
      const s = mergeSummary({
        ...clean,
        tickets: [ticket('done'), ticket('done'), ticket('cancelled'), ticket('failed')],
      })
      expect(row(s, 'run')).toEqual({
        key: 'run',
        value: '2/4 tickets done · 1 waived · 1 failed',
        tone: 'warn',
      })
    })

    it('never counts the review ticket as work the branch delivered', () => {
      const s = mergeSummary({
        ...clean,
        tickets: [ticket('done'), ticket('done', 2, 'review')],
      })
      expect(row(s, 'run')?.value).toBe('1/1 tickets done')
    })

    it('ambers a branch that was never test-driven', () => {
      expect(row(mergeSummary({ ...clean, driveTaken: false }), 'test drive')).toEqual({
        key: 'test drive',
        value: 'never test-driven',
        tone: 'warn',
      })
    })

    /** Decision 19(d): the dialog inherits the strip's stamp, word for word. */
    it('carries the review freshness stamp verbatim, ambered when it is not fresh', () => {
      expect(row(mergeSummary({ ...clean, freshness: STALE }), 'review')).toEqual({
        key: 'review',
        value: STALE.text,
        tone: 'warn',
      })
    })
  })

  /**
   * Decision 29 — the walked dialog was blind to the conflict the bar was
   * already shouting about, so a human who read only the dialog saw all green
   * over a branch that would re-conflict.
   */
  describe('over a standing merge conflict', () => {
    const conflict = { base: 'main', files: ['index.html', 'src/App.tsx'], at: 1 }

    it('tops the summary with a red row naming the files', () => {
      expect(mergeSummary({ ...clean, conflict }).conflictRow).toBe(
        '⚠ A merge conflict is standing (index.html, src/App.tsx) — this merge will fail unless it’s been resolved.',
      )
    })

    it('names the base when git could not report which files conflicted', () => {
      const s = mergeSummary({ ...clean, conflict: { base: 'main', files: [], at: 1 } })
      expect(s.conflictRow).toContain('(main)')
    })

    it('still says what lands if it lands — the green rows are not withheld', () => {
      const s = mergeSummary({ ...clean, conflict })
      expect(s.rows.map((r) => r.key)).toEqual(['what lands', 'run', 'test drive', 'review'])
    })
  })

  /**
   * Decision 31(b) — the warnings box enumerates exactly what the human is
   * shipping over, and every one of them at once rather than the first.
   */
  describe('the warnings box', () => {
    it('counts open test-drive notes, pluralised', () => {
      expect(mergeSummary({ ...clean, openNotes: 3 }).warnings).toEqual([
        '3 open test-drive notes.',
      ])
      expect(mergeSummary({ ...clean, openNotes: 1 }).warnings).toEqual([
        '1 open test-drive note.',
      ])
    })

    it('says nothing when no notes are open, or when notes are unknown', () => {
      expect(mergeSummary({ ...clean, openNotes: 0 }).warnings).toEqual([])
      expect(mergeSummary(clean).warnings).toEqual([])
    })

    /** Decision 11: the merge dialog is the last catch for waived work. */
    it('names waived tickets as set-aside work', () => {
      const s = mergeSummary({ ...clean, tickets: [ticket('done'), ticket('cancelled')] })
      expect(s.warnings).toEqual(['1 ticket waived — set aside unfinished, not delivered.'])
    })

    /** Decision 26(d): the debt that rides along at triage, caught here too. */
    it('names unburned fix tickets earlier laps left standing, per lap', () => {
      const s = mergeSummary({
        ...clean,
        lap: 3,
        tickets: [ticket('done', 3), ticket('pending', 1), ticket('pending', 1), ticket('pending', 2)],
      })
      expect(s.warnings).toEqual([
        '1 unburned fix ticket from lap 2 — merging leaves them behind.',
        '2 unburned fix tickets from lap 1 — merging leaves them behind.',
      ])
    })

    it('never counts this lap’s own pending tickets as standing debt', () => {
      const s = mergeSummary({ ...clean, lap: 2, tickets: [ticket('pending', 2)] })
      expect(s.warnings).toEqual([])
    })

    it('warns whenever the review row is amber, in the stamp’s own words', () => {
      expect(mergeSummary({ ...clean, freshness: STALE }).warnings).toEqual([`${STALE.text}.`])
    })

    it('says plainly that no review has run at all', () => {
      const s = mergeSummary({ ...clean, freshness: { tone: 'none', text: 'no review yet' } })
      expect(s.warnings).toEqual(['No review has run on this branch — nothing was checked for you.'])
    })

    it('says a verification pass is still running', () => {
      const s = mergeSummary({
        ...clean,
        freshness: { tone: 'verifying', text: 'Verification running — evidence below predates it' },
      })
      expect(s.warnings[0]).toContain('verification pass is still running')
    })

    it('carries the reason a verification could not run', () => {
      const s = mergeSummary({
        ...clean,
        freshness: { tone: 'failed', text: 'verification could not run: drive slot held' },
      })
      expect(s.warnings).toEqual([
        'The review evidence is not fresh: verification could not run: drive slot held.',
      ])
    })

    it('enumerates every gap at once — the whole picture, not the first fault', () => {
      const s = mergeSummary({
        ...clean,
        lap: 3,
        tickets: [ticket('cancelled', 3), ticket('pending', 1)],
        openNotes: 2,
        freshness: STALE,
      })
      expect(s.warnings).toHaveLength(4)
    })
  })

  /**
   * The deferred-scope catch predates this redesign (decisions #7) and outlives
   * it: it is the one warning about what the spec never even attempted.
   */
  describe('with scope deferred to a later lap', () => {
    it('warns with the deferred scope quoted, flattened onto one line', () => {
      const s = mergeSummary({ ...clean, laterLaps: '- inspector\n- diff viewer\n' })
      expect(s.warnings).toEqual(['The spec still lists deferred scope: - inspector - diff viewer'])
    })

    it('cuts a long section rather than burying the dialog in it', () => {
      const s = mergeSummary({ ...clean, laterLaps: 'x'.repeat(400) })
      expect(s.warnings[0]).toHaveLength('The spec still lists deferred scope: '.length + 181)
      expect(s.warnings[0].endsWith('…')).toBe(true)
    })

    it('says nothing when the spec defers nothing', () => {
      expect(mergeSummary({ ...clean, laterLaps: null }).warnings).toEqual([])
    })
  })
})
