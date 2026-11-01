import { describeCommand, type InstallPlan, type PlanItem, type SetupCommand } from './plan'

/**
 * Running an install plan, and drawing it. The command runner is injected, so
 * tests see what ran and in what order without installing anything.
 */

/** Run one command with the person's terminal attached; resolves true on exit 0. */
export type StepRunner = (command: SetupCommand) => Promise<boolean>

/**
 * Run every item in order. An item stops at its first failing command, but the
 * plan never stops at a failed item: the rest may well not depend on it, and
 * the re-check afterwards says what is still missing. Returns the failed items.
 */
export async function runPlan(
  plan: InstallPlan,
  runStep: StepRunner,
  log: (line: string) => void,
): Promise<PlanItem[]> {
  const failed: PlanItem[] = []
  for (const item of plan.install) {
    log('')
    log(`Installing ${item.label}`)
    for (const command of item.commands) {
      log(`$ ${describeCommand(command)}`)
      if (!(await runStep(command))) {
        log(`${item.label} did not install.`)
        failed.push(item)
        break
      }
    }
  }
  return failed
}

const ansi = (code: string) => (text: string) => `\u001b[${code}m${text}\u001b[0m`
const plain = (text: string) => text

/** Colours for the list; all identity when output is not a terminal. */
export function palette(color: boolean) {
  return {
    heading: color ? ansi('1') : plain,
    good: color ? ansi('32') : plain,
    warn: color ? ansi('33') : plain,
    dim: color ? ansi('2') : plain,
  }
}

export type Palette = ReturnType<typeof palette>

/** The width of an item's label column, so `needs sudo` lines up. */
const LABEL_WIDTH = 42

export function formatPresent(plan: InstallPlan, c: Palette): string[] {
  return [c.heading('Already here'), ...plan.present.map((line) => `  ${c.good('✓')} ${line}`)]
}

export function formatItems(items: PlanItem[], c: Palette): string[] {
  if (items.length === 0) return [`  ${c.dim('Nothing')}`]
  return items.flatMap((item) => [
    item.needsSudo ? `  • ${item.label.padEnd(LABEL_WIDTH)}${c.warn('needs sudo')}` : `  • ${item.label}`,
    ...(item.warning ? [`    ${item.warning}`] : []),
  ])
}

/** The afterwards part; nothing at all when there is nothing to do. */
export function formatAfterwards(plan: InstallPlan, c: Palette): string[] {
  if (plan.afterwards.length === 0) return []
  return ['', c.heading('You do afterwards'), ...plan.afterwards.map((step, i) => `  ${i + 1}. ${step}`)]
}

export function formatInstall(plan: InstallPlan, c: Palette): string[] {
  return [c.heading('Will install'), ...formatItems(plan.install, c), ...formatAfterwards(plan, c)]
}

/** `Install these 3? [Y/n] ` / `Install this 1? [Y/n] `. */
export function confirmQuestion(count: number): string {
  return `Install ${count === 1 ? 'this' : 'these'} ${count}? [Y/n] `
}

export const AGENT_QUESTION = 'Which agent? [1] Claude Code  [2] Codex  [3] both  (1) '
