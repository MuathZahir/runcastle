import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Feature, WorkerKind } from '@runcastle/core'
import { worktreeDir } from '@runcastle/core/paths'
import { workers } from '../src/db/schema'
import type { AppCtx } from '../src/db/types'
import { evaluateEditGuard, type HostWorker } from '../src/launcher/edit-guard'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow } from '../src/launcher/sessions'
import { evaluateWorkerGuard } from '../src/launcher/worker-guard'
import hooksApp from '../src/routes/hooks'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedHostReview, seedProject } from './helpers/fixtures'

/**
 * The host worker's guards (workers-build-in-the-feature-s-folder decisions 9,
 * 10 and 11): a building worker edits inside its own folder and the temp
 * folder; a gates review edits only in the temp folder; and both are refused the
 * git that pushes, rewrites history, leaves the branch, or touches the shared
 * stash or another folder — in bash and in PowerShell.
 */

const feature = '/home/u/.runcastle/worktrees/p1/dark-mode'
const ownFolder = '/home/u/.runcastle/worktrees/p1/dark-mode--w1'
const inFeature: HostWorker = { role: 'build', placement: 'feature-folder', folder: feature }
const inOwn: HostWorker = { role: 'build', placement: 'own-folder', folder: ownFolder }
const review: HostWorker = { role: 'review', placement: 'feature-folder', folder: feature }

