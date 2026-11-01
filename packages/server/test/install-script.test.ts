import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const bash = ['/bin/bash', '/usr/bin/bash'].find((p) => existsSync(p)) ?? 'bash'
const script = resolve(dirname(fileURLToPath(import.meta.url)), '../../../site/install.sh')

describe.skipIf(process.platform === 'win32')('site/install.sh', () => {
  let root: string
  let stubs: string
  let home: string
  let log: string

  /** A stand-in command that appends "<name> <args>" to the log, then runs `body`. */
  const stub = (dir: string, name: string, body = ''): void => {
    const file = join(dir, name)
    writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\nexit 0\n`)
    chmodSync(file, 0o755)
  }

  /** What `curl https://bun.sh/install | bash` would do: put a bun at the given version in ~/.bun/bin. */
  const bunInstaller = (version: string): string =>
    `cat <<'EOS'
mkdir -p "$HOME/.bun/bin"
printf '#!/bin/sh\\n[ "$1" = --version ] && echo ${version}\\n' > "$HOME/.bun/bin/bun"
chmod +x "$HOME/.bun/bin/bun"
EOS`

  /** A PATH of the stubs plus the few system tools the script needs, so no real unzip is found. */
  const withoutUnzip = (): string => {
    const tools = join(root, 'tools')
    mkdirSync(tools)
    for (const name of ['bash', 'mkdir', 'chmod', 'cat', 'dirname']) {
      const found = ['/usr/bin', '/bin'].map((d) => join(d, name)).find((p) => existsSync(p))
      if (found) symlinkSync(found, join(tools, name))
    }
    return `${stubs}:${tools}`
  }

  const calls = ():string[] => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [])

  const run = (args: string[] = [], env: Record<string, string> = {}) =>
    spawnSync(bash, [script, ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      // No controlling terminal here, so /dev/tty cannot be opened unless a test says otherwise.
      env: { PATH: `${stubs}:/usr/bin:/bin`, HOME: home, ...env },
    })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'install-script-'))
    stubs = join(root, 'stubs')
    home = join(root, 'home')
    log = join(root, 'calls.log')
    mkdirSync(stubs)
    mkdirSync(home)
    stub(stubs, 'id', 'echo 1000')
    stub(stubs, 'unzip')
    stub(stubs, 'uname', 'echo Linux')
    stub(stubs, 'sudo', 'exec "$@"')
    stub(stubs, 'apt-get')
    // A current runcastle whose help knows `setup`.
    stub(stubs, 'runcastle', '[ "$1" = --help ] && echo "setup  install the rest"')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('stops as root, explains, and runs nothing', () => {
    stub(stubs, 'id', 'echo 0')
    stub(stubs, 'curl')
    const r = run(['--yes'])
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('sudo adduser')
    expect(r.stderr).toContain('sudo usermod -aG sudo')
    expect(calls()).toEqual(['id -u'])
  })

  it('hands straight over to setup, with its arguments, when Bun and runcastle are current', () => {
    stub(stubs, 'bun', 'echo 1.3.14')
    stub(stubs, 'curl')
    const r = run(['--yes', '--agent', 'codex'])
    expect(r.status).toBe(0)
    expect(calls().filter((c) => !c.startsWith('id') && !c.startsWith('bun --version'))).toEqual([
      'runcastle --help',
      'runcastle setup --yes --agent codex',
    ])
  })

  it('exits with the code setup exits with', () => {
    stub(stubs, 'bun', 'echo 2.0.0')
    stub(stubs, 'runcastle', '[ "$1" = --help ] && echo setup\n[ "$1" = setup ] && exit 7\nexit 0')
    expect(run().status).toBe(7)
  })

  it('installs Bun when it is missing, then hands over', () => {
    stub(stubs, 'curl', bunInstaller('1.3.20'))
    const r = run(['--yes'])
    expect(r.status).toBe(0)
    expect(calls()).toContain('curl -fsSL https://bun.sh/install')
    expect(calls()).toContain('runcastle setup --yes')
    expect(existsSync(join(home, '.bun', 'bin', 'bun'))).toBe(true)
  })

  it('installs unzip first, through sudo, when Bun is missing and unzip is not there', () => {
    rmSync(join(stubs, 'unzip'))
    stub(stubs, 'curl', bunInstaller('1.3.20'))
    const r = run(['--yes'], { PATH: withoutUnzip() })
    expect(r.status).toBe(0)
    const seen = calls()
    expect(seen).toContain('apt-get install -y unzip')
    expect(seen.indexOf('apt-get install -y unzip')).toBeLessThan(seen.indexOf('curl -fsSL https://bun.sh/install'))
  })

  it('with no terminal and no --yes, prints the unzip command and exits 1 without installing', () => {
    rmSync(join(stubs, 'unzip'))
    stub(stubs, 'curl')
    const r = run([], { PATH: withoutUnzip() })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('sudo apt-get')
    expect(calls().some((c) => c.startsWith('curl') || c.startsWith('apt-get'))).toBe(false)
  })

  it('upgrades a Bun older than 1.3.14 (compared numerically) when told yes', () => {
    stub(stubs, 'bun', '[ "$1" = --version ] && echo 1.3.9')
    stub(stubs, 'curl')
    const r = run(['--yes'])
    expect(r.status).toBe(0)
    expect(calls()).toContain('bun upgrade')
  })

  it('does not upgrade a Bun of 1.10.0, which is newer than 1.3.14', () => {
    stub(stubs, 'bun', '[ "$1" = --version ] && echo 1.10.0')
    stub(stubs, 'curl')
    run(['--yes'])
    expect(calls()).not.toContain('bun upgrade')
  })

  it('with an old Bun, no terminal and no --yes, stops without upgrading', () => {
    stub(stubs, 'bun', '[ "$1" = --version ] && echo 1.2.0')
    stub(stubs, 'curl')
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('bun upgrade')
    expect(calls()).not.toContain('bun upgrade')
    expect(calls().some((c) => c.startsWith('runcastle setup'))).toBe(false)
  })

  it('installs runcastle from RUNCASTLE_INSTALL_SPEC when its help lacks setup', () => {
    stub(stubs, 'bun', '[ "$1" = --version ] && echo 1.3.20')
    stub(stubs, 'curl')
    stub(stubs, 'runcastle', '[ "$1" = --help ] && echo "doctor  check the machine"')
    const r = run(['--yes'], { RUNCASTLE_INSTALL_SPEC: '/tmp/runcastle.tgz' })
    expect(r.status).toBe(0)
    expect(calls()).toContain('bun add -g /tmp/runcastle.tgz')
    expect(calls()).toContain('runcastle setup --yes')
  })
})
