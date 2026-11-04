import { describe, expect, it } from 'vitest'
import { runSetup, SETUP_USAGE, type SetupDeps } from '../src/bin/setup'
import type { DoctorReport, ProbeResult, ProbeStatus } from '../src/doctor/doctor'
import type { MachineFacts, SetupCommand } from '../src/setup/plan'
import { AGENT_QUESTION } from '../src/setup/runner'
import { createStepRunner } from '../src/setup/system'
import { ROOT_BURN_REFUSED } from '../src/workflows/burn-user'

function probe(id: string, status: ProbeStatus, detail = ''): ProbeResult {
  return { id, label: id, tier: 1, status, severity: 'error', detail }
}

const report = (...results: ProbeResult[]): DoctorReport => ({ results, ok: false, tier1Ok: false })

const fresh = report(
  probe('bun', 'ok', '1.4.2'),
  probe('git', 'missing'),
  probe('claude', 'missing'),
  probe('claude-auth', 'missing'),
  probe('afk-token', 'unset'),
  probe('codex', 'missing'),
  probe('codex-auth', 'missing'),
  probe('container-runtime', 'missing'),
)

const done = report(
  probe('bun', 'ok', '1.4.2'),
  probe('git', 'ok', 'git version 2.43.0'),
  probe('claude', 'ok', '2.4.1 (Claude Code)'),
  probe('claude-auth', 'ok'),
  probe('afk-token', 'ok'),
  probe('container-runtime', 'ok', 'Docker version 27.3.1'),
)

const ubuntu: MachineFacts = {
  platform: 'linux',
  distroId: 'ubuntu',
  packageManagers: ['apt-get'],
  hasDesktop: false,
  serviceFileExists: false,
  user: 'ada',
}

/** Doctor reports are served in order; the last one repeats. */
function harness(opts: { reports?: DoctorReport[]; fail?: (c: SetupCommand) => boolean; answers?: string[] } = {}) {
  const reports = opts.reports ?? [fresh, done]
  const lines: string[] = []
  const ran: SetupCommand[] = []
  const questions: string[] = []
  const answers = [...(opts.answers ?? [])]
  let doctorRuns = 0
  const deps: SetupDeps = {
    log: (line) => lines.push(line),
    doctor: async () => reports[Math.min(doctorRuns++, reports.length - 1)],
    facts: ubuntu,
    runStep: async (command) => {
      ran.push(command)
      return !opts.fail?.(command)
    },
    prompt: async (question) => {
      questions.push(question)
      return answers.shift() ?? ''
    },
    isTTY: true,
    color: false,
    runningAsRoot: false,
    extendPath: () => {},
  }
  return { deps, lines, ran, questions, doctorRuns: () => doctorRuns }
}

const ranFiles = (ran: SetupCommand[]) => ran.map((c) => [c.file, ...c.args].join(' '))

