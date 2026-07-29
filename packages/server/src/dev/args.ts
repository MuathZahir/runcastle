import { Phase } from '@runcastle/core'
import type { FeatureStatus } from '@runcastle/core'

/**
 * Argv parsing for the dev tool (`scripts/devtool.ts` → `bun run dev:tool`).
 *
 * Lives under `src/dev/` rather than beside the script for two reasons: it is
 * typechecked with the rest of the server, and it is unit-testable — the script
 * itself opens a db and touches `git config`, so its parse would otherwise only
 * be exercised by running it.
 *
 * Nothing in `src/dev/` is reachable from `src/index.ts` or `src/bin/runcastle.ts`,
 * and the published package is a bundle of exactly those two entrypoints
 * (`scripts/build-package.ts`), so none of this ships to an install.
 */

/** Everything the dev tool can be asked to do. */
export type DevCommand =
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'reset'; confirmed: boolean }
  | { kind: 'project-ls' }
  | { kind: 'project-rm'; target: string; confirmed: boolean; branches: boolean }
  | { kind: 'feature-ls'; project?: string }
  | { kind: 'feature-phase'; feature: string; phase: Phase }
  | { kind: 'feature-status'; feature: string; status: FeatureStatus }
  | { kind: 'feature-rm'; target: string; confirmed: boolean; branches: boolean }
  | { kind: 'prep-reset'; target: string }
  | { kind: 'onboarding-reset'; confirmed: boolean; branches: boolean }
  | { kind: 'onboarding-git'; action: 'clear' | 'restore' }

/** A usage error: the message is printed with the usage text, and the tool exits 1. */
export class UsageError extends Error {}

/** Feature statuses the tool accepts (mirrors core's `FeatureStatus`). */
export const FEATURE_STATUSES = ['active', 'shipped', 'archived'] as const

const KNOWN_FLAGS = new Set(['--yes', '--branches'])

/**
 * Partition argv into flags and positionals. The tool has no value-taking
 * options, so flags are boolean-only and this stays a partition rather than a
 * parser.
 */
export function splitFlags(argv: readonly string[]): { flags: Set<string>; args: string[] } {
  const flags = new Set<string>()
  const args: string[] = []
  for (const a of argv) {
    if (a === '-y') flags.add('--yes')
    else if (a.startsWith('--')) flags.add(a)
    else args.push(a)
  }
  return { flags, args }
}

/**
 * Parse argv into a {@link DevCommand}, throwing {@link UsageError} with a
 * human-readable reason for anything unrecognised.
 *
 * An unknown flag is an error rather than an ignored token: on a tool whose
 * confirmation is a flag, a typo'd `--yess` silently degrading to "not
 * confirmed" is merely confusing, but the class of mistake is one where being
 * quiet is never the safe default.
 */
