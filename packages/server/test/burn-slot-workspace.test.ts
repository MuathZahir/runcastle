import { exec } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { RuncastleConfig } from '@runcastle/core'
import { DEFAULT_SANDBOX_IMAGE } from '@runcastle/core'
import { simpleGit } from 'simple-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BURN_CACHE_MOUNT,
  burnCacheEnv,
  burnCacheVolumeName,
  createSlotAllocator,
  slotRepoPath,
  slotStampPath,
} from '../src/workflows/burn-cache'
import {
  SANDBOX_WORKSPACE_PATH,
  SETUP_MARKER_FILE,
  buildSandboxOptions,
  buildSlotSetupCommand,
  buildSlotStamp,
  buildWorkspaceNotes,
  createToolTimer,
  parseSetupMarker,
  resolveBurnWorkspaceMode,
  withBurnCacheSlot,
} from '../src/workflows/ticket-burner'

const runCommand = promisify(exec)

/**
 * The burn's half of the persistent cache volume: what the container is handed
 * (mounts + env), where the agent works (`slot` mode), what the setup hook does
 * to a slot it cannot trust (the sync script), who owns a slot for how long,
 * and the telemetry that makes the win measurable.
 */

const PROJECT_ID = 'proj_MG5rF2sQ8kwd'
const BRANCH = 'runcastle/ticket/cache-volume/2-Ab12Cd34'
const STAMP = 'sandcastle:runcastle node=$(node --version 2>/dev/null) pm=pnpm@9'

function config(
  sandbox: RuncastleConfig['sandbox'],
  burnCache: RuncastleConfig['burnCache'] = 'volume',
): Pick<RuncastleConfig, 'sandbox' | 'burnWorkspace' | 'burnCache' | 'sandboxImage' | 'burnCpus'> {
  return { sandbox, burnWorkspace: 'auto', burnCache }
}

describe('buildSandboxOptions — what the burn container is handed by cache mode', () => {
  it('mounts the project volume and points every store at it when the cache is on', () => {
    const mount = { volume: burnCacheVolumeName(PROJECT_ID), sandboxPath: BURN_CACHE_MOUNT }
    const opts = buildSandboxOptions(config('docker'), [mount], burnCacheEnv('pnpm'))

    expect(opts.mounts).toEqual([{ volume: `runcastle-${PROJECT_ID}`, sandboxPath: BURN_CACHE_MOUNT }])
    expect(opts.env).toEqual({
      npm_config_store_dir: `${BURN_CACHE_MOUNT}/store/pnpm`,
      pnpm_config_store_dir: `${BURN_CACHE_MOUNT}/store/pnpm`,
      BUN_INSTALL_CACHE_DIR: `${BURN_CACHE_MOUNT}/store/pnpm`,
      npm_config_cache: `${BURN_CACHE_MOUNT}/store/pnpm`,
      YARN_GLOBAL_FOLDER: `${BURN_CACHE_MOUNT}/store/pnpm`,
      TMPDIR: `${BURN_CACHE_MOUNT}/tmp`,
      NODE_COMPILE_CACHE: `${BURN_CACHE_MOUNT}/node-compile`,
    })
    // The volume mount is the ONLY mount: ADR-0004's per-manager bind mounts
    // are what the volume replaces, not something it sits alongside.
    expect(opts.mounts?.some((m) => 'hostPath' in m)).toBe(false)
  })

  // `'off'` must be byte-for-byte today's behaviour, env included — a provider
  // handed `env: {}` is not the same as one handed nothing, because sandcastle
  // only applies its own defaults for an absent key.
  it('yields exactly the ADR-0004 bind mount and NO env with the cache off', () => {
    const mount = { hostPath: '/host/.npm', sandboxPath: '~/.npm' }
    const opts = buildSandboxOptions(config('docker', 'off'), [mount])

    expect(opts.mounts).toEqual([mount])
    expect('env' in opts).toBe(false)
    expect(opts.imageName).toBe(DEFAULT_SANDBOX_IMAGE)
  })

  it('omits an empty env map so the provider default applies', () => {
    expect('env' in buildSandboxOptions(config('docker'), [], {})).toBe(false)
  })
})

