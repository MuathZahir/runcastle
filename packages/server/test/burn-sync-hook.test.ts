import { exec } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SANDBOX_WORKSPACE_PATH,
  SYNC_RECORD_FILE,
  buildSyncHookScript,
  parseSyncRecord,
  strandedCommitsError,
} from '../src/workflows/ticket-burner'

const runCommand = promisify(exec)

/**
 * The post-commit sync hook, installed in a real clone and fired by real
 * commits — git runs it through its own `sh` on every platform, so unlike the
 * slot-script tests this runs on a Windows host too. The "host" repo stands in
 * for the mounted workspace (the clone's `origin`), and `mount` for the
 * workspace directory the hook records into.
 *
 * What is asserted is where the commits end up and what the burner concludes
 * from the record, not the hook's wording.
 */

const BRANCH = 'runcastle/ticket/stranded/2-Ab12Cd34'

describe('the sandbox sync hook, under real git', () => {
  let host: string
  let clone: string
  let mount: string

  const record = () => parseSyncRecord(readFileSync(join(mount, SYNC_RECORD_FILE), 'utf8'))
  const hostTip = async () => (await simpleGit(host).raw(['rev-parse', '--verify', '--quiet', BRANCH])).trim()
  const cloneHead = async () => (await simpleGit(clone).revparse(['HEAD'])).trim()

  /** Commit one file in the clone; the hook fires, and what it told the agent comes back. */
  async function commit(name: string): Promise<string> {
    writeFileSync(join(clone, name), `${name}\n`)
    await simpleGit(clone).add('.')
    const { stderr } = await runCommand(`git commit -q -m "ticket(2): ${name}"`, { cwd: clone })
    return stderr
  }

  /** Delete the host's temp branch the way the boot sweep does: detach its holder, then delete. */
  async function deleteHostBranch(): Promise<void> {
    await simpleGit(host).raw(['checkout', '--detach'])
    await simpleGit(host).raw(['branch', '-D', BRANCH])
  }

  beforeEach(async () => {
    host = mkdtempSync(join(tmpdir(), 'rc-sync-host-'))
    clone = mkdtempSync(join(tmpdir(), 'rc-sync-clone-'))
    mount = mkdtempSync(join(tmpdir(), 'rc-sync-mount-'))

    const h = simpleGit(host)
    await h.init(['-b', BRANCH])
    await h.addConfig('user.email', 'test@runcastle.dev')
    await h.addConfig('user.name', 'Runcastle Test')
    writeFileSync(join(host, 'README.md'), 'base\n')
    await h.add('.')
    await h.commit('base')
    // The host arms this before any container starts: the hook pushes into a
    // branch the sandcastle worktree has checked out.
    await h.addConfig('receive.denyCurrentBranch', 'ignore')

    await simpleGit().clone(host, clone)
    const c = simpleGit(clone)
    await c.addConfig('user.email', 'agent@runcastle.dev')
    await c.addConfig('user.name', 'Burn Agent')
    const script = buildSyncHookScript(BRANCH)
      .join('\n')
      .replaceAll(SANDBOX_WORKSPACE_PATH, mount.replaceAll('\\', '/'))
    writeFileSync(join(clone, '.git', 'hooks', 'post-commit'), `${script}\n`, { mode: 0o755 })
  })

  afterEach(() => {
    for (const dir of [host, clone, mount]) rmSync(dir, { recursive: true, force: true })
  })

  it('syncs a commit to the temp branch and records it', async () => {
    const stderr = await commit('work.md')

    expect(await hostTip()).toBe(await cloneHead())
    expect(record()).toEqual({ head: await cloneHead() })
    expect(stderr).not.toContain('runcastle: commit sync failed')
    expect(await strandedCommitsError(host, BRANCH, record())).toBeUndefined()
  })

  // The bug: the boot sweep deleted a live, still-empty temp branch, and every
  // lease push after it was refused as "stale info".
  it('recreates a temp branch the host deleted under a live burn', async () => {
    await deleteHostBranch()

    const stderr = await commit('work.md')

    expect(await hostTip()).toBe(await cloneHead())
    expect(stderr).not.toContain('runcastle: commit sync failed')
    expect(await strandedCommitsError(host, BRANCH, record())).toBeUndefined()
  })

  it('recreates it from a detached HEAD too', async () => {
    await simpleGit(clone).raw(['checkout', '--detach'])
    await deleteHostBranch()

    await commit('work.md')

    expect(await hostTip()).toBe(await cloneHead())
  })

  it('still syncs an amend of an already-synced commit', async () => {
    await commit('work.md')
    writeFileSync(join(clone, 'work.md'), 'amended\n')
    await simpleGit(clone).add('.')
    await runCommand('git commit -q --amend -m "ticket(2): work"', { cwd: clone })

    expect(await hostTip()).toBe(await cloneHead())
    expect(await strandedCommitsError(host, BRANCH, record())).toBeUndefined()
  })

  it('never overwrites host commits the sandbox lacks, and the ticket fails by name', async () => {
    writeFileSync(join(host, 'HOST.md'), 'host side\n')
    await simpleGit(host).add('.')
    await simpleGit(host).commit('host side')
    const hostCommit = await hostTip()

    const stderr = await commit('work.md')

    expect(await hostTip()).toBe(hostCommit)
    expect(stderr).toContain('runcastle: commit sync failed')
    expect(stderr).toContain(`git push origin HEAD:refs/heads/${BRANCH}`)
    expect(stderr).not.toContain('next commit')
    expect(record()).toMatchObject({ head: await cloneHead(), unsynced: 1 })
    expect(await strandedCommitsError(host, BRANCH, record())).toMatch(
      /^1 commit\(s\) stranded in the sandbox: .+never reached runcastle\/ticket\/stranded\/2-Ab12Cd34\)$/,
    )
  }, 20_000)

  it('counts the last commit home once the agent pushes it by hand', async () => {
    const c = simpleGit(clone)
    await c.raw(['remote', 'set-url', '--push', 'origin', join(mount, 'no-such-repo')])

    await commit('work.md')
    expect(await strandedCommitsError(host, BRANCH, record())).toMatch(/stranded in the sandbox/)

    await c.raw(['remote', 'set-url', '--push', 'origin', host])
    await runCommand(`git push -q origin HEAD:refs/heads/${BRANCH}`, { cwd: clone })

    expect(await strandedCommitsError(host, BRANCH, record())).toBeUndefined()
  }, 20_000)
})

