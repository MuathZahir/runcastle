import type { ContainerFacts, VolumeFacts } from './ownership'
import { type Engine, engineRun } from './sandbox'

/**
 * What the engine holds, read for the ownership check and the sweep
 * (runcastle-cleans-up-after-itself decisions 5, 6): every container with its
 * labels, mounts and size, every volume with its labels. Docker and Podman
 * answer `inspect` with the same field names this reads.
 */

interface RawContainer {
  Name?: string
  State?: { Running?: boolean }
  Config?: { Labels?: Record<string, string> | null }
  Mounts?: { Type?: string; Source?: string; Name?: string; Destination?: string }[] | null
  SizeRw?: number
}

export function containerFactsOf(raw: RawContainer): ContainerFacts {
  return {
    name: (raw.Name ?? '').replace(/^\//, ''),
    running: raw.State?.Running === true,
    labels: raw.Config?.Labels ?? {},
    mounts: (raw.Mounts ?? []).map((m) => ({
      type: m.Type ?? '',
      // A named volume's source is its name; a bind's is the host path.
      source: m.Type === 'volume' && m.Name ? m.Name : (m.Source ?? ''),
      destination: m.Destination ?? '',
    })),
    ...(typeof raw.SizeRw === 'number' ? { sizeBytes: raw.SizeRw } : {}),
  }
}

const isMissing = (err: unknown): boolean => /no such/i.test(`${(err as { stderr?: string }).stderr ?? ''} ${err instanceof Error ? err.message : ''}`)

/** One container's facts; undefined when the engine has none of that name. Throws when the engine does not answer. */
export async function inspectContainer(engine: Engine, name: string): Promise<ContainerFacts | undefined> {
  try {
    const out = await engineRun(engine, ['container', 'inspect', name])
    const raw = (JSON.parse(out) as RawContainer[])[0]
    return raw ? containerFactsOf(raw) : undefined
  } catch (err) {
    if (isMissing(err)) return undefined
    throw err
  }
}

/** Every container the engine holds, stopped ones too, with its writable layer's size. */
export async function listContainers(engine: Engine): Promise<ContainerFacts[]> {
  const ids = (await engineRun(engine, ['ps', '-aq', '--no-trunc'])).split('\n').map((l) => l.trim()).filter(Boolean)
  if (!ids.length) return []
  const out = await engineRun(engine, ['container', 'inspect', '--size', ...ids])
  return (JSON.parse(out) as RawContainer[]).map(containerFactsOf)
}

/** Every volume the engine holds, with its labels and, where the engine says, its size. */
export async function listVolumes(engine: Engine): Promise<VolumeFacts[]> {
  const names = (await engineRun(engine, ['volume', 'ls', '-q'])).split('\n').map((l) => l.trim()).filter(Boolean)
  if (!names.length) return []
  const raw = JSON.parse(await engineRun(engine, ['volume', 'inspect', ...names])) as { Name: string; Labels?: Record<string, string> | null }[]
  const sizes = await volumeSizes(engine).catch(() => new Map<string, number>())
  return raw.map((v) => {
    const size = sizes.get(v.Name)
    return { name: v.Name, labels: v.Labels ?? {}, ...(size !== undefined ? { sizeBytes: size } : {}) }
  })
}

/** Volume sizes from `system df -v`, best effort: an engine that answers otherwise gives none. */
async function volumeSizes(engine: Engine): Promise<Map<string, number>> {
  const out = await engineRun(engine, ['system', 'df', '-v', '--format', '{{json .}}'])
  const sizes = new Map<string, number>()
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const parsed = JSON.parse(line) as { Volumes?: { Name?: string; VolumeName?: string; Size?: string | number }[] }
    for (const v of parsed.Volumes ?? []) {
      const name = v.Name ?? v.VolumeName
      const size = typeof v.Size === 'number' ? v.Size : parseSize(v.Size)
      if (name && size !== undefined) sizes.set(name, size)
    }
  }
  return sizes
}

const UNITS: Record<string, number> = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 }

/** `"1.2GB"`, `"512 MiB"`, `"0B"` → bytes; undefined for what it cannot read. */
export function parseSize(text: string | undefined): number | undefined {
  const m = text?.trim().match(/^([\d.]+)\s*([kmgt]i?)?b$/i)
  if (!m) return undefined
  const unit = `${(m[2] ?? '').toLowerCase()}b`
  const mult = UNITS[unit]
  return mult === undefined ? undefined : Math.round(Number(m[1]) * mult)
}

/** Remove a container, running or not; one already gone is no error. */
export async function removeContainer(engine: Engine, name: string): Promise<void> {
  try {
    await engineRun(engine, ['rm', '-f', name])
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}

/** Stop containers at once, giving each `seconds` before it is killed. */
export async function stopContainers(engine: Engine, names: string[], seconds = 5): Promise<void> {
  if (names.length) await engineRun(engine, ['stop', '-t', String(seconds), ...names])
}

export async function removeVolume(engine: Engine, name: string): Promise<void> {
  try {
    await engineRun(engine, ['volume', 'rm', name])
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}
