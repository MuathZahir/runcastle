import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bunHookCommand, bunSpawn, NO_ENV_FILE, sdkExecutableArgs } from '../src/util/bun-launch'
import { dotenvFiles, dropDotenvVars, parseDotenv, parseEnviron, type DropDotenvDeps } from '../src/util/drop-dotenv'
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
    expect(parsed.get('SINGLE')?.expands).toBe(false)
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
    UNRELATED: 'kept',
  })

  it('with the start environment (Linux), removes exactly the keys the shell did not set', () => {
    const env = loaded()
    const removed = dropDotenvVars(deps(env, new Set(['SHELL_DIFF', 'SHELL_SAME', 'UNRELATED'])))
    expect(removed.sort()).toEqual(['ANTHROPIC_API_KEY', 'EXP', 'LATER'])
    expect(env).toEqual({ SHELL_DIFF: 'shell', SHELL_SAME: 'same', UNRELATED: 'kept' })
  })

  it('without it (macOS, Windows), removes keys whose value is the file value, keeping a different shell value', () => {
    const env = loaded()
    const removed = dropDotenvVars(deps(env, null))
    // SHELL_SAME is the accepted miss: a shell export equal to the .env value goes too.
    expect(removed.sort()).toEqual(['ANTHROPIC_API_KEY', 'EXP', 'LATER', 'SHELL_SAME'])
    expect(env).toEqual({ SHELL_DIFF: 'shell', UNRELATED: 'kept' })
  })

  it('lets a later file win a key, as Bun does', () => {
    const env = { LATER: 'env' }
    // `.env.local` says LATER=local, so the value `env` did not come from the files.
    expect(dropDotenvVars(deps(env, null))).toEqual([])
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
})

describe('the runcastle bin', () => {
  it('runs the .env drop before any other import', () => {
    const src = readFileSync(join(serverSrc, 'bin', 'runcastle.ts'), 'utf8')
    const firstImport = src.split('\n').find((line) => /^\s*import\b/.test(line))
    expect(firstImport?.trim()).toBe("import './no-dotenv'")
  })
})