export function parseArgs(argv: readonly string[]): DevCommand {
  const { flags, args } = splitFlags(argv)
  for (const f of flags) {
    if (!KNOWN_FLAGS.has(f) && f !== '--help') throw new UsageError(`unknown flag ${f}`)
  }
  const confirmed = flags.has('--yes')
  const branches = flags.has('--branches')
  const [group, ...rest] = args

  if (group === undefined || group === 'help' || flags.has('--help')) return { kind: 'help' }
  if (group === 'status') return { kind: 'status' }
  if (group === 'reset') return { kind: 'reset', confirmed }

  if (group === 'project') {
    const [action, target] = rest
    if (action === undefined || action === 'ls') return { kind: 'project-ls' }
    if (action === 'rm') {
      if (target === undefined) throw new UsageError('project rm needs a project id, name, or `all`')
      return { kind: 'project-rm', target, confirmed, branches }
    }
    throw new UsageError(`unknown project action \`${action}\` (ls, rm)`)
  }

  if (group === 'feature') {
    const [action, ...tail] = rest
    if (action === undefined || action === 'ls') {
      const project = tail[0]
      return project === undefined ? { kind: 'feature-ls' } : { kind: 'feature-ls', project }
    }
    if (action === 'phase') {
      const [feature, phase] = tail
      if (feature === undefined || phase === undefined) {
        throw new UsageError(`feature phase needs <feature> <${Phase.options.join('|')}>`)
      }
      const parsed = Phase.safeParse(phase)
      if (!parsed.success) {
        throw new UsageError(`unknown phase \`${phase}\` (${Phase.options.join(', ')})`)
      }
      return { kind: 'feature-phase', feature, phase: parsed.data }
    }
    if (action === 'status') {
      const [feature, status] = tail
      if (feature === undefined || status === undefined) {
        throw new UsageError(`feature status needs <feature> <${FEATURE_STATUSES.join('|')}>`)
      }
      if (!(FEATURE_STATUSES as readonly string[]).includes(status)) {
        throw new UsageError(`unknown status \`${status}\` (${FEATURE_STATUSES.join(', ')})`)
      }
      return { kind: 'feature-status', feature, status: status as FeatureStatus }
    }
    if (action === 'rm') {
      const target = tail[0]
      if (target === undefined) throw new UsageError('feature rm needs a feature id, slug, or `all`')
      return { kind: 'feature-rm', target, confirmed, branches }
    }
    throw new UsageError(`unknown feature action \`${action}\` (ls, phase, status, rm)`)
  }

  if (group === 'prep') {
    const [action, target] = rest
    if (action !== 'reset') throw new UsageError(`unknown prep action \`${action ?? ''}\` (reset)`)
    if (target === undefined) throw new UsageError('prep reset needs a project id, name, or `all`')
    return { kind: 'prep-reset', target }
  }

  if (group === 'onboarding') {
    const [action, sub] = rest
    if (action === 'reset') return { kind: 'onboarding-reset', confirmed, branches }
    if (action === 'git') {
      if (sub !== 'clear' && sub !== 'restore') {
        throw new UsageError('onboarding git needs `clear` or `restore`')
      }
      return { kind: 'onboarding-git', action: sub }
    }
    throw new UsageError(`unknown onboarding action \`${action ?? ''}\` (reset, git)`)
  }

  throw new UsageError(`unknown command \`${group}\``)
}

/**
 * True when a command destroys enough to warrant an explicit `--yes`. Scoped to
 * the whole-tree operations: single-target deletes name what they are deleting,
 * so a confirmation there would just be friction on the common dev loop.
 */
export function needsConfirmation(cmd: DevCommand): boolean {
  switch (cmd.kind) {
    case 'reset':
    case 'onboarding-reset':
      return !cmd.confirmed
    case 'project-rm':
    case 'feature-rm':
      return cmd.target === 'all' && !cmd.confirmed
    default:
      return false
  }
}

/** Commands that change state the running dev server may hold in memory. */
export function isMutation(cmd: DevCommand): boolean {
  return cmd.kind !== 'help' && cmd.kind !== 'status' && !cmd.kind.endsWith('-ls')
}

export const USAGE = `runcastle dev tool — test-state surgery on the DEV data dir only

Usage: bun run dev:tool <command> [flags]

  status                          where dev's data dir is and what is in it

  project ls                      list projects (open and closed)
  project rm <id|name|all>        hard-delete a project, its features and rows
  prep reset <id|name|all>        forget preparation findings so it asks again

  feature ls [projectId|name]     list features with phase and status
  feature phase <id|slug> <phase> force a phase (${Phase.options.join(', ')})
  feature status <id|slug> <s>    force a status (${FEATURE_STATUSES.join(', ')})
  feature rm <id|slug|all>        hard-delete a feature and its rows

  onboarding reset                delete every project + the AFK token so the
                                  first-run wizard appears again
  onboarding git clear|restore    stash/restore the GLOBAL git identity so the
                                  wizard's git step is reachable
  reset                           delete the whole dev data dir

Flags:
  --yes, -y     confirm a whole-tree destructive command (reset, rm all)
  --branches    also delete matching feature/* branches in the target repo

This tool only ever touches the dev data dir (~/.runcastle-dev, or
RUNCASTLE_DEV_DATA_DIR). It refuses to run against a real install's
~/.runcastle, so it cannot destroy the projects a published runcastle owns.
`
