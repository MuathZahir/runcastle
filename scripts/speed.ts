/**
 * Measures how fast the web app feels, in real Chrome against this checkout's
 * server, for the targets of a-faster-web-app (decision 6): a slower PC (CPU
 * slowed 4x) reaching runcastle over an SSH tunnel (10 Mbit/s, 60 ms round trips).
 *
 *   bun run --filter @runcastle/web build
 *   CHROME_PATH=/path/to/chrome bun scripts/speed.ts [--no-throttle]
 *
 * Like thread-timing.ts it works on a copy, never on the real data: the database
 * and every thread log are copied to a scratch data dir and served by `buildApp`
 * alone. It is a tool to rerun by hand, never a merge check (decision 11).
 *
 * Typing: in the longest feature chat, type a sentence one key at a time and read
 * each key's time from key press to the next paint (the browser's Event Timing),
 * once idle and once while an agent streams its reply into that same chat.
 * Loading: open the project page in an empty browser (first visit), then refresh
 * it (repeat visit), until the sidebar shows the project's features.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { chromium, type BrowserContext, type Page } from 'playwright-core'

// The page's side of `page.evaluate`, which runs in Chrome: this config has no DOM types.
declare const document: { body: { innerText: string } }
declare const window: { keyLags: number[] }
declare const requestAnimationFrame: (callback: () => void) => number
declare const PerformanceObserver: new (cb: (list: { getEntries(): { name: string; duration: number }[] }) => void) => {
  observe(opts: { type: string; buffered?: boolean; durationThreshold?: number }): void
}
declare const performance: {
  now(): number
  getEntriesByType(type: string): { name: string; transferSize: number; encodedBodySize: number }[]
}

/** Chrome on PATH-less Linux boxes usually comes from agent-browser or Playwright's cache. */
function findChrome(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
  const ab = join(homedir(), '.agent-browser', 'browsers')
  if (existsSync(ab)) for (const v of readdirSync(ab).sort().reverse()) candidates.unshift(join(ab, v, 'chrome'))
  const found = candidates.find((c) => existsSync(c))
  if (!found) throw new Error('no Chrome found: set CHROME_PATH')
  return found
}

const PORT = 4623
const THROTTLE = !process.argv.includes('--no-throttle')
const CPU_SLOWDOWN = 4
const LINK = { latency: 60, downloadThroughput: (10 * 1_000_000) / 8, uploadThroughput: (10 * 1_000_000) / 8 }
const SENTENCE = 'the quick brown fox jumps over the lazy dog again'
/** A working agent streams its words: the log writes a chunk at most every 100 ms. */
const CHUNK_EVERY_MS = 110
const SETUP_KEY = 'runcastle.setupComplete.v1'

const repo = resolve(import.meta.dirname, '..')
const real = process.env.RUNCASTLE_DATA_DIR ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.runcastle')
const scratch = mkdtempSync(join(tmpdir(), 'rc-speed-'))

function copyData(): void {
  new Database(join(real, 'runcastle.db'), { readonly: true }).run(`VACUUM INTO '${join(scratch, 'runcastle.db').replaceAll("'", "''")}'`)
  if (existsSync(join(real, 'config.json'))) copyFileSync(join(real, 'config.json'), join(scratch, 'config.json'))
  for (const id of readdirSync(join(real, 'sessions'))) {
    const log = join(real, 'sessions', id, 'thread.jsonl')
    if (!existsSync(log)) continue
    mkdirSync(join(scratch, 'sessions', id), { recursive: true })
    cpSync(log, join(scratch, 'sessions', id, 'thread.jsonl'))
  }
}

interface Target {
  id: string
  size: number
  project: string
  url: string
}

