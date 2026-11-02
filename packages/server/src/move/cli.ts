import { rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { dataDir } from '@runcastle/core/paths'
import { runcastleVersion } from '../version'
import { checkDestination, serverRunning } from './destination'
import { packMove } from './pack'
import {
  askDestination,
  copyPack,
  failureMessage,
  manualSteps,
  runRemoteMoveIn,
  type RemoteFlags,
} from './remote'
import { formatMoveInResult, formatReport, isBlocked } from './report'
import { clearedCommandLines, scanMove } from './scan'
import { formatBytes, freeBytes, stamp } from './shell'
import type { DestinationQuestion, MoveEnv, MoveScan, MoveSql, OpenSql } from './types'
import { moveIn } from './unpack'

/** The argument handling and terminal side of `runcastle move` and `runcastle move-in`. */

export interface MoveArgs {
  host?: string
  dryRun: boolean
  yes: boolean
  replace: boolean
  reposDir?: string
  noRepo: string[]
  out?: string
}

export interface MoveInArgs {
  pack?: string
  check: boolean
  replace: boolean
  reposDir?: string
}

function takeValue(args: string[], i: number, flag: string): string {
  const value = args[i + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
  return value
}

export function parseMoveArgs(args: string[]): MoveArgs {
  const parsed: MoveArgs = { dryRun: false, yes: false, replace: false, noRepo: [] }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--dry-run') parsed.dryRun = true
    else if (arg === '--yes') parsed.yes = true
    else if (arg === '--replace') parsed.replace = true
    else if (arg === '--repos-dir') parsed.reposDir = takeValue(args, i++, arg)
    else if (arg === '--no-repo') parsed.noRepo.push(takeValue(args, i++, arg))
    else if (arg === '--out') parsed.out = takeValue(args, i++, arg)
    else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}`)
    else if (parsed.host) throw new Error(`unexpected argument ${arg}`)
    else parsed.host = arg
  }
  return parsed
}

export function parseMoveInArgs(args: string[]): MoveInArgs {
  const parsed: MoveInArgs = { check: false, replace: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--check') parsed.check = true
    else if (arg === '--replace') parsed.replace = true
    else if (arg === '--repos-dir') parsed.reposDir = takeValue(args, i++, arg)
    else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}`)
    else if (parsed.pack) throw new Error(`unexpected argument ${arg}`)
    else parsed.pack = arg
  }
  return parsed
}

export function currentEnv(): MoveEnv {
  return {
    platform: process.platform,
    home: homedir(),
    dataDir: dataDir(),
    claudeDir: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
  }
}

async function openSql(): Promise<OpenSql> {
  const { openRawSqlite } = await import('../db/client')
  return openRawSqlite
}

function questionFor(scan: MoveScan, migrations: string[], env: MoveEnv): DestinationQuestion {
  return {
    runcastleVersion: runcastleVersion(),
    sourcePlatform: env.platform,
    migrations,
    targetFolders: scan.projects.filter((p) => p.repoMoves).map((p) => p.targetFolder),
    dataBytes: scan.report.dataBytes,
    repoBytes: scan.report.repoBytes,
  }
}

async function confirmed(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error('Run with --yes to go ahead without a terminal to answer in.')
    return false
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await prompt.question('\nGo ahead? (y/N) ')
  prompt.close()
  return /^y(es)?$/i.test(answer.trim())
}

export async function runMoveCli(argv: string[]): Promise<number> {
  const args = parseMoveArgs(argv)
  const env = currentEnv()
  const open = await openSql()
  const flags: RemoteFlags = { replace: args.replace, ...(args.reposDir ? { reposDir: args.reposDir } : {}) }

  let sql: MoveSql
  try {
    sql = open(join(env.dataDir, 'runcastle.db'), { readonly: true })
  } catch {
    console.error(`No runcastle database at ${env.dataDir}.`)
    return 1
  }

  let scan: MoveScan
  let migrations: string[]
  let cleared: string[]
  try {
    scan = scanMove(env, sql, { noRepo: args.noRepo })
    migrations = sql.all<{ name: string }>('SELECT name FROM __migrations').map((r) => r.name)
    cleared = clearedCommandLines(sql)
  } finally {
    sql.close()
  }

  const running = await serverRunning(env)
  if (running) scan.report.blockers.unshift("this machine's runcastle server is running: stop it for a real move")

  const destination = args.host
    ? askDestination(args.host, questionFor(scan, migrations, env), flags)
    : undefined
  // Commands are cleared only between systems. With no host the destination is
  // unknown, so the report still warns.
  const pack = args.out ?? join(tmpdir(), `runcastle-move-${stamp()}.tar.gz`)
  const room = freeBytes(dirname(pack))
  const packMax = scan.report.dataBytes + scan.report.repoBytes
  if (room !== null && room < packMax) {
    scan.report.blockers.push(
      `not enough disk beside the pack: up to ${formatBytes(packMax)} needed, ${formatBytes(room)} free. Choose another place with --out`,
    )
  }

  const sameSystem = destination?.answer?.platform === env.platform
  const reportText = formatReport(scan.report, destination, sameSystem ? [] : cleared)
  console.log(reportText)

  if (args.dryRun) {
    console.log('\nNothing was changed.')
    return 0
  }
  if (isBlocked(scan.report, destination)) {
    console.error('\nNothing was changed. Clear the blocks above, then run this again.')
    return 1
  }
  if (!args.yes && !(await confirmed())) {
    console.log('Nothing was changed.')
    return 0
  }

  await packMove({ env, scan, open, out: pack, reportText, log: (line) => console.log(line) })
  console.log(`\nPacked: ${pack}`)

  if (!args.host) {
    console.log('\nFinish on the new machine with:')
    for (const line of manualSteps(pack, undefined, flags)) console.log(`  ${line}`)
    return 0
  }

  const copy = copyPack(pack, args.host)
  if (!copy.ok) {
    console.error(failureMessage('The copy', copy.detail, pack, args.host, flags))
    return 1
  }
  const remote = runRemoteMoveIn(pack, args.host, flags)
  if (!remote.ok) {
    console.error(failureMessage('The move on the other machine', remote.detail, pack, args.host, flags))
    return 1
  }
  rmSync(pack, { force: true })
  console.log('\nThe move is finished. This machine is unchanged and must not be used for work now.')
  return 0
}

async function readStdin(): Promise<string> {
  let text = ''
  for await (const chunk of process.stdin) text += String(chunk)
  return text
}

export async function runMoveInCli(argv: string[]): Promise<number> {
  const args = parseMoveInArgs(argv)
  const env = currentEnv()
  const open = await openSql()

  if (args.check) {
    const question = JSON.parse(await readStdin()) as DestinationQuestion
    const answer = await checkDestination(question, env, {
      replace: args.replace,
      open,
      ...(args.reposDir ? { reposDir: args.reposDir } : {}),
    })
    console.log(JSON.stringify(answer))
    return 0
  }
  if (!args.pack) {
    console.error('Usage: runcastle move-in <pack> [--replace] [--repos-dir <dir>]')
    return 1
  }
  const result = await moveIn({
    pack: args.pack,
    env,
    open,
    replace: args.replace,
    log: (line) => console.log(line),
    ...(args.reposDir ? { reposDir: args.reposDir } : {}),
  })
  console.log(`\n${formatMoveInResult(result)}`)
  return 0
}
