import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { resolveBun } from './helpers/bun'
import { rmTemp, tmpRepo } from './helpers/fixtures'

/**
 * A whole move between two scratch homes: `fixtures/move/roundtrip.ts` runs
 * under real Bun, because a move needs `bun:sqlite`, and prints what it saw.
 */
const bun = resolveBun()

describe.skipIf(!bun)('runcastle move, end to end', () => {
  let root: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a JSON object printed by the fixture
  let f: any

  beforeAll(() => {
    root = tmpRepo()
    const run = spawnSync(bun as string, [join(import.meta.dirname, 'fixtures', 'move', 'roundtrip.ts'), root], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 170_000,
    })
    if (run.status !== 0) throw new Error(`fixture failed:\n${run.stdout}\n${run.stderr}`)
    f = JSON.parse(run.stdout.trim().split('\n').pop() as string)
  }, 180_000)

  afterAll(() => rmTemp(root))

  it('leaves the old machine byte-identical', () => {
    expect(f.changedOnSource).toEqual([])
  })

  it('refuses a destination with data until told to replace it, and changes nothing', () => {
    expect(f.failures.noReplace).toContain('add --replace')
    expect(f.failures.noReplace).toContain('runcastle-trial')
    expect(f.destUnchanged).toBe(true)
  })

  it('leaves the destination as it was when the pack is corrupt', () => {
    expect(f.failures.corrupt).not.toBe('did not fail')
    expect(f.destUnchanged).toBe(true)
    expect(f.stagingLeft).toEqual([])
  })

  it('moves every ref and the remote, and pushes nothing', () => {
    expect(f.destRefs).toBe(f.sourceRefs)
    expect(f.destRemote).toBe('https://example.invalid/app.git')
    expect(f.destBranch).toBe('main')
  })

  it("puts the main checkout's uncommitted work back", () => {
    expect(f.mainFile).toBe('two\n')
    expect(f.mainUntracked).toBe('untracked\n')
    expect(f.mainDeletedFile).toBe(false)
    expect(f.mainEnv).toBe(false)
  })

  it("recreates a talk worktree that holds work, on its branch", () => {
    expect(f.worktreeFile).toBe('changed in the talk worktree\n')
    expect(f.worktreeUntracked).toBe('untracked in the talk worktree\n')
    expect(f.worktreeBranch).toBe('feature/login')
    expect(f.result.wipKept).toEqual([])
  })

  it('rewrites only the paths the app follows', () => {
    expect(f.repoPath).toBe(f.expected.newRepo)
    expect(f.worktreePath).toBe(f.expected.newWorktree)
    expect(f.transcriptPath).toBe(f.expected.newTranscript)
    expect(f.eventText).toBe(`history mentions ${f.expected.oldRepo}`)
    expect(f.result.unmappedPaths).toBe(0)
  })

  it('rewrites a Codex transcript, which lives under the data dir', () => {
    expect(f.codexTranscriptPath).toBe(f.expectedCodex)
    expect(f.codexFile).toBe('{"codex":true}\n')
  })

  it('renames Claude folders, and leaves chats from other folders behind', () => {
    expect(f.transcript).toBe('{"cwd":"old"}\n')
    expect(f.handChat).toBe('{"hand":true}\n')
    expect(f.memory).toBe('- a memory\n')
    expect(f.otherChat).toBe(false)
  })

  it('loses nothing when two old Claude folders land in one new one', () => {
    expect(f.olderChat).toBe('{"older":true}\n')
    expect(f.claudeMemories).toEqual(['- newer memory\n', '- older memory\n'])
  })

  it('names a chat with no transcript, rather than letting it pass unseen', () => {
    expect(f.attention.join('\n')).toContain('1 chat with no transcript')
  })

  it('carries an untracked nested repo by its own ignore rules, and says its history stays', () => {
    expect(f.nestedFile).toBe('only copy of this file\n')
    expect(f.nestedIgnored).toBe(false)
    expect(f.attention.join('\n')).toContain('vendor/mylib is a git repo of its own')
  })

  it('keeps a secret out even when git does not ignore it, and says so', () => {
    expect(f.unignoredEnv).toBe(false)
    expect(f.envExample).toBe(true)
    expect(f.attention.join('\n')).toContain('.env.local stays behind')
  })

  it('names symlinks it leaves behind, without blocking the move', () => {
    const text = f.attention.join('\n')
    expect(text).toContain('reviews/t1/link-in-data')
    expect(text).toContain('link-in-claude')
    expect(text).toContain('link-in-repo')
    expect(f.blockers.join('\n')).not.toContain('link-in')
    expect(f.symlinksArrived).toEqual([])
    expect(f.packHasLinkTarget).toBe(false)
  })

  it('leaves launch files out, which can hold values a session was given', () => {
    expect(f.launchFiles).toEqual([])
  })

  it('restores the newest stash as a real stash, and upstream tracking', () => {
    expect(f.stashList).toContain('moved from the old machine')
    expect(f.stashFile).toBe('stashed work\n')
    expect(f.upstream).toBe('refs/heads/main')
  })

  it('keeps a repo with no commits: its staged work, remote and branch name', () => {
    expect(f.unbornBranch).toBe('trunk')
    expect(f.unbornRemote).toBe('https://example.invalid/unborn.git')
    expect(f.unbornFile).toBe('staged, never committed\n')
  })

  it('blocks a shallow clone before anything is packed', () => {
    expect(f.shallowBlocked.length).toBe(1)
  })

  it('carries thread logs, images and Codex conversations but no secrets, caches or logs', () => {
    expect(f.threadLog).toBe('{"i":0}\n')
    expect(f.chatImage).toBe('png')
    expect(f.codexRollout).toBe('{}\n')
    expect(f.auth).toBe(false)
    expect(f.manifestHasAuth).toBe(false)
    expect(f.manifestHasCache).toBe(false)
  })

  it('clears drive and reset commands between systems, keeps the rest, and saves the old values', () => {
    expect([f.driveSetup, f.driveStop, f.dbReset]).toEqual([null, null, null])
    expect(f.dev).toBe('bun run dev')
    expect(f.verify).toBe('bun test')
    expect(f.reportFile).toContain('cmd /c reset.bat')
    expect(f.reportFile).toContain('bun run db:up')
  })

  it('drops provenance for cleared fields and every verified stamp', () => {
    expect(f.findings.map((row: { key: string }) => row.key)).toEqual(['verifyCommands'])
    expect(f.findings[0].verified_at).toBeNull()
    expect(f.findings[0].verified_sha).toBeNull()
  })

  it("keeps the destination's .env, install id and burn limits, and takes the other settings", () => {
    expect(f.env).toBe('NEW_MACHINE_SECRET=1\n')
    expect(f.installId).toBe('new-install\n')
    expect(f.config).toEqual({ model: 'kept-model', burnConcurrency: 5 })
  })

  it('sets the old data aside rather than deleting it, and removes the pack', () => {
    expect(f.result.setAside.some((s: { to: string }) => s.to.includes('.before-move-'))).toBe(true)
    expect(f.packDeleted).toBe(true)
  })

  it('boots on the moved data: open chats end, and a missing talk worktree comes back', () => {
    expect(f.reconciled).toBe(1)
    expect(f.statusAfterBoot).toBe('ended')
    expect(f.rebuiltBranch).toBe('feature/idle')
  })

  it('keeps a project whose repo folder is gone, at its expected path', () => {
    expect(f.gonePath).toBe(join(f.expected.reposDir, 'vanished'))
    expect(f.attention.join('\n')).toContain('vanished: repo stays behind')
  })

  it('reports what will be lost before it is', () => {
    const text = f.attention.join('\n')
    expect(text).toContain('.env')
    expect(text).toContain('uploads')
    expect(text).toContain('1 open chat will end')
  })

  it('refuses a relative --repos-dir, which on the new machine would land under the working folder', () => {
    expect(f.relativeRepos).toContain('--repos-dir must be an absolute path')
    expect(f.altered.cleanLeft).toEqual([])
  })

  it('counts a server only when it serves this data dir, or cannot be read', () => {
    expect(f.servers).toEqual({
      ownServer: true,
      otherServer: false,
      unreadableServer: true,
      noServer: false,
      busyServer: true,
    })
  })

  it('refuses a pack altered after it was made, and writes nothing', () => {
    expect(f.altered.alteredFile).toContain('did not arrive intact')
    expect(f.altered.alteredRows).toContain('table sessions')
    expect(f.altered.alteredRef).toContain('refs/tags/v1')
    expect(f.altered.newerPack).toContain('newer runcastle')
    expect(f.altered.cleanLeft).toEqual([])
  })

  it('keeps uncommitted work beside the repo when its patch will not apply, and the move still succeeds', () => {
    expect(f.patch.wipKept.map((w: { key: string }) => w.key)).toEqual(['main'])
    expect(f.patch.appliedOthers).toContain('app (login)')
    expect(f.patch.keptPatch).toBe('this is not a patch\n')
    expect(f.patch.keptCopy).toBe('two\n')
    expect(f.patch.keptUntracked).toBe('untracked\n')
    expect(f.patch.checkoutUntouched).toBe('one\n')
  })

  it('blocks on a running round, a drive left on the main checkout, a stopped merge and a folder clash', () => {
    const text = f.blocked.join('\n')
    expect(text).toContain('a round of login is marked running')
    expect(text).toContain('the main checkout is on feature/idle')
    expect(text).toContain('the talk worktree login is in the middle of a merge')
    expect(text).toContain('two projects want the folder app')
  })

  it('lets --no-repo clear a folder clash', () => {
    expect(f.clashAfterNoRepo).toEqual([])
    expect(f.twinTarget).toBe('app-proj_twin')
  })

  it('moves again with --replace, setting the first move aside', () => {
    expect(f.secondSetAside).toContain(f.expected.newRepo)
    expect(f.secondRepoFile).toBe('two\n')
  })
})