describe('resolveBurnWorkspaceMode — the cache decides the workspace (decision 8)', () => {
  it('is the slot on every platform once the cache is on', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      expect(resolveBurnWorkspaceMode(config('docker'), platform)).toBe('slot')
      expect(resolveBurnWorkspaceMode(config('podman'), platform)).toBe('slot')
    }
  })

  // A warm slot has no clone to amortise and carries every cache, so ADR-0005's
  // "isolation only costs on Linux" trade flips — burnWorkspace stops applying.
  it('ignores burnWorkspace while the cache is on', () => {
    expect(resolveBurnWorkspaceMode({ ...config('docker'), burnWorkspace: 'mounted' }, 'linux')).toBe(
      'slot',
    )
  })

  it('behaves exactly as before with the cache off', () => {
    expect(resolveBurnWorkspaceMode(config('docker', 'off'), 'win32')).toBe('isolated')
    expect(resolveBurnWorkspaceMode(config('docker', 'off'), 'linux')).toBe('mounted')
    expect(resolveBurnWorkspaceMode(config('noSandbox', 'off'), 'win32')).toBe('mounted')
  })

  // resolveBurnCacheMode already answers 'off' for anything whose `-v` cannot
  // name a volume, so a noSandbox burn never reaches slot mode.
  it('never puts a non-container sandbox on a slot, even with the cache on', () => {
    expect(resolveBurnWorkspaceMode(config('noSandbox'), 'linux')).toBe('mounted')
  })

  it('points the prompt at the slot checkout rather than the isolated clone', () => {
    const notes = buildWorkspaceNotes('slot', slotRepoPath(3))
    expect(notes).toContain(`${BURN_CACHE_MOUNT}/slots/3/repo`)
    expect(notes).not.toContain('/home/agent/repo')
    expect(notes).toContain(`${SANDBOX_WORKSPACE_PATH}/DIGEST.md`)
  })
})

