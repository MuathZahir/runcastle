import { resolveDoctorEnv } from '../doctor/cli'
import { type DoctorReport, runDoctor } from '../doctor/doctor'
import { type AgentChoice, buildInstallPlan, type MachineFacts } from '../setup/plan'
import {
  AGENT_QUESTION,
  confirmQuestion,
  formatAfterwards,
  formatInstall,
  formatItems,
  formatPresent,
  palette,
  runPlan,
  type StepRunner,
} from '../setup/runner'
import { addInstallerDirsToPath, askKey, createStepRunner, readMachineFacts } from '../setup/system'
import { ROOT_BURN_REFUSED, runningAsRoot } from '../workflows/burn-user'

export const SETUP_USAGE = 'usage: runcastle setup [--yes] [--agent claude|codex|both]'

export interface SetupDeps {
  log?: (line: string) => void
  /** Runs the doctor's probes; the gate-mode doctor when omitted. */
  doctor?: () => Promise<DoctorReport>
  facts?: MachineFacts
  runStep?: StepRunner
  /** Asks a one-keypress question; resolves the key, or '' for Enter. */
  prompt?: (question: string) => Promise<string>
  /** There is a terminal to ask on; read from stdin when omitted. */
  isTTY?: boolean
  color?: boolean
  runningAsRoot?: boolean
  /** Put the installers' folders on this process's PATH before the re-check. */
  extendPath?: () => void
}

interface SetupOptions {
  yes: boolean
  agent: AgentChoice | null
}

const AGENT_CHOICES: readonly AgentChoice[] = ['claude', 'codex', 'both']

function parseFlags(argv: string[]): SetupOptions | null {
  const options: SetupOptions = { yes: false, agent: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--yes' || arg === '-y') options.yes = true
    else if (arg === '--agent' || arg.startsWith('--agent=')) {
      const value = arg === '--agent' ? argv[++i] : arg.slice('--agent='.length)
      const agent = AGENT_CHOICES.find((a) => a === value)
      if (!agent) return null
      options.agent = agent
    } else return null
  }
  return options
}

const AGENT_KEYS: Record<string, AgentChoice> = { '2': 'codex', '3': 'both' }

/**
 * `runcastle setup`: show what this machine already has, what it will install
 * and what the person does afterwards; take one yes, install everything it can,
 * re-check, and report what is left. Returns the process exit code.
 */
export async function runSetup(argv: string[], deps: SetupDeps = {}): Promise<number> {
  const log = deps.log ?? console.log
  const options = parseFlags(argv)
  if (!options) {
    log(SETUP_USAGE)
    return 1
  }
  const facts = deps.facts ?? readMachineFacts()
  if (facts.platform !== 'win32' && (deps.runningAsRoot ?? runningAsRoot())) {
    log(ROOT_BURN_REFUSED)
    return 1
  }
  const doctor = deps.doctor ?? (() => runDoctor(resolveDoctorEnv('gate')))
  const prompt = deps.prompt ?? askKey
  const tty = deps.isTTY ?? Boolean(process.stdin.isTTY)
  const c = palette(deps.color ?? Boolean(process.stdout.isTTY))

  const report = await doctor()
  let choice = options.agent
  let plan = buildInstallPlan(report, facts, choice)
  formatPresent(plan, c).forEach((line) => log(line))
  log('')
  if (plan.needsAgentChoice) {
    // Asked only when there is someone to ask; `--yes` and no terminal mean Claude Code.
    choice = options.yes || !tty ? 'claude' : (AGENT_KEYS[(await prompt(AGENT_QUESTION)).trim()] ?? 'claude')
    if (!options.yes && tty) log('')
    plan = buildInstallPlan(report, facts, choice)
  }
  formatInstall(plan, c).forEach((line) => log(line))
  log('')

  if (plan.install.length === 0) {
    log('Nothing to install.')
    return 0
  }
  if (!options.yes && !tty) {
    log('There is no terminal to ask on, so nothing was installed. Re-run with --yes to install these.')
    return 1
  }
  // Enter or y. Any other key is a no: this yes can run `sudo`.
  if (!options.yes && !/^y?$/i.test((await prompt(confirmQuestion(plan.install.length))).trim())) {
    log('Nothing was installed.')
    return 1
  }

  const failed = await runPlan(plan, deps.runStep ?? createStepRunner(), log)

  ;(deps.extendPath ?? addInstallerDirsToPath)()
  const missing = buildInstallPlan(await doctor(), facts, choice).install
  log('')
  if (missing.length > 0) {
    log(c.heading('Still missing'))
    formatItems(missing, c).forEach((line) => log(line))
  } else {
    log('Everything is installed.')
  }
  formatAfterwards(plan, c).forEach((line) => log(line))
  return failed.length > 0 || missing.length > 0 ? 1 : 0
}
