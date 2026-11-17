import { describe, expect, it } from 'vitest'
import type { ExecFn, ExecOutcome } from '../src/doctor/doctor'
import { tryImageBuildSlot } from '../src/services/image-build'
import {
  removeLeftoverBuilders,
  removeStaleSandboxImages,
} from '../src/services/sandbox-image-cleanup'
import { builderNamePrefix } from '../src/services/sandbox-image'

/**
 * Removing the sandbox images runcastle no longer needs (decision 8), against a
 * fake engine: what it lists, what it inspects, which containers exist, and
 * which `rmi` it is asked for.
 */

const OWN = '/home/u/.runcastle'
const OTHER_LIVE = '/home/u/.runcastle-drive-live'
const GONE = '/home/u/.runcastle-drive-gone'

interface FakeImage {
  id: string
  tags?: string[]
  bytes?: number
  labels: Record<string, string>
}

const answered = (stdout = ''): ExecOutcome => ({ ok: true, code: 0, stdout, stderr: '' })

const runcastleLabels = (extra: Record<string, string> = {}) => ({
  'runcastle.dockerfile-hash': 'abc',
  'runcastle.owner': 'runcastle',
  'runcastle.data-dir': OWN,
  ...extra,
})

/** An engine holding `images` and containers created from `usedImages`. */
function fakeEngine(images: FakeImage[], usedImages: string[] = []) {
  const removed: string[][] = []
  const exec: ExecFn = async (_cmd, args) => {
    if (args[0] === 'images') {
      // The engine's own label filter.
      return answered(images.filter((i) => 'runcastle.dockerfile-hash' in i.labels).map((i) => i.id).join('\n'))
    }
    if (args[0] === 'image' && args[1] === 'inspect') {
      return answered(
        images
          .filter((i) => args.includes(i.id))
          .map((i) => [i.id, i.bytes ?? 1000, JSON.stringify(i.tags ?? []), JSON.stringify(i.labels)].join('\t'))
          .join('\n'),
      )
    }
    if (args[0] === 'ps') return answered(usedImages.map((_, n) => `c${n}`).join('\n'))
    if (args[0] === 'container' && args[1] === 'inspect') return answered(usedImages.join('\n'))
    if (args[0] === 'rmi') {
      removed.push(args.slice(1))
      return answered()
    }
    return { ok: true, code: 1, stdout: '', stderr: 'unexpected' }
  }
  return { exec, removed }
}

const exists = (path: string) => path !== GONE

