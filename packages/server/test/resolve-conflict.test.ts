import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir, worktreeDir } from '@runcastle/core/paths'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { evaluateEditGuard } from '../src/launcher/edit-guard'
import { launchSession } from '../src/launcher/launcher'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow, getSessionRow } from '../src/launcher/sessions'
import hooksApp from '../src/routes/hooks'
import { listAfter } from '../src/services/events'
import { createFeatureBranch, isAncestor } from '../src/services/git'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * The resolve-conflict exemption (decisions 1 + 5). "Resolve with agent" and
 * "Resolve in terminal" brief their agent to merge, resolve the conflicts and
 * commit — work the talk-session edit guard denied outright, so the agent either
 * wedged on the deny or bypassed it with shell scripts.
 *
 * Tested at the three seams the fix crosses: the pure guard (the whole
 * exemption matrix), the hook route (the guard against a REAL worktree's merge
 * state), and the launch input (the purpose reaching the session row).
 */

const GUARD_BASE = {
  toolName: 'Edit',
  worktreePath: '/wt/dark-mode',
  featureSlug: 'dark-mode',
} as const

const SOURCE_FILE = '/wt/dark-mode/vitest.config.ts'

describe('evaluateEditGuard — the resolve-conflict exemption', () => {
  it('allows any file write while the merge it was opened for is in progress', () => {
    for (const toolName of ['Edit', 'Write', 'NotebookEdit']) {
      for (const filePath of [SOURCE_FILE, 'src/theme.ts', '/wt/dark-mode/package.json']) {
        expect(
          evaluateEditGuard({
            ...GUARD_BASE,
            kind: 'revisit',
            purpose: 'resolve-conflict',
            mergeInProgress: true,
            toolName,
            filePath,
          }),
        ).toBeNull()
      }
    }
  })

  /**
   * The exemption is scoped to the merge, not granted to the session: once the
   * merge commit lands, MERGE_HEAD is gone and the standard ticket message is
   * what the agent gets for the next stray edit.
   */
  it('denies with the standard message once no merge is in progress', () => {
    const denial = evaluateEditGuard({
      ...GUARD_BASE,
      kind: 'revisit',
      purpose: 'resolve-conflict',
      mergeInProgress: false,
      filePath: SOURCE_FILE,
    })
    expect(denial?.reason).toMatch(/Talk sessions do not write code/)
    expect(denial?.reason).toMatch(/docs\/features\/dark-mode/)
  })

  it('still lets a resolve session write its feature docs between merges', () => {
    expect(
      evaluateEditGuard({
        ...GUARD_BASE,
        kind: 'revisit',
        purpose: 'resolve-conflict',
        mergeInProgress: false,
        filePath: 'docs/features/dark-mode/decisions.md',
      }),
    ).toBeNull()
  })

  /** A merge in someone else's worktree grants nothing — the purpose is the key. */
  it('denies a session with no purpose even while a merge is in progress', () => {
    for (const kind of ['ideation', 'qa', 'waypoint', 'converge', 'revisit'] as const) {
      const denial = evaluateEditGuard({
        ...GUARD_BASE,
        kind,
        mergeInProgress: true,
        filePath: SOURCE_FILE,
      })
      expect(denial?.reason).toMatch(/Talk sessions do not write code/)
    }
  })

  describe('every other session behaves exactly as before', () => {
    it('denies source and allows the feature docs for an ordinary talk session', () => {
      expect(
        evaluateEditGuard({ ...GUARD_BASE, kind: 'ideation', filePath: SOURCE_FILE })?.reason,
      ).toMatch(/Talk sessions do not write code/)
      expect(
        evaluateEditGuard({
          ...GUARD_BASE,
          kind: 'ideation',
          filePath: 'docs/features/dark-mode/spec.md',
        }),
      ).toBeNull()
    })

    it('leaves a project session alone and keeps failing open on what it cannot read', () => {
      expect(
        evaluateEditGuard({ ...GUARD_BASE, kind: 'project', filePath: '/wt/project/src/index.ts' }),
      ).toBeNull()
      expect(
        evaluateEditGuard({ ...GUARD_BASE, kind: 'ideation', toolName: 'Bash', filePath: 'x.ts' }),
      ).toBeNull()
      expect(evaluateEditGuard({ ...GUARD_BASE, kind: 'ideation' })).toBeNull()
    })

    it('sends a session with no feature to `record_finding`, purpose or not', () => {
      for (const purpose of [undefined, 'resolve-conflict'] as const) {
        const denial = evaluateEditGuard({
          kind: 'prepare',
          purpose,
          mergeInProgress: false,
          worktreePath: '/repo',
          toolName: 'Write',
          filePath: '/repo/.env',
        })
        expect(denial?.reason).toContain('record_finding')
      }
    })
  })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

const cleanup: string[] = []

function mkTmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanup.push(dir)
  return dir
}

afterEach(() => {
  for (const d of cleanup) rmSync(d, { recursive: true, force: true })
  cleanup.length = 0
})

/**
 * The hook route's own view of the exemption, against real git rather than a
 * boolean. The worktree is a REAL `git worktree`, whose `.git` is a file
 * pointing at the parent's git dir — testing `<worktree>/.git/MERGE_HEAD`
 * directly would find nothing there and deny every resolve.
 */
describe('pre-tool — a resolve-conflict session against a real worktree', () => {
  let ctx: AppCtx
  let sessionId: string
  let worktree: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const repo = mkTmp('runcastle-resolve-repo-')
    git(repo, 'init', '-b', 'main')
    git(repo, 'config', 'user.email', 'test@runcastle.dev')
    git(repo, 'config', 'user.name', 'Runcastle Test')
    git(repo, 'config', 'core.autocrlf', 'false')
    writeFileSync(join(repo, 'vitest.config.ts'), 'export default {}\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'initial commit')

    // The two sides of the conflict: the same line, edited on both branches.
    git(repo, 'branch', 'feature/dark-mode')
    writeFileSync(join(repo, 'vitest.config.ts'), 'export default { main: true }\n')
    git(repo, 'commit', '-am', 'main moves')

    worktree = join(mkTmp('runcastle-resolve-wt-'), 'dark-mode')
    git(repo, 'worktree', 'add', worktree, 'feature/dark-mode')
    writeFileSync(join(worktree, 'vitest.config.ts'), 'export default { feature: true }\n')
    git(worktree, 'commit', '-am', 'feature moves')

    const project = seedProject(ctx, repo)
    const feature = seedFeature(ctx, project.id, { slug: 'dark-mode', phase: 'review' })
    sessionId = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'revisit',
      purpose: 'resolve-conflict',
      purposeData: { mergeFrom: 'main', mergeInto: 'feature/dark-mode' },
      worktreePath: worktree,
    }).id
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  async function preTool(id: string, filePath: string): Promise<any> {
    const app = new Hono()
    app.route('/api/hooks', hooksApp)
    const res = await app.request('/api/hooks/pre-tool', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: id,
        payload: {
          hook_event_name: 'PreToolUse',
          tool_name: 'Edit',
          tool_input: { file_path: filePath },
        },
      }),
    })
    return res.json()
  }

  /** Start the merge the session was launched about; it conflicts by construction. */
  function startConflictingMerge(): void {
    expect(() => git(worktree, 'merge', 'main')).toThrow()
  }

  it('allows the conflicting file to be written while the merge is unresolved', async () => {
    startConflictingMerge()
    expect(await preTool(sessionId, join(worktree, 'vitest.config.ts'))).toEqual({})
  })

  it('denies again the moment the merge commit lands', async () => {
    startConflictingMerge()
    writeFileSync(join(worktree, 'vitest.config.ts'), 'export default { both: true }\n')
    git(worktree, 'commit', '-am', 'resolve the merge')

    const json = await preTool(sessionId, join(worktree, 'vitest.config.ts'))
    expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(json.hookSpecificOutput.permissionDecisionReason).toMatch(/do not write code/i)
  })

  it('denies before the agent has started the merge', async () => {
    const json = await preTool(sessionId, join(worktree, 'vitest.config.ts'))
    expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  /** A worktree git cannot read answers "no merge", never a thrown hook. */
  it('falls back to the ordinary rules when the worktree cannot be probed', async () => {
    const feature = seedFeature(ctx, seedProject(ctx).id, { slug: 'gone' })
    const orphan = createSessionRow(ctx, {
      featureId: feature.id,
      kind: 'revisit',
      purpose: 'resolve-conflict',
      purposeData: { mergeFrom: 'main', mergeInto: 'feature/gone' },
      worktreePath: join(tmpdir(), 'runcastle-does-not-exist', 'gone'),
    }).id

    const json = await preTool(orphan, '/wt/gone/src/theme.ts')
    expect(json.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(await preTool(orphan, 'docs/features/gone/spec.md')).toEqual({})
  })
})

/**
 * Session end for a resolve-conflict session (decision 2a). The conflict is
 * derived from the event feed, so the only way a resolved conflict ever clears
 * itself is an event saying so — emitted here, from real git state, when the
 * session that was opened to land the merge ends with it landed.
 */
describe('session-end — merge.resolved when the resolver landed the merge', () => {
  let ctx: AppCtx
  let featureId: string
  let worktree: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const repo = mkTmp('runcastle-resolved-repo-')
    git(repo, 'init', '-b', 'main')
    git(repo, 'config', 'user.email', 'test@runcastle.dev')
    git(repo, 'config', 'user.name', 'Runcastle Test')
    git(repo, 'config', 'core.autocrlf', 'false')
    writeFileSync(join(repo, 'vitest.config.ts'), 'export default {}\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'initial commit')

    git(repo, 'branch', 'feature/dark-mode')
    writeFileSync(join(repo, 'vitest.config.ts'), 'export default { main: true }\n')
    git(repo, 'commit', '-am', 'main moves')

    worktree = join(mkTmp('runcastle-resolved-wt-'), 'dark-mode')
    git(repo, 'worktree', 'add', worktree, 'feature/dark-mode')
    writeFileSync(join(worktree, 'vitest.config.ts'), 'export default { feature: true }\n')
    git(worktree, 'commit', '-am', 'feature moves')

    const project = seedProject(ctx, repo)
    featureId = seedFeature(ctx, project.id, { slug: 'dark-mode', phase: 'review' }).id
    setRuntimeCtx(ctx)
  })

  afterEach(() => clearRuntimeCtx())

  function resolveSession(worktreePath = worktree): string {
    return createSessionRow(ctx, {
      featureId,
      kind: 'revisit',
      purpose: 'resolve-conflict',
      purposeData: { mergeFrom: 'main', mergeInto: 'feature/dark-mode' },
      worktreePath,
    }).id
  }

  async function endSession(id: string): Promise<any> {
    const app = new Hono()
    app.route('/api/hooks', hooksApp)
    const res = await app.request('/api/hooks/session-end', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: id, payload: { hook_event_name: 'SessionEnd' } }),
    })
    return res.json()
  }

  const resolved = () => listAfter(ctx, featureId, 0).filter((e) => e.type === 'merge.resolved')

  /** Resolve the conflicting merge exactly as the session's agent is briefed to. */
  function landTheMerge(): void {
    expect(() => git(worktree, 'merge', 'main')).toThrow()
    writeFileSync(join(worktree, 'vitest.config.ts'), 'export default { both: true }\n')
    git(worktree, 'commit', '-am', 'resolve the merge')
  }

  it('emits merge.resolved with the branch pair once the merge is in', async () => {
    landTheMerge()
    expect(await endSession(resolveSession())).toEqual({})

    expect(resolved()).toHaveLength(1)
    expect(resolved()[0]?.data).toMatchObject({
      mergeFrom: 'main',
      mergeInto: 'feature/dark-mode',
    })
  })

  it('emits nothing when the session ended with the merge unresolved', async () => {
    expect(() => git(worktree, 'merge', 'main')).toThrow()
    await endSession(resolveSession())
    expect(resolved()).toHaveLength(0)
  })

  it('leaves an ordinary session alone even with the merge landed', async () => {
    landTheMerge()
    await endSession(
      createSessionRow(ctx, { featureId, kind: 'revisit', worktreePath: worktree }).id,
    )
    expect(resolved()).toHaveLength(0)
  })

  /** Teardown outranks detection: a probe that cannot run still ends the session. */
  it('still ends the session when the worktree cannot be probed', async () => {
    const id = resolveSession(join(tmpdir(), 'runcastle-does-not-exist', 'gone'))
    expect(await endSession(id)).toEqual({})

    expect(getSessionRow(ctx, id)?.status).toBe('ended')
    expect(resolved()).toHaveLength(0)
    expect(listAfter(ctx, featureId, 0).filter((e) => e.type === 'session.ended')).toHaveLength(1)
  })
})

