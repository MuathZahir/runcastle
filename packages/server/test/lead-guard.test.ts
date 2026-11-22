import { describe, expect, it } from 'vitest'
import { evaluateLeadGuard } from '../src/launcher/lead-guard'

/**
 * The lead's line guard (`the-feature-lead-runs-rounds` decision 27): after Go
 * the lead runs any command unprompted, except merging into or pushing to the
 * base branch, git on the main checkout or another feature's worktree, and
 * deleting the feature branch.
 */
describe('lead guard', () => {
  const own = '/home/u/.runcastle/worktrees/p1/dark-mode'
  const verdict = (command: string, toolName = 'Bash') =>
    evaluateLeadGuard({
      toolName,
      command,
      worktreePath: own,
      mainCheckout: '/home/u/code/app',
      worktreesDir: '/home/u/.runcastle/worktrees/p1',
      featureBranch: 'feature/dark-mode',
      baseBranch: 'main',
    })

  it('allows ordinary work on the feature branch in its own worktree', () => {
    for (const cmd of [
      'git status',
      'git add -A && git commit -m "feat(web): dark mode"',
      'git push',
      'git push origin feature/dark-mode',
      'git push -u origin HEAD:feature/dark-mode',
      'git merge main',
      'git diff main...HEAD',
      'git log --oneline main..',
      'git show main:README.md',
      'git checkout main -- package.json',
      'git fetch origin main',
      'git branch -d feature/dark-mode-spike',
      'git switch -c feature/dark-mode-retry',
      'bun run typecheck 2>&1 | tail -5',
      'cd packages/web && git status',
      `git -C ${own} log -1`,
      'git commit -m "mention git push origin main in prose"',
      "git commit -F - <<'EOF'\nfix: no longer git push origin main\nEOF",
      'git -C $repo status',
      'rm -rf node_modules',
    ]) {
      expect(verdict(cmd), cmd).toBeNull()
    }
  })

  it('denies writing the base branch', () => {
    for (const cmd of [
      'git push origin main',
      'git push origin HEAD:main',
      'git push --force origin feature/dark-mode:main',
      'git push -f origin +HEAD:refs/heads/main',
      'git push --all origin',
      'git push --mirror',
      'git fetch . feature/dark-mode:main',
      'git branch -f main HEAD',
      'git update-ref refs/heads/main HEAD',
      'git checkout main && git merge feature/dark-mode',
      'git switch main',
      'git status; git push origin main',
      'FOO=1 git push origin main',
    ]) {
      expect(verdict(cmd), cmd).not.toBeNull()
    }
  })

  it('denies git on the main checkout or another feature\'s worktree', () => {
    for (const cmd of [
      'git -C /home/u/code/app merge feature/dark-mode',
      'git -C /home/u/code/app status',
      'cd /home/u/code/app && git log',
      'cd ../other-feature && git commit -am x',
      'git -C /home/u/.runcastle/worktrees/p1/__project status',
      'git --git-dir=/home/u/code/app/.git log',
      '(cd /home/u/code/app/packages && git pull)',
    ]) {
      expect(verdict(cmd), cmd).not.toBeNull()
    }
  })

  it('denies deleting the feature branch', () => {
    for (const cmd of [
      'git branch -D feature/dark-mode',
      'git branch --delete --force feature/dark-mode',
      'git push origin --delete feature/dark-mode',
      'git push origin :feature/dark-mode',
      'git update-ref -d refs/heads/feature/dark-mode',
    ]) {
      expect(verdict(cmd), cmd).not.toBeNull()
    }
  })

  it('reads PowerShell forms the same way', () => {
    for (const cmd of [
      'git push origin main; if ($LASTEXITCODE) { exit 1 }',
      '& git push origin "main"',
      '& "C:\\Program Files\\Git\\cmd\\git.exe" push origin main',
      'Set-Location -Path /home/u/code/app; git status',
      'git.exe branch -D feature/dark-mode',
      'git status | Out-Null; git -C "/home/u/code/app" merge feature/dark-mode',
    ]) {
      expect(verdict(cmd, 'PowerShell'), cmd).not.toBeNull()
    }
    for (const cmd of ['git status | Select-Object -First 5', '& git commit -m "x"', 'Get-ChildItem; git log -1']) {
      expect(verdict(cmd, 'PowerShell'), cmd).toBeNull()
    }
  })

  it('tells the agent why, and ignores tools that are not shells', () => {
    expect(verdict('git push origin main')?.reason).toMatch(/main.*human/s)
    expect(verdict('git push origin main', 'Edit')).toBeNull()
  })

  /** Decision 11 of workers-build-in-the-feature-s-folder: PowerShell's statement forms and Windows paths. */
  it('splits PowerShell statements, continuations and escapes', () => {
    for (const cmd of [
      'git status; git push origin main',
      'git status\r\ngit push origin main',
      'git fetch && git push origin main',
      'git fetch || git push origin main',
      'git log | Select-Object -First 1; git push origin main',
      'git status `\n; git push origin main',
      'if ($ok) { git push origin main }',
    ]) expect(verdict(cmd, 'PowerShell'), cmd).not.toBeNull()
    for (const cmd of [
      'git commit -m "push `"main`""',
      'git commit -m x`; git push origin main',
      "git commit -F - @'\ngit push origin main\n'@",
    ]) expect(verdict(cmd, 'PowerShell'), cmd).toBeNull()
  })

  it('joins a bash line continuation', () => {
    expect(verdict('git push \\\n  origin main')).not.toBeNull()
  })

  it('compares Windows folders in any case', () => {
    const win = (command: string) =>
      evaluateLeadGuard({
        toolName: 'PowerShell',
        command,
        worktreePath: 'C:\\Users\\u\\.runcastle\\worktrees\\p1\\dark-mode',
        mainCheckout: 'C:\\code\\app',
        worktreesDir: 'C:\\Users\\u\\.runcastle\\worktrees\\p1',
        featureBranch: 'feature/dark-mode',
        baseBranch: 'main',
        platform: 'win32',
      })
    expect(win('git -C c:\\users\\U\\.runcastle\\worktrees\\P1\\dark-mode status')).toBeNull()
    expect(win('git log runcastle/worker/w1 --oneline; git diff feature/dark-mode...runcastle/worker/w1')).toBeNull()
    expect(win('git -C c:\\CODE\\app status')).not.toBeNull()
    expect(win('Set-Location ..\\other; git status')).not.toBeNull()
  })
})
