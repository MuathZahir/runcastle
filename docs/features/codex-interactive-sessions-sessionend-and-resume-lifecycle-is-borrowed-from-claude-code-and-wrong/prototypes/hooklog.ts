// Hook sink: mimics runcastle's hook-client shape (invoked per event, payload
// on stdin as JSON) but just appends a timestamped line to hooks.log in the
// directory named by RUNCASTLE_SPIKE_DIR.
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.env.RUNCASTLE_SPIKE_DIR
if (!dir) throw new Error('RUNCASTLE_SPIKE_DIR not set')
const logPath = join(dir, 'hooks.log')
const event = process.argv[2] ?? 'unknown'

let stdin = ''
for await (const chunk of process.stdin) stdin += chunk

appendFileSync(
  logPath,
  `${new Date().toISOString()} EVENT=${event} PAYLOAD=${stdin.replace(/\r?\n/g, ' ').trim()}\n`,
)