describe('buildSlotSetupCommand — the slot-sync script', () => {
  const script = (setupCommand?: string) =>
    buildSlotSetupCommand(2, BRANCH, setupCommand, 'pnpm', STAMP)
  const repo = slotRepoPath(2)

  it('runs the sync steps in the order a killed container makes necessary', () => {
    const cmd = script('corepack pnpm install --frozen-lockfile')
    const at = (needle: string) => {
      const i = cmd.indexOf(needle)
      expect(i, `missing step: ${needle}`).toBeGreaterThan(-1)
      return i
    }
    // Locks first — a stale index.lock makes every git command below fail.
    const locks = at(`rm -f ${repo}/.git/*.lock`)
    const sync = at(`git -C ${repo} rev-parse --git-dir`)
    const clean = at(`git -C ${repo} clean -fd`)
    const stamp = at(`cat ${slotStampPath(2)}`)
    const attachments = at(`[ -d "${SANDBOX_WORKSPACE_PATH}/.runcastle-attachments" ]`)
    const hook = at(`> ${repo}/.git/hooks/post-commit`)
    const shim = at(`exec corepack pnpm "$@"`)
    const install = at(`cd ${repo} && corepack pnpm install --frozen-lockfile`)
    const rePin = at(`git -C ${repo} config core.hooksPath ${repo}/.git/hooks`)
    const marker = at('RUNCASTLE_SETUP cold=%s')

    expect([locks, sync, clean, stamp, attachments, hook, shim, install, rePin, marker]).toEqual(
      [locks, sync, clean, stamp, attachments, hook, shim, install, rePin, marker].slice().sort((a, b) => a - b),
    )
  })

  it('clones only when the slot has no usable git dir, and fetches otherwise', () => {
    const cmd = script()
    expect(cmd).toContain(
      `if ! git -C ${repo} rev-parse --git-dir >/dev/null 2>&1; then rm -rf ${repo} && git clone ${SANDBOX_WORKSPACE_PATH} ${repo} && RC_COLD=1;`,
    )
    expect(cmd).toContain(`git -C ${repo} fetch ${SANDBOX_WORKSPACE_PATH} ${BRANCH}`)
    expect(cmd).toContain(`git -C ${repo} reset --hard FETCH_HEAD`)
    // The local branch name is what the post-commit hook's HEAD:<branch> push
    // reports against, so a re-synced slot has to be put back on it.
    expect(cmd).toContain(`git -C ${repo} checkout -B ${BRANCH}`)
  })

  // `-fd` and NOT `-fdX`/`-fdx`: the ignored files ARE the cache. node_modules,
  // dist, .turbo and .tsbuildinfo surviving the clean is the whole feature.
  it('cleans untracked files but never ignored ones on the warm path', () => {
    const cmd = script()
    expect(cmd).toContain(`git -C ${repo} clean -fd &&`)
    expect(cmd).not.toContain(`git -C ${repo} clean -fdx`)
    // -fdX appears exactly once, inside the stamp-mismatch wipe.
    expect(cmd.split(`git -C ${repo} clean -fdX`)).toHaveLength(2)
  })

  it('wipes node_modules and the ignored outputs on a stamp mismatch, then restamps', () => {
    const cmd = script()
    const guard = `if [ "$(cat ${slotStampPath(2)} 2>/dev/null)" != "$RC_STAMP" ]`
    expect(cmd).toContain(guard)
    expect(cmd).toContain(
      `${guard}; then rm -rf ${repo}/node_modules && git -C ${repo} clean -fdX && RC_COLD=1 && printf '%s\\n' "$RC_STAMP" > ${slotStampPath(2)}; fi`,
    )
    // The stamp is written AFTER the wipe: a wipe killed halfway must be retried
    // on the next burn, not recorded as done.
    expect(cmd.indexOf(`> ${slotStampPath(2)}`)).toBeGreaterThan(
      cmd.indexOf(`rm -rf ${repo}/node_modules`),
    )
  })

  it('emits the marker line with the cold flag and both phase durations', () => {
    const cmd = script('npm ci')
    expect(cmd).toContain(
      `printf 'RUNCASTLE_SETUP cold=%s sync_ms=%s install_ms=%s\\n' "$RC_COLD" "$RC_SYNC_MS" "$RC_INSTALL_MS" > ${SANDBOX_WORKSPACE_PATH}/${SETUP_MARKER_FILE}`,
    )
    // The install clock brackets only the install, so a warm slot's near-no-op
    // install is distinguishable from the sync that preceded it.
    expect(cmd.indexOf('RC_INSTALL_START=')).toBeLessThan(cmd.indexOf(`cd ${repo} && npm ci`))
    expect(cmd.indexOf('RC_INSTALL_MS=')).toBeGreaterThan(cmd.indexOf(`cd ${repo} && npm ci`))
  })

  it('still times the install phase when there is nothing to install', () => {
    const cmd = script()
    expect(cmd).toContain('RC_INSTALL_START=')
    expect(cmd).toContain('RC_INSTALL_MS=')
    expect(cmd).not.toContain(`cd ${repo} &&`)
  })
})

/**
 * The script runs inside the burn container by construction, so it is `sh` —
 * driven here for real rather than matched as a string, because the acceptance
 * question ("does a second run start warm?") is not one a string can answer. A
 * Windows host has no sh to drive it with; the shape assertions above cover it.
 */
