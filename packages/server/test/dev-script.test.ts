import { spawn } from 'node:child_process'
import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEV_FILTERS, devArgs, devEnv, devSpawnOptions, killTree } from '../../../scripts/dev'

describe('root dev launcher', () => {
  it('starts BOTH the server and web packages', () => {
    // The bug (POSIX-VERIFICATION.md §2): a single `bun run --filter A --filter B`
    // blocks on the server's `bun --hot` and web never starts on POSIX. The fix
    // spawns each package as its own concurrent process — so both must be listed.
    expect(DEV_FILTERS).toContain('@runcastle/server')
    expect(DEV_FILTERS).toContain('@runcastle/web')
  })

  it('runs each package via its own single-filter dev command', () => {
    expect(devArgs('@runcastle/web')).toEqual(['run', '--filter', '@runcastle/web', 'dev'])
  })

  it('points dev at its own data dir, never a real install', () => {
    // Without this, `bun run dev` shares ~/.runcastle with an installed
    // runcastle, and every destructive test hits the developer's real projects.
    const env = devEnv({})
    expect(env.RUNCASTLE_DATA_DIR).toBe(join(homedir(), '.runcastle-dev'))
    expect(env.RUNCASTLE_DATA_DIR).not.toBe(join(homedir(), '.runcastle'))
    expect(env.RUNCASTLE_DEV).toBe('1')
  })

  it('keeps an explicitly-set data dir, and preserves the rest of the env', () => {
    const env = devEnv({ RUNCASTLE_DATA_DIR: '/tmp/scratch', PATH: '/usr/bin' })
    expect(env.RUNCASTLE_DATA_DIR).toBe('/tmp/scratch')
    expect(env.PATH).toBe('/usr/bin')
  })

  // The dev server binding the port is a GRANDCHILD (`bun run --filter … dev`),
  // and on POSIX only a group signal reaches it — which needs the child to lead
  // a group of its own. On Windows `detached` would open a console window and
  // buys nothing: `taskkill /T` walks the child list.
  it('gives each dev child its own process group to kill, off Windows', () => {
    expect(devSpawnOptions({}).detached).toBe(process.platform !== 'win32')
    expect(devSpawnOptions({}).stdio).toBe('inherit')
  })
})

/**
 * The script's own copy of the shared tree-kill (the server package's version is
 * not importable from a repo-root script). POSIX only — the Windows `taskkill /T`
 * half of the same shape is covered per backend in dev-pane.test.ts. The stand-in
 * for a dev server is a grandchild appending to a file: once killed, the file
 * must stop growing.
 */
describe('killTree', () => {
  it('kills the grandchild, which is what actually holds the port', async () => {
    if (process.platform === 'win32') return
    const dir = mkdtempSync(join(tmpdir(), 'rc-devkill-'))
    const log = join(dir, 'tick.log')
    writeFileSync(
      join(dir, 'ticker.mjs'),
      `import { appendFileSync } from 'node:fs'\nsetInterval(() => appendFileSync(${JSON.stringify(log)}, 'x'), 50)\n`,
    )

    // `& wait` keeps `sh` from exec-replacing itself with the ticker, so the
    // ticker is a real grandchild — the process a direct-child kill leaves alive.
    const child = spawn('sh', ['-c', `"${process.execPath}" ticker.mjs & wait`], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
    })
    await new Promise((r) => setTimeout(r, 600))
    expect(statSync(log).size).toBeGreaterThan(0)

    await killTree(child.pid!)
    await new Promise((r) => setTimeout(r, 200))
    const ticksAtKill = statSync(log).size
    await new Promise((r) => setTimeout(r, 600))
    expect(statSync(log).size, 'the grandchild outlived the tree kill').toBe(ticksAtKill)
  }, 20_000)
})
