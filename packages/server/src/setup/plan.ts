import type { AgentRuntime } from '@runcastle/core'
import { isOlderVersion } from '../doctor/adapter-requirements'
import {
  AGENT_INSTALLERS,
  BUN_INSTALLER,
  type DoctorReport,
  noNodeDetail,
  type ProbeResult,
  RUNTIME_SPECS,
  type StandaloneInstaller,
} from '../doctor/doctor'
import { parseAgentCliVersion } from '../services/agent-cli-versions'

/**
 * The install plan behind `runcastle setup`: a pure function of the doctor's
 * report and a few facts about the machine. It decides what is already there,
 * what setup installs under the one yes, and what the person does afterwards.
 * Every probe stays the doctor's; nothing here looks at the machine.
 */

/** The oldest Bun runcastle runs on; an older one is listed as an update (decision 8). */
export const MIN_BUN_VERSION = '1.3.14'

/** The Linux systems Docker's own install script covers (decision 3), by `/etc/os-release` `ID=`. */
export const DOCKER_SCRIPT_DISTROS = [
  'ubuntu',
  'debian',
  'raspbian',
  'centos',
  'rhel',
  'rocky',
  'fedora',
  'sles',
] as const

/** Linux package managers in the order setup prefers them, then macOS's and Windows'. */
export const LINUX_PACKAGE_MANAGERS = ['apt-get', 'dnf', 'yum', 'pacman', 'zypper', 'apk'] as const
export type PackageManager = (typeof LINUX_PACKAGE_MANAGERS)[number] | 'brew' | 'winget'

export interface MachineFacts {
  platform: NodeJS.Platform
  /** `ID=` of `/etc/os-release`; null off Linux or when unreadable. */
  distroId: string | null
  /** Which package managers are on PATH. */
  packageManagers: readonly PackageManager[]
  /** `DISPLAY` or `WAYLAND_DISPLAY` is set. */
  hasDesktop: boolean
  /** A runcastle service file is already installed. */
  serviceFileExists: boolean
  /** The person's login name, for the docker group. */
  user: string
  /** The install script added Bun to PATH, so the terminal it ran in lacks it. */
  pathChanged?: boolean
}

/** Which agent CLI to install when neither is there (decision 2). */
export type AgentChoice = 'claude' | 'codex' | 'both'

/** One command, as a spawn takes it. */
export interface SetupCommand {
  file: string
  args: string[]
}

export interface PlanItem {
  label: string
  needsSudo: boolean
  /** A line shown under the item, for what it changes beyond installing. */
  warning?: string
  /** Run in order; the item fails at the first that fails. */
  commands: SetupCommand[]
  /** The tool lands in a folder a terminal opened earlier does not have on PATH. */
  changesPath: boolean
}

export interface InstallPlan {
  /** What is already there, one line each. */
  present: string[]
  install: PlanItem[]
  afterwards: string[]
  /** Neither agent CLI is there and no choice was given: ask before showing the list. */
  needsAgentChoice: boolean
}

export const DOCKER_GROUP_WARNING =
  'Adds you to the docker group, which is effectively root on this machine.'

const AGENTS: Record<AgentChoice, AgentRuntime[]> = {
  claude: ['claude-code'],
  codex: ['codex'],
  both: ['claude-code', 'codex'],
}

const sh = (line: string): SetupCommand => ({ file: 'sh', args: ['-c', line] })
const sudo = (...args: string[]): SetupCommand => ({ file: 'sudo', args })

/** A tool's standalone installer, run the way this system runs it. */
function installerCommand(installer: StandaloneInstaller, platform: NodeJS.Platform): SetupCommand {
  if (platform !== 'win32') return sh(installer.unix)
  return {
    file: 'powershell',
    args: ['-ExecutionPolicy', 'ByPass', '-c', `irm ${installer.windowsUrl} | iex`],
  }
}

/** How a command reads to a person, for the progress line. */
export function describeCommand(command: SetupCommand): string {
  return [command.file, ...command.args].map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')
}

