/**
 * Times what opening a thread costs, in real Chrome against this checkout's
 * server, for the targets of threads-open-fast-and-show-the-truth (decision 7).
 *
 *   bun run --filter @runcastle/web build
 *   bun scripts/thread-timing.ts [--watch]
 *
 * It works on a copy, never on the real data: the database and every thread log
 * are copied to a scratch data dir, and the server is built here with `buildApp`
 * alone, so none of the boot's sweeps run against rows that name real worktrees.
 * It reads the real repositories (git, read-only) as the page's reads do.
 *
 * "With agents working": two other threads gain events all the way through, at
 * the busiest rate the real logs show. A marker is a `notice` event, which the
 * thread draws as a line; a thread counts as current once its newest marker shows.
 *
 * `--watch` adds six minutes on a thread left open: the query cache drops the
 * entry its log is cached in after five, and a thread on screen must not care.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import { chromium, type Page } from 'playwright-core'

// The page's side of `page.evaluate`, which runs in Chrome: this config has no DOM types.
declare const document: { body: { innerText: string } }
declare const history: { pushState(state: unknown, title: string, url: string): void }
declare const PopStateEvent: new (type: string) => unknown
declare function dispatchEvent(event: unknown): boolean
declare function requestAnimationFrame(callback: () => void): number
declare const window: { lags: number[] }

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 4622
/** A working agent streams its words: the log writes a chunk at most every 100 ms, and the stream signals every 120. */
const CHUNK_EVERY_MS = 110
/** The same key `use-project-nav.ts` keeps: a browser that has passed the setup check before. */
const SETUP_KEY = 'runcastle.setupComplete.v1'

const repo = resolve(import.meta.dirname, '..')
const real = process.env.RUNCASTLE_DATA_DIR ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.runcastle')
const scratch = mkdtempSync(join(tmpdir(), 'rc-timing-'))

/** Copy the database consistently, the thread logs and the config. Nothing else of the data dir. */
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
  url: string
}

