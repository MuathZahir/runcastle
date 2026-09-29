// Scenario A — session end. Uses runcastle's real PTY registry + killTree under Bun.
// Run from packages/server/probe/ (copied there inside the container).
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { ptyRegistry } from '../src/pty/registry'

const stub = join(import.meta.dir, 'claude-stub.cjs')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const survivors = (mode: string) =>
  execSync(`ps -eo pid,ppid,pgid,sid,args | grep "fake-mcp-${mode}" | grep -v grep || true`).toString().trim()

for (const mode of ['stay', 'exit', 'setsid']) {
  const id = `probe-${mode}`
  const entry = ptyRegistry().create({ sessionId: id, cmd: 'bash', args: ['-c', `node ${stub} ${mode}`], opts: { cwd: '/tmp', env: process.env as Record<string, string> } })
  entry.pty.onData((d) => process.stdout.write(`[${mode}] ${d}`))
  await sleep(2000)
  console.log(`\n[${mode}] before end:\n${survivors(mode) || '(none)'}`)
  await ptyRegistry().killTree(id)
  ptyRegistry().remove(id)
  await sleep(1500)
  const left = survivors(mode)
  console.log(`[${mode}] RESULT after session end: ${left ? 'LEFTOVER\n' + left : 'clean'}\n`)
}
process.exit(0)
