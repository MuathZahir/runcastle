import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionKind } from '@runcastle/core'
import { PROJECT_WORKTREE_SLUG } from '@runcastle/core/paths'
import { evaluateRemoteGuard } from '../src/launcher/remote-guard'
import { clearRuntimeCtx, setRuntimeCtx } from '../src/launcher/runtime'
import { createSessionRow } from '../src/launcher/sessions'
import hooksApp from '../src/routes/hooks'
import type { AppCtx } from '../src/db/types'
import { makeTestCtx } from './helpers/db'
import { seedFeature, seedProject } from './helpers/fixtures'

/**
 * The remote guard (`agents-never-stop-for-approval` decisions 8 and 9): with
 * every permission request answered by runcastle, nothing asks before a command
 * runs, so commands that destroy things on the remote, and recursive deletes
 * outside the session's folder, are refused instead.
 */
describe('remote guard', () => {
  const own = '/home/u/.runcastle/worktrees/p1/dark-mode'
  const verdict = (command: string, toolName = 'Bash') =>
    evaluateRemoteGuard({
      toolName,
      command,
      worktreePath: own,
      home: '/home/u',
      tempFolders: ['/tmp'],
      ownFolders: ['/home/u/.runcastle/scenario-data/f1'],
    })
  const refused = (command: string, toolName?: string) => expect(verdict(command, toolName), command).not.toBeNull()
  const allowed = (command: string, toolName?: string) => expect(verdict(command, toolName), command).toBeNull()

  describe('the remote', () => {
    it('allows plain pushes, pull requests and CI runs', () => {
      for (const cmd of [
        'git push',
        'git push -u origin HEAD',
        'git push origin feature/dark-mode',
        'git push origin HEAD:refs/heads/feature/dark-mode',
        'git push --tags',
        'git push --force --dry-run origin main',
        'gh pr create --title x --body y',
        'gh pr view 12',
        'gh run view 123 --log-failed',
        'gh workflow run ci.yml',
        'gh api repos/o/r/pulls',
        'gh api -X POST repos/o/r/issues -f title=x',
        'gh issue close 3',
        'git push-helper --force',
      ]) allowed(cmd)
    })

    it('refuses a force push in every spelling', () => {
      for (const cmd of [
        'git push --force',
        'git push -f origin main',
        'git push -uf origin feature/x',
        'git push --force-with-lease',
        'git push --force-with-lease=main:abc123 origin main',
        'git push --force-if-includes origin x',
        'git push origin +feature/x',
        'git push origin +HEAD:main',
        'git -C ../other push --force',
      ]) refused(cmd)
    })

    it('refuses deleting, mirroring and pruning refs on the remote', () => {
      for (const cmd of [
        'git push origin --delete feature/old',
        'git push -d origin v1.0',
        'git push origin :feature/old',
        'git push --mirror backup',
        'git push --prune origin refs/heads/*:refs/heads/*',
      ]) refused(cmd)
    })

    it('refuses gh commands that delete, merge or reshape the repository', () => {
      for (const cmd of [
        'gh repo delete o/r --yes',
        'gh repo archive',
        'gh repo rename new-name',
        'gh -R o/r repo delete --yes',
        'gh release delete v1.0',
        'gh release delete-asset v1.0 a.zip',
        'gh pr merge 12 --squash',
        'gh secret delete TOKEN',
        'gh variable delete X',
        'gh label delete bug',
        'gh cache delete --all',
        'gh run delete 123',
        'gh repo deploy-key delete 5',
        'gh api -X DELETE repos/o/r/git/refs/heads/x',
        'gh api --method DELETE repos/o/r',
        'gh api --method=delete repos/o/r',
        'gh api -XDELETE repos/o/r/releases/1',
        'gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=abc -F force=true',
      ]) refused(cmd)
    })

    it('reads compound commands, heredoc commits, wrappers, nested shells and PowerShell', () => {
      refused('cd packages && git add -A && git commit -F - <<\'EOF\'\nmsg\nEOF\ngit push --force')
      refused('gh run view 1; git push origin :old')
      refused('sudo -u me git push -f')
      refused('env GIT_TRACE=1 git push --force')
      refused('bash -lc "git push --force origin main"')
      refused('pwsh -Command "gh repo delete o/r --yes"')
      refused('& "C:\\Program Files\\Git\\cmd\\git.exe" push --force', 'PowerShell')
      allowed('git commit -m "never git push --force"')
      allowed('echo "gh repo delete" > notes.md')
    })

    it('ignores what is not a shell tool', () => {
      allowed('git push --force', 'Edit')
      expect(evaluateRemoteGuard({ toolName: 'Bash', worktreePath: own })).toBeNull()
    })
  })

  describe('recursive deletes', () => {
    it('allows recursive deletes inside the session folder, temp and its own extras', () => {
      for (const cmd of [
        'rm -rf node_modules',
        'rm -rf ./dist build/out',
        'rm -rf *',
        `rm -rf ${own}/coverage`,
        'cd packages/web && rm -rf .vite',
        'rm -rf /tmp/rc-test-123',
        'rm -rf /home/u/.runcastle/scenario-data/f1/run-3',
        'find . -name "*.orig" -delete',
        'rm -f ../notes.txt',
        'rm ../a.txt',
        'rmdir ../empty',
        'Remove-Item -Recurse -Force .\\dist',
        'rm -rf "$TARGET"',
        'rm -rf $(mktemp -d)',
        'cd "$SOMEWHERE" && rm -rf build',
      ]) allowed(cmd)
    })

    it('refuses a recursive delete outside the folder, of the folder, or above it', () => {
      for (const cmd of [
        'rm -rf /',
        'rm -rf ~',
        'rm -rf ~/projects/app',
        'rm -rf $HOME/.config',
        'rm -rf ${HOME}',
        'rm -rf ..',
        'rm -rf ../other-feature',
        'rm -rf ../*',
        `rm -rf ${own}`,
        'rm -rf .',
        'rm -R /etc/x',
        'rm --recursive /var/data',
        'rm -fr /home/u/code/app',
        'cd .. && rm -rf dark-mode',
        'cd && rm -rf code',
        'rm -rf /tmp',
        'rm -rf /home/u/.runcastle/scenario-data/f1',
        'find /home/u -name "*.log" -delete',
        'find .. -delete',
        'sudo rm -rf /opt/app',
        'bash -c "rm -rf ~/code"',
        'xargs echo; rm -rf -- /srv',
      ]) refused(cmd)
    })

    it('reads `cd -` as an unknown folder, not home', () => {
      allowed('cd - && rm -rf build')
      allowed('cd /tmp/x && cd - && rm -rf build')
    })

    it('starts from the folder the shell is in now, which a `cd` in an earlier call may have moved', () => {
      const from = (cwd: string, command: string) =>
        evaluateRemoteGuard({ toolName: 'Bash', command, worktreePath: own, cwd, home: '/home/u', tempFolders: ['/tmp'] })
      expect(from(`${own}/packages/web`, 'rm -rf .vite')).toBeNull()
      expect(from(`${own}/packages/web`, 'rm -rf ../..')).not.toBeNull()
      expect(from('/home/u/code/app', 'rm -rf dist')).not.toBeNull()
    })

    it('refuses the PowerShell and cmd spellings', () => {
      for (const cmd of [
        'Remove-Item -Recurse -Force C:\\Users\\u\\code',
        'Remove-Item -Path ..\\other -Recurse',
        'rm -r ~\\code',
        'ri -rec $env:USERPROFILE\\code',
        'del /s /q C:\\data',
        'rmdir /s /q ..\\other',
        'rd /s ..',
      ]) refused(cmd, 'PowerShell')
      allowed('Remove-Item -Force ..\\one-file.txt', 'PowerShell')
    })
  })
})