/** The feature threads, largest log first, with the address each opens at. */
function largestThreads(): Target[] {
  const db = new Database(join(scratch, 'runcastle.db'), { readonly: true })
  const rows = db
    .query('select s.id as id, f.slug as slug, f.project_id as project from sessions s join features f on f.id = s.feature_id')
    .all() as { id: string; slug: string; project: string }[]
  db.close()
  return rows
    .flatMap((r) => {
      const log = join(scratch, 'sessions', r.id, 'thread.jsonl')
      if (!existsSync(log)) return []
      return [{ id: r.id, size: statSync(log).size, url: `/p/${encodeURIComponent(r.project)}/f/${encodeURIComponent(r.slug)}?thread=${r.id}` }]
    })
    .sort((a, b) => b.size - a.size)
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function main(): Promise<void> {
  copyData()
  process.env.RUNCASTLE_DATA_DIR = scratch
  process.env.RUNCASTLE_WEB_DIST = join(repo, 'apps', 'web', 'dist')
  // A session's inherited asset paths point at the installed runcastle, not this checkout.
  for (const name of ['RUNCASTLE_MIGRATIONS_DIR', 'RUNCASTLE_SKILLS_DIR', 'RUNCASTLE_HOOK_CLIENT', 'RUNCASTLE_PTY_HOST', 'RUNCASTLE_SANDCASTLE_TEMPLATE']) {
    delete process.env[name]
  }

  // Imported only now: these read the data dir as they load.
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

  const [target, other, busy] = largestThreads()
  if (!target || !other || !busy) throw new Error('needs at least three feature threads with logs')
  console.log(`target ${target.id}, ${(target.size / 1048576).toFixed(1)} MB`)

  let seq = 0
  const marker = (threadId: string): string => {
    const text = `timing-marker-${Date.now()}-${++seq}`
    appendThreadEvent(threadId, { type: 'notice', text })
    return text
  }
  const work = (threadId: string): ReturnType<typeof setInterval> => {
    appendThreadEvent(threadId, { type: 'turn_started' })
    return setInterval(() => {
      appendThreadEvent(threadId, { type: 'agent_text', messageId: `timing_${threadId}`, text: 'words ' })
    }, CHUNK_EVERY_MS)
  }

  const results: [label: string, value: number, target: number][] = []
  const background = [work(busy.id)]

  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript((key) => localStorage.setItem(key, 'true'), SETUP_KEY)
  const page = await context.newPage()

  /** From `act` until the thread shows `text`, watching every frame for a thread drawn without it. */
  const until = async (page: Page, text: string, act: () => Promise<unknown>): Promise<{ ms: number; oldFirst: boolean }> => {
    const t0 = performance.now()
    await act()
    // Installed per opening: a full reload loses it.
    const watch = page.evaluate(
      (want) =>
        new Promise<boolean>((done) => {
          let oldFirst = false
          const tick = () => {
            const shown = document.body.innerText
            if (shown.includes(want)) return done(oldFirst)
            if (/Worked for/.test(shown)) oldFirst = true
            requestAnimationFrame(tick)
          }
          tick()
        }),
      text,
    )
    return { oldFirst: await watch, ms: performance.now() - t0 }
  }
  const visit = (url: string) => () => page.evaluate((u) => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)

  const slowReads = async (what: string): Promise<void> => {
    const reads = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((e) => e.name.includes('/api/trpc/') && e.duration > 60)
        .map((e) => ({
          at: Math.round(e.startTime),
          ms: Math.round(e.duration),
          kb: Math.round((e as unknown as { encodedBodySize: number }).encodedBodySize / 1024),
          read: decodeURIComponent(e.name.split('/api/trpc/')[1]).split('?')[0],
        })),
    )
    console.log(`${what}, reads over 60 ms:`)
    for (const r of reads) console.log(`  @${r.at} +${r.ms} ms ${r.kb} KB on the wire ${r.read}`)
  }

  // The server has read nothing yet: a first open after a start.
  const first = await until(page, marker(target.id), () => page.goto(base + target.url, { waitUntil: 'commit' }))
  results.push(['first open after a server start', first.ms, 1000])
  await slowReads('the first open')

  const reloads: number[] = []
  for (let n = 0; n < 3; n++) reloads.push((await until(page, marker(target.id), () => page.goto(base + target.url, { waitUntil: 'commit' }))).ms)
  results.push(['reload on the thread', median(reloads), 2000])
  await slowReads('the last reload')

  const switches: number[] = []
  let oldFirst = 0
  for (let n = 0; n < 4; n++) {
    await until(page, marker(other.id), visit(other.url))
    await page.waitForTimeout(400)
    const back = await until(page, marker(target.id), visit(target.url))
    switches.push(back.ms)
    if (back.oldFirst) oldFirst++
    await page.waitForTimeout(400)
  }
  results.push(['switch back to the thread', median(switches), 300])
  results.push(['opens that drew an old state first', oldFirst, 0])

  // The open thread works, and every marker's time on screen is measured from its own stamp.
  background.push(work(target.id))
  await page.evaluate(() => {
    const lags: number[] = []
    const seen = new Set<string>()
    const look = () => {
      for (const [m, at] of document.body.innerText.matchAll(/timing-marker-(\d+)-\d+/g)) {
        if (!seen.has(m)) {
          seen.add(m)
          lags.push(Date.now() - Number(at))
        }
      }
      requestAnimationFrame(look)
    }
    look()
    window.lags = lags
  })
  await page.evaluate(() => {
    window.lags.length = 0
  })
  let sent = 0
  const markers = setInterval(() => {
    sent++
    marker(target.id)
  }, 500)
  await page.waitForTimeout(20_000)
  clearInterval(markers)
  await page.waitForTimeout(1500)
  const lags = await page.evaluate(() => window.lags)
  results.push(['working thread, typical lag behind its log', lags.length ? median(lags) : Number.POSITIVE_INFINITY, 1000])
  results.push(['working thread, worst lag', lags.length ? Math.max(...lags) : Number.POSITIVE_INFINITY, 1000])
  results.push(['working thread, markers never shown', sent - lags.length, 0])

  if (process.argv.includes('--watch')) {
    const folds = () => page.evaluate(() => document.body.innerText.match(/Worked for/g)?.length ?? 0)
    const before = await folds()
    await page.waitForTimeout(6 * 60_000)
    await until(page, marker(target.id), async () => undefined)
    await page.waitForTimeout(500)
    results.push(['settled turns lost after six minutes open', before - (await folds()), 0])
  }

  for (const timer of background) clearInterval(timer)
  await browser.close()
  void server.stop(true)

  console.log('\n' + 'what'.padEnd(46) + 'measured'.padStart(10) + 'target'.padStart(9))
  for (const [label, value, goal] of results) {
    const met = value <= goal
    console.log(`${label.padEnd(46)}${String(Math.round(value)).padStart(10)}${String(goal).padStart(9)}  ${met ? 'met' : 'NOT MET'}`)
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