const LINUX_GIT: Record<(typeof LINUX_PACKAGE_MANAGERS)[number], SetupCommand[]> = {
  'apt-get': [sudo('apt-get', 'update'), sudo('apt-get', 'install', '-y', 'git')],
  dnf: [sudo('dnf', 'install', '-y', 'git')],
  yum: [sudo('yum', 'install', '-y', 'git')],
  pacman: [sudo('pacman', '-S', '--noconfirm', 'git')],
  zypper: [sudo('zypper', '--non-interactive', 'install', 'git')],
  apk: [sudo('apk', 'add', 'git')],
}

function row(report: DoctorReport, id: string): ProbeResult | undefined {
  return report.results.find((r) => r.id === id)
}

const isOk = (r: ProbeResult | undefined): boolean => r?.status === 'ok'

/** `Git 2.43.0` from `git version 2.43.0`; the bare label when no version reads. */
function withVersion(label: string, r: ProbeResult | undefined): string {
  const version = r ? parseAgentCliVersion(r.detail) : null
  return version ? `${label} ${version}` : label
}

function gitPlan(facts: MachineFacts): { item?: PlanItem; afterwards?: string } {
  const has = (pm: PackageManager) => facts.packageManagers.includes(pm)
  if (facts.platform === 'win32') {
    if (!has('winget')) return { afterwards: 'Install Git: https://git-scm.com/download/win' }
    return {
      item: {
        label: 'Git (with winget)',
        needsSudo: false,
        commands: [
          {
            file: 'winget',
            args: ['install', '--id', 'Git.Git', '-e', '--accept-source-agreements', '--accept-package-agreements'],
          },
        ],
        changesPath: true,
      },
    }
  }
  if (facts.platform === 'darwin') {
    if (!has('brew')) return { afterwards: 'Install Git: xcode-select --install' }
    return {
      item: { label: 'Git (with Homebrew)', needsSudo: false, commands: [{ file: 'brew', args: ['install', 'git'] }], changesPath: false },
    }
  }
  const pm = LINUX_PACKAGE_MANAGERS.find(has)
  if (!pm) return { afterwards: 'Install Git: https://git-scm.com/downloads' }
  return { item: { label: 'Git', needsSudo: true, commands: LINUX_GIT[pm], changesPath: false } }
}

/** What happens for one agent CLI: present, installed, reinstalled or updated. */
function agentItem(
  runtime: AgentRuntime,
  report: DoctorReport,
  platform: NodeJS.Platform,
): { present?: string; item?: PlanItem } {
  const spec = RUNTIME_SPECS[runtime]
  const binary = row(report, spec.ids.binary)
  const install = installerCommand(AGENT_INSTALLERS[runtime], platform)
  if (!isOk(binary)) {
    const label = binary?.detail === noNodeDetail(spec.bin) ? `${spec.label} (reinstall without Node)` : spec.label
    // Standalone installers write to `~/.local/bin`, which an open terminal may lack.
    return { item: { label, needsSudo: false, commands: [install], changesPath: true } }
  }
  const version = row(report, `${spec.ids.binary}-adapter-version`)
  if (version?.status === 'stale') {
    const [installed, minimum] = version.detail.match(/\d+\.\d+\.\d+/g) ?? []
    const update = runtime === 'claude-code' ? { file: spec.bin, args: ['update'] } : install
    return {
      item: {
        label: installed && minimum ? `${spec.label} ${installed} → ${minimum}` : `${spec.label} (update)`,
        needsSudo: false,
        commands: [update],
        changesPath: false,
      },
    }
  }
  return { present: withVersion(spec.label, binary) }
}

/** An agent CLI is on the machine, even one that cannot run for want of Node. */
function agentInstalled(report: DoctorReport, runtime: AgentRuntime): boolean {
  const spec = RUNTIME_SPECS[runtime]
  const binary = row(report, spec.ids.binary)
  return isOk(binary) || binary?.detail === noNodeDetail(spec.bin)
}

