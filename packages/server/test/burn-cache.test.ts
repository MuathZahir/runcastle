import { describe, expect, it } from 'vitest'
import type { ExecFn, ExecOutcome } from '../src/doctor/doctor'
import {
  BURN_CACHE_MOUNT,
  BURN_CACHE_VOLUME_LABEL,
  BURN_CACHE_VOLUME_VERSION,
  BurnCacheBusyError,
  BurnSlotsExhaustedError,
  burnCacheEnv,
  burnCacheVolumeName,
  burnCacheVolumeSize,
  createSlotAllocator,
  ensureBurnCacheVolume,
  getBurnSlotAllocator,
  inspectBurnCacheVolume,
  removeBurnCacheVolume,
  slotRepoPath,
  storePath,
} from '../src/workflows/burn-cache'

/**
 * The host side of the persistent burn cache: volume lifecycle and slot
 * ownership. Every engine command goes through an injected `ExecFn`, so these
 * pin the exact argv issued — which is the whole contract, since the commands
 * are the only thing that reaches Docker/Podman.
 */

const PROJECT = 'proj_abc123def456'
const VOLUME = `runcastle-${PROJECT}`
const IMAGE = 'sandcastle:runcastle'

/** A recording `ExecFn` whose canned outcome is chosen per command. */
function fakeExec(reply: (command: string, args: string[]) => Partial<ExecOutcome> = () => ({})) {
  const calls: string[][] = []
  const exec: ExecFn = async (command, args) => {
    calls.push([command, ...args])
    return { ok: true, code: 0, stdout: '', stderr: '', ...reply(command, args) }
  }
  return { exec, calls }
}

const isInspect = (args: string[]) => args[0] === 'volume' && args[1] === 'inspect'

/** The volume-inspect probe reports the volume as missing. */
const volumeMissing = (_command: string, args: string[]): Partial<ExecOutcome> =>
  isInspect(args) ? { ok: true, code: 1, stderr: 'no such volume' } : {}

/** The volume exists and carries this version's label: created and chowned by us. */
const volumeCurrent = (_command: string, args: string[]): Partial<ExecOutcome> =>
  isInspect(args) ? { stdout: `${BURN_CACHE_VOLUME_VERSION}\n` } : {}

/** The volume exists but is unlabelled — left behind by v1.2.11's failed chown. */
const volumeStale = (_command: string, args: string[]): Partial<ExecOutcome> =>
  isInspect(args) ? { stdout: '\n' } : {}

const CHOWN_ONE_SHOT = [
  'docker',
  'run',
  '--rm',
  '--user',
  'root',
  '--entrypoint',
  'chown',
  '-v',
  `${VOLUME}:${BURN_CACHE_MOUNT}`,
  IMAGE,
  '-R',
  '1000:1000',
  BURN_CACHE_MOUNT,
]
const CREATE_LABELLED = [
  'docker',
  'volume',
  'create',
  '--label',
  `${BURN_CACHE_VOLUME_LABEL}=${BURN_CACHE_VOLUME_VERSION}`,
  VOLUME,
]

describe('burnCacheVolumeName', () => {
  // Project ids are already legal volume names, and sanitising one would risk
  // two projects landing on the same volume.
  it('is the project id under a runcastle- prefix', () => {
    expect(burnCacheVolumeName(PROJECT)).toBe(VOLUME)
  })
})

describe('inspectBurnCacheVolume', () => {
  it('asks the engine for the runcastle label only', async () => {
    const { exec, calls } = fakeExec(volumeCurrent)
    await inspectBurnCacheVolume(exec, 'docker', PROJECT)
    expect(calls).toEqual([
      ['docker', 'volume', 'inspect', '--format', `{{index .Labels "${BURN_CACHE_VOLUME_LABEL}"}}`, VOLUME],
    ])
  })

  it('distinguishes missing, current and stale', async () => {
    expect(await inspectBurnCacheVolume(fakeExec(volumeMissing).exec, 'docker', PROJECT)).toBe('missing')
    expect(await inspectBurnCacheVolume(fakeExec(volumeCurrent).exec, 'docker', PROJECT)).toBe('current')
    expect(await inspectBurnCacheVolume(fakeExec(volumeStale).exec, 'docker', PROJECT)).toBe('stale')
    // A label from a different layout version is stale too, not current.
    const other = fakeExec((_c, args) => (isInspect(args) ? { stdout: '0\n' } : {}))
    expect(await inspectBurnCacheVolume(other.exec, 'docker', PROJECT)).toBe('stale')
  })

  it('reads an engine that is not even installed as missing', async () => {
    const { exec } = fakeExec(() => ({ ok: false, code: null }))
    expect(await inspectBurnCacheVolume(exec, 'docker', PROJECT)).toBe('missing')
  })
})