/**
 * The merge-landed probe (decision 2a). "Has the resolver's merge landed?" is
 * asked as "is the branch it merged FROM now an ancestor of the branch it merged
 * INTO", against real git state rather than a mocked exit code.
 */
describe('isAncestor — has the merge landed', () => {
  let repo: string
  let worktree: string

  beforeEach(() => {
    repo = mkTmp('runcastle-ancestor-repo-')
    git(repo, 'init', '-b', 'main')
    git(repo, 'config', 'user.email', 'test@runcastle.dev')
    git(repo, 'config', 'user.name', 'Runcastle Test')
    git(repo, 'config', 'core.autocrlf', 'false')
    writeFileSync(join(repo, 'vitest.config.ts'), 'export default {}\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'initial commit')

    git(repo, 'branch', 'feature/dark-mode')
    writeFileSync(join(repo, 'vitest.config.ts'), 'export default { main: true }\n')
    git(repo, 'commit', '-am', 'main moves')

    worktree = join(mkTmp('runcastle-ancestor-wt-'), 'dark-mode')
    git(repo, 'worktree', 'add', worktree, 'feature/dark-mode')
    writeFileSync(join(worktree, 'vitest.config.ts'), 'export default { feature: true }\n')
    git(worktree, 'commit', '-am', 'feature moves')
  })

  it('is false while the two branches have diverged', async () => {
    expect(await isAncestor(worktree, 'main', 'feature/dark-mode')).toBe(false)
  })

  it('is true once the merge commit lands', async () => {
    expect(() => git(worktree, 'merge', 'main')).toThrow()
    writeFileSync(join(worktree, 'vitest.config.ts'), 'export default { both: true }\n')
    git(worktree, 'commit', '-am', 'resolve the merge')

    expect(await isAncestor(worktree, 'main', 'feature/dark-mode')).toBe(true)
  })

  /** A branch that never moved off the other is its ancestor, as git answers it. */
  it('is true for a branch that is identical to, or behind, the other', async () => {
    git(repo, 'branch', 'untouched', 'feature/dark-mode')
    expect(await isAncestor(worktree, 'untouched', 'feature/dark-mode')).toBe(true)
    expect(await isAncestor(worktree, 'feature/dark-mode', 'feature/dark-mode')).toBe(true)
  })

  it('answers false rather than throwing on an unknown branch or a missing repo', async () => {
    expect(await isAncestor(worktree, 'main', 'no-such-branch')).toBe(false)
    expect(await isAncestor(join(tmpdir(), 'runcastle-does-not-exist'), 'main', 'main')).toBe(false)
  })
})

describe('launchSession — the purpose reaches the session row', () => {
  let ctx: AppCtx
  let featureId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const repo = mkTmp('runcastle-resolve-launch-')
    git(repo, 'init', '-b', 'main')
    git(repo, 'config', 'user.email', 'test@runcastle.dev')
    git(repo, 'config', 'user.name', 'Runcastle Test')
    git(repo, 'commit', '--allow-empty', '-m', 'initial commit')

    const project = seedProject(ctx, repo)
    const feature = seedFeature(ctx, project.id, { slug: 'dark-mode', phase: 'review' })
    featureId = feature.id
    await createFeatureBranch(project, 'dark-mode', 'main')
    cleanup.push(worktreeDir(project.id, 'dark-mode'))
  })

  it('persists the purpose and the branch pair the resolve is about', async () => {
    const { sessionId } = await launchSession(
      ctx,
      {
        featureId,
        kind: 'revisit',
        kickoffLine: 'Resolve the merge conflict.',
        purpose: 'resolve-conflict',
        purposeData: { mergeFrom: 'main', mergeInto: 'feature/dark-mode' },
      },
      { spawn: false },
    )
    cleanup.push(sessionDir(sessionId))

    const session = getSessionRow(ctx, sessionId)
    expect(session?.purpose).toBe('resolve-conflict')
    expect(session?.purposeData).toEqual({ mergeFrom: 'main', mergeInto: 'feature/dark-mode' })
  })

  it('leaves an ordinary launch with no purpose at all', async () => {
    const { sessionId } = await launchSession(ctx, { featureId, kind: 'revisit' }, { spawn: false })
    cleanup.push(sessionDir(sessionId))

    const session = getSessionRow(ctx, sessionId)
    expect(session?.purpose).toBeUndefined()
    expect(session?.purposeData).toBeUndefined()
  })
})
