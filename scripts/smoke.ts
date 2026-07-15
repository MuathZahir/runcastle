/**
 * Scripted end-to-end smoke test (SPEC §11).
 *
 * Drives the WHOLE runcastle pipeline in-process against a throwaway target repo
 * and a throwaway `~/.runcastle` data dir, performing a REAL (cheap, host) claude
 * burn on trivial tickets:
 *
 *   git target repo → project.init → feature.create → fabricate ideation session
 *   → hooks/session-start → MCP emit_tickets + complete_phase → feature.burn
 *   (noSandbox, smokeModel) → poll run/events → testDrive start/stop → merge.
 *
 * Run: `bun run scripts/smoke.ts`
 *
 * Design notes:
 * - The app is built in-process via `buildApp(ctx)` (which now injects the boot
 *   handle via `setRuntimeCtx`, so hooks + MCP share the one db). tRPC is driven
 *   through the in-process caller (full router + error middleware + services);
 *   the hooks (`/api/hooks/*`) and MCP (`/mcp`) HTTP endpoints are driven through
 *   the real Hono app via `app.request(...)`.
 * - `~/.runcastle` is redirected by overriding USERPROFILE/HOME (the only knob
 *   core `paths.ts` honours) BEFORE importing anything, so the smoke never
 *   touches the developer's real data dir.
 * - CLAUDE_CONFIG_DIR is pinned to the developer's REAL `~/.claude` so the
 *   burner's host `claude` (spawned under the redirected home) still finds its
 *   credentials.
 * - The target repo gitignores `.sandcastle/` (sandcastle's scratch) and `docs/`
 *   (feature knowledge docs) so the main checkout stays clean for test-drive and
 *   merge; gate checks read those files off disk via existsSync regardless.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// --- env setup (MUST precede any core/server import that resolves paths) ------

const SCRATCH =
  'C:/Users/user/AppData/Local/Temp/claude/C--Users-user-Projects--Active-/d5f87a03-170a-482c-ad5d-f35dee8ebb4c/scratchpad'
const SMOKE_HOME = join(SCRATCH, 'smoke-home')
const TARGET = join(SCRATCH, 'smoke-target')

const REAL_HOME = homedir() // capture before we override USERPROFILE/HOME
process.env.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR ?? join(REAL_HOME, '.claude')

rmSync(SMOKE_HOME, { recursive: true, force: true })
rmSync(TARGET, { recursive: true, force: true })
mkdirSync(SMOKE_HOME, { recursive: true })

process.env.USERPROFILE = SMOKE_HOME
process.env.HOME = SMOKE_HOME

// --- dynamic imports (after env is set so lazy homedir() reads the temp home) --

const paths = await import('../packages/core/src/paths.ts')
const { loadConfig } = await import('../packages/core/src/config-load.ts')
const { createDb } = await import('../packages/server/src/db/client.ts')
const { runMigrations } = await import('../packages/server/src/db/migrate.ts')
const { buildApp } = await import('../packages/server/src/index.ts')
const { appRouter } = await import('../packages/server/src/trpc/router.ts')
const { createCallerFactory } = await import('../packages/server/src/trpc/context.ts')
const { launchSession, converge } = await import('../packages/server/src/launcher/launcher.ts')
const { cancelRun } = await import('../packages/server/src/workflows/runner.ts')

// --- tiny harness -------------------------------------------------------------

type StepResult = { name: string; ok: boolean; detail: string }
const results: StepResult[] = []

function log(msg: string): void {
  process.stdout.write(`${msg}\n`)
}
function banner(step: string): void {
  log(`\n${'='.repeat(72)}\n▶ ${step}\n${'='.repeat(72)}`)
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`)
}
function record(name: string, detail: string): void {
  results.push({ name, ok: true, detail })
  log(`  ✓ ${name} — ${detail}`)
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

// --- boot the app -------------------------------------------------------------

mkdirSync(paths.dataDir(), { recursive: true })
const db = createDb(paths.dbPath())
runMigrations(db)
const config = loadConfig()
const ctx = { db, config } as { db: typeof db; config: typeof config }
const app = buildApp(ctx as never)
const trpc = createCallerFactory(appRouter)(ctx as never)

log(`runcastle smoke — data dir: ${paths.dataDir()}`)
log(`smokeModel = ${config.smokeModel}`)

// --- HTTP helpers over the in-process app ------------------------------------

async function postHook(event: string, body: unknown): Promise<any> {
  const res = await app.request(`/api/hooks/${event}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

interface McpCallResult {
  isError: boolean
  data: any
  raw: any
}
async function mcp(sessionId: string, body: unknown): Promise<any> {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'X-Runcastle-Session': sessionId,
    },
    body: JSON.stringify(body),
  })
  return res.json()
}
async function mcpToolCall(
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpCallResult> {
  const body = await mcp(sessionId, {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name, arguments: args },
  })
  const result = body.result
  const text = result?.content?.[0]?.text
  let data: any = text
  try {
    data = JSON.parse(text)
  } catch {
    /* leave as raw text */
  }
  return { isError: !!result?.isError, data, raw: body }
}