describe('removeStaleSandboxImages', () => {
  it('removes a dangling runcastle image a rebuild replaced, and counts its size', async () => {
    const engine = fakeEngine([
      { id: 'sha256:old', bytes: 3_500_000_000, labels: runcastleLabels() },
      { id: 'sha256:new', tags: ['sandcastle:runcastle'], labels: runcastleLabels() },
    ])

    const result = await removeStaleSandboxImages({ engine: 'docker', exec: engine.exec, dataDir: OWN, exists })

    expect(engine.removed).toEqual([['sha256:old']])
    expect(result.removed).toEqual([{ id: 'sha256:old', tags: [], reason: 'dangling', bytes: 3_500_000_000 }])
    expect(result.freedBytes).toBe(3_500_000_000)
  })

  it('removes the image of a project this install no longer has', async () => {
    const engine = fakeEngine([
      { id: 'sha256:gone', tags: ['sandcastle:runcastle-proj_gone'], labels: runcastleLabels({ 'runcastle.project': 'proj_gone' }) },
      { id: 'sha256:live', tags: ['sandcastle:runcastle-proj_live'], labels: runcastleLabels({ 'runcastle.project': 'proj_live' }) },
      // From before the labels: the project comes from the tag.
      { id: 'sha256:legacy', tags: ['sandcastle:runcastle-proj_old'], labels: { 'runcastle.dockerfile-hash': 'abc' } },
      { id: 'sha256:stock', tags: ['sandcastle:runcastle'], labels: runcastleLabels() },
    ])

    const result = await removeStaleSandboxImages({
      engine: 'docker',
      exec: engine.exec,
      dataDir: OWN,
      liveProjectIds: ['proj_live'],
      exists,
    })

    expect(engine.removed).toEqual([['sandcastle:runcastle-proj_gone'], ['sandcastle:runcastle-proj_old']])
    expect(result.removed.map((i) => i.reason)).toEqual(['project-gone', 'project-gone'])
  })

  it('removes no project image when it is not told which projects are live', async () => {
    const engine = fakeEngine([
      { id: 'sha256:gone', tags: ['sandcastle:runcastle-proj_gone'], labels: runcastleLabels({ 'runcastle.project': 'proj_gone' }) },
    ])
    await removeStaleSandboxImages({ engine: 'docker', exec: engine.exec, dataDir: OWN, exists })
    expect(engine.removed).toEqual([])
  })

  it('keeps an image a container uses, running or stopped', async () => {
    const engine = fakeEngine(
      [
        { id: 'sha256:old', labels: runcastleLabels() },
        { id: 'sha256:gone', tags: ['sandcastle:runcastle-proj_gone'], labels: runcastleLabels() },
      ],
      ['sha256:old', 'sha256:gone'],
    )

    const result = await removeStaleSandboxImages({
      engine: 'docker',
      exec: engine.exec,
      dataDir: OWN,
      liveProjectIds: [],
      exists,
    })

    expect(engine.removed).toEqual([])
    expect(result).toEqual({ removed: [], freedBytes: 0, failed: [] })
  })

  it('never touches an image runcastle did not build', async () => {
    const engine = fakeEngine([
      // No runcastle label at all.
      { id: 'sha256:theirs', labels: { maintainer: 'someone' } },
      // Built FROM runcastle's image, so it inherited the labels, but tagged by someone else.
      { id: 'sha256:child', tags: ['acme/box:1'], labels: runcastleLabels() },
      // An older runcastle's tag named after the project, which a setting may still name.
      { id: 'sha256:byname', tags: ['sandcastle:runcastle-demo'], labels: { 'runcastle.dockerfile-hash': 'abc' } },
    ])

    await removeStaleSandboxImages({
      engine: 'docker',
      exec: engine.exec,
      dataDir: OWN,
      liveProjectIds: [],
      exists,
    })

    expect(engine.removed).toEqual([])
  })

  it('leaves an image marked with another install whose data folder still exists', async () => {
    const engine = fakeEngine([
      { id: 'sha256:live-drive', labels: runcastleLabels({ 'runcastle.data-dir': OTHER_LIVE }) },
      { id: 'sha256:gone-drive', labels: runcastleLabels({ 'runcastle.data-dir': GONE }) },
    ])

    await removeStaleSandboxImages({ engine: 'docker', exec: engine.exec, dataDir: OWN, exists })

    expect(engine.removed).toEqual([['sha256:gone-drive']])
  })

  it('removes nothing when the engine cannot say which containers exist', async () => {
    const base = fakeEngine([{ id: 'sha256:old', labels: runcastleLabels() }])
    const exec: ExecFn = async (cmd, args) =>
      args[0] === 'ps' ? { ok: false, code: null, stdout: '', stderr: '' } : base.exec(cmd, args)

    await removeStaleSandboxImages({ engine: 'podman', exec, dataDir: OWN, exists })

    expect(base.removed).toEqual([])
  })

  it('reports an image the engine refuses to remove', async () => {
    const base = fakeEngine([{ id: 'sha256:old', labels: runcastleLabels() }])
    const exec: ExecFn = async (cmd, args) =>
      args[0] === 'rmi'
        ? { ok: true, code: 1, stdout: '', stderr: 'image has dependent child images' }
        : base.exec(cmd, args)

    const result = await removeStaleSandboxImages({ engine: 'docker', exec, dataDir: OWN, exists })

    expect(result.removed).toEqual([])
    expect(result.failed).toEqual([{ id: 'sha256:old', tags: [], error: 'image has dependent child images' }])
  })
})

describe('removeLeftoverBuilders', () => {
  const own = `${builderNamePrefix(OWN)}deadbeef`
  const other = `${builderNamePrefix(OTHER_LIVE)}cafef00d`
  const listing = [
    'NAME/NODE            DRIVER/ENDPOINT     STATUS    BUILDKIT',
    `${own}   docker-container`,
    `  ${own}0  unix:///var/run/docker.sock  running  v0.17`,
    `${other}   docker-container`,
    'default*             docker',
  ].join('\n')

  it("removes only this install's own builders", async () => {
    const calls: string[][] = []
    const exec: ExecFn = async (_cmd, args) => {
      calls.push(args)
      return answered(args[1] === 'ls' ? listing : '')
    }

    expect(await removeLeftoverBuilders({ exec, dataDir: OWN })).toEqual([own])
    expect(calls).toEqual([
      ['buildx', 'ls'],
      ['buildx', 'rm', own],
    ])
  })

  it('leaves them while this server is building', async () => {
    const release = tryImageBuildSlot()
    const calls: string[][] = []
    const exec: ExecFn = async (_cmd, args) => {
      calls.push(args)
      return answered(listing)
    }
    try {
      expect(await removeLeftoverBuilders({ exec, dataDir: OWN })).toEqual([])
      expect(calls).toEqual([])
    } finally {
      release?.()
    }
  })
})