/**
 * Build the plan. `choice` only matters when neither agent CLI is installed;
 * then a null choice asks for one (`needsAgentChoice`) and adds no agent.
 */
export function buildInstallPlan(
  report: DoctorReport,
  facts: MachineFacts,
  choice: AgentChoice | null,
): InstallPlan {
  const present: string[] = []
  const install: PlanItem[] = []
  const afterwards: string[] = []
  const { platform } = facts

  // Bun: setup itself runs on it, so a missing row means a PATH that lacks it.
  const bun = row(report, 'bun')
  const bunVersion = bun && isOk(bun) ? parseAgentCliVersion(bun.detail) : null
  if (!isOk(bun)) {
    install.push({ label: 'Bun', needsSudo: false, commands: [installerCommand(BUN_INSTALLER, platform)], changesPath: true })
  } else if (bunVersion && isOlderVersion(bunVersion, MIN_BUN_VERSION)) {
    install.push({
      label: `Bun ${bunVersion} → ${MIN_BUN_VERSION}`,
      needsSudo: false,
      commands: [{ file: 'bun', args: ['upgrade'] }],
      changesPath: false,
    })
  } else {
    present.push(withVersion('Bun', bun))
  }
  present.push('runcastle')

  const git = row(report, 'git')
  if (isOk(git)) present.push(withVersion('Git', git))
  else {
    const plan = gitPlan(facts)
    if (plan.item) install.push(plan.item)
    if (plan.afterwards) afterwards.push(plan.afterwards)
  }

  const anyAgent = agentInstalled(report, 'claude-code') || agentInstalled(report, 'codex')
  const needsAgentChoice = !anyAgent && choice === null
  const inUse: AgentRuntime[] = anyAgent
    ? (['claude-code', 'codex'] as const).filter((r) => agentInstalled(report, r))
    : choice
      ? AGENTS[choice]
      : []
  for (const runtime of inUse) {
    const agent = agentItem(runtime, report, platform)
    if (agent.present) present.push(agent.present)
    if (agent.item) install.push(agent.item)
  }

  const container = row(report, 'container-runtime')
  let dockerGroupChanged = false
  let containerAfterwards: string | undefined
  if (isOk(container)) {
    present.push(withVersion(/podman/i.test(container?.detail ?? '') ? 'Podman' : 'Docker', container))
  } else if (container?.status === 'missing' || !container) {
    if (platform === 'linux' && DOCKER_SCRIPT_DISTROS.some((d) => d === facts.distroId)) {
      dockerGroupChanged = true
      install.push({
        label: 'Docker Engine',
        needsSudo: true,
        warning: DOCKER_GROUP_WARNING,
        commands: [sh('curl -fsSL https://get.docker.com | sudo sh'), sudo('usermod', '-aG', 'docker', facts.user)],
        changesPath: false,
      })
    } else if (platform === 'linux') {
      containerAfterwards = 'Install Docker: https://docs.docker.com/get-docker/'
    } else {
      containerAfterwards = 'Install Docker Desktop: https://docs.docker.com/desktop/'
    }
  } else if (container.fix) {
    containerAfterwards = container.fix
  }

  if (dockerGroupChanged) afterwards.push('Log out and back in, so the docker group applies')
  // Logging out covers it, so one step does for both.
  else if (facts.pathChanged || install.some((i) => i.changesPath)) afterwards.push('Open a new terminal')
  if (containerAfterwards) afterwards.push(containerAfterwards)
  for (const runtime of inUse) {
    const spec = RUNTIME_SPECS[runtime]
    if (!isOk(row(report, spec.ids.auth))) afterwards.push(`Sign in: ${spec.loginCommand}`)
  }
  const token = RUNTIME_SPECS['claude-code'].ids.afkKey
  if (inUse.includes('claude-code') && token && !isOk(row(report, token))) {
    afterwards.push('For burns: runcastle token')
  }
  if (platform === 'linux' && !facts.hasDesktop && !facts.serviceFileExists) {
    afterwards.push('To keep it running: runcastle service install')
  }

  return { present, install, afterwards, needsAgentChoice }
}
