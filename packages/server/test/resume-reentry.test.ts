import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import {
  KICKOFF_LINES,
  RESUME_KICKOFF_PREFIX,
  RESUME_MAX_REENTRIES,
  RESUME_MAX_TRANSCRIPT_BYTES,
  createSessionRow,
  markSessionEnded,
  markSessionLive,
  reentryCount,
  resumeCapExceeded,
  resumeKickoffLine,
  transcriptBytes,
} from '../src/launcher/sessions'
import { evaluateEditGuard, prototypesRel } from '../src/launcher/edit-guard'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * Three fixes that share one theme — a session being handed something about its
 * own past that is either false or ruinously expensive.
 */

describe('resumeKickoffLine — quote the conversation that is coming back', () => {
  /**
   * A revisit resumes `mostRecentResumableSession` with NO kind filter, on
   * purpose: "revisit" means "pick up the last thing we talked about", whatever
   * kind that was. The framing quoted `KICKOFF_LINES[newKind]` regardless, so a
   * revisit resuming an ideation conversation opened with "Your original
   * instruction was: invoke the /runcastle:revisit skill" — which was never that
   * conversation's instruction, with the real opening turn visible directly
   * above in the restored transcript.
   */
  it('quotes the RESUMED row kind, not the new session kind', () => {
    const line = resumeKickoffLine('revisit', 'ideation')
    expect(line).toContain(KICKOFF_LINES.ideation)
    expect(line).not.toContain(KICKOFF_LINES.revisit)
    expect(line.startsWith(RESUME_KICKOFF_PREFIX)).toBe(true)
  })

  it('falls back to the new kind when the resumed row kind is unknown', () => {
    expect(resumeKickoffLine('revisit')).toBe(RESUME_KICKOFF_PREFIX + KICKOFF_LINES.revisit)
  })

  /**
   * It also stopped asserting a cause. "runcastle restarted and closed the
   * terminal" is one of several ways a session ends and is flatly untrue of the
   * commonest — the human clicking Revisit on a conversation that closed
   * cleanly.
   */
  it('does not claim runcastle restarted', () => {
    expect(RESUME_KICKOFF_PREFIX).not.toMatch(/runcastle restarted/i)
    // it still says what DID happen, and asks for re-orientation rather than a restart
    expect(RESUME_KICKOFF_PREFIX).toMatch(/terminal was closed/i)
    expect(RESUME_KICKOFF_PREFIX).toMatch(/do not start over/i)
  })
})

describe('the re-entry cap', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'runcastle-reentry-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('resumes an ordinary conversation', () => {
    expect(resumeCapExceeded({ bytes: 40_000, reentries: 2 })).toBeNull()
  })

  /**
   * There is no compaction, pruning or summarization anywhere in runcastle, so
   * `--resume` is monotonic. A measured `prepare` conversation resumed across
   * four rows reached 1.42 MB / ~91k tokens; past that, Claude Code's own
   * auto-compact fires and silently drops exactly the decision prose the revisit
   * came back for.
   */
  it('declines an oversized transcript, naming the size', () => {
    const v = resumeCapExceeded({ bytes: RESUME_MAX_TRANSCRIPT_BYTES + 1, reentries: 1 })
    expect(v?.reason).toBe('transcript-size')
    expect(v?.detail).toMatch(/KB/)
  })

  it('declines once the conversation has been re-entered too many times', () => {
    const v = resumeCapExceeded({ bytes: 1000, reentries: RESUME_MAX_REENTRIES })
    expect(v?.reason).toBe('reentry-count')
    expect(v?.detail).toContain(String(RESUME_MAX_REENTRIES))
  })

  /** A transcript we cannot measure must never be able to wedge a launch. */
  it('fails OPEN on an unmeasurable transcript', () => {
    expect(resumeCapExceeded({ bytes: undefined, reentries: 0 })).toBeNull()
    expect(transcriptBytes(null)).toBeUndefined()
    expect(
      transcriptBytes({ transcriptPath: join(dir, 'nope.jsonl') } as never),
    ).toBeUndefined()
  })

  it('measures a real transcript on disk', () => {
    const path = join(dir, 't.jsonl')
    writeFileSync(path, 'x'.repeat(1234), 'utf8')
    expect(transcriptBytes({ transcriptPath: path } as never)).toBe(1234)
  })
})

describe('reentryCount', () => {
  let ctx: AppCtx
  beforeEach(async () => {
    ctx = await makeTestCtx()
  })

  it('counts the ended rows that ever went live, scoped to the feature', () => {
    const project = seedProject(ctx, 'C:/repo')
    const a = seedFeature(ctx, project.id, { slug: 'a' })
    const b = seedFeature(ctx, project.id, { slug: 'b' })
    expect(reentryCount(ctx, { featureId: a.id })).toBe(0)

    for (const cc of ['cc-1', 'cc-2', 'cc-3']) {
      const s = createSessionRow(ctx, { featureId: a.id, kind: 'revisit', worktreePath: 'w' })
      markSessionLive(ctx, s.id, { ccSessionId: cc })
      markSessionEnded(ctx, s.id)
    }
    // a row that never went live has no cc id and is not a re-entry
    const stillborn = createSessionRow(ctx, {
      featureId: a.id,
      kind: 'revisit',
      worktreePath: 'w',
    })
    markSessionEnded(ctx, stillborn.id)

    expect(reentryCount(ctx, { featureId: a.id })).toBe(3)
    expect(reentryCount(ctx, { featureId: b.id })).toBe(0)
  })
})

/**
 * The prototype spike exemption. A `prototype` waypoint's job is to BUILD the
 * throwaway thing that answers its question, which is code — so it gets one
 * place to put it, inside the feature's own docs dir, and the denial for
 * everywhere else has to be able to name that place.
 */
describe('edit guard — prototype spikes', () => {
  const base = {
    kind: 'waypoint' as const,
    toolName: 'Write',
    worktreePath: 'C:/wt/dark-mode',
    featureSlug: 'dark-mode',
  }

  it('names one path and it is under the feature docs', () => {
    expect(prototypesRel('dark-mode')).toBe('docs/features/dark-mode/prototypes')
  })

  it('allows a spike under docs/features/<slug>/prototypes/', () => {
    expect(
      evaluateEditGuard({ ...base, filePath: 'docs/features/dark-mode/prototypes/spike.ts' }),
    ).toBeNull()
    expect(
      evaluateEditGuard({
        ...base,
        filePath: 'docs/features/dark-mode/prototypes/nested/deep/app.tsx',
      }),
    ).toBeNull()
  })

  it('still denies code outside it, and says where a spike goes', () => {
    const denial = evaluateEditGuard({ ...base, filePath: 'src/theme.ts' })
    expect(denial).not.toBeNull()
    expect(denial?.reason).toContain('docs/features/dark-mode/prototypes/')
    // and it does not read as a route to landing the real change
    expect(denial?.reason).toMatch(/not a route to landing the real change/i)
  })

  /** A near-miss sibling must not be swept in by a prefix match. */
  it('denies a lookalike sibling directory', () => {
    expect(
      evaluateEditGuard({ ...base, filePath: 'docs/features/other/prototypes/spike.ts' }),
    ).not.toBeNull()
  })
})