describe.skipIf(process.platform === 'win32')('buildSlotSetupCommand — driven for real', () => {
  let home: string
  let workspace: string
  let volume: string

  /** The script with its two container paths pointed at real directories. */
  function slotScript(slot: number, branch: string, setup?: string): string {
    return buildSlotSetupCommand(slot, branch, setup, undefined, STAMP)
      .replaceAll(SANDBOX_WORKSPACE_PATH, workspace)
      .replaceAll(BURN_CACHE_MOUNT, volume)
  }

  async function runSetup(slot: number, branch: string, setup?: string): Promise<void> {
    await runCommand(slotScript(slot, branch, setup), {
      cwd: workspace,
      // `git config --global` is a real write: keep it in the temp home.
      env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: join(home, 'gitconfig') },
    })
  }

  const slotRepo = (slot: number) => join(volume, 'slots', String(slot), 'repo')

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'rc-slot-home-'))
    workspace = mkdtempSync(join(tmpdir(), 'rc-slot-ws-'))
    volume = mkdtempSync(join(tmpdir(), 'rc-slot-vol-'))

    const g = simpleGit(workspace)
    await g.init(['-b', BRANCH])
    await g.addConfig('user.email', 'test@runcastle.dev')
    await g.addConfig('user.name', 'Runcastle Test')
    writeFileSync(join(workspace, '.gitignore'), 'node_modules/\ndist/\n')
    writeFileSync(join(workspace, 'README.md'), 'base\n')
    await g.add('.')
    await g.commit('base')
    // A push into the checked-out branch is exactly what the burn's post-commit
    // hook does; the host arms this before any container starts.
    await g.addConfig('receive.denyCurrentBranch', 'ignore')
  })

  afterEach(() => {
    for (const dir of [home, workspace, volume]) rmSync(dir, { recursive: true, force: true })
  })

  it('clones a cold slot, reports cold, and lands on the temp branch', async () => {
    await runSetup(1, BRANCH)

    expect(existsSync(join(slotRepo(1), 'README.md'))).toBe(true)
    expect(readFileSync(join(volume, 'slots', '1', '.runcastle-stamp'), 'utf8')).toContain(
      'sandcastle:runcastle node=v',
    )
    const marker = parseSetupMarker(readFileSync(join(workspace, SETUP_MARKER_FILE), 'utf8'))
    expect(marker?.cold).toBe(true)
    expect(await simpleGit(slotRepo(1)).revparse(['--abbrev-ref', 'HEAD'])).toBe(BRANCH)
  })

  it('re-syncs a warm slot to the new branch, keeps ignored caches, drops the rest', async () => {
    await runSetup(1, BRANCH)
    // What a finished burn leaves behind: an ignored cache that must survive,
    // and untracked junk that must not.
    mkdirSync(join(slotRepo(1), 'node_modules', 'left'), { recursive: true })
    writeFileSync(join(slotRepo(1), 'node_modules', 'left', 'index.js'), 'warm\n')
    writeFileSync(join(slotRepo(1), 'DIGEST.md'), 'stale digest\n')

    // The next ticket: a new temp branch off a moved workspace HEAD.
    const next = 'runcastle/ticket/cache-volume/3-Ef56Gh78'
    const g = simpleGit(workspace)
    await g.checkoutLocalBranch(next)
    writeFileSync(join(workspace, 'NEW.md'), 'second\n')
    await g.add('.')
    await g.commit('second')

    await runSetup(1, next)

    expect(readFileSync(join(slotRepo(1), 'node_modules', 'left', 'index.js'), 'utf8')).toBe('warm\n')
    expect(existsSync(join(slotRepo(1), 'DIGEST.md'))).toBe(false)
    expect(existsSync(join(slotRepo(1), 'NEW.md'))).toBe(true)
    expect(await simpleGit(slotRepo(1)).revparse(['--abbrev-ref', 'HEAD'])).toBe(next)

    const marker = parseSetupMarker(readFileSync(join(workspace, SETUP_MARKER_FILE), 'utf8'))
    expect(marker?.cold).toBe(false)
  })

  it('survives a stale index.lock left by a killed container', async () => {
    await runSetup(1, BRANCH)
    writeFileSync(join(slotRepo(1), '.git', 'index.lock'), '')

    await expect(runSetup(1, BRANCH)).resolves.toBeUndefined()
    expect(existsSync(join(slotRepo(1), '.git', 'index.lock'))).toBe(false)
  })

  it('re-clones a slot whose git dir is gone, rather than failing the burn', async () => {
    await runSetup(1, BRANCH)
    rmSync(join(slotRepo(1), '.git'), { recursive: true, force: true })

    await runSetup(1, BRANCH)

    expect(existsSync(join(slotRepo(1), 'README.md'))).toBe(true)
    const marker = parseSetupMarker(readFileSync(join(workspace, SETUP_MARKER_FILE), 'utf8'))
    expect(marker?.cold).toBe(true)
  })

  it('wipes node_modules and reports cold when the toolchain stamp moves', async () => {
    await runSetup(1, BRANCH)
    mkdirSync(join(slotRepo(1), 'node_modules'), { recursive: true })
    writeFileSync(join(slotRepo(1), 'node_modules', 'marker'), 'old abi\n')
    writeFileSync(join(volume, 'slots', '1', '.runcastle-stamp'), 'sandcastle:older node=v20 pm=none@any\n')

    await runSetup(1, BRANCH)

    expect(existsSync(join(slotRepo(1), 'node_modules'))).toBe(false)
    const marker = parseSetupMarker(readFileSync(join(workspace, SETUP_MARKER_FILE), 'utf8'))
    expect(marker?.cold).toBe(true)
  })

  it('arms the post-commit hook so the slot pushes its commits back', async () => {
    await runSetup(1, BRANCH)
    const repo = simpleGit(slotRepo(1))
    await repo.addConfig('user.email', 'agent@runcastle.dev')
    await repo.addConfig('user.name', 'Burn Agent')
    writeFileSync(join(slotRepo(1), 'WORK.md'), 'done\n')
    await repo.add('.')
    await repo.commit('ticket(2): work')

    // The hook pushed the ref AND hard-reset the workspace onto it.
    expect(existsSync(join(workspace, 'WORK.md'))).toBe(true)
    expect(await simpleGit(workspace).revparse(['HEAD'])).toBe(await repo.revparse(['HEAD']))
  })
})

