/**
 * Scenario: a feature in runcastle-demo whose Design tab holds three designs
 * waiting for the human (agents-see-the-tweaks-you-picked):
 *
 *   1. "Invoice list" has a states switcher (full, empty) and a Tweaks menu
 *      (accent, density). It reports its state and tweaks to the Design tab on
 *      load and on every change, and keeps the tweaks in localStorage under a key
 *      that includes its path.
 *   2. "Profile" is single-state: it reports `state: null, tweaks: {}`.
 *   3. "Settings" is an old-style page that reports nothing.
 *
 * Tweak Invoice list, approve all three, and read the approval line the lead
 * gets.
 *
 * Run by the project's scenario runner (`bun {file}`) inside a test drive of
 * runcastle, with the drive identity, the `.runcastle/drive.env` overlay and a
 * fresh `RUNCASTLE_SCENARIO_RUN` in its env. It seeds the DRIVEN instance — the
 * overlay's `RUNCASTLE_DATA_DIR`, through this checkout's own services — and
 * prints the feature's page as `ENTRY_URL=…`.
 *
 * The pages and the design server's command (`.runcastle/design.json`, a plain
 * python http.server) sit uncommitted in the feature's talk worktree, where a
 * lead's would be; nothing lands on the demo's main branch. The scenario does
 * not start the server (a pane started here would die with this process): the
 * Design tab starts it from the recorded command when the human opens it.
 * Needs `python3` on the PATH.
 *
 * `SCENARIO_PROJECT` names a different project to seed (tests register a temp
 * repo under its own name).
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { dbPath, worktreeDir } from '../../../packages/core/src/paths.ts'
import { loadConfig } from '../../../packages/core/src/config-load.ts'
import { createDb } from '../../../packages/server/src/db/client.ts'
import { runMigrations } from '../../../packages/server/src/db/migrate.ts'
import type { AppCtx } from '../../../packages/server/src/db/types.ts'
import { recordDesign } from '../../../packages/server/src/services/designs.ts'
import { createFeature } from '../../../packages/server/src/services/features.ts'
import { listProjects } from '../../../packages/server/src/services/projects.ts'
import { DRIVE_PREFIX, isDriveDataDir } from '../../drive-dir.ts'

const PROJECT = process.env.SCENARIO_PROJECT || 'runcastle-demo'

const BRIEF = `# An invoice list

## Problem
Invoices are only reachable one by one. People want to see them all at once.

## Goal
A list of invoices with their amounts and status, plus a profile and a settings page around it.
`

/** The command the design server runs: a static file server on the port runcastle picks. */
const DESIGN_COMMAND = 'python3 -m http.server $RUNCASTLE_DESIGN_PORT --bind 127.0.0.1'

const STYLE = `
  :root { --accent: #0d9488; --pad: 14px; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.4 system-ui, sans-serif; color: #1f2937; background: #f8fafc; }
  main { max-width: 640px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  .bar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; }
  button, select { font: inherit; padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; }
  button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: var(--pad); margin-bottom: 8px; display: flex; justify-content: space-between; }
  .card b { color: var(--accent); }
  .empty { text-align: center; color: #64748b; padding: 40px 0; }
  .tweaks { margin-left: auto; position: relative; }
  .menu { position: absolute; right: 0; top: 36px; background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; width: 190px; display: none; }
  .menu.open { display: block; }
  .menu label { display: block; font-size: 12px; color: #64748b; margin-top: 8px; }
  .menu label:first-child { margin-top: 0; }
  .menu select { width: 100%; }
`

const INVOICE_LIST = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Invoice list</title><style>${STYLE}</style></head>
<body><main>
  <h1>Invoices</h1>
  <div class="bar">
    <span id="states"></span>
    <div class="tweaks">
      <button id="tw-toggle">Tweaks</button>
      <div class="menu" id="menu">
        <label>accent <select id="accent"><option>teal</option><option>coral</option><option>indigo</option></select></label>
        <label>density <select id="density"><option>compact</option><option>comfy</option></select></label>
      </div>
    </div>
  </div>
  <div id="list"></div>
