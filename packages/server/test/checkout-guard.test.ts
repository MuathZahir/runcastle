import { describe, expect, it } from 'vitest'
import type { SessionKind, SessionPurpose } from '@runcastle/core'
import { evaluateCheckoutGuard, mentionsCommit } from '../src/launcher/checkout-guard'

/**
 * The checkout guard: the host-side kinds work in the human's own checkout and
 * run without prompts, so a hook refuses what the prompts used to catch.
 */
describe('checkout guard', () => {
  const wt = '/home/u/code/app'
  const verdict = (
    command: string,
    kind: SessionKind = 'drive-fix',
    extra: { purpose?: SessionPurpose; stagedPaths?: string[]; toolName?: string } = {},
  ) => evaluateCheckoutGuard({ kind, toolName: 'Bash', command, worktreePath: wt, ...extra })

  const HOST_KINDS = ['drive-fix', 'scenario'] as const

  it('refuses sweeping or out-of-bounds staging', () => {
    for (const kind of HOST_KINDS) {
      for (const cmd of ['git add -A', 'git add --all', 'git add .', 'git add -u', 'git add src/x.ts', 'git add .runcastle/a.sh src/x.ts']) {
        expect(verdict(cmd, kind), `${kind}: ${cmd}`).not.toBeNull()
      }
    }
  })

  it('allows staging the paths the kind may write', () => {
    for (const kind of HOST_KINDS) {
      expect(verdict('git add .runcastle/drive-setup.sh', kind)).toBeNull()
      expect(verdict('cd .runcastle && git add .', kind)).toBeNull()
    }
    expect(verdict('git add .gitignore', 'drive-fix')).toBeNull()
    expect(verdict('git add .gitignore', 'scenario')).not.toBeNull()
  })

  it('lets the scenario setup errand stage anything, and only stage', () => {
    expect(verdict('git add src/login.ts', 'scenario', { purpose: 'scenario-setup' })).toBeNull()
    expect(verdict('git reset --hard', 'scenario', { purpose: 'scenario-setup' })).not.toBeNull()
  })

  it('refuses commit -a in every spelling, and a commit of paths outside its own', () => {
    for (const cmd of ['git commit -am x', 'git commit -a -m x', 'git commit --all -m x', 'git commit -sam x', 'git commit -m x src/a.ts']) {
      expect(verdict(cmd), cmd).not.toBeNull()
    }
    expect(verdict('git commit -m x')).toBeNull()
    expect(verdict('git commit -m "add a thing" --amend')).toBeNull()
    expect(verdict('git commit -ma')).toBeNull() // message "a", not -a
  })

  it('refuses a commit while the human\'s paths are staged, and lists them', () => {
    const denial = verdict('git commit -m x', 'drive-fix', { stagedPaths: ['.runcastle/a.sh', 'src/a.ts', 'README.md'] })
    expect(denial?.reason).toContain('src/a.ts')
    expect(denial?.reason).toContain('README.md')
    expect(denial?.reason).not.toContain('.runcastle/a.sh,')
    expect(verdict('git commit -m x', 'drive-fix', { stagedPaths: ['.runcastle/a.sh'] })).toBeNull()
  })

  it('refuses the acts that move or discard the human\'s work', () => {
    for (const cmd of [
      'git checkout main',
      'git checkout -b other',
      'git switch main',
      'git reset --hard',
      'git stash',
      'git stash pop',
      'git clean -fd',
      'git restore src/a.ts',
      'git rebase main',
      'git merge main',
      'git push',
      'git push origin HEAD',
      'git branch -D feature/x',
      'git branch --delete feature/x',
      'git -C . push',
      'git status && git push',
    ]) {
      expect(verdict(cmd), cmd).not.toBeNull()
    }
  })

  it('allows reads and restoring its own files', () => {
    for (const cmd of [
      'git status',
      'git diff --stat',
      'git log --oneline -5',
      'git branch',
      'git branch --show-current',
      'git checkout -- .runcastle/drive-setup.sh',
      'git restore .runcastle/drive-setup.sh',
      'bun .runcastle/drive-setup.ts',
      'ls',
    ]) {
      expect(verdict(cmd), cmd).toBeNull()
    }
  })

  it('explains what to do instead', () => {
    expect(verdict('git add -A')?.reason).toMatch(/Name the paths/)
    expect(verdict('git push')?.reason).toMatch(/Leave it to them/)
  })

  it('never touches the other kinds, non-shell tools or an empty command', () => {
    for (const kind of ['chat', 'side', 'project'] as const) {
      expect(verdict('git add -A && git push', kind)).toBeNull()
    }
    expect(verdict('git push', 'drive-fix', { toolName: 'Edit' })).toBeNull()
    expect(evaluateCheckoutGuard({ kind: 'drive-fix', toolName: 'Bash', worktreePath: wt })).toBeNull()
  })

  it('spots a commit in a command line', () => {
    expect(mentionsCommit('git add x && git commit -m y')).toBe(true)
    expect(mentionsCommit('git -C . commit -m y')).toBe(true)
    expect(mentionsCommit('git status')).toBe(false)
  })
})
