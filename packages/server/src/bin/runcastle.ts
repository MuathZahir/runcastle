#!/usr/bin/env bun
// First: drop what Bun loaded from a start-folder .env, before anything reads process.env.
import './no-dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isOlderVersion } from '../doctor/adapter-requirements'
import { applyInstalledAssetEnv } from '../launcher/asset-paths'
import { MIN_BUN_VERSION } from '../setup/plan'
import { runcastleVersion } from '../version'

/**
 * The published `runcastle` bin (issue #51, workstream G). One entrypoint that
 * boots the server (serving the SPA) by default and dispatches subcommands:
 *
 *   runcastle            boot the server + open the app on http://localhost:4512
 *   runcastle serve      the same, spelled out for scripts and services
 *   runcastle setup      list what this machine is missing and install it
 *   runcastle doctor     run the pre-boot gate/diagnostic (forwards --gate etc.)
 *   runcastle move       move this machine's runcastle to another machine
 *   runcastle move-in    the receiving end of a move
 *   runcastle token      save the unattended Claude Code token
 *   runcastle service    keep runcastle running on a Linux machine
 *   runcastle build-image  build the stock sandbox image, with no app
 *   runcastle --version  print the installed version
 *   runcastle --help     print usage
 *
 * `parseCommand` is the pure dispatch (unit-tested); the side-effecting boot is
 * done in `main`, guarded by `import.meta.main` so importing this file for the
 * test never spawns a server.
 */
export type Command =
  | 'serve'
  | 'setup'
  | 'doctor'
  | 'token'
  | 'service'
  | 'build-image'
  | 'move'
  | 'move-in'
  | 'version'
  | 'help'

export interface ParsedCommand {
  command: Command
  args: string[]
}

export function parseCommand(argv: string[]): ParsedCommand {
  const [first, ...rest] = argv
  if (first === undefined) return { command: 'serve', args: [] }
  if (first === '--version' || first === '-v' || first === 'version')
    return { command: 'version', args: rest }
  if (first === '--help' || first === '-h' || first === 'help')
    return { command: 'help', args: rest }
  if (first === 'setup') return { command: 'setup', args: rest }
  if (first === 'doctor') return { command: 'doctor', args: rest }
  if (first === 'move') return { command: 'move', args: rest }
  if (first === 'move-in') return { command: 'move-in', args: rest }
  if (first === 'token') return { command: 'token', args: rest }
  if (first === 'service') return { command: 'service', args: rest }
  if (first === 'build-image') return { command: 'build-image', args: rest }
  if (first === 'serve') return { command: 'serve', args: rest }
  // Unknown token: show help rather than silently booting on a typo.
  return { command: 'help', args: argv }
}

/**
 * The line that stops `serve` on a Bun older than runcastle's floor, or null when
 * `version` is new enough. The installers check the floor, but `bun add -g
 * runcastle` only warns about `engines`, and an older Bun boots the server fine,
 * then crashes the first time it opens a terminal (Bun.spawn's `terminal` option).
 */
export function bunTooOldLine(version: string): string | null {
  if (!isOlderVersion(version, MIN_BUN_VERSION)) return null
  return `runcastle needs Bun ${MIN_BUN_VERSION} or newer, and this is Bun ${version}. Run \`bun upgrade\`, then start runcastle again.`
}

const USAGE = `runcastle — Idea in, merged branch out. On your machine, in your repo.

Usage:
  runcastle            Boot the server and serve the app (http://localhost:4512)
  runcastle serve      The same, spelled out for scripts and services
  runcastle setup      List what this machine is missing and install it (--yes, --agent claude|codex|both)
  runcastle doctor     Check prerequisites (add --gate for the pre-boot gate)
  runcastle move [user@host] [--dry-run] [--yes] [--replace] [--with-env]
                       [--with-claude-setup] [--also <project>:<path>]
                       [--repos-dir <dir>] [--no-repo <project>] [--out <file>]
                       Move runcastle to another machine; only reads this one
  runcastle move-in <pack> [--replace] [--repos-dir <dir>]
                       Bring a move in on this machine
  runcastle token      Save the unattended Claude Code token (--stdin to read it from a pipe)
  runcastle service install
                       Keep runcastle running on this Linux machine (service remove undoes it)
  runcastle build-image
                       Build the sandbox image without the app (the first round builds it if it is missing)
  runcastle --version  Print the installed version
  runcastle --help     Show this help
`

async function main(argv: string[]): Promise<number> {
  // In a published install every runtime asset is vendored beside this bin (one
  // dir up from `bin/`); point the asset env vars at those copies before any
  // module resolves them. A contributor checkout has none of them beside the
  // bin, so this is a no-op and the workspace source paths win (issue #51).
  applyInstalledAssetEnv(resolve(dirname(fileURLToPath(import.meta.url)), '..'))

  const { command, args } = parseCommand(argv)
  switch (command) {
    case 'version':
      console.log(runcastleVersion())
      return 0
    case 'help':
      console.log(USAGE)
      return 0
    case 'setup': {
      const { runSetup } = await import('./setup')
      return runSetup(args)
    }
    case 'doctor': {
      const { runCli } = await import('../doctor/cli')
      return runCli(args)
    }
    case 'move': {
      const { runMoveCli } = await import('../move/cli')
      return runMoveCli(args)
    }
    case 'move-in': {
      const { runMoveInCli } = await import('../move/cli')
      return runMoveInCli(args)
    }
    case 'token': {
      const { runToken } = await import('./token')
      return runToken(args)
    }
    case 'service': {
      const { runService } = await import('./service')
      return runService(args)
    }
    case 'build-image': {
      const { runBuildImage } = await import('./build-image')
      return runBuildImage(args)
    }
    case 'serve': {
      const tooOld = bunTooOldLine(Bun.version)
      if (tooOld) {
        console.error(tooOld)
        return 1
      }
      const { startServer } = await import('../index')
      await startServer()
      return 0
    }
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => {
      // `serve` never resolves in practice (the listener keeps the loop alive);
      // the other commands return a numeric exit code.
      if (code !== 0) process.exit(code)
    },
    (err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    },
  )
}