describe('ensureBurnCacheVolume', () => {
  it('creates a labelled volume and chowns it to the burn user on first creation', async () => {
    const { exec, calls } = fakeExec(volumeMissing)

    await ensureBurnCacheVolume({ engine: 'docker', imageName: IMAGE, projectId: PROJECT, exec })

    expect(calls.slice(1)).toEqual([CREATE_LABELLED, CHOWN_ONE_SHOT])
  })

  // The sandbox image's ENTRYPOINT is `sleep infinity`; without `--entrypoint`
  // the one-shot became `sleep infinity chown -R …` and died on `-R` (v1.2.11).
  it('overrides the image ENTRYPOINT so chown actually runs', () => {
    const entrypoint = CHOWN_ONE_SHOT.indexOf('--entrypoint')
    expect(entrypoint).toBeGreaterThan(-1)
    expect(CHOWN_ONE_SHOT[entrypoint + 1]).toBe('chown')
    // and the image is followed by chown's own args, not by a second `chown`.
    expect(CHOWN_ONE_SHOT.slice(CHOWN_ONE_SHOT.indexOf(IMAGE) + 1)).toEqual(['-R', '1000:1000', BURN_CACHE_MOUNT])
  })

  // A recursive chown of a multi-gigabyte cache, once per burn, is exactly the
  // cost this feature exists to remove.
  it('never touches a volume that exists with the current label', async () => {
    const { exec, calls } = fakeExec(volumeCurrent)

    await ensureBurnCacheVolume({ engine: 'docker', imageName: IMAGE, projectId: PROJECT, exec })

    expect(calls.map((c) => c.slice(0, 3))).toEqual([['docker', 'volume', 'inspect']])
  })

  it('drops and recreates an unlabelled (root-owned) volume left by an older version', async () => {
    const { exec, calls } = fakeExec(volumeStale)

    await ensureBurnCacheVolume({ engine: 'docker', imageName: IMAGE, projectId: PROJECT, exec })

    expect(calls.slice(1)).toEqual([['docker', 'volume', 'rm', VOLUME], CREATE_LABELLED, CHOWN_ONE_SHOT])
  })

  it('rolls the volume back when the chown fails, so the next burn retries from scratch', async () => {
    const { exec, calls } = fakeExec((c, args) =>
      args[0] === 'run' ? { code: 1, stderr: "sleep: invalid option -- 'R'" } : volumeMissing(c, args),
    )

    await expect(
      ensureBurnCacheVolume({ engine: 'docker', imageName: IMAGE, projectId: PROJECT, exec }),
    ).rejects.toThrow(/invalid option/)
    expect(calls.at(-1)).toEqual(['docker', 'volume', 'rm', VOLUME])
  })

  it('reports the chown error even if the rollback itself fails', async () => {
    const { exec } = fakeExec((c, args) => {
      if (args[0] === 'run') return { code: 125, stderr: 'no such image' }
      if (args[1] === 'rm') return { code: 1, stderr: 'volume is in use' }
      return volumeMissing(c, args)
    })

    await expect(
      ensureBurnCacheVolume({ engine: 'docker', imageName: IMAGE, projectId: PROJECT, exec }),
    ).rejects.toThrow(/no such image/)
  })

  it('issues the same commands through podman', async () => {
    const { exec, calls } = fakeExec(volumeMissing)

    await ensureBurnCacheVolume({ engine: 'podman', imageName: IMAGE, projectId: PROJECT, exec })

    expect(calls.map((call) => call[0])).toEqual(['podman', 'podman', 'podman'])
    expect(calls[2]?.slice(1, 9)).toEqual([
      'run',
      '--rm',
      '--user',
      'root',
      '--entrypoint',
      'chown',
      '-v',
      `${VOLUME}:${BURN_CACHE_MOUNT}`,
    ])
  })

  it('fails loudly when the engine refuses, rather than burning against no cache', async () => {
    const { exec } = fakeExec((_c, args) =>
      args[1] === 'create' ? { ok: true, code: 1, stderr: 'permission denied' } : volumeMissing(_c, args),
    )

    await expect(
      ensureBurnCacheVolume({ engine: 'docker', imageName: IMAGE, projectId: PROJECT, exec }),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('removeBurnCacheVolume', () => {
  it('removes the volume when no slot is held', async () => {
    const { exec, calls } = fakeExec()

    await removeBurnCacheVolume({ engine: 'docker', projectId: PROJECT, exec, slots: [] })

    expect(calls).toEqual([['docker', 'volume', 'rm', VOLUME]])
  })

  // The volume holds those burns' working trees; deleting it mid-burn leaves
  // the agent writing into a removed mount.
  it('refuses while burns hold slots, naming them, and issues nothing', async () => {
    const { exec, calls } = fakeExec()

    const removal = removeBurnCacheVolume({
      engine: 'docker',
      projectId: PROJECT,
      exec,
      slots: [3, 1],
    })

    await expect(removal).rejects.toBeInstanceOf(BurnCacheBusyError)
    await expect(removal).rejects.toThrow(/slots 1, 3/)
    expect(calls).toEqual([])
  })

  it('carries the held slots on the error for the caller to report', async () => {
    const { exec } = fakeExec()
    const error = await removeBurnCacheVolume({
      engine: 'podman',
      projectId: PROJECT,
      exec,
      slots: [2],
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(BurnCacheBusyError)
    expect((error as BurnCacheBusyError).slots).toEqual([2])
  })
})

/**
 * Docker and Podman disagree about the verbose JSON: the record may be nested
 * under a `Volumes` key or emitted one per line, named `Name` or `VolumeName`,
 * with the size as a human string from the CLI formatter or a raw byte count
 * from the API type. The parser tolerates all of it rather than pinning one
 * shape per engine and breaking on the next release.
 */
describe('burnCacheVolumeSize', () => {
  const sizeExec = (stdout: string) => fakeExec(() => ({ stdout }))

  it('asks the engine for its verbose disk-usage report', async () => {
    const { exec, calls } = sizeExec('{}')

    await burnCacheVolumeSize({ engine: 'docker', projectId: PROJECT, exec })

    expect(calls).toEqual([['docker', 'system', 'df', '-v', '--format', 'json']])
  })

  it('reads a human size out of a docker report', async () => {
    const stdout = JSON.stringify({
      Images: [],
      Containers: [],
      Volumes: [
        { Name: 'some-other-volume', Links: '1', Size: '5GB' },
        { Name: VOLUME, Links: '0', Size: '1.25GB' },
      ],
      BuildCache: [],
    })

    const size = await burnCacheVolumeSize({ engine: 'docker', projectId: PROJECT, exec: sizeExec(stdout).exec })

    expect(size).toBe(1_250_000_000)
  })

  it('reads a byte count out of a line-per-record podman report', async () => {
    const stdout = [
      '{"Type":"Images","Total":3,"Active":1,"Size":123456,"Reclaimable":0}',
      `{"VolumeName":"${VOLUME}","Links":0,"Size":2048}`,
    ].join('\n')

    const size = await burnCacheVolumeSize({ engine: 'podman', projectId: PROJECT, exec: sizeExec(stdout).exec })

    expect(size).toBe(2048)
  })

  it('reads a size nested under the API type UsageData', async () => {
    const stdout = JSON.stringify({ Volumes: [{ Name: VOLUME, UsageData: { Size: 4096, RefCount: 0 } }] })

    const size = await burnCacheVolumeSize({ engine: 'docker', projectId: PROJECT, exec: sizeExec(stdout).exec })

    expect(size).toBe(4096)
  })

  it('is null for a volume the report does not mention', async () => {
    const stdout = JSON.stringify({ Volumes: [{ Name: 'somebody-elses-volume', Size: '1GB' }] })

    expect(
      await burnCacheVolumeSize({ engine: 'docker', projectId: PROJECT, exec: sizeExec(stdout).exec }),
    ).toBeNull()
  })

  // Shown a size or nothing — never a guess.
  it('is null when the engine fails or answers with something unreadable', async () => {
    const failed = fakeExec(() => ({ ok: false, code: null, stderr: 'Cannot connect to the Docker daemon' }))
    expect(await burnCacheVolumeSize({ engine: 'docker', projectId: PROJECT, exec: failed.exec })).toBeNull()

    const garbage = sizeExec('not json at all')
    expect(await burnCacheVolumeSize({ engine: 'docker', projectId: PROJECT, exec: garbage.exec })).toBeNull()
  })
})

describe('slot allocator', () => {
  it('hands out the lowest free slot, starting at 1', () => {
    const slots = createSlotAllocator(3)

    expect(slots.claim()).toBe(1)
    expect(slots.claim()).toBe(2)
    expect(slots.claim()).toBe(3)
    expect(slots.held()).toEqual([1, 2, 3])
  })

  it('throws once every slot is held', () => {
    const slots = createSlotAllocator(2)
    slots.claim()
    slots.claim()

    expect(() => slots.claim()).toThrow(BurnSlotsExhaustedError)
  })

  // Lowest-free-first is what keeps a quiet server reusing one warm checkout
  // instead of spreading cold ones across the volume.
  it('re-hands a released slot before an untouched higher one', () => {
    const slots = createSlotAllocator(3)
    slots.claim()
    slots.claim()
    slots.release(1)

    expect(slots.held()).toEqual([2])
    expect(slots.claim()).toBe(1)
  })

  // Release runs in the burner's `finally`, which can fire on a path that never
  // claimed; it must not blow up there.
  it('treats releasing an unheld slot as a no-op', () => {
    const slots = createSlotAllocator(2)

    expect(() => slots.release(2)).not.toThrow()
    expect(slots.held()).toEqual([])
  })

  it('follows a burnConcurrency change without dropping what is held', () => {
    const slots = createSlotAllocator(3)
    slots.claim()
    slots.claim()
    slots.claim()

    slots.resize(1)

    expect(slots.held()).toEqual([1, 2, 3])
    expect(() => slots.claim()).toThrow(BurnSlotsExhaustedError)
  })
})

describe('getBurnSlotAllocator', () => {
  // The burner claims from it and the clear-cache refusal reads `held()` off
  // it; neither means anything unless it is the same object.
  it('is one shared instance that retunes to the latest capacity', () => {
    const first = getBurnSlotAllocator(2)
    const claimed = first.claim()

    const second = getBurnSlotAllocator(4)
    expect(second).toBe(first)
    expect(second.held()).toEqual([claimed])

    second.claim()
    second.claim()
    expect(second.claim()).toBe(4)

    for (const slot of second.held()) second.release(slot)
    expect(second.held()).toEqual([])
  })
})

describe('container paths and environment', () => {
  it('puts each slot checkout at a path that is the same on every run', () => {
    expect(BURN_CACHE_MOUNT).toBe('/home/agent/cache')
    expect(slotRepoPath(1)).toBe('/home/agent/cache/slots/1/repo')
    expect(slotRepoPath(4)).toBe('/home/agent/cache/slots/4/repo')
  })

  it('gives each package manager its own store directory', () => {
    expect(storePath('pnpm')).toBe('/home/agent/cache/store/pnpm')
    expect(storePath('bun')).toBe('/home/agent/cache/store/bun')
  })

  it('points every store and Node cache variable at the volume', () => {
    expect(burnCacheEnv('pnpm')).toEqual({
      npm_config_store_dir: '/home/agent/cache/store/pnpm',
      pnpm_config_store_dir: '/home/agent/cache/store/pnpm',
      BUN_INSTALL_CACHE_DIR: '/home/agent/cache/store/pnpm',
      npm_config_cache: '/home/agent/cache/store/pnpm',
      YARN_GLOBAL_FOLDER: '/home/agent/cache/store/pnpm',
      TMPDIR: '/home/agent/cache/tmp',
      NODE_COMPILE_CACHE: '/home/agent/cache/node-compile',
    })
    // The store variables follow the manager; the two Node ones do not.
    expect(burnCacheEnv('yarn').YARN_GLOBAL_FOLDER).toBe('/home/agent/cache/store/yarn')
    expect(burnCacheEnv('yarn').TMPDIR).toBe('/home/agent/cache/tmp')
  })
})
