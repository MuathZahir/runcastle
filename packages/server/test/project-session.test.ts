import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Project, SessionRow } from '@runcastle/core'
import { SessionKind, isProjectSessionKind } from '@runcastle/core'
import { PROJECT_WORKTREE_SLUG, sessionDir, worktreeDir } from '@runcastle/core/paths'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppCtx } from '../src/db/types'
import { sessions } from '../src/db/schema'
import {
  RUNCASTLE_MCP_ALLOW_RULES,
  SESSION_BASH_READ_RULES,
  SESSION_BASH_WRITE_RULES,
  renderProjectPrompt,
  renderSettings,
} from '../src/launcher/artifacts'
import { buildClaudeArgs, launchProjectSession } from '../src/launcher/launcher'
import { KICKOFF_LINES, getSessionRow } from '../src/launcher/sessions'
import { endSession } from '../src/pty/end-session'
import { listByProject } from '../src/services/events'
import { PROJECT_BRANCH, ensureProjectWorktree } from '../src/services/git'
import { createCallerFactory } from '../src/trpc/context'
import { appRouter } from '../src/trpc/router'
import { makeTestCtx } from './helpers/db'
import { seedProject } from './helpers/fixtures'

/**
 * The project session (feature-grouping decisions 17–20): a project-scoped
 * terminal that writes the repo for real, but never the human's checkout. The
 * invariants worth pinning are the ones that would silently cost work or
 * silently widen access — where it commits, what lands, and what it may run
 * without asking.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function initRepo(dir: string): void {
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@runcastle.dev')
  git(dir, 'config', 'user.name', 'Runcastle Test')
  git(dir, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(dir, 'README.md'), 'base\n')
  git(dir, 'add', 'README.md')
  git(dir, 'commit', '-m', 'initial commit')
}

/** Land one commit on `branch` from a throwaway worktree — a crashed session's leftovers. */
function commitOnBranch(repoPath: string, branch: string, file: string, body: string): string {
  const branches = git(repoPath, 'branch', '--list', branch)
  if (!branches) git(repoPath, 'branch', branch, 'main')
  const wt = join(mkdtempSync(join(tmpdir(), 'rc-proj-wt-')), 'wt')
  git(repoPath, 'worktree', 'add', wt, branch)
  writeFileSync(join(wt, file), body)
  git(wt, 'add', file)
  git(wt, 'commit', '-m', `project session: ${file}`)
  const tip = git(repoPath, 'rev-parse', branch)
  git(repoPath, 'worktree', 'remove', wt, '--force')
  return tip
}

/** Poll until `type` shows up on the project timeline (landing is fire-and-forget). */
async function waitForProjectEvent(
  ctx: AppCtx,
  projectId: string,
  type: string,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = listByProject(ctx, projectId).find((e) => e.type === type)
    if (found) return (found.data ?? {}) as Record<string, unknown>
    if (Date.now() > deadline) {
      throw new Error(
        `no ${type} event within ${timeoutMs}ms; saw: ${listByProject(ctx, projectId)
          .map((e) => e.type)
          .join(', ')}`,
      )
    }
    await new Promise((done) => setTimeout(done, 25))
  }
}

describe('the `project` session kind', () => {
  it('is a project-scoped kind with its own kickoff line', () => {
    expect(SessionKind.parse('project')).toBe('project')
    expect(isProjectSessionKind('project')).toBe(true)
    // …and it did not accidentally reclassify the feature kinds.
    expect(isProjectSessionKind('ideation')).toBe(false)

    expect(KICKOFF_LINES.project).toContain('/runcastle:project')
    expect(KICKOFF_LINES.project).not.toMatch(/[\r\n]/)
  })

  /**
   * The pre-approved `git add`/`git commit` rules are justified in code by talk
   * worktrees being docs-only, so even a blind `git add` can only touch feature
   * docs. This session can touch anything in the repo and land it on the base
   * branch, so that justification does not transfer (decision 18).
   */
  it('does not pre-approve write-shaped git commands in its settings', () => {
    const project = renderSettings('/hooks/hook-client.ts', 'project')
    for (const rule of SESSION_BASH_WRITE_RULES) {
      expect(project.permissions.allow).not.toContain(rule)
    }
    // …while the read-only git surface and our own MCP tools are unchanged.
    expect(project.permissions.allow).toEqual(
      expect.arrayContaining([...SESSION_BASH_READ_RULES, ...RUNCASTLE_MCP_ALLOW_RULES]),
    )

    // Every other kind keeps the full set (regression guard on the split).
    const ideation = renderSettings('/hooks/hook-client.ts', 'ideation')
    expect(ideation.permissions.allow).toEqual(
      expect.arrayContaining([...SESSION_BASH_WRITE_RULES]),
    )
  })

  it('briefs the session with its branch, its worktree, and its four tools', () => {
    const out = renderProjectPrompt({
      project: { id: 'proj_1', name: 'acme', repoPath: '/repo', mainBranch: 'main' },
      branch: PROJECT_BRANCH,
      worktreePath: '/wt/__project',
    })
    expect(out).toContain(PROJECT_BRANCH)
    expect(out).toContain('/wt/__project')
    // the consequence of the branch, stated where the agent will read it
    expect(out).toContain('/repo')
    expect(out).toContain('main')
    for (const tool of [
      'create_feature',
      'get_project_context',
      'get_work_record',
      'record_event',
    ]) {
      expect(out).toContain(tool)
    }
    // …and none of the pipeline tools it is deliberately not given.
    expect(out).not.toContain('emit_tickets')
    expect(out).not.toContain('complete_phase')
    expect(out).toContain('/runcastle:project')
  })
})