</main>
<script>
  var COLORS = { teal: '#0d9488', coral: '#f0674c', indigo: '#4f46e5' }
  var PAD = { compact: '8px', comfy: '18px' }
  var STATES = ['full', 'empty']
  var KEY = 'runcastle:tweaks:' + location.pathname
  var DATA = [['INV-1042', '$1,200.00', 'Paid'], ['INV-1043', '$310.50', 'Due'], ['INV-1044', '$88.00', 'Overdue']]
  var state = 'full'
  var tweaks = { accent: 'teal', density: 'compact' }
  try { Object.assign(tweaks, JSON.parse(localStorage.getItem(KEY) || '{}')) } catch (e) {}

  function report() {
    window.parent.postMessage({ type: 'runcastle-design-report', state: state, tweaks: tweaks }, '*')
  }
  function render() {
    document.documentElement.style.setProperty('--accent', COLORS[tweaks.accent])
    document.documentElement.style.setProperty('--pad', PAD[tweaks.density])
    document.getElementById('accent').value = tweaks.accent
    document.getElementById('density').value = tweaks.density
    document.getElementById('states').innerHTML = ''
    STATES.forEach(function (s) {
      var b = document.createElement('button')
      b.textContent = s
      b.className = s === state ? 'on' : ''
      b.onclick = function () { state = s; render(); report() }
      document.getElementById('states').appendChild(b)
    })
    document.getElementById('list').innerHTML = state === 'empty'
      ? '<div class="empty">No invoices yet</div>'
      : DATA.map(function (r) { return '<div class="card"><span>' + r[0] + ' <b>' + r[2] + '</b></span><span>' + r[1] + '</span></div>' }).join('')
  }
  function change(name) {
    return function (e) {
      tweaks[name] = e.target.value
      localStorage.setItem(KEY, JSON.stringify(tweaks))
      render(); report()
    }
  }
  document.getElementById('accent').onchange = change('accent')
  document.getElementById('density').onchange = change('density')
  document.getElementById('tw-toggle').onclick = function () { document.getElementById('menu').classList.toggle('open') }
  render(); report()
</script></body></html>
`

const PROFILE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Profile</title><style>${STYLE}</style></head>
<body><main>
  <h1>Profile</h1>
  <div class="card"><span>Name</span><b>Ada Lovelace</b></div>
  <div class="card"><span>Email</span><b>ada@example.com</b></div>
  <div class="card"><span>Plan</span><b>Team</b></div>
</main>
<script>
  window.parent.postMessage({ type: 'runcastle-design-report', state: null, tweaks: {} }, '*')
</script></body></html>
`

/** An old-style page: it reports nothing. */
const SETTINGS = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Settings</title><style>${STYLE}</style></head>
<body><main>
  <h1>Settings</h1>
  <div class="card"><span>Email me about overdue invoices</span><input type="checkbox" checked></div>
  <div class="card"><span>Currency</span><select><option>USD</option><option>EUR</option></select></div>
</main></body></html>
`

const PAGES = [
  { file: 'invoice-list.html', title: 'Invoice list', body: INVOICE_LIST },
  { file: 'profile.html', title: 'Profile', body: PROFILE },
  { file: 'settings.html', title: 'Settings', body: SETTINGS },
]

/**
 * Only ever the drive's own tree. Every path helper reads `RUNCASTLE_DATA_DIR`
 * lazily, so this check runs before the first one is called; unset, they would
 * fall back to the developer's real `~/.runcastle`.
 */
function driveDataDir(): string {
  const dir = process.env.RUNCASTLE_DATA_DIR
  if (!dir) throw new Error('RUNCASTLE_DATA_DIR is not set — run this inside a test drive')
  if (!isDriveDataDir(resolve(dir))) {
    throw new Error(`refusing to seed ${resolve(dir)} — not a ${DRIVE_PREFIX}* data dir`)
  }
  return resolve(dir)
}

async function main(): Promise<void> {
  process.env.RUNCASTLE_DATA_DIR = driveDataDir()
  const db = createDb(dbPath())
  try {
    runMigrations(db)
    const ctx: AppCtx = { db, config: loadConfig() }

    const project = listProjects(ctx).find(
      (p) => p.name === PROJECT || basename(p.repoPath) === PROJECT,
    )
    if (!project) throw new Error(`${PROJECT} is not registered in this drive's data dir`)

    // A live create: the branch is cut and the talk worktree made for the docs.
    const run = process.env.RUNCASTLE_SCENARIO_RUN || randomBytes(3).toString('hex')
    const feature = await createFeature(ctx, {
      projectId: project.id,
      title: `Designs waiting ${run}`,
      oneLiner: 'Seeded by the Feature with designs waiting scenario.',
      brief: BRIEF,
    })

    // What a lead leaves in its worktree: the pages and the recorded server command.
    const worktree = worktreeDir(project.id, feature.slug)
    for (const page of PAGES) {
      const file = join(worktree, 'preview', page.file)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, page.body)
    }
    mkdirSync(join(worktree, '.runcastle'), { recursive: true })
    writeFileSync(join(worktree, '.runcastle', 'design.json'), `${JSON.stringify({ command: DESIGN_COMMAND }, null, 2)}\n`)

    for (const page of PAGES) recordDesign(ctx, feature.id, { path: `/preview/${page.file}`, title: page.title })

    console.log(`ENTRY_URL=/p/${encodeURIComponent(project.id)}/f/${encodeURIComponent(feature.slug)}`)
  } finally {
    // Checkpoint the WAL into the db file for any reader after us (see feature-never-run.ts).
    const client = (db as unknown as { $client: { exec(sql: string): void; close(): void } }).$client
    client.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    client.close()
  }
}

try {
  await main()
} catch (e) {
  console.error(`[feature-with-designs-waiting] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