describe('withBurnCacheSlot — one slot per ticket run, back on every exit path', () => {
  it('claims before the body and releases after it', async () => {
    const allocator = createSlotAllocator(2)
    const seen = await withBurnCacheSlot(allocator, async (slot) => {
      expect(allocator.held()).toEqual([1])
      return slot
    })
    expect(seen).toBe(1)
    expect(allocator.held()).toEqual([])
  })

  // The burn path this protects: an attempt that dies mid-run must not leave a
  // slot held for the life of the server, or the next burn narrows by one.
  it('releases the slot when the body throws, and rethrows', async () => {
    const allocator = createSlotAllocator(2)
    await expect(
      withBurnCacheSlot(allocator, async () => {
        throw new Error('claude-code exited with code 137')
      }),
    ).rejects.toThrow('exited with code 137')
    expect(allocator.held()).toEqual([])
  })

  it('releases the slot when the body is aborted', async () => {
    const allocator = createSlotAllocator(2)
    const abort = new AbortController()
    const pending = withBurnCacheSlot(allocator, async () => {
      abort.abort(new Error('stopped by user'))
      abort.signal.throwIfAborted()
    })
    await expect(pending).rejects.toThrow('stopped by user')
    expect(allocator.held()).toEqual([])
  })

  it('runs the body with no slot at all when the cache is off', async () => {
    expect(await withBurnCacheSlot(undefined, async (slot) => slot)).toBeUndefined()
  })

  it('gives concurrent tickets distinct slots and reuses a freed one', async () => {
    const allocator = createSlotAllocator(2)
    const held: number[] = []
    const hold = (release: Promise<void>) =>
      withBurnCacheSlot(allocator, async (slot) => {
        held.push(slot as number)
        await release
      })
    let freeFirst = (): void => {}
    const first = hold(new Promise<void>((r) => (freeFirst = () => r())))
    const second = hold(Promise.resolve())
    await second
    freeFirst()
    await first
    expect(held).toEqual([1, 2])
    // The next ticket takes the lowest free slot, so a quiet server keeps
    // landing back on slot 1 and its warm checkout.
    await withBurnCacheSlot(allocator, async (slot) => expect(slot).toBe(1))
  })
})