describe('ensureProjectWorktree', () => {
  let ctx: AppCtx
  let project: Project
  let repoPath: string
  const cleanup: string[] = []
  let prevHome: string | undefined
  let prevUserProfile: string | undefined

  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'rc-proj-home-'))
    cleanup.push(home)
    prevHome = process.env.HOME
    prevUserProfile = process.env.USERPROFILE
    process.env.HOME = home
    process.env.USERPROFILE = home

    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'rc-proj-repo-'))
    cleanup.push(repoPath)
    initRepo(repoPath)
    project = seedProject(ctx, repoPath)
  })

  afterEach(() => {
    process.env.HOME = prevHome
    process.env.USERPROFILE = prevUserProfile
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  it('cuts the branch from the base tip into its own worktree, never the checkout', async () => {
    const worktreePath = await ensureProjectWorktree(project)

    expect(worktreePath).toBe(worktreeDir(project.id, PROJECT_WORKTREE_SLUG))
    expect(worktreePath).not.toBe(project.repoPath)
    expect(git(worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(PROJECT_BRANCH)
    expect(git(repoPath, 'rev-parse', PROJECT_BRANCH)).toBe(git(repoPath, 'rev-parse', 'main'))
    // the human's checkout is untouched — still on main, still clean
    expect(git(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(git(repoPath, 'status', '--porcelain')).toBe('')
  })

  it('is idempotent across relaunches', async () => {
    const first = await ensureProjectWorktree(project)
    const second = await ensureProjectWorktree(project)
    expect(second).toBe(first)
    expect(git(second, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(PROJECT_BRANCH)
  })

  /**
   * The crashed-session case. A session that died without its terminal closing
   * never reached the end-of-session landing, so its commits are still sitting
   * on `runcastle/project` — and recutting the branch from the base tip would
   * delete them. They must land first.
   */
  it('lands a crashed session’s leftovers before recutting from the base tip', async () => {
    const leftoverTip = commitOnBranch(repoPath, PROJECT_BRANCH, 'NOTES.md', 'from a dead session\n')

    const worktreePath = await ensureProjectWorktree(project)

    // the work is on the base branch (and so in the human's checkout)…
    expect(git(repoPath, 'rev-parse', 'main')).toBe(leftoverTip)
    expect(existsSync(join(repoPath, 'NOTES.md'))).toBe(true)
    // …and the branch was then recut at that same tip for the new session
    expect(git(repoPath, 'rev-parse', PROJECT_BRANCH)).toBe(leftoverTip)
    expect(git(worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(PROJECT_BRANCH)
  })

  /**
   * The other half of "never clobber": when the leftovers CANNOT land, the
   * branch keeps them and the session reopens on top of its own work rather
   * than having it thrown away in the name of a fresh cut.
   */
  it('keeps leftovers that conflict with the base instead of discarding them', async () => {
    const leftoverTip = commitOnBranch(repoPath, PROJECT_BRANCH, 'SHARED.md', 'session version\n')
    // main moves under it, touching the same file — the merge will conflict
    writeFileSync(join(repoPath, 'SHARED.md'), 'human version\n')
    git(repoPath, 'add', 'SHARED.md')
    git(repoPath, 'commit', '-m', 'human edit')
    const mainTip = git(repoPath, 'rev-parse', 'main')

    const worktreePath = await ensureProjectWorktree(project)

    expect(git(repoPath, 'rev-parse', PROJECT_BRANCH)).toBe(leftoverTip)
    expect(git(repoPath, 'rev-parse', 'main')).toBe(mainTip)
    expect(readFileSync(join(repoPath, 'SHARED.md'), 'utf8')).toBe('human version\n')
    expect(git(worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(PROJECT_BRANCH)
  })
})

describe('launching, resuming and landing a project session', () => {
  let ctx: AppCtx
  let project: Project
  let repoPath: string
  const cleanup: string[] = []
  let prevHome: string | undefined
  let prevUserProfile: string | undefined

  beforeEach(async () => {
    const home = mkdtempSync(join(tmpdir(), 'rc-projlaunch-home-'))
    cleanup.push(home)
    prevHome = process.env.HOME
    prevUserProfile = process.env.USERPROFILE
    process.env.HOME = home
    process.env.USERPROFILE = home

    ctx = await makeTestCtx()
    repoPath = mkdtempSync(join(tmpdir(), 'rc-projlaunch-repo-'))
    cleanup.push(repoPath)
    initRepo(repoPath)
    project = seedProject(ctx, repoPath)
  })

  afterEach(() => {
    process.env.HOME = prevHome
    process.env.USERPROFILE = prevUserProfile
    for (const d of cleanup) rmSync(d, { recursive: true, force: true })
    cleanup.length = 0
  })

  function sessionRow(id: string): SessionRow {
    const row = getSessionRow(ctx, id)
    if (!row) throw new Error(`no session ${id}`)
    return row
  }

  /** The argv of the MOST RECENT launch (a relaunch appends a second event). */
  function launchCommand(): string {
    const launched = listByProject(ctx, project.id)
      .filter((e) => e.type === 'session.launched')
      .at(-1)
    return String((launched?.data as { command?: string })?.command ?? '')
  }

  it('creates a project-keyed row in its own worktree on the project branch', async () => {
    const { sessionId } = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })

    const row = sessionRow(sessionId)
    expect(row.kind).toBe('project')
    expect(row.projectId).toBe(project.id)
    expect(row.featureId ?? null).toBeNull()
    expect(row.worktreePath).toBe(worktreeDir(project.id, PROJECT_WORKTREE_SLUG))
    expect(row.worktreePath).not.toBe(project.repoPath)
    expect(git(row.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(PROJECT_BRANCH)

    const types = listByProject(ctx, project.id).map((e) => e.type)
    expect(types).toContain('session.launching')
  })

  it('launches with --permission-mode default and settings that do not pre-approve commits', async () => {
    const { sessionId } = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })

    expect(launchCommand()).toContain('--permission-mode default')

    const settings = JSON.parse(
      readFileSync(join(sessionDir(sessionId), 'settings.json'), 'utf8'),
    ) as { permissions: { allow: string[] } }
    expect(settings.permissions.allow).not.toContain('Bash(git add:*)')
    expect(settings.permissions.allow).not.toContain('Bash(git commit:*)')
    expect(settings.permissions.allow).toContain('Bash(git status:*)')
  })

  it('refuses a second concurrent project session with a clear message', async () => {
    await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
    await expect(
      launchProjectSession(ctx, { projectId: project.id }, { spawn: false }),
    ).rejects.toThrow(/already open/i)
  })

  it('resumes its own last conversation on relaunch', async () => {
    const first = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
    ctx.db
      .update(sessions)
      .set({ status: 'ended', ccSessionId: 'cc-project-1' })
      .where(eq(sessions.id, first.sessionId))
      .run()

    await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })

    expect(launchCommand()).toContain('--resume cc-project-1')
    expect(listByProject(ctx, project.id).map((e) => e.type)).toContain('session.resumed')
  })

  it('lands the session’s commits on the base branch when the terminal ends', async () => {
    const { sessionId } = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
    const wt = sessionRow(sessionId).worktreePath
    writeFileSync(join(wt, 'CONTEXT.md'), '# charter\n')
    git(wt, 'add', 'CONTEXT.md')
    git(wt, 'commit', '-m', 'project: draft the charter')

    endSession(ctx, sessionId)

    const data = await waitForProjectEvent(ctx, project.id, 'project.landed')
    expect(data.commits).toBe(1)
    expect(existsSync(join(repoPath, 'CONTEXT.md'))).toBe(true)
  })

  it('keeps the branch and says so when the work cannot land', async () => {
    const { sessionId } = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
    const wt = sessionRow(sessionId).worktreePath
    writeFileSync(join(wt, 'CONTEXT.md'), 'session version\n')
    git(wt, 'add', 'CONTEXT.md')
    git(wt, 'commit', '-m', 'project: charter')
    const projectTip = git(repoPath, 'rev-parse', PROJECT_BRANCH)

    // the human wrote the same file on the base branch meanwhile
    writeFileSync(join(repoPath, 'CONTEXT.md'), 'human version\n')
    git(repoPath, 'add', 'CONTEXT.md')
    git(repoPath, 'commit', '-m', 'human charter')

    endSession(ctx, sessionId)

    const data = await waitForProjectEvent(ctx, project.id, 'project.land_conflict')
    expect(data.conflict).toBe(true)
    // nothing overwritten: the branch still holds the work for the next launch
    expect(git(repoPath, 'rev-parse', PROJECT_BRANCH)).toBe(projectTip)
    expect(readFileSync(join(repoPath, 'CONTEXT.md'), 'utf8')).toBe('human version\n')
  })

  /**
   * `talkToProject` is exercised through `launchProjectSession` above rather
   * than called here: the router launches for real (no `spawn:false` seam), and
   * a unit test must not spawn a terminal. What the router adds on top is the
   * pair of endpoints and the live-session lookup behind them.
   */
  it('is reachable over tRPC as talkToProject / projectSession', async () => {
    const trpc = createCallerFactory(appRouter)(ctx)
    expect(typeof trpc.project.talkToProject).toBe('function')

    expect(await trpc.project.projectSession({ projectId: project.id })).toBeNull()

    const { sessionId } = await launchProjectSession(ctx, { projectId: project.id }, { spawn: false })
    const open = await trpc.project.projectSession({ projectId: project.id })
    expect(open?.id).toBe(sessionId)
    expect(open?.kind).toBe('project')

    endSession(ctx, sessionId)
    expect(await trpc.project.projectSession({ projectId: project.id })).toBeNull()
  })
})