function largestThread(): Target {
  const db = new Database(join(scratch, 'runcastle.db'), { readonly: true })
  const rows = db
    .query('select s.id as id, f.slug as slug, f.project_id as project from sessions s join features f on f.id = s.feature_id')
    .all() as { id: string; slug: string; project: string }[]
  db.close()
  const all = rows.flatMap((r) => {
    const log = join(scratch, 'sessions', r.id, 'thread.jsonl')
    if (!existsSync(log)) return []
    return [{ id: r.id, project: r.project, size: statSync(log).size, url: `/p/${encodeURIComponent(r.project)}/f/${encodeURIComponent(r.slug)}?thread=${r.id}` }]
  })
  const top = all.sort((a, b) => b.size - a.size)[0]
  if (!top) throw new Error('needs a feature thread with a log')
  return top
}

/** A feature title of the project, newest first: the sidebar lists it once loaded. */
function sidebarTitle(project: string): string {
  const db = new Database(join(scratch, 'runcastle.db'), { readonly: true })
  const row = db.query('select title from features where project_id = ? order by created_at desc limit 1').get(project) as { title: string } | null
  db.close()
  if (!row) throw new Error('the project has no features')
  return row.title
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))] ?? Number.NaN

async function throttle(context: BrowserContext, page: Page): Promise<void> {
  if (!THROTTLE) return
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN })
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...LINK })
}