/** The guard on the pre-tool hook route: every host session kind meets it, the orchestrator included. */
describe('remote guard on the pre-tool hook', () => {
  let ctx: AppCtx
  let featureId: string
  let projectId: string

  beforeEach(async () => {
    ctx = await makeTestCtx()
    const project = seedProject(ctx)
    projectId = project.id
    featureId = seedFeature(ctx, project.id, { slug: 'dark-mode' }).id
    setRuntimeCtx(ctx)
  })
  afterEach(() => clearRuntimeCtx())

  async function shell(kind: SessionKind, command: string, runtime?: 'codex', cwd?: string): Promise<any> {
    const app = new Hono()
    app.route('/api/hooks', hooksApp)
    const project = kind === 'project'
    const feature = project ? seedFeature(ctx, projectId, { slug: PROJECT_WORKTREE_SLUG }).id : featureId
    const id = createSessionRow(ctx, {
      featureId: feature,
      kind,
      worktreePath: '/home/u/wt/dark-mode',
      ...(runtime ? { model: { id: 'gpt-5.5', runtime } } : {}),
    }).id
    const res = await app.request('/api/hooks/pre-tool', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: id, payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...(cwd ? { cwd } : {}) } }),
    })
    return res.json()
  }

  it.each(['project', 'chat', 'side', 'drive-fix', 'scenario', 'worker'] as const)('denies a force push from a %s session', async (kind) => {
    const json = await shell(kind, 'git push --force origin feature/dark-mode')
    expect(json.hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(json.hookSpecificOutput.permissionDecisionReason).toMatch(/force push/)
  })

  it('denies a recursive delete outside the folder from the orchestrator and a Codex lead', async () => {
    for (const json of [await shell('project', 'rm -rf ~/code'), await shell('chat', 'rm -rf /srv/app', 'codex')]) {
      expect(json.hookSpecificOutput?.permissionDecision).toBe('deny')
      expect(json.hookSpecificOutput.permissionDecisionReason).toMatch(/outside the session's folder/)
    }
  })

  it('resolves a delete against the cwd the hook reports', async () => {
    expect((await shell('chat', 'rm -rf dist', undefined, '/home/u/elsewhere')).hookSpecificOutput?.permissionDecision).toBe('deny')
    expect(await shell('chat', 'rm -rf dist', undefined, '/home/u/wt/dark-mode/packages/web')).toEqual({})
  })

  it('has no opinion on a plain push or a delete inside the folder', async () => {
    expect(await shell('project', 'git push origin main')).toEqual({})
    expect(await shell('chat', 'rm -rf node_modules && git push')).toEqual({})
  })
})
