import { describe, expect, it } from 'vitest'
import type { DoctorReport, ProbeResult, ProbeStatus } from '../src/doctor/doctor'
import {
  buildInstallPlan,
  DOCKER_GROUP_WARNING,
  DOCKER_SCRIPT_DISTROS,
  type MachineFacts,
} from '../src/setup/plan'

function probe(id: string, status: ProbeStatus, detail = '', fix?: string): ProbeResult {
  return { id, label: id, tier: 1, status, severity: 'error', detail, ...(fix ? { fix } : {}) }
}

/** A report where every row named is as given and everything else is absent. */
function report(...results: ProbeResult[]): DoctorReport {
  return { results, ok: false, tier1Ok: false }
}

const NODE_SCRIPT = 'claude is a Node script (an npm or bun install), and this machine has no Node'

/** A clean VPS: Bun and runcastle only (the install script put them there). */
const freshMachine = () =>
  report(
    probe('bun', 'ok', '1.4.2'),
    probe('git', 'missing', 'git not found on PATH'),
    probe('claude', 'missing', 'claude not found on PATH'),
    probe('claude-auth', 'missing'),
    probe('afk-token', 'unset'),
    probe('codex', 'missing', 'codex not found on PATH'),
    probe('codex-auth', 'missing'),
    probe('container-runtime', 'missing'),
  )

const ubuntuVps: MachineFacts = {
  platform: 'linux',
  distroId: 'ubuntu',
  packageManagers: ['apt-get'],
  hasDesktop: false,
  serviceFileExists: false,
  user: 'ada',
}

const mac: MachineFacts = {
  platform: 'darwin',
  distroId: null,
  packageManagers: ['brew'],
  hasDesktop: true,
  serviceFileExists: false,
  user: 'ada',
}

const windows: MachineFacts = { ...mac, platform: 'win32', packageManagers: ['winget'] }

const labels = (plan: { install: { label: string }[] }) => plan.install.map((i) => i.label)

