import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LABEL_DOCKERFILE_HASH, type PromptDisplay } from '@runcastle/core'
import type { AgentHost } from '../../src/threads/types'
import type { CliResult, CliRun } from '../../src/workers/container-leftovers'
import { tmpRepo } from '../helpers/fixtures'

/**
 * The fakes workers are tested with: an agent host that only records, and a
 * container CLI with no containers behind it, for the upgrade step that
 * cleans up what the container era left. The git underneath stays real.
 */

export interface Sent {
  threadId: string
  text: string
  display?: PromptDisplay
}

/** An agent host that only records what was said to which thread. */
export function fakeHost(): { host: AgentHost; sent: Sent[]; stopped: string[] } {
  const sent: Sent[] = []
  const stopped: string[] = []
  const host = {
    prompt: async (threadId: string, input: { text: string }, opts: { display?: PromptDisplay }) => {
      sent.push({ threadId, text: input.text, ...(opts.display ? { display: opts.display } : {}) })
      return { promptId: `p${sent.length}` }
    },
    stop: async (threadId: string) => {
      stopped.push(threadId)
    },
    isRunning: () => false,
  }
  return { host: host as unknown as AgentHost, sent, stopped }
}

export interface FakeContainer {
  id: string
  name: string
  labels?: Record<string, string>
  mounts?: { Type: string; Source?: string; Name?: string; Destination: string }[]
  image?: string
  size?: number
  /** Files inside the container, by path, for `cp`. */
  files?: Record<string, string>
}

export interface FakeImage {
  id: string
  size: number
  tags: string[]
  labels: Record<string, string>
}

export interface FakeVolume {
  name: string
  labels?: Record<string, string>
  size?: number
}

export interface FakeCli {
  run: CliRun
  /** The binary that answers; null for a machine with none. */
  bin: 'docker' | 'podman' | null
  /** An installed binary that does not answer, such as Docker with its daemon stopped. */
  silent?: 'docker' | 'podman'
  /** Reading the containers fails, though listing their ids worked. */
  inspectFails?: boolean
  containers: FakeContainer[]
  images: FakeImage[]
  volumes: FakeVolume[]
  builders: string[]
  /** Docker's shared build cache, as `system df` says it. */
  buildCache?: string
  /** Every call that reached the answering binary, as one line each. */
  calls: string[]
  /** What was removed, as `<kind> <name>`. */
  removed: string[]
}

const ok = (stdout = ''): CliResult => ({ code: 0, stdout, stderr: '' })
const no = (stderr: string): CliResult => ({ code: 1, stdout: '', stderr })

