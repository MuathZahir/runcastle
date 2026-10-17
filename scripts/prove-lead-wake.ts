/**
 * Live proof that a feature's lead is woken (`the-feature-lead-runs-rounds`
 * decision 12): a runcastle message delivered with `deliverToLead` to a lead
 * whose terminal is OPEN (Claude Code: the turn-end waiter; Codex: `codex
 * queue`) and to one whose terminal is CLOSED (a headless resume), each shown to
 * run a real turn of the real CLI.
 *
 * Run on a host where the CLI is installed and logged in:
 *
 *   bun scripts/prove-lead-wake.ts claude-code [--model <id>] [--only live|headless]
 *   bun scripts/prove-lead-wake.ts codex       [--model <id>] [--only live|headless]
 *
 * It serves an in-process runcastle on a scratch data dir and port
 * (RUNCASTLE_DATA_DIR / RUNCASTLE_SERVER_PORT, default 4599 — your own server
 * and data are untouched) over a scratch git repo, and asserts:
 *
 * - headless: `lead.woken_headless`, the resumed CLI reporting in through its
 *   SessionStart hook, the proof word in its transcript, a clean exit; and a
 *   message sent DURING that run delivered by the next resume, not dropped.
 * - live: an interactive chat opened in a PTY, its kickoff turn left to end;
 *   then a message delivered — `lead.woke` on Claude Code (the waiter took it at
 *   the turn end) or `lead.message_queued` via codex queue on Codex — and the
 *   proof word appearing in the transcript, i.e. the turn ran.
 *
 * Real model turns: it spends a few cents. Exits non-zero on the first failure.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runtime = process.argv[2]
if (runtime !== 'claude-code' && runtime !== 'codex') {
  console.error('usage: bun scripts/prove-lead-wake.ts claude-code|codex [--model <id>] [--only live|headless]')
  process.exit(2)
}
const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}
const model = flag('--model') ?? (runtime === 'codex' ? 'gpt-5.5' : 'claude-sonnet-5-5')
const only = flag('--only')

const SCRATCH = join(tmpdir(), 'runcastle-prove-lead-wake')
rmSync(SCRATCH, { recursive: true, force: true })
const TARGET = join(SCRATCH, 'target')
mkdirSync(TARGET, { recursive: true })
process.env.RUNCASTLE_DATA_DIR = join(SCRATCH, 'data')
process.env.RUNCASTLE_SERVER_PORT = process.env.RUNCASTLE_SERVER_PORT ?? '4599'

// After the env is set, so paths and config read it.
const paths = await import('../packages/core/src/paths.ts')
const { loadConfig } = await import('../packages/core/src/config-load.ts')
const { createDb } = await import('../packages/server/src/db/client.ts')
const { runMigrations } = await import('../packages/server/src/db/migrate.ts')

const { buildApp } = await import('../packages/server/src/index.ts')
const { appRouter } = await import('../packages/server/src/trpc/router.ts')
const { createCallerFactory } = await import('../packages/server/src/trpc/context.ts')
const { endSession, launchSession } = await import('../packages/server/src/launcher/launcher.ts')
const { getSessionRow } = await import('../packages/server/src/launcher/sessions.ts')
const { listAfter } = await import('../packages/server/src/services/events.ts')
const { deliverToLead, startLeadWaker } = await import('../packages/server/src/services/lead-delivery.ts')
const { getFeatureRow, setPhase } = await import('../packages/server/src/services/repo.ts')


const WORD = 'LEADWOKE'
const proofText = (n: number): string =>
  `[runcastle] Wake proof ${n}: reply with exactly the word ${WORD}${n} and nothing else. Call no tools.`

function log(msg: string): void {
  process.stdout.write(`${msg}\n`)
}
function fail(msg: string): never {
  log(`  ✗ ${msg}`)
  process.exit(1)
}
function git(...args: string[]): void {
  execFileSync('git', args, { cwd: TARGET, stdio: 'ignore' })
}

mkdirSync(paths.dataDir(), { recursive: true })
const db = createDb(paths.dbPath())
runMigrations(db)
const baseConfig = loadConfig()
const ctx = {
  db,
  config: { ...baseConfig, model, models: [{ id: model, runtime }] },
} as never as Parameters<typeof buildApp>[0]
const app = buildApp(ctx)
const server = Bun.serve({ port: ctx.config.serverPort, fetch: app.fetch, idleTimeout: 0 })
startLeadWaker(ctx)
const trpc = createCallerFactory(appRouter)(ctx as never)
log(`prove-lead-wake — ${runtime} (${model}), server :${server.port}, data ${paths.dataDir()}`)

writeFileSync(join(TARGET, 'README.md'), '# Wake proof target\n', 'utf8')
git('init', '-b', 'main')
git('config', 'user.email', 'prove@runcastle.dev')
git('config', 'user.name', 'Runcastle Prove')
git('add', '-A')
git('commit', '-m', 'chore: initial commit')
const project = await trpc.project.open({ repoPath: TARGET })
const created = await trpc.feature.create({
  projectId: project.id,
  title: 'wake proof',
  oneLiner: 'prove the lead wakes',
})
// Past Go, as a lead is: set directly, so no Go wake runs before the proof's own.
setPhase(ctx, created.id, 'building')
const featureId = created.id

const eventsOf = (type: string) =>
  listAfter(ctx, featureId, 0)
    .filter((e) => e.type === type)
    .map((e) => ({ ...e, data: (e.data ?? {}) as Record<string, unknown> }))

async function until<T>(what: string, probe: () => T | undefined | null | false, timeoutMs = 300_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() > deadline) fail(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 1000))
  }
}

function transcriptHas(sessionId: string, text: string): boolean {
  const path = getSessionRow(ctx, sessionId)?.transcriptPath
  return !!path && existsSync(path) && readFileSync(path, 'utf8').includes(text)
}

async function proveHeadless(): Promise<void> {
  log('\n▶ headless — no terminal open')
  const before = eventsOf('lead.woken_headless').length
  await deliverToLead(ctx, getFeatureRow(ctx, featureId), { text: proofText(1), source: 'runcastle' })
  const woken = await until('lead.woken_headless', () => eventsOf('lead.woken_headless')[before])
  const sessionId = String(woken.data.sessionId)
  log(`  ✓ resumed headless as ${sessionId}`)
  // Sent while that run is going: must ride the next resume.
  await deliverToLead(ctx, getFeatureRow(ctx, featureId), { text: proofText(2), source: 'runcastle' })
  await until('the CLI to report in (SessionStart hook)', () => getSessionRow(ctx, sessionId)?.ccSessionId)
  const exited = await until('the run to exit', () =>
    eventsOf('session.pty_exited').find((e) => e.data.sessionId === sessionId),
  )
  if (exited.data.exitCode !== 0) fail(`headless run exited ${String(exited.data.exitCode)}`)
  if (!transcriptHas(sessionId, `${WORD}1`)) fail(`no ${WORD}1 in the transcript — the turn did not run`)
  log(`  ✓ turn ran: ${WORD}1 in the transcript, exit 0`)
  const next = await until('the held message’s resume', () => eventsOf('lead.woken_headless')[before + 1])
  const nextId = String(next.data.sessionId)
  await until('the second run to exit', () =>
    eventsOf('session.pty_exited').find((e) => e.data.sessionId === nextId),
  )
  if (!transcriptHas(nextId, `${WORD}2`)) fail(`no ${WORD}2 in the second transcript`)
  log(`  ✓ the message sent mid-run was delivered by the next resume (${nextId})`)
}

async function proveLive(): Promise<void> {
  log('\n▶ live — terminal open')
  const { sessionId } = await launchSession(ctx, { featureId, kind: 'chat' })
  await until('the chat to go live', () => getSessionRow(ctx, sessionId)?.status === 'live')
  await until('its kickoff turn to end', () => getSessionRow(ctx, sessionId)?.awaitingInput === true, 600_000)
  log(`  ✓ chat ${sessionId} live and idle`)
  await deliverToLead(ctx, getFeatureRow(ctx, featureId), { text: proofText(3), source: 'runcastle' })
  const queued = eventsOf('lead.message_queued').at(-1)
  log(`  ✓ queued via ${String(queued?.data.route)}`)
  if (runtime === 'claude-code') {
    await until('lead.woke (the waiter took it)', () =>
      eventsOf('lead.woke').find((e) => e.data.sessionId === sessionId),
    )
    log('  ✓ lead.woke — the turn-end waiter handed it over')
  }
  await until(`${WORD}3 in the transcript`, () => transcriptHas(sessionId, `${WORD}3`))
  log(`  ✓ turn ran: ${WORD}3 in the live session's transcript`)
  endSession(ctx, sessionId)
}

try {
  if (only !== 'live') await proveHeadless()
  if (only !== 'headless') await proveLive()
  log(`\nPROVEN on ${runtime}: ${only ?? 'headless and live'}`)
} finally {
  server.stop(true)
}
process.exit(0)
