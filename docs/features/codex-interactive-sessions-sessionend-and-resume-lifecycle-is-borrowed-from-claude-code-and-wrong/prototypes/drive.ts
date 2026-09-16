// PTY driver for the live verification spike: spawns the codex TUI inside a
// real pty (same node-pty runcastle's launcher uses), runs a scripted
// two-turn conversation, then exits, logging raw output with timestamps.
//
// Usage: bun run drive.ts <spikeDir> [resumeSessionId]
//   spikeDir must contain codex-home/ and workdir/; output goes to
//   <spikeDir>/pty.log (raw, timestamped chunks) and the hook sink writes
//   <spikeDir>/hooks.log.
import { appendFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require2 = createRequire(import.meta.url)
const pty = require2('C:/Users/user/.bun/install/global/node_modules/node-pty')

const spikeDir = process.argv[2]
if (!spikeDir) throw new Error('usage: bun run drive.ts <spikeDir> [resumeSessionId]')
const resumeId = process.argv[3]

const ptyLog = join(spikeDir, resumeId ? 'pty-resume.log' : 'pty.log')
writeFileSync(ptyLog, `${new Date().toISOString()} SPAWN resume=${resumeId ?? 'no'}\n`)
const log = (line: string) => appendFileSync(ptyLog, `${new Date().toISOString()} ${line}\n`)

const args = [...(resumeId ? ['resume', resumeId] : []), '--dangerously-bypass-hook-trust']
const proc = pty.spawn('codex.cmd', args, {
  name: 'xterm-256color',
  cols: 120,
  rows: 32,
  cwd: join(spikeDir, 'workdir'),
  env: {
    ...process.env,
    CODEX_HOME: join(spikeDir, 'codex-home'),
    RUNCASTLE_SPIKE_DIR: spikeDir,
  },
})

let alive = true
let updateModalHandled = false
proc.onData((d: string) => {
  log(`OUT ${JSON.stringify(d)}`)
  // The synthetic-home update prompt blocks the composer; pick option 3
  // ("Skip until next version") so the run proceeds without self-updating.
  if (!updateModalHandled && d.includes('Update available')) {
    updateModalHandled = true
    setTimeout(() => {
      log('MODAL update-available: sending 3 + enter')
      write('3')
      setTimeout(() => write('\r'), 300)
    }, 500)
  }
})
proc.onExit(({ exitCode }: { exitCode: number }) => {
  alive = false
  log(`EXIT code=${exitCode}`)
})

const write = (data: string) => {
  try {
    proc.write(data)
  } catch (err) {
    log(`WRITE-FAILED ${JSON.stringify(String(err))} alive=${alive}`)
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const type = async (text: string) => {
  log(`TYPE ${JSON.stringify(text)}`)
  write(text)
  await sleep(400)
  log('TYPE <enter>')
  write('\r')
}

await sleep(20_000) // idle window: does anything fire before the first turn?
if (alive) await type('Reply with exactly the word pong and nothing else.')
await sleep(30_000) // turn 1 completes in here — watch for Stop/SessionEnd
if (alive) await type('Reply with exactly the word pong2 and nothing else.')
await sleep(30_000) // turn 2 completes in here
if (alive) {
  log('SEND ctrl-c')
  write('\x03')
  await sleep(1500)
}
if (alive) {
  log('SEND ctrl-c (2)')
  write('\x03')
  await sleep(6000)
}
if (alive) {
  log('KILL still alive after double ctrl-c')
  proc.kill()
  await sleep(2000)
}
log('DRIVER DONE')
