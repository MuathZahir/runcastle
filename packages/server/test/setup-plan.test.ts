import { describe, expect, it } from 'vitest'
import type { DoctorReport, ProbeResult, ProbeStatus } from '../src/doctor/doctor'
import {
  buildInstallPlan,
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
    probe('codex', 'missing', 'codex not found on PATH'),
    probe('codex-auth', 'missing'),
  )

const ubuntuVps: MachineFacts = {
  platform: 'linux',
  packageManagers: ['apt-get'],
  hasDesktop: false,
  serviceFileExists: false,
}

const mac: MachineFacts = {
  platform: 'darwin',
  packageManagers: ['brew'],
  hasDesktop: true,
  serviceFileExists: false,
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
    ])
    expect(plan.install[0].commands).toEqual([
      { file: 'sudo', args: ['apt-get', 'update'] },
      { file: 'sudo', args: ['apt-get', 'install', '-y', 'git'] },
    ])
    expect(plan.install[1].commands).toEqual([
      { file: 'sh', args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'] },
    ])
    expect(plan.afterwards).toEqual([
      'Open a new terminal',
      'Sign in: claude auth login',
      'To keep it running: runcastle service install',
    ])
    expect(plan.needsAgentChoice).toBe(false)
  })

  it('installs nothing a Mac already has', () => {
    const plan = buildInstallPlan(
      report(
        probe('bun', 'ok', '1.4.2'),
        probe('git', 'ok', 'git version 2.47.1'),
        probe('claude', 'missing'),
        probe('codex', 'ok', 'codex-cli 0.170.0'),
        probe('codex-auth', 'ok'),
        probe('codex-adapter-version', 'ok', 'Codex 0.170.0 (the chat adapter needs 0.164.0 or newer)'),
      ),
      mac,
      null,
    )

    expect(plan.present).toEqual(['Bun 1.4.2', 'runcastle', 'Git 2.47.1', 'Codex 0.170.0'])
    expect(plan.install).toEqual([])
    expect(plan.afterwards).toEqual([])
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
      'Sign in: codex login',
    ])
  })

  it('a Windows machine without winget gets a Git link instead', () => {
    const plan = buildInstallPlan(freshMachine(), { ...windows, packageManagers: [] }, 'claude')

    expect(labels(plan)).toEqual(['Claude Code'])
    expect(plan.afterwards).toContain('Install Git: https://git-scm.com/download/win')
  })

  it('Arch Linux installs Git with pacman', () => {
    const plan = buildInstallPlan(
      freshMachine(),
      { ...ubuntuVps, packageManagers: ['pacman'], hasDesktop: true },
      'claude',
    )

    expect(labels(plan)).toEqual(['Git', 'Claude Code'])
    expect(plan.install[0].commands).toEqual([{ file: 'sudo', args: ['pacman', '-S', '--noconfirm', 'git'] }])
    expect(plan.afterwards).toEqual([
      'Open a new terminal',
      'Sign in: claude auth login',
    ])
  })

  it('says to open a new terminal when the script added Bun to PATH', () => {
    const present = report(
      probe('bun', 'ok', '1.4.2'),
      probe('git', 'ok', 'git version 2.47.0'),
      probe('codex', 'ok', '0.61.0'),
      probe('codex-auth', 'ok'),
    )
    expect(buildInstallPlan(present, { ...mac, pathChanged: true }, null).afterwards).toContain('Open a new terminal')
    expect(buildInstallPlan(present, mac, null).afterwards).not.toContain('Open a new terminal')
  })

  it('a second run lists only what is still missing', () => {
    const plan = buildInstallPlan(
      report(
        probe('bun', 'ok', '1.4.2'),
        probe('git', 'ok', 'git version 2.43.0'),
        probe('claude', 'ok', '2.4.1 (Claude Code)'),
        probe('claude-auth', 'ok'),
        probe('codex', 'missing'),
      ),
      { ...ubuntuVps, serviceFileExists: true },
      null,
    )

    expect(plan.present).toEqual(['Bun 1.4.2', 'runcastle', 'Git 2.43.0', 'Claude Code 2.4.1'])
    expect(plan.install).toEqual([])
    expect(plan.afterwards).toEqual([])
  })

  it('a machine with everything has nothing to install', () => {
    const plan = buildInstallPlan(
      report(
        probe('bun', 'ok', '1.4.2'),
        probe('git', 'ok', 'git version 2.43.0'),
        probe('claude', 'ok', '2.4.1 (Claude Code)'),
        probe('claude-auth', 'ok'),
      ),
      { ...ubuntuVps, hasDesktop: true },
      null,
    )

    expect(plan.install).toEqual([])
    expect(plan.afterwards).toEqual([])
  })
})

describe('Docker', () => {
  it('is never installed, and a machine without it is complete', () => {
    const plan = buildInstallPlan(
      report(
        probe('bun', 'ok', '1.4.2'),
        probe('git', 'ok', 'git version 2.43.0'),
        probe('claude', 'ok', '2.4.1 (Claude Code)'),
        probe('claude-auth', 'ok'),
      ),
      { ...ubuntuVps, hasDesktop: true },
      null,
    )

    expect(plan.install).toEqual([])
    expect(plan.afterwards).toEqual([])
  })

  it('names no Docker step even on a fresh machine', () => {
    const plan = buildInstallPlan(freshMachine(), ubuntuVps, 'claude')

    expect(labels(plan).some((l) => /docker|podman/i.test(l))).toBe(false)
    expect(plan.install.every((i) => i.commands.every((c) => !/docker/.test(c.args.join(' '))))).toBe(true)
    expect(plan.afterwards.some((a) => /docker|log out/i.test(a))).toBe(false)
  })
})

describe('agents', () => {
  it('asks which agent when neither is installed and no choice was given', () => {
    const plan = buildInstallPlan(freshMachine(), ubuntuVps, null)

    expect(plan.needsAgentChoice).toBe(true)
    expect(labels(plan)).toEqual(['Git'])
  })

  it('installs both when asked for both', () => {
    expect(labels(buildInstallPlan(freshMachine(), ubuntuVps, 'both'))).toEqual(['Git', 'Claude Code', 'Codex'])
  })

  it('adds no agent when one is already installed, whatever the choice', () => {
    const results = freshMachine().results.map((r) => (r.id === 'codex' ? probe('codex', 'ok', 'codex-cli 0.170.0') : r))
    const plan = buildInstallPlan(report(...results), ubuntuVps, 'claude')

    expect(plan.needsAgentChoice).toBe(false)
    expect(labels(plan)).toEqual(['Git'])
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
        probe('claude-adapter-version', 'stale', 'Claude Code 2.0.1 is older than 2.1.4, which the chat adapter needs'),
        probe('codex', 'ok', 'codex-cli 0.150.0'),
        probe('codex-auth', 'ok'),
        probe('codex-adapter-version', 'stale', 'Codex 0.150.0 is older than 0.164.0, which the chat adapter needs'),
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
        probe('claude-adapter-version', 'ok', 'Claude Code 2.1.4 (the chat adapter needs 2.1.4 or newer)'),
      ),
      { ...ubuntuVps, hasDesktop: true },
      null,
    )

    expect(plan.install).toEqual([])
    expect(plan.present).toEqual(['Bun 1.3.14', 'runcastle', 'Git 2.30.0', 'Claude Code 2.1.4'])
  })
})