describe('runcastle setup', () => {
  it('asks which agent once, then one yes, installs everything and re-checks', async () => {
    const h = harness({ answers: ['2', 'y'] })

    expect(await runSetup([], h.deps)).toBe(0)

    expect(h.questions).toEqual([AGENT_QUESTION, 'Install these 3? [Y/n] '])
    expect(ranFiles(h.ran)).toEqual([
      'sudo apt-get update',
      'sudo apt-get install -y git',
      'sh -c curl -fsSL https://chatgpt.com/codex/install.sh | sh',
      'sh -c curl -fsSL https://get.docker.com | sudo sh',
      'sudo usermod -aG docker ada',
    ])
    expect(h.doctorRuns()).toBe(2)
    expect(h.lines).toContain('Everything is installed.')
    expect(h.lines).toContain('  1. Log out and back in, so the docker group applies')
  })

  it('prints the list in the approved layout', async () => {
    const h = harness({ answers: ['1', 'n'] })

    await runSetup([], h.deps)

    expect(h.lines.slice(0, 15)).toEqual([
      'Already here',
      '  ✓ Bun 1.4.2',
      '  ✓ runcastle',
      '',
      '',
      'Will install',
      '  • Git                                       needs sudo',
      '  • Claude Code',
      '  • Docker Engine                             needs sudo',
      '    Adds you to the docker group, which is effectively root on this machine.',
      '',
      'You do afterwards',
      '  1. Log out and back in, so the docker group applies',
      '  2. Sign in: claude auth login',
      '  3. For unattended rounds: runcastle token',
    ])
  })

  it('keeps going past a failed item, re-checks, and exits 1', async () => {
    const stillNoGit = report(...done.results.map((r) => (r.id === 'git' ? probe('git', 'missing') : r)))
    const h = harness({ reports: [fresh, stillNoGit], fail: (c) => c.args.includes('update') })

    expect(await runSetup(['--yes'], h.deps)).toBe(1)

    expect(ranFiles(h.ran)).toEqual([
      'sudo apt-get update',
      'sh -c curl -fsSL https://claude.ai/install.sh | bash',
      'sh -c curl -fsSL https://get.docker.com | sudo sh',
      'sudo usermod -aG docker ada',
    ])
    expect(h.doctorRuns()).toBe(2)
    expect(h.lines).toContain('Git did not install.')
    const missing = h.lines.indexOf('Still missing')
    expect(h.lines[missing + 1]).toMatch(/^ {2}• Git +needs sudo$/)
  })

  it('asks nothing with --yes, and installs Claude Code when no agent is named', async () => {
    const h = harness()

    expect(await runSetup(['--yes'], h.deps)).toBe(0)

    expect(h.questions).toEqual([])
    expect(ranFiles(h.ran)).toContain('sh -c curl -fsSL https://claude.ai/install.sh | bash')
  })

  it('--agent skips the agent question but still asks the one yes', async () => {
    const h = harness()

    await runSetup(['--agent', 'both'], h.deps)

    expect(h.questions).toEqual(['Install these 4? [Y/n] '])
    expect(ranFiles(h.ran).filter((c) => c.includes('install.sh'))).toHaveLength(2)
  })

  it('does not ask which agent when one is already installed', async () => {
    const withCodex = report(...fresh.results.map((r) => (r.id === 'codex' ? probe('codex', 'ok', '0.170.0') : r)))
    const h = harness({ reports: [withCodex, done] })

    await runSetup([], h.deps)

    expect(h.questions).toEqual(['Install these 2? [Y/n] '])
  })

  it('with no terminal and no --yes, shows the list, runs nothing and exits 1', async () => {
    const h = harness()

    expect(await runSetup([], { ...h.deps, isTTY: false })).toBe(1)

    expect(h.ran).toEqual([])
    expect(h.questions).toEqual([])
    expect(h.lines).toContain('Will install')
    expect(h.lines.at(-1)).toMatch(/--yes/)
  })

  it('a no installs nothing', async () => {
    const h = harness({ answers: ['', 'n'] })

    expect(await runSetup([], h.deps)).toBe(1)
    expect(h.ran).toEqual([])
  })

  it('counts only Enter or y as a yes, so a stray key installs nothing', async () => {
    const h = harness({ answers: ['', 'q'] })

    expect(await runSetup([], h.deps)).toBe(1)
    expect(h.ran).toEqual([])
  })

  it('with nothing to install, says so and exits 0 without asking', async () => {
    const h = harness({ reports: [done] })

    expect(await runSetup([], h.deps)).toBe(0)
    expect(h.questions).toEqual([])
    expect(h.lines.at(-1)).toBe('Nothing to install.')
  })

  it.each(['linux', 'darwin'] as const)('refuses root on %s before anything runs', async (platform) => {
    const h = harness()

    expect(await runSetup(['--yes'], { ...h.deps, facts: { ...ubuntu, platform }, runningAsRoot: true })).toBe(1)

    expect(h.lines).toEqual([ROOT_BURN_REFUSED])
    expect(h.doctorRuns()).toBe(0)
    expect(h.ran).toEqual([])
  })

  it.each([['--force'], ['--agent', 'gemini'], ['--agent']])('rejects %s with the usage', async (...argv) => {
    const h = harness()

    expect(await runSetup(argv, h.deps)).toBe(1)
    expect(h.lines).toEqual([SETUP_USAGE])
  })
})

describe('createStepRunner', () => {
  it('tells Codex not to ask its own question', async () => {
    const check = "process.exit(process.env.CODEX_NON_INTERACTIVE === '1' ? 0 : 1)"
    expect(await createStepRunner()({ file: process.execPath, args: ['-e', check] })).toBe(true)
  })
})
