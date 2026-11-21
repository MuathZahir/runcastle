import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listProcesses, parseCimProcesses, parsePsWithEnv, pickLeftovers, sweepLeftoverAgents, type ProcInfo } from '../src/services/leftover-agents'
import { processesWith, until } from './helpers/processes'

/**
 * The start-up clean (stopping-a-session-kills-its-process decisions 5, 6): only
 * processes carrying this server's own mark are ended, never the server's own
 * agents, the processes it runs under, another install's, or the human's.
 */

const URL = 'http://localhost:4512'
const mark = { serverUrl: URL, dataDir: '/home/u/.runcastle', selfPid: 100 }
const agentEnv = (url = URL) => ({ RUNCASTLE_SESSION_ID: 'sess_1', RUNCASTLE_SERVER_URL: url })

describe('pickLeftovers', () => {
  const procs: ProcInfo[] = [
    { pid: 1, ppid: 0, command: 'init', env: {} },
    // A runcastle terminal the server was restarted from: marked, but the server runs under it.
    { pid: 50, ppid: 1, pgid: 50, command: 'bash', env: agentEnv() },
    { pid: 100, ppid: 50, pgid: 50, command: 'bun runcastle', env: agentEnv() },
    // The server's own agent and its claude.
    { pid: 101, ppid: 100, pgid: 101, command: 'bun claude-agent-acp/dist/index.js', env: agentEnv() },
    { pid: 102, ppid: 101, pgid: 101, command: 'claude --resume=a', env: agentEnv() },
    // A dead run's adapter and claude, now children of init.
    { pid: 200, ppid: 1, pgid: 9, command: 'bun claude-agent-acp/dist/index.js', env: agentEnv() },
    { pid: 201, ppid: 200, pgid: 9, command: 'claude --resume=b', env: agentEnv() },
    // Another install (the dev server's port), and the human's own claude.
    { pid: 300, ppid: 1, command: 'claude', env: agentEnv('http://localhost:4600') },
    { pid: 400, ppid: 1, command: 'claude', env: { HOME: '/home/u' } },
  ]

  it('picks only a dead run’s marked processes', () => {
    expect(pickLeftovers(procs, mark).map((p) => p.pid)).toEqual([200, 201])
  })

  it('matches by settings path where the environment is unreadable, with the adapter above it', () => {
    const win: ProcInfo[] = [
      { pid: 100, ppid: 1, command: 'bun.exe runcastle' },
      { pid: 200, ppid: 1, command: 'bun.exe --no-env-file C:\\x\\node_modules\\@agentclientprotocol\\claude-agent-acp\\dist\\index.js' },
      { pid: 201, ppid: 200, command: 'claude.exe --settings C:\\Users\\u\\.runcastle\\sessions\\sess_1\\settings.json --resume=b' },
      // Another data folder's claude, and a claude with no settings at all.
      { pid: 300, ppid: 1, command: 'claude.exe --settings C:\\Users\\u\\.runcastle-dev\\sessions\\sess_2\\settings.json' },
      { pid: 400, ppid: 1, command: 'claude.exe' },
    ]
    const picked = pickLeftovers(win, { serverUrl: URL, dataDir: 'C:\\Users\\u\\.runcastle', selfPid: 100 })
    expect(picked.map((p) => p.pid).sort()).toEqual([200, 201])
  })
})

describe('listing parsers', () => {
  it('reads macOS `ps -E` lines, environment appended', () => {
    const procs = parsePsWithEnv(
      [
        '  200     1     9 /bin/bun claude-agent-acp/dist/index.js RUNCASTLE_SESSION_ID=sess_1 RUNCASTLE_SERVER_URL=http://localhost:4512 HOME=/u',
        '  300     1   300 claude RUNCASTLE_SESSION_ID=sess_2 RUNCASTLE_SERVER_URL=http://localhost:45120',
        '  400     1   400 claude HOME=/u',
        '',
      ].join('\n'),
    )
    expect(procs.map((p) => [p.pid, p.ppid, p.pgid])).toEqual([
      [200, 1, 9],
      [300, 1, 300],
      [400, 1, 400],
    ])
    // A longer port that merely starts with this one is another server.
    expect(pickLeftovers(procs, { ...mark, selfPid: 1 }).map((p) => p.pid)).toEqual([200])
  })

  it('reads Windows `Get-CimInstance` JSON, one row or many', () => {
    expect(parseCimProcesses('{"ProcessId":5,"ParentProcessId":4,"CommandLine":"claude.exe"}')).toEqual([{ pid: 5, ppid: 4, command: 'claude.exe' }])
    expect(parseCimProcesses('[{"ProcessId":5,"ParentProcessId":4,"CommandLine":null}]')).toEqual([{ pid: 5, ppid: 4, command: '' }])
    expect(parseCimProcesses('not json')).toEqual([])
  })
})