/** A container CLI that answers from the test's lists and removes from them; anything else it is asked fails. */
export function fakeCli(bin: FakeCli['bin'] = 'docker'): FakeCli {
  const cli: FakeCli = {
    bin,
    containers: [],
    images: [],
    volumes: [],
    builders: [],
    calls: [],
    removed: [],
    run: async (b, args) => {
      if (b === cli.silent) return no('Cannot connect to the Docker daemon. Is the docker daemon running?')
      if (b !== cli.bin) return { code: null, stdout: '', stderr: `${b}: not found` }
      cli.calls.push(args.join(' '))
      const [a0, a1] = args
      const rest = (n: number) => args.slice(n)
      if (a0 === 'ps') return ok(cli.containers.map((c) => c.id).join('\n'))
      if (a0 === 'container' && a1 === 'inspect' && cli.inspectFails) return no('inspect timed out')
      if (a0 === 'container' && a1 === 'inspect') {
        const ids = rest(3)
        return ok(
          JSON.stringify(
            cli.containers
              .filter((c) => ids.includes(c.id))
              .map((c) => ({ Id: c.id, Name: `/${c.name}`, Image: c.image ?? 'sha256:none', Config: { Labels: c.labels ?? null }, Mounts: c.mounts ?? [], ...(c.size !== undefined ? { SizeRw: c.size } : {}) })),
          ),
        )
      }
      if (a0 === 'images') return ok(cli.images.filter((i) => LABEL_DOCKERFILE_HASH in i.labels).map((i) => i.id).join('\n'))
      if (a0 === 'image' && a1 === 'inspect') {
        const ids = rest(4)
        return ok(cli.images.filter((i) => ids.includes(i.id)).map((i) => `${i.id}\t${i.size}\t${JSON.stringify(i.tags)}\t${JSON.stringify(i.labels)}`).join('\n'))
      }
      if (a0 === 'volume' && a1 === 'ls') return ok(cli.volumes.map((v) => v.name).join('\n'))
      if (a0 === 'volume' && a1 === 'inspect') return ok(JSON.stringify(cli.volumes.filter((v) => rest(2).includes(v.name)).map((v) => ({ Name: v.name, Labels: v.labels ?? null }))))
      if (a0 === 'system' && a1 === 'df' && args[2] === '-v') {
        return ok(JSON.stringify({ Volumes: cli.volumes.filter((v) => v.size !== undefined).map((v) => ({ Name: v.name, Size: `${v.size}B` })) }))
      }
      if (a0 === 'system' && a1 === 'df') return ok(cli.buildCache ? JSON.stringify({ Type: 'Build Cache', Size: cli.buildCache }) : '')
      if (a0 === 'buildx' && a1 === 'ls') return ok(cli.builders.join('\n'))
      if (a0 === 'cp') {
        const [from = '', to = ''] = rest(1)
        const [name, inside = ''] = from.split(':')
        const c = cli.containers.find((x) => x.name === name)
        if (!c) return no(`No such container: ${name}`)
        for (const [path, body] of Object.entries(c.files ?? {})) {
          if (!path.startsWith(`${inside}/`)) continue
          const target = join(to, inside.split('/').at(-1) ?? '', path.slice(inside.length + 1))
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, body)
        }
        return ok()
      }
      if (a0 === 'rm') {
        const name = args[2] ?? ''
        if (!cli.containers.some((c) => c.name === name)) return no(`Error: No such container: ${name}`)
        cli.containers = cli.containers.filter((c) => c.name !== name)
        cli.removed.push(`container ${name}`)
        return ok()
      }
      if (a0 === 'rmi') {
        const tags = rest(1)
        cli.images = cli.images.filter((i) => !(i.tags.some((t) => tags.includes(t)) || tags.includes(i.id)))
        cli.removed.push(`image ${tags.join(' ')}`)
        return ok()
      }
      if (a0 === 'volume' && a1 === 'rm') {
        cli.volumes = cli.volumes.filter((v) => v.name !== args[2])
        cli.removed.push(`volume ${args[2]}`)
        return ok()
      }
      if (a0 === 'buildx' && a1 === 'rm') {
        cli.builders = cli.builders.filter((n) => n !== args[2])
        cli.removed.push(`builder ${args[2]}`)
        return ok()
      }
      return no(`unknown command: ${args.join(' ')}`)
    },
  }
  return cli
}

export function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}

/** A repo with `main` and `feature/<slug>`, nothing checked out on the feature branch. */
export function initRepo(slug: string): string {
  const repo = tmpRepo()
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 't@t.t')
  git(repo, 'config', 'user.name', 't')
  writeFileSync(join(repo, 'README.md'), 'hello\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'initial commit')
  git(repo, 'branch', `feature/${slug}`)
  return repo
}

/** Commit `file` on `branch`, leaving `main` checked out. */
export function commitOn(repo: string, branch: string, file: string, body: string, subject: string): void {
  git(repo, 'checkout', '-q', '-B', branch, branch)
  writeFileSync(join(repo, file), body)
  git(repo, 'add', file)
  git(repo, 'commit', '-q', '-m', subject)
  git(repo, 'checkout', '-q', 'main')
}
