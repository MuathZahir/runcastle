import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bunHookCommand, bunSpawn, NO_ENV_FILE, sdkExecutableArgs } from '../src/util/bun-launch'
import { candidateDotenvFiles, dotenvFiles, dropDotenvVars, expandDotenv, parseDotenv, parseEnviron, type DropDotenvDeps } from '../src/util/drop-dotenv'
import { resolveBun } from './helpers/bun'
import { envWithoutAnthropicKey, makeDotenvFolder, runOut, SENTINEL_KEY, type DotenvFolder } from './helpers/dotenv-sentinel'

/**
 * sessions-never-pick-up-a-project-s-api-key: no runcastle Bun process reads a
 * project's `.env`, so an `ANTHROPIC_API_KEY` there never bills over the human's
 * subscription. The ACP launch specs are run for real in `launch-artifacts` and
 * `codex-acp-launch`; `bun-launch-guard` keeps new launches on the helper.
 */

const bun = resolveBun()
const serverSrc = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')

describe('parseDotenv', () => {
  it('reads plain, quoted, exported and commented lines the way Bun does', () => {
    const parsed = parseDotenv(
      [
        '# a comment',
        'PLAIN=one',
        'export EXPORTED=two',
        'SPACED = three  # trailing comment',
        'DOUBLE="four\\nlines"',
        "SINGLE='five $NOT'",
        'BACKTICK=`six`',
        'EXPANDS=${HOME}/x',
        'EMPTY=',
        '',
      ].join('\n'),
    )
    expect(Object.fromEntries([...parsed].map(([k, v]) => [k, v.value]))).toEqual({
      PLAIN: 'one',
      EXPORTED: 'two',
      SPACED: 'three',
      DOUBLE: 'four\nlines',
      SINGLE: 'five $NOT',
      BACKTICK: 'six',
      EXPANDS: '${HOME}/x',
      EMPTY: '',
    })
    expect(parsed.get('EXPANDS')?.expands).toBe(true)
    // Bun expands `$` inside single quotes too (checked on 1.4.4).
    expect(parsed.get('SINGLE')?.expands).toBe(true)
    expect(parsed.get('PLAIN')?.expands).toBe(false)
  })

  it('handles CRLF files', () => {
    expect(parseDotenv('A=1\r\nB="2"\r\n').get('A')?.value).toBe('1')
  })
})

describe('parseEnviron', () => {
  it('reads the keys of NUL-separated records', () => {
    expect([...parseEnviron('PATH=/bin\0HOME=/h\0EQ=a=b\0')]).toEqual(['PATH', 'HOME', 'EQ'])
  })
})

describe('dotenvFiles', () => {
  it('lists the files Bun reads, lowest precedence first', () => {
    expect(dotenvFiles(undefined)).toEqual(['.env', '.env.development', '.env.local', '.env.development.local'])
    expect(dotenvFiles('production')).toEqual(['.env', '.env.production', '.env.local', '.env.production.local'])
    expect(dotenvFiles('test')).toEqual(['.env', '.env.test'])
  })

  it('takes every mode as a candidate, since a .env may have changed NODE_ENV after Bun chose its files', () => {
    const files = candidateDotenvFiles(['production'])
    for (const f of ['.env', '.env.development', '.env.development.local', '.env.production', '.env.production.local', '.env.local', '.env.test']) {
      expect(files).toContain(f)
    }
    expect(candidateDotenvFiles(['staging'])).toContain('.env.staging.local')
    expect(new Set(files).size).toBe(files.length)
  })
})

describe('expandDotenv', () => {
  // Each case is what Bun 1.4.4 itself produced from the same .env text.
  const env = { HOME_X: 'hx', A: 'hx/a' }
  it.each([
    ['$HOME_X/a', 'hx/a'],
    ['${HOME_X}b', 'hxb'],
    ['q$HOME_X', 'qhx'],
    ['\\$HOME_X', '$HOME_X'],
    ['${HOME_X:-dflt}', 'hx'],
    ['${UNSET_Q:-dflt}', 'dflt'],
    ['$UNSET_Y.z', '.z'],
    ['$A-h', 'hx/a-h'],
    ['pre$', 'pre$'],
    ['pa$$word', 'pa$'],
    ['a$$', 'a$$'],
    ['${}z', 'z'],
    ['x$1y', 'x'],
    ['a $ b', 'a $ b'],
    ['${UNSET_Q-d2}', '${UNSET_Q-d2}'],
    ['${HOME_X:=z}', '${HOME_X:=z}'],
  ])('%s -> %s', (raw, expanded) => {
    expect(expandDotenv(raw, env)).toBe(expanded)
  })
})