describe('worker git guard', () => {
  const verdict = (worker: HostWorker | undefined, command: string, toolName = 'Bash') =>
    evaluateWorkerGuard({ toolName, command, ...(worker ? { hostWorker: worker } : {}) })
  const refused = (worker: HostWorker, command: string, toolName?: string) =>
    expect(verdict(worker, command, toolName), command).not.toBeNull()
  const allowed = (worker: HostWorker, command: string, toolName?: string) =>
    expect(verdict(worker, command, toolName), command).toBeNull()

  it("allows a building worker's ordinary git", () => {
    for (const w of [inFeature, inOwn]) {
      for (const cmd of [
        'git status',
        'git diff HEAD~1',
        'git log --oneline -5',
        'git add -A && git commit -m "feat(web): dark mode"',
        'git commit --fixup HEAD',
        'git revert HEAD --no-edit',
        'git checkout -- src/theme.ts',
        'git checkout HEAD~1 -- src/theme.ts',
        'git checkout -p',
        'git restore src/theme.ts',
        'git restore --staged .',
        'git reset',
        'git reset HEAD',
        'git reset src/theme.ts',
        'git reset -- src/theme.ts',
        'git show feature/dark-mode:src/theme.ts',
        'git branch',
        'git branch --show-current',
        'git branch -vv',
        'git worktree list',
        'git fetch origin',
        'git rebase --abort',
        'grep -rn "git push" docs/',
        'git commit -m "never git stash or git push --force"',
      ]) allowed(w, cmd)
    }
  })

  it('refuses pushing, pulling and the stash to every host worker', () => {
    for (const w of [inFeature, inOwn, review]) {
      for (const cmd of [
        'git push',
        'git push -u origin HEAD',
        'git push --dry-run',
        'git pull',
        'git pull --rebase origin main',
        'git stash',
        'git stash push -u -m wip',
        'git stash list',
        'git stash pop',
        'git -C ../other stash',
      ]) refused(w, cmd)
    }
  })

  it('refuses rewriting history', () => {
    for (const w of [inFeature, inOwn]) {
      for (const cmd of [
        'git reset --hard',
        'git reset --hard origin/feature/dark-mode',
        'git reset --soft HEAD~1',
        'git reset --keep HEAD^',
        'git reset --merge',
        'git reset HEAD~2',
        'git reset ORIG_HEAD',
        'git reset 1a2b3c4d',
        'git rebase main',
        'git rebase -i HEAD~3',
        'git rebase --continue',
        'git commit --amend --no-edit',
        'git commit -a --amend -m x',
        'git filter-branch --tree-filter "rm x" HEAD',
        'git filter-repo --path secrets --invert-paths',
      ]) refused(w, cmd)
    }
  })

  it('refuses deleting, renaming or moving branches, and update-ref', () => {
    for (const cmd of [
      'git branch -d runcastle/worker/w1',
      'git branch -D feature/dark-mode',
      'git branch --delete old',
      'git branch -m new-name',
      'git branch -M feature/dark-mode other',
      'git branch -f feature/dark-mode HEAD~3',
      'git branch --force x',
      'git update-ref refs/heads/feature/dark-mode HEAD~1',
      'git update-ref -d refs/heads/x',
    ]) refused(inOwn, cmd)
    allowed(inOwn, 'git branch spike')
  })

  it('refuses switching branch, but not restoring files', () => {
    for (const w of [inFeature, inOwn]) {
      for (const cmd of [
        'git checkout main',
        'git checkout -b spike',
        'git checkout -B spike',
        'git checkout --detach',
        'git checkout -',
        'git switch main',
        'git switch -c spike',
        'git switch -',
      ]) refused(w, cmd)
    }
    expect(verdict(inFeature, 'git checkout main')?.reason).toMatch(/share the feature's folder with the lead/)
    expect(verdict(inOwn, 'git switch main')?.reason).toMatch(/your own branch/)
    expect(verdict(inOwn, 'git checkout main')?.reason).toMatch(/git checkout -- <path>/)
  })

  it('refuses making, removing or pruning worktrees', () => {
    for (const cmd of ['git worktree add ../x', 'git worktree remove ../x', 'git worktree prune', 'git worktree move a b']) {
      refused(inOwn, cmd)
    }
  })

  it('allows a merge in its own folder only', () => {
    allowed(inOwn, 'git merge feature/dark-mode')
    allowed(inOwn, 'git merge --abort')
    refused(inFeature, 'git merge runcastle/worker/w2')
    refused(review, 'git merge feature/dark-mode')
  })

  it('refuses a review every git command that changes the folder', () => {
    for (const cmd of [
      'git add src/x.ts',
      'git commit -m x',
      'git checkout -- src/x.ts',
      'git restore .',
      'git reset',
      'git cherry-pick abc1234',
      'git revert HEAD',
      'git clean -fd',
      'git rm src/x.ts',
      'git mv a b',
    ]) refused(review, cmd)
    for (const cmd of ['git status', 'git diff main...HEAD', 'git log', 'git show HEAD:src/x.ts']) allowed(review, cmd)
    expect(verdict(review, 'git commit -m x')?.reason).toMatch(/report_finding/)
  })

  it('says why and what to do instead', () => {
    expect(verdict(inFeature, 'git push')?.reason).toMatch(/already on the feature branch/)
    expect(verdict(inOwn, 'git push')?.reason).toMatch(/lead merges your branch/)
    expect(verdict(inOwn, 'git stash')?.reason).toMatch(/shared by every folder/)
    expect(verdict(inOwn, 'git reset --hard')?.reason).toMatch(/git revert/)
  })

  it('reads wrappers, nested shells and compound lines', () => {
    for (const cmd of [
      'git add . && git commit -m x && git push',
      'git status; git stash',
      'env GIT_TRACE=1 git push',
      'sudo git reset --hard',
      'bash -c "git stash"',
      'git -C ../other-feature checkout main',
      'git -c core.pager=cat rebase main',
      'git commit -F - <<\'EOF\'\nmsg\nEOF\ngit push',
      'git commit -m "x" \\\n  && git push',
    ]) refused(inOwn, cmd)
  })

  it('reads PowerShell: separators, the call operator, backtick escapes and here-strings', () => {
    for (const cmd of [
      'git add .; git push',
      'git status\ngit stash',
      'git status | Out-Null; git reset --hard',
      'git add . && git push',
      'git diff || git switch main',
      '& "C:\\Program Files\\Git\\cmd\\git.exe" push',
      'git.exe stash',
      'git commit -m x `\n  ; git push',
      'pwsh -Command "git stash"',
      'if ($true) { git checkout main }',
    ]) refused(inOwn, cmd, 'PowerShell')
    for (const cmd of [
      'git commit -m "say `"git push`""',
      'git commit -m x`; git push',
      "git commit -F - @'\nfix: x\ngit push --force\n'@",
      'Get-ChildItem C:\\wt | Select-Object Name',
    ]) allowed(inOwn, cmd, 'PowerShell')
  })

  it('leaves every other session, and the non-shell tools, alone', () => {
    expect(verdict(undefined, 'git push --force')).toBeNull()
    expect(verdict(inOwn, 'git push', 'Edit')).toBeNull()
    expect(evaluateWorkerGuard({ toolName: 'Bash', hostWorker: inOwn })).toBeNull()
  })
})

describe('edit guard for host workers', () => {
  const edit = (worker: HostWorker, filePath: string, over: Partial<Parameters<typeof evaluateEditGuard>[0]> = {}) =>
    evaluateEditGuard({
      kind: 'worker',
      toolName: 'Edit',
      filePath,
      worktreePath: worker.folder,
      featureSlug: 'dark-mode',
      hostWorker: worker,
      tempFolders: ['/tmp'],
      ...over,
    })

  it('lets a building worker edit anywhere in its own folder and the temp folder', () => {
    expect(edit(inFeature, 'src/theme.ts')).toBeNull()
    expect(edit(inFeature, `${feature}/packages/web/src/app.tsx`)).toBeNull()
    expect(edit(inFeature, 'docs/features/dark-mode/brief.md')).toBeNull()
    expect(edit(inOwn, `${ownFolder}/src/theme.ts`)).toBeNull()
    expect(edit(inOwn, '/tmp/scratch/notes.md')).toBeNull()
  })

  it('refuses a building worker anywhere else, naming its folder', () => {
    for (const path of [`${feature}/src/theme.ts`, '../dark-mode/src/x.ts', '/home/u/.bashrc', '/home/u/code/app/src/x.ts']) {
      const denial = edit(inOwn, path)
      expect(denial, path).not.toBeNull()
      expect(denial?.reason).toContain(ownFolder)
    }
    expect(edit(inFeature, '/home/u/.claude/settings.json')?.reason).toMatch(/share with the lead/)
  })

  it('refuses a gates review every edit but the temp folder', () => {
    expect(edit(review, '/tmp/review-notes.md')).toBeNull()
    for (const path of ['src/theme.ts', 'docs/features/dark-mode/brief.md', '/home/u/x']) {
      const reason = edit(review, path)?.reason
      expect(reason, path).toMatch(/review writes no code/)
      expect(reason).toMatch(/report_finding/)
    }
  })

  it('reads Windows paths: drive letters, either slash, any case', () => {
    const win: HostWorker = { role: 'build', placement: 'own-folder', folder: 'C:\\Users\\u\\.runcastle\\worktrees\\p1\\w1' }
    const winEdit = (filePath: string) =>
      edit(win, filePath, { platform: 'win32', tempFolders: ['C:\\Users\\u\\AppData\\Local\\Temp'] })
    expect(winEdit('src\\theme.ts')).toBeNull()
    expect(winEdit('c:\\users\\U\\.runcastle\\worktrees\\P1\\w1\\src\\theme.ts')).toBeNull()
    expect(winEdit('C:/Users/u/.runcastle/worktrees/p1/w1/src/theme.ts')).toBeNull()
    expect(winEdit('C:\\Users\\u\\AppData\\Local\\Temp\\x.txt')).toBeNull()
    expect(winEdit('C:\\Users\\u\\.runcastle\\worktrees\\p1\\dark-mode\\src\\x.ts')).not.toBeNull()
    expect(winEdit('D:\\Users\\u\\.runcastle\\worktrees\\p1\\w1\\src\\x.ts')).not.toBeNull()
    expect(winEdit('..\\w2\\x.ts')).not.toBeNull()
  })

  it('no longer tells any session that a worker builds in a sandbox', () => {
    const denial = evaluateEditGuard({
      kind: 'worker',
      toolName: 'Edit',
      filePath: 'src/theme.ts',
      worktreePath: feature,
      featureSlug: 'dark-mode',
    })
    expect(denial?.reason).toMatch(/does not write code/)
    expect(denial?.reason).not.toMatch(/sandbox|Talk sessions/)
  })
})

/** The same guards through the pre-tool hook route, for a worker session whose row records its folder. */
describe('host worker guards on the pre-tool hook', () => {
  let ctx: AppCtx
  let feature: Feature
  let featureFolder: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    feature = seedFeature(ctx, project.id, { slug: 'dark-mode' })
    featureFolder = worktreeDir(project.id, 'dark-mode')
    setRuntimeCtx(ctx)
  })
  afterEach(() => clearRuntimeCtx())

  /** A host worker: its session works in `folder`, its row records the folder and (own folder only) its branch. */
  function hostWorker(kind: WorkerKind, folder: string, opts: { branch?: string; reviewMode?: 'gates' | 'drive' } = {}): string {
    const session = createSessionRow(ctx, { featureId: feature.id, kind: 'worker', worktreePath: folder })
    const now = Date.now()
    ctx.db
      .insert(workers)
      .values({
        id: session.id,
        featureId: feature.id,
        projectId: feature.projectId,
        label: kind,
        purpose: 'Build it',
        kind,
        model: 'm',
        runtime: 'claude-code',
        startedBy: 'lead',
        status: 'working',
        engine: 'docker',
        branch: opts.branch ?? null,
        folder,
        reviewMode: opts.reviewMode ?? null,
        featureBranch: feature.branch,
        createdAt: now,
        updatedAt: now,
      })
      .run()
    return session.id
  }

  async function preTool(id: string, tool: string, input: Record<string, unknown>): Promise<any> {
    const app = new Hono()
    app.route('/api/hooks', hooksApp)
    const res = await app.request('/api/hooks/pre-tool', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: id, payload: { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input } }),
    })
    return res.json()
  }
  const denied = (json: any) => json.hookSpecificOutput?.permissionDecision === 'deny'

  it("lets a worker in the feature's folder edit code and install there, inside its lines", async () => {
    const id = hostWorker('with-you', featureFolder)
    expect(await preTool(id, 'Edit', { file_path: `${featureFolder}/src/theme.ts` })).toEqual({})
    expect(await preTool(id, 'Write', { file_path: 'packages/web/src/new.ts' })).toEqual({})
    expect(await preTool(id, 'Bash', { command: 'bun install && bun run test' })).toEqual({})
    expect(await preTool(id, 'Bash', { command: 'rm -rf node_modules/.cache' })).toEqual({})
    expect(await preTool(id, 'Bash', { command: 'git add -A && git commit -m "feat(web): x"' })).toEqual({})
  })

  it("refuses a worker in the feature's folder its edits outside, a push, a stash, a merge and a delete outside", async () => {
    const id = hostWorker('on-its-own', featureFolder)
    const outside = await preTool(id, 'Edit', { file_path: '/home/u/.bashrc' })
    expect(denied(outside)).toBe(true)
    expect(outside.hookSpecificOutput.permissionDecisionReason).toContain(featureFolder)
    for (const command of ['git push', 'git stash', 'git merge main', 'git checkout main', 'git reset --hard', 'rm -rf ..']) {
      expect(denied(await preTool(id, 'Bash', { command })), command).toBe(true)
    }
    expect(denied(await preTool(id, 'PowerShell', { command: 'git status; git stash' }))).toBe(true)
  })

  it('holds a worker in its own folder to that folder, and lets it merge the feature branch in', async () => {
    const own = `${featureFolder}--w1`
    const id = hostWorker('unassigned', own, { branch: 'runcastle/worker/w1' })
    expect(await preTool(id, 'Edit', { file_path: `${own}/src/x.ts` })).toEqual({})
    expect(denied(await preTool(id, 'Edit', { file_path: `${featureFolder}/src/x.ts` }))).toBe(true)
    expect(await preTool(id, 'Bash', { command: `git merge ${feature.branch}` })).toEqual({})
    expect(await preTool(id, 'Bash', { command: 'rm -rf dist' })).toEqual({})
    expect(denied(await preTool(id, 'Bash', { command: `rm -rf ${featureFolder}/src` }))).toBe(true)
    expect(denied(await preTool(id, 'Bash', { command: 'git push -u origin HEAD' }))).toBe(true)
  })

  it("holds a gates review in the feature's folder to reading", async () => {
    const id = hostWorker('review', featureFolder, { reviewMode: 'gates' })
    const edit = await preTool(id, 'Edit', { file_path: `${featureFolder}/src/theme.ts` })
    expect(edit.hookSpecificOutput.permissionDecisionReason).toMatch(/review writes no code/)
    const install = await preTool(id, 'Bash', { command: 'bun install' })
    expect(install.hookSpecificOutput.permissionDecisionReason).toMatch(/review installs nothing/)
    expect(denied(await preTool(id, 'Bash', { command: 'git commit -am x' }))).toBe(true)
    expect(await preTool(id, 'Bash', { command: 'git diff main...HEAD && bun run test' })).toEqual({})
  })

  it('leaves a drive review and a worker from before (no folder) on the docs-only line they had', async () => {
    const drive = seedHostReview(ctx, feature, featureFolder).id
    const old = createSessionRow(ctx, { featureId: feature.id, kind: 'worker', worktreePath: featureFolder }).id
    for (const id of [drive, old]) {
      expect(await preTool(id, 'Edit', { file_path: `${featureFolder}/docs/features/dark-mode/notes.md` })).toEqual({})
      const json = await preTool(id, 'Edit', { file_path: `${featureFolder}/src/theme.ts` })
      expect(json.hookSpecificOutput.permissionDecisionReason).toMatch(/does not write code/)
      expect(await preTool(id, 'Bash', { command: 'git push' })).toEqual({})
    }
  })
})