describe('setup telemetry (decision 9)', () => {
  it('parses the marker line the setup script leaves', () => {
    expect(parseSetupMarker('RUNCASTLE_SETUP cold=1 sync_ms=8421 install_ms=94360\n')).toEqual({
      cold: true,
      syncMs: 8421,
      installMs: 94360,
    })
    expect(parseSetupMarker('RUNCASTLE_SETUP cold=0 sync_ms=1204 install_ms=3310\n')?.cold).toBe(
      false,
    )
  })

  it('reads nothing out of a truncated or absent marker', () => {
    expect(parseSetupMarker('RUNCASTLE_SETUP cold=0 sync_ms=12')).toBeUndefined()
    expect(parseSetupMarker('')).toBeUndefined()
  })

  it('stamps the image and package-manager major, and asks the container for Node', () => {
    expect(buildSlotStamp('sandcastle:runcastle', 'pnpm@9.6.0')).toBe(
      'sandcastle:runcastle node=$(node --version 2>/dev/null) pm=pnpm@9',
    )
    // A repo with no corepack pin still stamps — the image and Node are the
    // parts that actually break a warm node_modules.
    expect(buildSlotStamp('sandcastle:runcastle')).toContain('pm=none@any')
  })

  it('charges the container rebuild between iterations to `setup`, not to the agent', () => {
    const timer = createToolTimer()
    const at = (ms: number) => new Date(1_700_000_000_000 + ms)
    timer.beginSetup(1_700_000_000_000)
    // 30s of container build + setup hook before the agent says anything.
    timer.onEvent({ type: 'text', message: 'hi', iteration: 1, timestamp: at(30_000) })
    timer.onEvent({
      type: 'toolCall',
      name: 'Bash',
      formattedArgs: 'bun run typecheck',
      iteration: 1,
      timestamp: at(35_000),
    })
    // Iteration 2 is a whole new container: the 60s gap is its setup, not the
    // typecheck it happens to follow.
    timer.onEvent({ type: 'text', message: 'again', iteration: 2, timestamp: at(95_000) })

    const summary = timer.summary()
    expect(summary.byCategory.setup?.ms).toBe(90_000)
    expect(summary.byCategory.model?.ms).toBe(5_000)
    // The typecheck is counted as a call but charged no time — its gap was the
    // rebuild, and attributing that to it is exactly the lie this fixes.
    expect(summary.byCategory.typecheck).toEqual({ calls: 1, ms: 0 })
    // `setup` is time, never a tool call.
    expect(summary.calls).toBe(1)
  })

  it('leaves a single-iteration burn charged exactly as before, plus its setup', () => {
    const timer = createToolTimer()
    const at = (ms: number) => new Date(1_700_000_000_000 + ms)
    timer.beginSetup(1_700_000_000_000)
    timer.onEvent({ type: 'text', message: 'hi', iteration: 1, timestamp: at(1_000) })
    timer.onEvent({
      type: 'toolCall',
      name: 'Bash',
      formattedArgs: 'bun run test',
      iteration: 1,
      timestamp: at(2_000),
    })
    timer.onEvent({ type: 'text', message: 'done', iteration: 1, timestamp: at(9_000) })

    const summary = timer.summary()
    expect(summary.byCategory.setup?.ms).toBe(1_000)
    expect(summary.byCategory.tests?.ms).toBe(7_000)
  })
})
