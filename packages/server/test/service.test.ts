import { describe, expect, it } from 'vitest'
import { SERVICE_USAGE, runService, type ServiceDeps } from '../src/bin/service'
import { renderServiceFile, servicePath } from '../src/services/service-file'

describe('renderServiceFile', () => {
  const text = renderServiceFile({
    user: 'ada',
    home: '/home/ada',
    runcastleBin: '/home/ada/.bun/bin/runcastle',
    path: servicePath('/usr/bin:relative/bin:/usr/bin', '/home/ada'),
  })

  it('runs as the user with an absolute ExecStart and a PATH holding Bun and ~/.local/bin', () => {
    expect(text).toContain('User=ada\n')
    expect(text).toContain('ExecStart=/home/ada/.bun/bin/runcastle serve\n')
    expect(text).toContain('Environment=PATH=/usr/bin:/home/ada/.bun/bin:/home/ada/.local/bin:/usr/local/bin:/bin\n')
  })

  it('orders after docker without requiring it', () => {
    expect(text).toMatch(/^After=.*docker\.service/m)
    expect(text).not.toContain('Requires=docker.service')
    expect(text).not.toContain('SupplementaryGroups')
  })
})

function harness(over: ServiceDeps = {}) {
  const lines: string[] = []
  const steps: string[] = []
  const deps: ServiceDeps = {
    log: (l) => lines.push(l),
    platform: 'linux',
    systemdPresent: true,
    runningAsRoot: false,
    user: 'ada',
    home: '/home/ada',
    host: 'box',
    processPath: '/usr/bin',
    runcastleBin: '/home/ada/.bun/bin/runcastle',
    serviceFileExists: false,
    writeTemp: () => '/tmp/unit',
    runStep: (command, args) => {
      steps.push([command, ...args].join(' '))
      return 0
    },
    ...over,
  }
  return { lines, steps, deps }
}

describe('runcastle service', () => {
  it('installs with sudo steps in order and says how to reach it', async () => {
    const h = harness()
    expect(await runService(['install'], h.deps)).toBe(0)
    expect(h.steps).toEqual([
      'sudo install -m 644 /tmp/unit /etc/systemd/system/runcastle.service',
      'sudo systemctl daemon-reload',
      'sudo systemctl enable runcastle',
      'sudo systemctl restart runcastle',
    ])
    expect(h.lines.join('\n')).toContain('ssh -L 4512:localhost:4512 ada@box')
  })

  it('reports an existing file as replaced', async () => {
    const h = harness({ serviceFileExists: true })
    await runService(['install'], h.deps)
    expect(h.lines.join('\n')).toContain('Replaced')
  })

  it.each([
    ['macOS', { platform: 'darwin' as const }],
    ['Windows', { platform: 'win32' as const }],
    ['no systemd', { systemdPresent: false }],
    ['root', { runningAsRoot: true }],
  ])('runs nothing on %s', async (_name, over) => {
    const h = harness(over)
    expect(await runService(['install'], h.deps)).toBe(1)
    expect(h.steps).toEqual([])
    expect(h.lines.length).toBeGreaterThan(0)
  })

  it('removes the service, and is a no-op with no service file', async () => {
    const h = harness({ serviceFileExists: true })
    expect(await runService(['remove'], h.deps)).toBe(0)
    expect(h.steps).toEqual([
      'sudo systemctl disable --now runcastle',
      'sudo rm -f /etc/systemd/system/runcastle.service',
      'sudo systemctl daemon-reload',
    ])

    const none = harness()
    expect(await runService(['remove'], none.deps)).toBe(0)
    expect(none.steps).toEqual([])
  })

  it('prints usage for any other argument', async () => {
    const h = harness()
    expect(await runService(['start'], h.deps)).toBe(1)
    expect(h.lines).toEqual([SERVICE_USAGE])
  })
})