describe('dropDotenvVars', () => {
  const files: Record<string, string> = {
    '/p/.env': 'ANTHROPIC_API_KEY=from-file\nSHELL_DIFF=file\nSHELL_SAME=same\nLATER=env\nEXP=$HOME/x\n',
    '/p/.env.local': 'LATER=local\n',
  }
  function deps(env: Record<string, string | undefined>, startKeys: Set<string> | null, execArgv: string[] = []): DropDotenvDeps {
    return { env, cwd: '/p', execArgv, startKeys: () => startKeys, readFile: (p) => files[p.replace(/\\/g, '/')] ?? null }
  }
  // What Bun leaves in process.env: the shell's SHELL_DIFF and SHELL_SAME win, the files fill the rest.
  const loaded = () => ({
    ANTHROPIC_API_KEY: 'from-file',
    SHELL_DIFF: 'shell',
    SHELL_SAME: 'same',
    LATER: 'local',
    EXP: '/home/x',
    HOME: '/home',
    UNRELATED: 'kept',
  })

  it('with the start environment (Linux), removes exactly the keys the shell did not set', () => {
    const env = loaded()
    const removed = dropDotenvVars(deps(env, new Set(['SHELL_DIFF', 'SHELL_SAME', 'HOME', 'UNRELATED'])))
    expect(removed.sort()).toEqual(['ANTHROPIC_API_KEY', 'EXP', 'LATER'])
    expect(env).toEqual({ SHELL_DIFF: 'shell', SHELL_SAME: 'same', HOME: '/home', UNRELATED: 'kept' })
  })

  it('without it (macOS, Windows), removes keys whose value is the file value, keeping a different shell value', () => {
    const env = loaded()
    const removed = dropDotenvVars(deps(env, null))
    // SHELL_SAME is the accepted miss: a shell export equal to the .env value goes too.
    expect(removed.sort()).toEqual(['ANTHROPIC_API_KEY', 'EXP', 'LATER', 'SHELL_SAME'])
    expect(env).toEqual({ SHELL_DIFF: 'shell', HOME: '/home', UNRELATED: 'kept' })
  })

  it('without it, keeps a shell value that no file gives the key', () => {
    const env = { LATER: 'shell', ANTHROPIC_API_KEY: 'shell-key' }
    expect(dropDotenvVars(deps(env, null))).toEqual([])
    expect(env).toEqual({ LATER: 'shell', ANTHROPIC_API_KEY: 'shell-key' })
  })

  it('without it, expands a $ value the way Bun does and keeps a shell export that differs', () => {
    const dollar: Record<string, string> = {
      '/p/.env': 'ANTHROPIC_API_KEY=${OTHER}\nDB_PASS=pa$$word\nREF=${BASE}/v1\n',
    }
    const run = (env: Record<string, string | undefined>) =>
      dropDotenvVars({ env, cwd: '/p', execArgv: [], startKeys: () => null, readFile: (p) => dollar[p.replace(/\\/g, '/')] ?? null })
    const shell: Record<string, string | undefined> = { ANTHROPIC_API_KEY: 'shell-key', DB_PASS: 'shellpass', BASE: 'https://x', REF: 'https://y/v1' }
    expect(run(shell)).toEqual([])
    expect(shell).toEqual({ ANTHROPIC_API_KEY: 'shell-key', DB_PASS: 'shellpass', BASE: 'https://x', REF: 'https://y/v1' })
    // What Bun loads when the shell set none of them: `pa$$word` is `pa$` and `${OTHER}` is empty.
    const fromFile: Record<string, string | undefined> = { ANTHROPIC_API_KEY: '', DB_PASS: 'pa$', BASE: 'https://x', REF: 'https://x/v1' }
    expect(run(fromFile).sort()).toEqual(['ANTHROPIC_API_KEY', 'DB_PASS', 'REF'])
    expect(fromFile).toEqual({ BASE: 'https://x' })
  })

  it('checks the files of every mode, so a .env that sets NODE_ENV cannot hide .env.development', () => {
    const modes: Record<string, string> = { '/p/.env': 'NODE_ENV=production\n', '/p/.env.development': 'ANTHROPIC_API_KEY=from-dev\n' }
    const env: Record<string, string | undefined> = { NODE_ENV: 'production', ANTHROPIC_API_KEY: 'from-dev' }
    const removed = dropDotenvVars({ env, cwd: '/p', execArgv: [], startKeys: () => new Set(), readFile: (p) => modes[p.replace(/\\/g, '/')] ?? null })
    expect(removed.sort()).toEqual(['ANTHROPIC_API_KEY', 'NODE_ENV'])
  })

  it('does nothing when Bun already ran with --no-env-file', () => {
    const env = loaded()
    expect(dropDotenvVars(deps(env, new Set(), [NO_ENV_FILE]))).toEqual([])
    expect(env.ANTHROPIC_API_KEY).toBe('from-file')
  })
})

