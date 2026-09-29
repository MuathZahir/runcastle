import { openStubTerminal } from './job-object-terminal'

/**
 * A stand-in runcastle server for the crash case: listens on a RANDOM free port
 * (never 4512 — a live runcastle holds that), opens a terminal whose MCP stand-in
 * is orphaned while the terminal stays live, prints
 * `READY {port, hostPid, nestPid, stubPid, mcpPid}`, and idles until it is killed.
 * Run BY `bun`, spawned from `job-object-win32.test.ts`, which does the judging:
 * this process is the thing that gets hard-killed, so it cannot report after.
 */

const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('ok') })

try {
  const t = await openStubTerminal('job-crash', 'nest')
  process.stdout.write(
    `READY ${JSON.stringify({
      port: server.port,
      hostPid: t.hostPid,
      nestPid: t.nestPid,
      stubPid: t.stubPid,
      mcpPid: t.mcpPid,
    })}\n`,
  )
} catch (err) {
  process.stdout.write(`FAILED ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
}

// Idle: the Bun.serve listener keeps the process alive until the test kills it.