// --- the run ------------------------------------------------------------------

async function main(): Promise<void> {
  // (1) temp target repo -------------------------------------------------------
  banner('STEP 1 — create temp target repo (git init + tiny bun app + commit)')
  mkdirSync(join(TARGET, 'src'), { recursive: true })
  git(TARGET, 'init', '-b', 'main')
  git(TARGET, 'config', 'user.email', 'smoke@runcastle.dev')
  git(TARGET, 'config', 'user.name', 'Runcastle Smoke')
  git(TARGET, 'config', 'core.autocrlf', 'false')
  // gitignore the tool's scratch (.sandcastle) + feature docs so the main
  // checkout stays clean for test-drive/merge; gates read docs off disk anyway.
  writeFileSync(join(TARGET, '.gitignore'), '.sandcastle/\ndocs/\nnode_modules/\n', 'utf8')
  writeFileSync(
    join(TARGET, 'package.json'),
    `${JSON.stringify(
      { name: 'smoke-target', private: true, type: 'module', scripts: { start: 'bun src/index.ts' } },
      null,
      2,
    )}\n`,
    'utf8',
  )
  writeFileSync(join(TARGET, 'src', 'index.ts'), `console.log('hello from smoke target')\n`, 'utf8')
  writeFileSync(join(TARGET, 'README.md'), '# Smoke Target\n\nA throwaway bun app for the runcastle smoke.\n', 'utf8')
  git(TARGET, 'add', '-A')
  git(TARGET, 'commit', '-m', 'chore: initial commit')
  assert(git(TARGET, 'rev-parse', '--abbrev-ref', 'HEAD') === 'main', 'target on main')
  assert(git(TARGET, 'rev-list', '--count', 'HEAD') === '1', 'one seed commit')
  record('target repo', `git repo at ${TARGET} on main with 1 commit`)

  // (2) project.init -----------------------------------------------------------
  banner('STEP 2 — tRPC project.init')
  const project = await trpc.project.init({ repoPath: TARGET })
  assert(project.repoPath === TARGET, 'project.repoPath === target')
  assert(project.mainBranch === 'main', 'project.mainBranch === main')
  record('project.init', `project ${project.id} @ ${project.mainBranch}`)

  // (3) feature.create ---------------------------------------------------------
  banner('STEP 3 — tRPC feature.create (collapsed)')
  const feature = await trpc.feature.create({
    title: 'health check file',
    oneLiner: 'add a HEALTH.md file to prove the pipeline works end to end',
    size: 'collapsed',
  })
  assert(feature.slug === 'health-check-file', `slug is health-check-file (got ${feature.slug})`)
  assert(feature.phase === 'ideation', 'phase ideation')
  assert(feature.branch === 'feature/health-check-file', 'branch feature/health-check-file')
  const branches = git(TARGET, 'branch', '--list', 'feature/health-check-file')
  assert(branches.includes('feature/health-check-file'), 'real feature branch created')
  const featureId = feature.id
  const slug = feature.slug
  record('feature.create', `${featureId} slug=${slug} branch=${feature.branch}`)

  // (4) fabricate ideation session (spawn:false) + decisions.md ----------------
  banner('STEP 4 — fabricate ideation session (launchSession spawn:false) + decisions.md')
  const { sessionId } = await launchSession(ctx as never, { featureId, kind: 'ideation' }, { spawn: false })
  assert(!!sessionId, 'sessionId returned')
  const worktree = paths.worktreeDir(project.id, slug)
  assert(existsSync(worktree), `talk worktree exists at ${worktree}`)
  assert(
    git(worktree, 'rev-parse', '--abbrev-ref', 'HEAD') === 'feature/health-check-file',
    'talk worktree checked out to feature branch',
  )
  // A real grill writes decisions incrementally into the talk worktree; write a
  // 2-line decisions.md so the ideation→tickets gate (G1) is satisfiable.
  const docsDir = join(worktree, ...paths.featureDocsRel(slug).split('/'))
  mkdirSync(docsDir, { recursive: true })
  writeFileSync(
    join(docsDir, 'decisions.md'),
    '# Decisions\n\n- Ship a HEALTH.md file containing `ok`, then append `checked`.\n',
    'utf8',
  )
  record('launchSession', `session ${sessionId}; worktree live on feature branch; decisions.md written`)

  // (5) hooks POST /api/hooks/session-start ------------------------------------
  banner('STEP 5 — POST /api/hooks/session-start → additionalContext + session live')
  const hookJson = await postHook('session-start', {
    sessionId,
    payload: {
      session_id: 'cc-smoke-001',
      transcript_path: '/tmp/smoke-transcript.jsonl',
      hook_event_name: 'SessionStart',
      source: 'startup',
    },
  })
  assert(hookJson?.hookSpecificOutput?.hookEventName === 'SessionStart', 'verified nested SessionStart shape')
  const addCtx: string = hookJson.hookSpecificOutput.additionalContext
  assert(typeof addCtx === 'string' && addCtx.length > 0, 'additionalContext present')
  assert(addCtx.includes('[runcastle]'), 'additionalContext carries [runcastle] brief')
  assert(addCtx.includes('health check file'), 'additionalContext carries feature title')
  assert(addCtx.includes('phase: ideation'), 'additionalContext carries phase')
  assert(addCtx.includes('get_feature_context'), 'additionalContext points at MCP')
  const liveSession = await trpc.feature.get({ id: featureId })
  const sess = liveSession.sessions.find((s: any) => s.id === sessionId)
  assert(sess?.status === 'live', `session went live (status=${sess?.status})`)
  assert(sess?.ccSessionId === 'cc-smoke-001', 'ccSessionId stored')
  record('hooks/session-start', 'additionalContext (nested) + session live + ccSessionId stored')

  // (6) MCP emit_tickets + complete_phase --------------------------------------
  banner('STEP 6 — MCP initialize + emit_tickets(2) + complete_phase (ideation→tickets)')
  const init = await mcp(sessionId, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } },
  })
  assert(init?.result?.serverInfo?.name === 'runcastle', 'MCP initialize → serverInfo.runcastle')

  const emit = await mcpToolCall(sessionId, 'emit_tickets', {
    tickets: [
      {
        title: 'Create HEALTH.md containing exactly: ok',
        goal: 'Create a file named HEALTH.md at the repository root whose entire contents are exactly the two characters "ok" (lowercase), followed by a single trailing newline. Do not add anything else.',
        context: 'This is a fresh minimal repo. No existing HEALTH.md. Just create the file at the repo root.',
        acceptanceCriteria: ['HEALTH.md exists at the repo root', 'HEALTH.md contains exactly: ok'],
        seams: ['HEALTH.md'],
        blockedBy: [],
      },
      {
        title: 'Append the line: checked',
        goal: 'Append a new line containing exactly the word "checked" to the existing HEALTH.md at the repository root. Keep the existing "ok" line intact.',
        context: 'HEALTH.md was created by ticket 1 and currently contains the single line "ok".',
        acceptanceCriteria: ['HEALTH.md still contains the line "ok"', 'HEALTH.md has a new line "checked" appended'],
        seams: ['HEALTH.md'],
        blockedBy: [1],
      },
    ],
  })
  assert(!emit.isError, `emit_tickets not an error (${JSON.stringify(emit.data)})`)
  assert(emit.data.stored === 2, `2 tickets stored (got ${emit.data.stored})`)
  assert(Array.isArray(emit.data.ids) && emit.data.ids.length === 2, 'emit_tickets returned 2 ids')
  const afterEmit = await trpc.feature.get({ id: featureId })
  assert(afterEmit.tickets.length === 2, '2 tickets in db')
  const t2 = afterEmit.tickets.find((t: any) => t.seq === 2)
  assert(JSON.stringify(t2?.blockedBy) === '[1]', `ticket seq2 blockedBy resolves to [1] (got ${JSON.stringify(t2?.blockedBy)})`)
  record('MCP emit_tickets', `stored 2 tickets; seq2 blockedBy=[1]`)

  const complete = await mcpToolCall(sessionId, 'complete_phase', { phase: 'ideation' })
  assert(!complete.isError, 'complete_phase not an error')
  assert(complete.data.ok === true, `complete_phase ok (got ${JSON.stringify(complete.data)})`)
  assert(complete.data.nextPhase === 'tickets', `advanced to tickets (got ${complete.data.nextPhase})`)
  const afterComplete = await trpc.feature.get({ id: featureId })
  assert(afterComplete.feature.phase === 'tickets', 'feature phase is tickets')
  record('MCP complete_phase', 'ideation→tickets via G1 (decisions.md)')

  // (7) feature.burn — REAL noSandbox claude runs on the host ------------------
  banner('STEP 7 — tRPC feature.burn (RUNCASTLE_SANDBOX=noSandbox, RUNCASTLE_MODEL=smokeModel)')
  process.env.RUNCASTLE_SANDBOX = 'noSandbox'
  process.env.RUNCASTLE_MODEL = config.smokeModel
  log(`  burning with sandbox=noSandbox model=${config.smokeModel} (real host claude — trivial tickets)`)
  const { runId } = await trpc.feature.burn({ featureId })
  assert(!!runId, 'burn returned a runId')
  log(`  runId=${runId}; polling run/events (budget 10 min)…`)

  // poll run.get + events.list (afterId cursor) until terminal
  const DEADLINE = Date.now() + 10 * 60 * 1000
  let cursor = 0
  const seenIds: number[] = []
  const seenTypes = new Set<string>()
  let status = 'running'
  let summary = ''
  while (true) {
    const evs = await trpc.events.list({ featureId, afterId: cursor })
    for (const e of evs) {
      assert(e.id > cursor, `events.list afterId cursor monotonic (id ${e.id} > cursor ${cursor})`)
      seenIds.push(e.id)
      seenTypes.add(e.type)
      cursor = e.id
      if (['ticket.burning', 'ticket.done', 'ticket.failed', 'burn.summary', 'run.finished'].includes(e.type)) {
        log(`    · [${e.id}] ${e.type}: ${e.message}`)
      }
    }
    const run = await trpc.run.get({ runId })
    status = run.status
    summary = run.summary ?? ''
    if (status !== 'running') break
    if (Date.now() > DEADLINE) {
      cancelRun(runId)
      throw new Error('BUDGET GUARD: burn exceeded 10 minutes — cancelled')
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  // afterId cursor sanity: ids strictly increasing + unique
  const strictlyIncreasing = seenIds.every((id, i) => i === 0 || id > seenIds[i - 1])
  const unique = new Set(seenIds).size === seenIds.length
  assert(strictlyIncreasing && unique, 'events afterId paging yielded strictly-increasing unique ids')
  assert(seenTypes.has('run.started'), 'saw run.started event')
  assert(seenTypes.has('run.finished'), 'saw run.finished event')
  assert(status === 'succeeded', `run succeeded (status=${status}, summary=${summary})`)

  const afterBurn = await trpc.feature.get({ id: featureId })
  const doneCount = afterBurn.tickets.filter((t: any) => t.status === 'done').length
  assert(doneCount === 2, `both tickets done (got ${doneCount}; statuses=${afterBurn.tickets.map((t: any) => t.status).join(',')})`)
  // commits landed on the feature branch
  const featCommits = git(TARGET, 'log', '--oneline', 'feature/health-check-file').split('\n').filter(Boolean)
  assert(featCommits.length >= 3, `feature branch has burn commits (${featCommits.length} total incl. seed)`)
  const healthOnBranch = git(TARGET, 'show', 'feature/health-check-file:HEALTH.md')
  assert(/\bok\b/.test(healthOnBranch), 'HEALTH.md on feature branch contains ok')
  assert(/\bchecked\b/.test(healthOnBranch), 'HEALTH.md on feature branch contains checked')
  record('feature.burn', `run succeeded — 2/2 tickets done, ${featCommits.length - 1} commit(s) on branch, HEALTH.md = ok+checked`)

  // (8) testDrive start/stop ---------------------------------------------------
  banner('STEP 8 — tRPC feature.testDrive start → stop (with a live talk worktree)')
  const dStart = await trpc.feature.testDrive({ featureId, action: 'start' })
  assert(dStart.ok === true, `test drive started (deniedReason=${dStart.deniedReason})`)
  assert(dStart.branch === 'feature/health-check-file', 'test drive switched main to the feature branch')
  assert(git(TARGET, 'rev-parse', '--abbrev-ref', 'HEAD') === 'feature/health-check-file', 'main checkout on feature branch')
  assert(existsSync(join(TARGET, 'HEALTH.md')), 'HEALTH.md present in main checkout while test-driving')
  const dStop = await trpc.feature.testDrive({ featureId, action: 'stop' })
  assert(dStop.ok === true, 'test drive stopped')
  assert(git(TARGET, 'rev-parse', '--abbrev-ref', 'HEAD') === 'main', 'main checkout restored to main')
  assert(!existsSync(join(TARGET, 'HEALTH.md')), 'HEALTH.md gone from main working tree after stop (not yet merged)')
  record('feature.testDrive', 'start switched to feature branch, stop restored main')

  // (9) merge ------------------------------------------------------------------
  banner('STEP 9 — tRPC feature.merge → phase shipped + HEALTH.md on main')
  const merge = await trpc.feature.merge({ featureId })
  assert(merge.ok === true, `merge ok (conflict=${merge.conflict})`)
  assert(!merge.conflict, 'no conflict')
  const shipped = await trpc.feature.get({ id: featureId })
  assert(shipped.feature.phase === 'shipped', `feature phase shipped (got ${shipped.feature.phase})`)
  assert(git(TARGET, 'rev-parse', '--abbrev-ref', 'HEAD') === 'main', 'still on main after merge')
  const healthOnMain = git(TARGET, 'show', 'main:HEALTH.md')
  assert(/\bok\b/.test(healthOnMain) && /\bchecked\b/.test(healthOnMain), 'HEALTH.md on main contains ok + checked')
  assert(existsSync(join(TARGET, 'HEALTH.md')), 'HEALTH.md present in main working tree after merge')
  record('feature.merge', `phase shipped; HEALTH.md on main = ${JSON.stringify(healthOnMain)}`)

  // The mapped ideation path (ADR-0001), driven end-to-end alongside the unmapped
  // burn above. No claude runs here — it exercises the map machinery only.
  await mappedFlow(project.id)
}

/**
 * The mapped-ideation smoke (issue #9): escalate a fresh feature into a map, emit
 * two waypoints with a blocking edge, resolve both (watching the second cascade
 * onto the frontier), then confirm G1 (`all-waypoints-terminal`) is satisfiable
 * and that Converge crosses it. Runs against the SAME project/target repo as the
 * unmapped flow — no burn, just the real /mcp + tRPC + converge surfaces.
 */
async function mappedFlow(projectId: string): Promise<void> {
  // (10) mapped feature + a live ideation session so /mcp resolves it by header --
  banner('STEP 10 — mapped path: feature.create + fabricate ideation session (spawn:false) → live')
  const feature = await trpc.feature.create({
    title: 'mapped playground',
    oneLiner: 'a mapped feature to prove escalate → waypoints → converge end to end',
    size: 'collapsed',
  })
  const featureId = feature.id
  const slug = feature.slug
  assert(feature.mapped === false, 'feature starts unmapped (it must escalate)')
  const { sessionId } = await launchSession(ctx as never, { featureId, kind: 'ideation' }, { spawn: false })
  const mapHook = await postHook('session-start', {
    sessionId,
    payload: {
      session_id: 'cc-smoke-mapped-001',
      transcript_path: '/tmp/smoke-mapped-transcript.jsonl',
      hook_event_name: 'SessionStart',
      source: 'startup',
    },
  })
  assert(mapHook?.hookSpecificOutput?.hookEventName === 'SessionStart', 'mapped session-start acknowledged')
  record('mapped feature', `${featureId} slug=${slug}; ideation session ${sessionId} live`)

  // (11) MCP escalate_to_map → mapped flips + map.md scaffolded --------------------
  banner('STEP 11 — MCP escalate_to_map → feature.mapped + map.md')
  const escalate = await mcpToolCall(sessionId, 'escalate_to_map', {
    destination: 'a fully mapped feature',
    notes: 'charted across a couple of waypoints',
  })
  assert(!escalate.isError, `escalate_to_map not an error (${JSON.stringify(escalate.data)})`)
  assert(escalate.data.ok === true, 'escalate_to_map returned ok')
  const escalated = await trpc.feature.get({ id: featureId })
  assert(escalated.feature.mapped === true, 'feature is now mapped')
  const mapDoc = join(paths.worktreeDir(projectId, slug), ...paths.featureDocsRel(slug).split('/'), 'map.md')
  assert(existsSync(mapDoc), `map.md scaffolded at ${mapDoc}`)
  record('MCP escalate_to_map', 'feature mapped; map.md scaffolded into the talk worktree')

  // (12) MCP emit_waypoints (2, wp2 blockedBy wp1) → only wp1 on the frontier ------
  banner('STEP 12 — MCP emit_waypoints(2) with a blocking edge (wp2 blockedBy [1])')
  const emit = await mcpToolCall(sessionId, 'emit_waypoints', {
    waypoints: [
      { title: 'root question', type: 'grilling', question: 'what shape should this take?', blockedBy: [] },
      { title: 'follow-up', type: 'grilling', question: 'given the shape, what next?', blockedBy: [1] },
    ],
  })
  assert(!emit.isError, `emit_waypoints not an error (${JSON.stringify(emit.data)})`)
  assert(emit.data.stored === 2, `2 waypoints stored (got ${emit.data.stored})`)
  assert(Array.isArray(emit.data.ids) && emit.data.ids.length === 2, 'emit_waypoints returned 2 ids')
  const [wp1Id, wp2Id] = emit.data.ids as [string, string]
  let mapped = await trpc.feature.get({ id: featureId })
  assert(JSON.stringify(mapped.frontierIds) === JSON.stringify([wp1Id]), `only wp1 on the frontier (got ${JSON.stringify(mapped.frontierIds)})`)
  assert(mapped.gate.next?.id === 'G1', 'the next gate is G1')
  assert(mapped.gate.satisfied === false, 'G1 not satisfiable while waypoints are open')
  record('MCP emit_waypoints', 'stored 2; wp2 blocked by wp1 → only wp1 on frontier')

  // (13) resolve wp1 → cascade unblocks wp2; resolve wp2 → G1 satisfiable ----------
  banner('STEP 13 — resolve wp1 (watch wp2 unblock) → resolve wp2 → G1 satisfiable')
  const r1 = await mcpToolCall(sessionId, 'resolve_waypoint', { id: wp1Id, disposition: 'resolved', summary: 'shape settled' })
  assert(!r1.isError && r1.data.ok === true, 'resolve_waypoint(wp1) ok')
  const unblocked = (await trpc.events.list({ featureId, afterId: 0 })).find(
    (e: any) => e.type === 'waypoint.unblocked' && e.data?.id === wp2Id,
  )
  assert(!!unblocked, 'a waypoint.unblocked event fired for wp2 as wp1 resolved')
  mapped = await trpc.feature.get({ id: featureId })
  assert(JSON.stringify(mapped.frontierIds) === JSON.stringify([wp2Id]), `wp2 cascaded onto the frontier (got ${JSON.stringify(mapped.frontierIds)})`)
  assert(mapped.gate.satisfied === false, 'G1 still not satisfiable while wp2 is open')

  const r2 = await mcpToolCall(sessionId, 'resolve_waypoint', { id: wp2Id, disposition: 'resolved', summary: 'plan set' })
  assert(!r2.isError && r2.data.ok === true, 'resolve_waypoint(wp2) ok')
  mapped = await trpc.feature.get({ id: featureId })
  assert(JSON.stringify(mapped.frontierIds) === JSON.stringify([]), 'frontier empty once every waypoint is terminal')
  assert(mapped.gate.satisfied === true, 'G1 (all-waypoints-terminal) is now satisfiable')
  record('resolution cascade', 'wp1 resolved → wp2 unblocked → wp2 resolved → G1 satisfiable')

  // (14) converge crosses the satisfied G1 into tickets (collapsed skips spec) ------
  banner('STEP 14 — converge crosses G1 → phase advances + kind=converge session')
  const conv = await converge(ctx as never, { featureId }, { spawn: false })
  assert(!!conv.sessionId, 'converge returned a session id')
  const converged = await trpc.feature.get({ id: featureId })
  assert(converged.feature.phase === 'tickets', `converged into tickets (got ${converged.feature.phase})`)
  const convSession = converged.sessions.find((s: any) => s.id === conv.sessionId)
  assert(convSession?.kind === 'converge', `spawned a kind=converge session (got ${convSession?.kind})`)
  record('feature.converge', 'G1 crossed → phase tickets; kind=converge session spawned')
}

// --- summary table ------------------------------------------------------------

function printSummary(passed: boolean, err?: unknown): void {
  banner('SMOKE SUMMARY')
  const name = (s: string) => s.padEnd(22)
  for (const r of results) log(`  PASS  ${name(r.name)} ${r.detail}`)
  if (!passed) {
    log(`  FAIL  ${name('(aborted)')} ${err instanceof Error ? err.message : String(err)}`)
  }
  log('')
  log(passed ? '★★★  SMOKE: PASS (end-to-end)  ★★★' : '✗✗✗  SMOKE: FAIL  ✗✗✗')
}

main()
  .then(() => {
    printSummary(true)
    process.exit(0)
  })
  .catch((err) => {
    printSummary(false, err)
    if (err instanceof Error && err.stack) log(`\n${err.stack}`)
    process.exit(1)
  })