describe('the shared Bun launch helper', () => {
  it('puts --no-env-file first on every direct spawn', () => {
    expect(bunSpawn(['x.js', 'y'])).toEqual({ command: process.execPath, args: [NO_ENV_FILE, 'x.js', 'y'] })
  })

  it('gives the SDK --no-env-file only for a JavaScript CLI under Bun', () => {
    expect(sdkExecutableArgs('/x/cli.js', true)).toEqual({ executableArgs: [NO_ENV_FILE] })
    expect(sdkExecutableArgs('/x/cli.mjs', true)).toEqual({ executableArgs: [NO_ENV_FILE] })
    expect(sdkExecutableArgs('/usr/bin/claude', true)).toEqual({})
    expect(sdkExecutableArgs('C:\\x\\claude.exe', true)).toEqual({})
    expect(sdkExecutableArgs('/x/cli.js', false)).toEqual({})
  })
})

describe.skipIf(!bun)('real Bun from a folder whose .env holds an Anthropic key', () => {
  let folder: DotenvFolder
  beforeEach(() => {
    folder = makeDotenvFolder()
  })
  afterEach(() => folder.cleanup())

  it('control: plain Bun does load it, so the tests below would catch a leak', () => {
    const out = runOut(bun!, ['run', folder.fixture], { cwd: folder.dir, env: envWithoutAnthropicKey() })
    expect(out).toBe(`KEY=${SENTINEL_KEY}`)
  })

  it('a bunSpawn launch does not', () => {
    const out = runOut(bun!, bunSpawn([folder.fixture]).args, { cwd: folder.dir, env: envWithoutAnthropicKey() })
    expect(out).toBe('KEY=<unset>')
  })

  it('the hook command a session runs through its shell does not', () => {
    const env = envWithoutAnthropicKey()
    env.PATH = `${dirname(bun!)}${delimiter}${env.PATH ?? ''}`
    const r = spawnSync(bunHookCommand(folder.fixture, 'stop'), { shell: true, cwd: folder.dir, env, encoding: 'utf8', timeout: 30_000 })
    expect(r.stderr).toBe('')
    expect(r.stdout).toBe('KEY=<unset>')
  })

  it('the server boot drops what Bun loaded, keeps what the shell set, and names only the dropped keys', () => {
    writeFileSync(join(folder.dir, '.env'), `ANTHROPIC_API_KEY=${SENTINEL_KEY}\nSHELL_DIFF=file\nFILE_ONLY=x\n`)
    const probe = join(folder.dir, 'boot-probe.ts')
    const noDotenv = JSON.stringify(join(serverSrc, 'bin', 'no-dotenv.ts'))
    writeFileSync(
      probe,
      `import ${noDotenv}\n` +
        "const pick = (k: string) => process.env[k] ?? '<unset>'\n" +
        "process.stdout.write(JSON.stringify(Object.fromEntries(['ANTHROPIC_API_KEY', 'SHELL_DIFF', 'FILE_ONLY', 'SHELL_ONLY'].map((k) => [k, pick(k)]))))\n",
    )
    const env = { ...envWithoutAnthropicKey(), SHELL_DIFF: 'shell', SHELL_ONLY: 'kept' }
    const r = spawnSync(bun!, ['run', probe], { cwd: folder.dir, env, encoding: 'utf8', timeout: 30_000 })
    expect(r.status, r.stderr).toBe(0)
    expect(JSON.parse(r.stdout)).toEqual({ ANTHROPIC_API_KEY: '<unset>', SHELL_DIFF: 'shell', FILE_ONLY: '<unset>', SHELL_ONLY: 'kept' })
    expect(r.stderr).toMatch(/ignoring 2 variable\(s\).*ANTHROPIC_API_KEY, FILE_ONLY/)
    expect(r.stderr).not.toContain(SENTINEL_KEY)
  })

  it('the server boot also drops a key in .env.development when the .env sets NODE_ENV', () => {
    writeFileSync(join(folder.dir, '.env'), 'NODE_ENV=production\n')
    writeFileSync(join(folder.dir, '.env.development'), `ANTHROPIC_API_KEY=${SENTINEL_KEY}\n`)
    const probe = join(folder.dir, 'boot-probe.ts')
    writeFileSync(
      probe,
      `import ${JSON.stringify(join(serverSrc, 'bin', 'no-dotenv.ts'))}\n` +
        "process.stdout.write(process.env.ANTHROPIC_API_KEY ?? '<unset>')\n",
    )
    const env = envWithoutAnthropicKey()
    delete env.NODE_ENV
    const control = runOut(bun!, ['-e', "process.stdout.write(process.env.ANTHROPIC_API_KEY ?? '<unset>')"], { cwd: folder.dir, env })
    expect(control).toBe(SENTINEL_KEY)
    const r = spawnSync(bun!, ['run', probe], { cwd: folder.dir, env, encoding: 'utf8', timeout: 30_000 })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toBe('<unset>')
  })
})

describe('the runcastle bin', () => {
  it('runs the .env drop before any other import', () => {
    const src = readFileSync(join(serverSrc, 'bin', 'runcastle.ts'), 'utf8')
    const firstImport = src.split('\n').find((line) => /^\s*import\b/.test(line))
    expect(firstImport?.trim()).toBe("import './no-dotenv'")
  })
})