async function main(): Promise<void> {
  copyData()
  process.env.RUNCASTLE_DATA_DIR = scratch
  process.env.RUNCASTLE_WEB_DIST = join(repo, 'apps', 'web', 'dist')
  if (!existsSync(join(process.env.RUNCASTLE_WEB_DIST, 'index.html'))) throw new Error('build the web app first: bun run --filter @runcastle/web build')
  for (const name of ['RUNCASTLE_MIGRATIONS_DIR', 'RUNCASTLE_SKILLS_DIR', 'RUNCASTLE_HOOK_CLIENT', 'RUNCASTLE_PTY_HOST', 'RUNCASTLE_SANDCASTLE_TEMPLATE']) {
    delete process.env[name]
  }

  const { loadConfig } = await import('../packages/core/src/config-load.ts')
  const { createDb } = await import('../packages/server/src/db/client.ts')
  const { runMigrations } = await import('../packages/server/src/db/migrate.ts')
  const { buildApp } = await import('../packages/server/src/index.ts')
  const { appendThreadEvent } = await import('../packages/server/src/threads/log.ts')

  const db = createDb(join(scratch, 'runcastle.db'))
  runMigrations(db)
  const app = buildApp({ db, config: loadConfig() })
  const server = Bun.serve({ port: PORT, hostname: '127.0.0.1', idleTimeout: 0, fetch: (req) => app.fetch(req) })
  const base = `http://127.0.0.1:${PORT}`

  const target = largestThread()
  const title = sidebarTitle(target.project)
  console.log(`chat ${target.id}, log ${(target.size / 1048576).toFixed(1)} MB; throttled: ${THROTTLE ? `CPU ${CPU_SLOWDOWN}x, 10 Mbit/s, 60 ms` : 'no'}`)

  const results: [label: string, value: number, unit: string, target: number][] = []
  const browser = await chromium.launch({ executablePath: findChrome(), headless: true })

  // ── Loading: a first visit in an empty browser, then repeat visits ──
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript((key) => localStorage.setItem(key, 'true'), SETUP_KEY)
    const page = await context.newPage()
    await throttle(context, page)
    const projectUrl = `${base}/p/${encodeURIComponent(target.project)}`
    const load = async (go: () => Promise<unknown>): Promise<{ ms: number; kb: number; requests: number }> => {
      const t0 = Date.now()
      await go()
      await page.waitForFunction((t) => document.body.innerText.includes(t), title, { timeout: 120_000, polling: 'raf' })
      const ms = Date.now() - t0
      const entries = await page.evaluate(() => [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')].map((e) => ({ name: e.name, transfer: e.transferSize })))
      return { ms, kb: entries.reduce((s, e) => s + e.transfer, 0) / 1024, requests: entries.length }
    }
    const cold = await load(() => page.goto(projectUrl, { waitUntil: 'commit' }))
    results.push(['first visit: project page shown', cold.ms, 'ms', 3000])
    results.push(['first visit: KB over the wire', cold.kb, 'KB', Number.POSITIVE_INFINITY])
    results.push(['first visit: requests', cold.requests, '', Number.POSITIVE_INFINITY])
    const warm: { ms: number; kb: number; requests: number }[] = []
    for (let n = 0; n < 3; n++) {
      await page.waitForTimeout(1500)
      warm.push(await load(() => page.reload({ waitUntil: 'commit' })))
    }
    results.push(['repeat refresh: project page shown', median(warm.map((w) => w.ms)), 'ms', 1500])
    results.push(['repeat refresh: KB over the wire', median(warm.map((w) => w.kb)), 'KB', Number.POSITIVE_INFINITY])
    await context.close()
  }

  // ── Typing in the longest chat ──
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript((key) => localStorage.setItem(key, 'true'), SETUP_KEY)
    const page = await context.newPage()
    await page.goto(base + target.url)
    const box = page.locator('textarea').first()
    await box.waitFor({ state: 'visible', timeout: 120_000 })
    await page.waitForFunction(() => !document.body.innerText.includes('Loading the chat'), undefined, { timeout: 120_000 })
    await page.waitForTimeout(2000)
    await throttle(context, page)
    await page.evaluate(() => {
      window.keyLags = []
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.name === 'keydown') window.keyLags.push(e.duration)
      }).observe({ type: 'event', durationThreshold: 16 })
    })

    const typeSentence = async (label: string): Promise<void> => {
      await page.evaluate(() => {
        window.keyLags.length = 0
      })
      await box.click()
      const keys: number[] = []
      for (const ch of SENTENCE) {
        const t0 = Date.now()
        await box.press(ch === ' ' ? 'Space' : ch)
        // The key has painted once the next frame runs.
        await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => setTimeout(done, 0))))
        keys.push(Date.now() - t0)
        await page.waitForTimeout(80)
      }
      await page.waitForTimeout(500)
      // Event Timing reports only keys over 16 ms; the rest count as 16.
      const timed = await page.evaluate(() => window.keyLags)
      const lags = [...timed, ...Array(Math.max(0, SENTENCE.length - timed.length)).fill(16)]
      results.push([`${label}: key to screen, typical`, median(lags), 'ms', 50])
      results.push([`${label}: key to screen, slowest 5%`, p95(lags), 'ms', 50])
      results.push([`${label}: key round trip from the driver, typical`, median(keys), 'ms', Number.POSITIVE_INFINITY])
      await box.fill('')
    }

    await typeSentence('idle chat')
    appendThreadEvent(target.id, { type: 'turn_started' })
    const stream = setInterval(() => {
      appendThreadEvent(target.id, { type: 'agent_text', messageId: 'speed_stream', text: 'words ' })
    }, CHUNK_EVERY_MS)
    await page.waitForTimeout(2000)
    await typeSentence('agent streaming')
    clearInterval(stream)
    const shown = await page.evaluate(() => document.body.innerText.length)
    console.log(`chat text on the page: ${Math.round(shown / 1024)} KB`)
    await context.close()
  }

  await browser.close()
  void server.stop(true)

  console.log('\n' + 'what'.padEnd(52) + 'measured'.padStart(10) + 'target'.padStart(9))
  for (const [label, value, unit, goal] of results) {
    const shownGoal = Number.isFinite(goal) ? String(goal) : '—'
    const verdict = Number.isFinite(goal) ? (value <= goal ? 'met' : 'NOT MET') : ''
    console.log(`${label.padEnd(52)}${`${Math.round(value)} ${unit}`.padStart(10)}${shownGoal.padStart(9)}  ${verdict}`)
  }
}

try {
  await main()
} finally {
  try {
    rmSync(scratch, { recursive: true, force: true })
  } catch {
    // Windows holds the database open until this process exits; the OS temp dir clears it.
  }
}
process.exit(0)
