import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveBun } from './helpers/bun'
import { rmTemp, tmpRepo } from './helpers/fixtures'

/**
 * A move that asks for everything: `fixtures/move/carry.ts` runs under real Bun,
 * because a move needs `bun:sqlite`, and prints what it saw.
 */
const bun = resolveBun()

describe.skipIf(!bun)('runcastle move, carrying everything it can', () => {
  let root: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a JSON object printed by the fixture
  let f: any

  beforeAll(() => {
    root = tmpRepo()
    const run = spawnSync(bun as string, [join(import.meta.dirname, 'fixtures', 'move', 'carry.ts'), root], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 110_000,
    })
    if (run.status !== 0) throw new Error(`fixture failed:\n${run.stdout}\n${run.stderr}`)
    f = JSON.parse(run.stdout.trim().split('\n').pop() as string)
  }, 120_000)

  afterAll(() => rmTemp(root))

  it('keeps every command and points the paths in them at the new machine', () => {
    expect(f.driveSetup).toBe(`docker compose -f "${f.expected.newRepo}/compose.yml" up`)
    expect(f.driveStop).toBe('bun .runcastle/drive-stop.ts')
    expect(f.dbReset).toContain('D:\\dev\\app.db')
    expect(f.driveInstructions).toContain(`The repo at ${f.expected.newRepo} is yours.`)
    expect(f.driveInstructions).toContain(`Logs are in ${f.expected.destHome}/.dev/logs.`)
  })

  it('says before the move which command no rewrite can fix, and only that one', () => {
    expect(f.windowsLines).toHaveLength(1)
    expect(f.windowsLines[0]).toContain('app, database reset command: only works on Windows')
    expect(f.result.commandsWindows.map((c: { value: string }) => c.value).join('\n')).toContain('D:\\dev\\app.db')
  })

  it('keeps the old values of rewritten commands in the report file', () => {
    expect(f.report).toContain('## Commands with their paths rewritten')
    expect(f.report).toContain('## Commands that only work on Windows')
  })

  it('carries .env files on request, ignored or not, and skips stale copies in dot-folders', () => {
    expect(f.rootEnv).toBe('ROOT_SECRET=1\n')
    expect(f.pkgEnv).toBe('PKG_SECRET=1\n')
    expect(f.stagingEnv).toBe('NOT_IGNORED_SECRET=1\n')
    expect(f.staleEnv).toBe(false)
    expect(f.result.envCarried).toBe(true)
  })

  it('leaves .env files and ignored data behind unless asked', () => {
    expect(f.plainCarried).toEqual([])
    expect(f.plainStaysBehind).toContain('.env files and logins')
    expect(f.plainStaysBehind).toContain('global Claude rules, skills and settings')
    expect(f.plainHasSetup).toBe(false)
    expect(f.plainAttention.join('\n')).toContain('.env.staging stays behind')
    expect(f.plainAttention.join('\n')).toContain('deletes moved chats older than 30 days')
  })

  it('stops listing what it carries as staying behind', () => {
    expect(f.staysBehind).toContain('logins')
    expect(f.staysBehind).not.toContain('.env files and logins')
    expect(f.staysBehind).not.toContain('global Claude rules, skills and settings')
    const ignored = f.attention.find((line: string) => line.includes('ignored files stay behind'))
    expect(ignored).toContain('cache')
    expect(ignored).not.toContain('uploads')
    expect(ignored).not.toMatch(/(^|[ /])\.env\b/)
    expect(f.attention.join('\n')).not.toContain('.env.staging stays behind')
  })

  it('carries a folder git ignores when asked, and only that folder', () => {
    expect(f.upload).toBe('png')
    expect(f.cacheFile).toBe(false)
  })

  it('refuses an --also that names nothing it can carry', () => {
    const text = f.badAlso.join('\n')
    expect(text).toContain('app: --also missing is not in the repo folder')
    expect(text).toContain('--also app:../outside: write it as')
    expect(text).toContain('--also no-colon: write it as')
    expect(text).toContain('--also nope:x: no moving repo is called nope')
  })

  it('carries the local ignore rules, with Linux line endings', () => {
    expect(f.exclude).toBe('# a comment\nscratch/\n')
  })

  it('carries rules, agents and skills, with what a link points at instead of the link', () => {
    expect(f.rule).toBe('be plain\n')
    expect(f.agent).toBe('an agent\n')
    expect(f.realSkill).toBe('real skill\n')
    expect(f.linkedSkill).toBe('linked skill\n')
    expect(f.linkedModules).toBe(false)
    expect(f.linkedGit).toBe(false)
    if (process.platform !== 'win32') expect(f.scriptIsExecutable).toBe(true)
  })

  it('names a link that leads nowhere', () => {
    expect(f.attention.join('\n')).toMatch(/links that lead nowhere stay behind: skills.broken/)
  })

  it('never carries a login, chat history or built plugins', () => {
    expect(f.login).toBe('{"token":"the new machine login"}')
    expect(f.history).toBe(false)
    expect(f.pluginCache).toBe(false)
    const paths = f.packedPaths.join('\n')
    expect(paths).not.toContain('credentials')
    expect(paths).not.toContain('plugins/')
    expect(JSON.stringify(f.claudeJson)).not.toContain('must not travel')
  })

  it("sets the new machine's rules aside and keeps its own settings where the old ones are silent", () => {
    expect(f.trialRule).toBeNull()
    expect(f.aside.some((name: string) => name.startsWith('rules.before-move-'))).toBe(true)
    expect(f.aside.some((name: string) => name.startsWith('settings.json.before-move-'))).toBe(true)
    expect(f.settings.theme).toBe('dark')
    expect(f.settings.model).toBe('kept')
  })

  it('tells Claude Code to keep the moved chats', () => {
    expect(f.settings.cleanupPeriodDays).toBe(3650)
    expect(f.result.claudeSetup.chatsKept).toBe(true)
  })

  it("adds the MCP servers to the new machine's own, keeping the rest of its file", () => {
    expect(f.claudeJson.mcpServers).toEqual({ own: { type: 'http' }, neon: { type: 'http' } })
    expect(f.claudeJson.hasCompletedOnboarding).toBe(true)
    expect(f.claudeJsonAside).toHaveLength(1)
  })

  it('installs enabled plugins from their marketplaces, and names one that failed', () => {
    expect(f.claudeCalls).toEqual([
      'plugin marketplace add owner/market',
      'plugin install good@market',
      'plugin install bad@market',
    ])
    expect(f.result.claudeSetup.failed).toEqual(['plugin bad@market'])
    expect(f.report).toContain('plugin bad@market')
  })
})
