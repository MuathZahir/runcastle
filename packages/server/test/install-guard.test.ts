import { describe, expect, it } from 'vitest'
import type { SessionKind } from '@runcastle/core'
import { evaluateInstallGuard, PRE_TOOL_MATCHER } from '../src/launcher/install-guard'

/**
 * The talk-worktree install guard: package installs from a shell are denied in a
 * feature's talk worktree (charter decision 6), and only there.
 */
describe('install guard', () => {
  const talk = '/home/u/.runcastle/worktrees/p1/dark-mode'
  const denied = (
    command: string,
    over: { kind?: SessionKind; toolName?: string; worktreePath?: string; talkWorktreePath?: string } = {},
  ) =>
    evaluateInstallGuard({
      kind: 'chat',
      toolName: 'Bash',
      command,
      worktreePath: talk,
      talkWorktreePath: talk,
      ...over,
    }) !== null

  it('denies every install verb in command position', () => {
    for (const cmd of [
      'bun install',
      'bun i',
      'bun add zod',
      'npm install',
      'npm i -D vitest',
      'npm ci',
      'npm add zod',
      'pnpm install --frozen-lockfile',
      'pnpm i',
      'pnpm add zod',
      'yarn',
      'yarn --frozen-lockfile',
      'yarn install',
      'yarn add zod',
      'bun --cwd packages/server install',
      'pnpm -C x install',
      'npm --prefix x ci',
      'FOO=1 bun install',
      'CI=true NODE_ENV=dev npm --silent install',
      'yarn --cwd x add zod',
    ]) {
      expect(denied(cmd), cmd).toBe(true)
    }
    for (const cmd of ['npm.cmd ci', 'bun.exe install', 'pnpm.cmd -C x i', '& yarn.cmd']) {
      expect(denied(cmd, { toolName: 'PowerShell' }), cmd).toBe(true)
    }
  })

  it('denies an install anywhere in a chain', () => {
    for (const cmd of [
      'cd x && bun install',
      'foo; npm ci',
      'git status || bun install && bun run typecheck',
      '(cd packages/web && pnpm install)',
      'echo hi | yarn',
      'git merge main\nbun install',
      'yarn\ngit status',
      'yarn\r\ngit status',
      'git merge main\nyarn --frozen-lockfile\ngit status',
    ]) {
      expect(denied(cmd), cmd).toBe(true)
    }
  })

  it('denies the PowerShell forms', () => {
    for (const cmd of [
      'Set-Location x; bun install',
      'bun install | Out-Null',
      '& npm ci; bun run typecheck',
    ]) {
      expect(denied(cmd, { toolName: 'PowerShell' }), cmd).toBe(true)
    }
  })

  it('allows searching for the string, runners, and read-only commands', () => {
    for (const cmd of [
      'grep -rn "bun install" docs/',
      "rg 'npm ci' .",
      'bunx tsc --noEmit',
      'npx vitest run',
      'bun pm ls',
      'bun run typecheck',
      'bun test',
      'bun init',
      'git log --oneline',
      'git diff --check',
      'cat yarn.lock',
      'yarn --version',
      'yarn -v',
      'yarn --help',
      'yarn -h',
      'yarn --version && git status',
      'yarn -v\ngit status',
      'bun --version',
      'npm --prefix x run build',
      'FOO=1 bun run typecheck',
      'pnpm -C x run test',
      'yarn.cmd --version',
    ]) {
      expect(denied(cmd), cmd).toBe(false)
    }
  })

  it('reads an apostrophe inside double quotes as text, not a quote opener', () => {
    expect(denied(`echo "it's" && bun install 'x'`)).toBe(true)
    expect(denied(`git commit -m "don't" && npm ci && echo 'done'`)).toBe(true)
    expect(denied(`echo 'say "hi"' && bun install`)).toBe(true)
    expect(denied(`echo "it's bun install"`)).toBe(false)
  })

  it('reads a heredoc body as text, not commands', () => {
    for (const cmd of [
      "git commit -F - <<'EOF'\ndocs: note\nbun install is blocked here\nEOF",
      'git commit -m "$(cat <<\'EOF\'\ndocs: note\n\nnpm ci is blocked here\nEOF\n)"',
      'cat <<EOF > notes.md\nyarn\nEOF',
      'cat <<-"END"\n\tpnpm add zod\n\tEND',
    ]) {
      expect(denied(cmd), cmd).toBe(false)
    }
  })

  it('still denies an install after a heredoc ends', () => {
    expect(denied("git commit -F - <<'EOF'\ndocs: note\nEOF\nbun install")).toBe(true)
    expect(denied("cat <<'EOF' && bun install\nbody\nEOF")).toBe(true)
  })

  it('denies every feature-worktree kind', () => {
    for (const kind of ['chat', 'waypoint', 'converge'] as const) {
      expect(denied('bun install', { kind }), kind).toBe(true)
    }
  })

  it('leaves the project kind alone', () => {
    expect(denied('bun install', { kind: 'project' })).toBe(false)
  })

  it('only guards the talk worktree itself — not the main checkout or __project', () => {
    expect(denied('bun install', { kind: 'prepare', worktreePath: '/repo' })).toBe(false)
    expect(denied('bun install', { kind: 'drive-fix', worktreePath: '/repo' })).toBe(false)
    expect(
      denied('bun install', { worktreePath: '/home/u/.runcastle/worktrees/p1/__project' }),
    ).toBe(false)
    expect(denied('bun install', { talkWorktreePath: undefined })).toBe(false)
  })

  it('matches the talk worktree however the path is spelled', () => {
    expect(denied('bun install', { worktreePath: `${talk}/` })).toBe(true)
  })

  it('ignores non-shell tools and fails open on a missing command', () => {
    expect(denied('bun install', { toolName: 'Edit' })).toBe(false)
    expect(denied('')).toBe(false)
  })

  it('names docs-only and where verification happens instead', () => {
    const denial = evaluateInstallGuard({
      kind: 'chat',
      toolName: 'Bash',
      command: 'bun install',
      worktreePath: talk,
      talkWorktreePath: talk,
    })
    expect(denial?.reason).toMatch(/docs-only/)
    expect(denial?.reason).toMatch(/burn sandbox/)
    expect(denial?.reason).toMatch(/review lap/)
    expect(denial?.reason).toMatch(/test drive/)
  })

  it('registers the edit tools and the shell tools in one matcher', () => {
    expect(PRE_TOOL_MATCHER.split('|')).toEqual(
      expect.arrayContaining(['Edit', 'Write', 'NotebookEdit', 'apply_patch', 'Bash', 'PowerShell']),
    )
  })
})