describe('parseSyncRecord / strandedCommitsError', () => {
  const sha = 'a'.repeat(40)

  it('reads nothing out of a missing or malformed record', () => {
    expect(parseSyncRecord(undefined)).toBeUndefined()
    expect(parseSyncRecord('')).toBeUndefined()
    expect(parseSyncRecord('not a sha\n')).toBeUndefined()
  })

  it('reads the head alone, or the head with the failed push', () => {
    expect(parseSyncRecord(`${sha}\n`)).toEqual({ head: sha })
    expect(parseSyncRecord(`${sha}\n3\n ! [rejected] HEAD -> x (fetch first)\n`)).toEqual({
      head: sha,
      unsynced: 3,
      reason: '! [rejected] HEAD -> x (fetch first)',
    })
    expect(parseSyncRecord(`${sha}\n?\n`)).toEqual({ head: sha, unsynced: null })
  })

  it('names a hook that never finished, and has nothing to say without a record', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'rc-sync-none-'))
    try {
      await simpleGit(repo).init(['-b', BRANCH])
      expect(await strandedCommitsError(repo, BRANCH, undefined)).toBeUndefined()
      expect(await strandedCommitsError(repo, BRANCH, { head: sha })).toMatch(
        /^commit\(s\) stranded in the sandbox: the sync hook did not finish/,
      )
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