describe('buildInstallPlan', () => {
  it('lists everything a fresh Ubuntu VPS lacks, with sudo where it is needed', () => {
    const plan = buildInstallPlan(freshMachine(), ubuntuVps, 'claude')

    expect(plan.present).toEqual(['Bun 1.4.2', 'runcastle'])
    expect(plan.install.map((i) => [i.label, i.needsSudo])).toEqual([
      ['Git', true],
      ['Claude Code', false],
      ['Docker Engine', true],
    ])
    expect(plan.install[0].commands).toEqual([
      { file: 'sudo', args: ['apt-get', 'update'] },
      { file: 'sudo', args: ['apt-get', 'install', '-y', 'git'] },
    ])
    expect(plan.install[1].commands).toEqual([
      { file: 'sh', args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'] },
    ])
    expect(plan.afterwards).toEqual([
      'Log out and back in, so the docker group applies',
      'Sign in: claude auth login',
      'For unattended rounds: runcastle token',
      'To keep it running: runcastle service install',
    ])
    expect(plan.needsAgentChoice).toBe(false)
  })

  it('sends a Mac to Docker Desktop and installs nothing it already has', () => {
    const plan = buildInstallPlan(
      report(
        probe('bun', 'ok', '1.4.2'),
        probe('git', 'ok', 'git version 2.47.1'),
        probe('claude', 'missing'),
        probe('codex', 'ok', 'codex-cli 0.170.0'),
        probe('codex-auth', 'ok'),
        probe('codex-adapter-version', 'ok', 'Codex 0.170.0 (the chat adapter needs 0.164.0 or newer)'),
        probe('container-runtime', 'missing'),
      ),
      mac,
      null,
    )

    expect(plan.present).toEqual(['Bun 1.4.2', 'runcastle', 'Git 2.47.1', 'Codex 0.170.0'])
    expect(plan.install).toEqual([])
    expect(plan.afterwards).toEqual(['Install Docker Desktop: https://docs.docker.com/desktop/'])
    expect(plan.needsAgentChoice).toBe(false)
  })

  it('a Mac without Homebrew gets Apple’s own Git dialog as a step to take', () => {
    const plan = buildInstallPlan(freshMachine(), { ...mac, packageManagers: [] }, 'claude')

    expect(labels(plan)).toEqual(['Claude Code'])
    expect(plan.afterwards[0]).toBe('Install Git: xcode-select --install')
  })

  it('installs on Windows with winget and the PowerShell installers, then asks for a new terminal', () => {
    const plan = buildInstallPlan(freshMachine(), windows, 'codex')

    expect(labels(plan)).toEqual(['Git (with winget)', 'Codex'])
    expect(plan.install.every((i) => !i.needsSudo)).toBe(true)
    expect(plan.install[0].commands[0].file).toBe('winget')
    expect(plan.install[1].commands).toEqual([
      {
        file: 'powershell',
        args: ['-ExecutionPolicy', 'ByPass', '-c', 'irm https://chatgpt.com/codex/install.ps1 | iex'],
      },
    ])
    expect(plan.afterwards).toEqual([
      'Open a new terminal',
      'Install Docker Desktop: https://docs.docker.com/desktop/',
      'Sign in: codex login',
    ])
  })

  it('a Windows machine without winget gets a Git link instead', () => {
    const plan = buildInstallPlan(freshMachine(), { ...windows, packageManagers: [] }, 'claude')

    expect(labels(plan)).toEqual(['Claude Code'])
    expect(plan.afterwards).toContain('Install Git: https://git-scm.com/download/win')
  })

  it('Arch Linux installs Git with pacman and leaves Docker as a link', () => {
    const plan = buildInstallPlan(
      freshMachine(),
      { ...ubuntuVps, distroId: 'arch', packageManagers: ['pacman'], hasDesktop: true },
      'claude',
    )

    expect(labels(plan)).toEqual(['Git', 'Claude Code'])
    expect(plan.install[0].commands).toEqual([{ file: 'sudo', args: ['pacman', '-S', '--noconfirm', 'git'] }])
    expect(plan.afterwards).toEqual([
      'Open a new terminal',
      'Install Docker: https://docs.docker.com/get-docker/',
      'Sign in: claude auth login',
      'For unattended rounds: runcastle token',
    ])
  })

  it('says to open a new terminal when the script added Bun to PATH, unless logging out covers it', () => {
    const present = report(
      probe('bun', 'ok', '1.4.2'),
      probe('git', 'ok', 'git version 2.47.0'),
      probe('codex', 'ok', '0.61.0'),
      probe('codex-auth', 'ok'),
      probe('container-runtime', 'ok', 'Docker version 28.5.2'),
    )
    expect(buildInstallPlan(present, { ...mac, pathChanged: true }, null).afterwards).toContain('Open a new terminal')
    expect(buildInstallPlan(present, mac, null).afterwards).not.toContain('Open a new terminal')
    const vps = buildInstallPlan(freshMachine(), { ...ubuntuVps, pathChanged: true }, 'claude').afterwards
    expect(vps).toContain('Log out and back in, so the docker group applies')
    expect(vps).not.toContain('Open a new terminal')
  })

  it('a second run lists only what is still missing', () => {
    const plan = buildInstallPlan(
      report(
        probe('bun', 'ok', '1.4.2'),
        probe('git', 'ok', 'git version 2.43.0'),
        probe('claude', 'ok', '2.4.1 (Claude Code)'),
        probe('claude-auth', 'ok'),
        probe('afk-token', 'ok'),
        probe('codex', 'missing'),
        probe('container-runtime', 'missing'),
      ),
      { ...ubuntuVps, serviceFileExists: true },
      null,
    )

    expect(plan.present).toEqual(['Bun 1.4.2', 'runcastle', 'Git 2.43.0', 'Claude Code 2.4.1'])
    expect(labels(plan)).toEqual(['Docker Engine'])
    expect(plan.afterwards).toEqual(['Log out and back in, so the docker group applies'])
  })

  it('a machine with everything has nothing to install', () => {
    const plan = buildInstallPlan(
      report(
        probe('bun', 'ok', '1.4.2'),
        probe('git', 'ok', 'git version 2.43.0'),
        probe('claude', 'ok', '2.4.1 (Claude Code)'),
        probe('claude-auth', 'ok'),
        probe('afk-token', 'ok'),
        probe('container-runtime', 'ok', 'Docker version 27.3.1, build ce12230'),
      ),
      { ...ubuntuVps, hasDesktop: true },
      null,
    )

    expect(plan.install).toEqual([])
    expect(plan.afterwards).toEqual([])
    expect(plan.present).toContain('Docker 27.3.1')
  })
})

describe('Docker', () => {
  const dockerItem = (facts: MachineFacts) =>
    buildInstallPlan(freshMachine(), facts, 'claude').install.find((i) => i.label === 'Docker Engine')

  it.each(DOCKER_SCRIPT_DISTROS)('installs automatically on %s, with sudo and the root warning', (distroId) => {
    const item = dockerItem({ ...ubuntuVps, distroId })

    expect(item?.needsSudo).toBe(true)
    expect(item?.warning).toBe(DOCKER_GROUP_WARNING)
    expect(item?.commands).toEqual([
      { file: 'sh', args: ['-c', 'curl -fsSL https://get.docker.com | sudo sh'] },
      { file: 'sudo', args: ['usermod', '-aG', 'docker', 'ada'] },
    ])
  })

  it('names exactly the eight systems Docker’s script covers', () => {
    expect([...DOCKER_SCRIPT_DISTROS].sort()).toEqual(
      ['centos', 'debian', 'fedora', 'raspbian', 'rhel', 'rocky', 'sles', 'ubuntu'],
    )
  })

  it.each(['arch', 'alpine', 'opensuse-tumbleweed', 'linuxmint', null])('is only a link on %s', (distroId) => {
    expect(dockerItem({ ...ubuntuVps, distroId })).toBeUndefined()
  })

  it.each(['Docker version 27.3.1', 'podman version 5.2.0'])('a working runtime (%s) adds no item', (detail) => {
    const base = freshMachine()
    const results = base.results.map((r) => (r.id === 'container-runtime' ? probe(r.id, 'ok', detail) : r))
    const plan = buildInstallPlan(report(...results), ubuntuVps, 'claude')

    expect(labels(plan)).not.toContain('Docker Engine')
    expect(plan.afterwards.some((a) => /docker/i.test(a))).toBe(false)
  })

  it('a dead daemon is a step to take, with the doctor’s own fix', () => {
    const fix = 'Start Docker Desktop (or `sudo systemctl start docker` on Linux), then re-run doctor.'
    const results = freshMachine().results.map((r) =>
      r.id === 'container-runtime' ? probe(r.id, 'daemon-dead', '', fix) : r,
    )
    const plan = buildInstallPlan(report(...results), ubuntuVps, 'claude')

    expect(labels(plan)).not.toContain('Docker Engine')
    expect(plan.afterwards).toContain(fix)
  })
})

describe('agents', () => {
  it('asks which agent when neither is installed and no choice was given', () => {
    const plan = buildInstallPlan(freshMachine(), ubuntuVps, null)

    expect(plan.needsAgentChoice).toBe(true)
    expect(labels(plan)).toEqual(['Git', 'Docker Engine'])
  })

  it('installs both when asked for both', () => {
    expect(labels(buildInstallPlan(freshMachine(), ubuntuVps, 'both'))).toEqual(['Git', 'Claude Code', 'Codex', 'Docker Engine'])
  })

  it('adds no agent when one is already installed, whatever the choice', () => {
    const results = freshMachine().results.map((r) => (r.id === 'codex' ? probe('codex', 'ok', 'codex-cli 0.170.0') : r))
    const plan = buildInstallPlan(report(...results), ubuntuVps, 'claude')

    expect(plan.needsAgentChoice).toBe(false)
    expect(labels(plan)).toEqual(['Git', 'Docker Engine'])
    expect(plan.present).toContain('Codex 0.170.0')
  })

  it('reinstalls a CLI that is a Node script on a machine with no Node, and asks nothing', () => {
    const results = freshMachine().results.map((r) => (r.id === 'claude' ? probe('claude', 'missing', NODE_SCRIPT) : r))
    const plan = buildInstallPlan(report(...results), ubuntuVps, null)

    expect(plan.needsAgentChoice).toBe(false)
    expect(labels(plan)).toContain('Claude Code (reinstall without Node)')
  })
})

describe('too old counts as missing (decision 8)', () => {
  it('lists stale agent CLIs as updates from one version to the other', () => {
    const plan = buildInstallPlan(
      report(
        probe('bun', 'ok', '1.4.2'),
        probe('git', 'ok', 'git version 2.43.0'),
        probe('claude', 'ok', '2.0.1 (Claude Code)'),
        probe('claude-auth', 'ok'),
        probe('afk-token', 'ok'),
        probe('claude-adapter-version', 'stale', 'Claude Code 2.0.1 is older than 2.1.4, which the chat adapter needs'),
        probe('codex', 'ok', 'codex-cli 0.150.0'),
        probe('codex-auth', 'ok'),
        probe('codex-adapter-version', 'stale', 'Codex 0.150.0 is older than 0.164.0, which the chat adapter needs'),
        probe('container-runtime', 'ok', 'Docker version 27.3.1'),
      ),
      { ...ubuntuVps, serviceFileExists: true },
      null,
    )

    expect(labels(plan)).toEqual(['Claude Code 2.0.1 → 2.1.4', 'Codex 0.150.0 → 0.164.0'])
    expect(plan.install[0].commands).toEqual([{ file: 'claude', args: ['update'] }])
    expect(plan.install[1].commands).toEqual([
      { file: 'sh', args: ['-c', 'curl -fsSL https://chatgpt.com/codex/install.sh | sh'] },
    ])
  })

  it('lists a Bun below 1.3.14 as an upgrade', () => {
    const results = freshMachine().results.map((r) => (r.id === 'bun' ? probe('bun', 'ok', '1.3.2') : r))
    const plan = buildInstallPlan(report(...results), ubuntuVps, 'claude')

    expect(plan.install[0]).toMatchObject({ label: 'Bun 1.3.2 → 1.3.14', commands: [{ file: 'bun', args: ['upgrade'] }] })
    expect(plan.present).toEqual(['runcastle'])
  })

  it('leaves alone a tool that is new enough but behind the latest', () => {
    const plan = buildInstallPlan(
      report(
        probe('bun', 'ok', '1.3.14'),
        probe('git', 'ok', 'git version 2.30.0'),
        probe('claude', 'ok', '2.1.4 (Claude Code)'),
        probe('claude-auth', 'ok'),
        probe('afk-token', 'ok'),
        probe('claude-adapter-version', 'ok', 'Claude Code 2.1.4 (the chat adapter needs 2.1.4 or newer)'),
        probe('container-runtime', 'ok', 'Docker version 20.10.0'),
      ),
      { ...ubuntuVps, hasDesktop: true },
      null,
    )

    expect(plan.install).toEqual([])
    expect(plan.present).toEqual(['Bun 1.3.14', 'runcastle', 'Git 2.30.0', 'Claude Code 2.1.4', 'Docker 20.10.0'])
  })
})
