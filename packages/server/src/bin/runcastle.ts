#!/usr/bin/env bun
import { runcastleVersion } from '../version'

/**
 * The published `runcastle` bin (issue #51, workstream G). One entrypoint that
 * boots the server (serving the SPA) by default and dispatches subcommands:
 *
 *   runcastle            boot the server + open the app on http://localhost:4512
 *   runcastle doctor     run the pre-boot gate/diagnostic (forwards --gate etc.)
 *   runcastle --version  print the installed version
 *   runcastle --help     print usage
 *
 * `parseCommand` is the pure dispatch (unit-tested); the side-effecting boot is
 * done in `main`, guarded by `import.meta.main` so importing this file for the
 * test never spawns a server.
 */
export type Command = 'serve' | 'doctor' | 'version' | 'help'

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
  if (first === 'doctor') return { command: 'doctor', args: rest }
  if (first === 'serve') return { command: 'serve', args: rest }
  // Unknown token: show help rather than silently booting on a typo.
  return { command: 'help', args: argv }
}

const USAGE = `runcastle — burn tickets into shipped features with Claude Code

Usage:
  runcastle            Boot the server and serve the app (http://localhost:4512)
  runcastle doctor     Check prerequisites (add --gate for the pre-boot gate)
  runcastle --version  Print the installed version
  runcastle --help     Show this help
`

async function main(argv: string[]): Promise<number> {
  const { command, args } = parseCommand(argv)
  switch (command) {
    case 'version':
      console.log(runcastleVersion())
      return 0
    case 'help':
      console.log(USAGE)
      return 0
    case 'doctor': {
      const { runCli } = await import('../doctor/cli')
      return runCli(args)
    }
    case 'serve': {
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
