// Scenario B — server crash. Listens on :4512 with Bun.serve (as index.ts does) and
// opens a real registry PTY running the claude stub; the harness then kill -9s us.
import { join } from 'node:path'
import { ptyRegistry } from '../src/pty/registry'

const mode = process.argv[2] ?? 'stay'
Bun.serve({ port: 4512, hostname: '127.0.0.1', fetch: () => new Response('ok') })
ptyRegistry().create({
  sessionId: 'crash',
  cmd: 'bash',
  args: ['-c', `node ${join(import.meta.dir, 'claude-stub.cjs')} ${mode}`],
  opts: { cwd: '/tmp', env: process.env as Record<string, string> },
})
console.log('server pid', process.pid, 'listening :4512 mode', mode)