describe('sweepLeftoverAgents', () => {
  it('never fails the boot when the listing fails', async () => {
    const n = await sweepLeftoverAgents(mark, {
      list: () => Promise.reject(new Error('no ps')),
    })
    expect(n).toEqual({ found: 0, ended: 0 })
  })

  it('counts a leftover that survived its stop as found, not ended', async () => {
    const left: ProcInfo = { pid: 900, ppid: 1, pgid: 900, command: 'claude', env: { RUNCASTLE_SESSION_ID: 's', RUNCASTLE_SERVER_URL: mark.serverUrl } }
    const n = await sweepLeftoverAgents(mark, {
      list: async () => [left],
      stop: async () => ({ gone: false, forced: true }),
    })
    expect(n).toEqual({ found: 1, ended: 0 })
  })
})

const tags: string[] = []
afterEach(() => {
  for (const tag of tags.splice(0)) for (const pid of processesWith(tag)) try { process.kill(pid, 'SIGKILL') } catch {}
})

describe.runIf(process.platform === 'linux')('the start-up clean on Linux, for real', () => {
  const FIXTURE = join(__dirname, 'fixtures', 'process-tree.cjs')
  /** A leftover of a dead server: a child of nobody here, with `env` as its environment. */
  function orphan(tag: string, env: Record<string, string>): void {
    spawn(process.execPath, [FIXTURE, 'orphan', tag], { stdio: 'ignore', env: { PATH: process.env.PATH ?? '', ...env } })
  }

  it('ends a dead run’s marked process and leaves the others', async () => {
    // A port nobody runs on, so no live agent of this machine ever matches.
    const url = `http://localhost:${40000 + (process.pid % 20000)}-test`
    const stamp = `${process.pid}-${Date.now().toString(36)}`
    const [ours, other, unmarked] = [`rc-left-ours-${stamp}`, `rc-left-other-${stamp}`, `rc-left-none-${stamp}`]
    tags.push(ours, other, unmarked)
    orphan(ours, { RUNCASTLE_SESSION_ID: 'sess_x', RUNCASTLE_SERVER_URL: url })
    orphan(other, { RUNCASTLE_SESSION_ID: 'sess_y', RUNCASTLE_SERVER_URL: `${url}0` })
    orphan(unmarked, {})
    // The leftover itself, not the short-lived process that starts it.
    await until(() => [ours, other, unmarked].every((t) => processesWith(`--resume=${t}`).length === 1), 'the orphans to start')

    const n = await sweepLeftoverAgents({ serverUrl: url, dataDir: '/nowhere', selfPid: process.pid })

    expect(n).toEqual({ found: 1, ended: 1 })
    expect(processesWith(ours)).toEqual([])
    expect(processesWith(other)).toHaveLength(1)
    expect(processesWith(unmarked)).toHaveLength(1)
  })

  it('never lists this test’s own descendants as leftovers', async () => {
    const procs = await listProcesses()
    expect(procs.some((p) => p.pid === process.pid)).toBe(true)
    const url = process.env.RUNCASTLE_SERVER_URL ?? URL
    // Whatever runs this test is marked if an agent started it; none of it is picked.
    const picked = pickLeftovers(procs, { serverUrl: url, dataDir: '/nowhere', selfPid: process.pid })
    const mine = new Set<number>([process.pid, process.ppid])
    expect(picked.filter((p) => mine.has(p.pid))).toEqual([])
  })
})
