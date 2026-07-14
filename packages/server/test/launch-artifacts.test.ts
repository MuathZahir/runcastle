import { readFileSync, rmSync } from 'node:fs'
import { sessionDir } from '@runcastle/core/paths'
import { afterEach, describe, expect, it } from 'vitest'
import type { Feature, RuncastleConfig, SessionRow } from '@runcastle/core'
import { RuncastleConfig as ConfigSchema } from '@runcastle/core'
import {
  RUNCASTLE_MCP_ALLOW_RULES,
  hookClientPath,
  renderMcpConfig,
  renderSettings,
  renderSystemPrompt,
  writeSessionArtifacts,
} from '../src/launcher/artifacts'
import { buildLaunchCommand, ptyExitMessage } from '../src/launcher/launcher'

const config: RuncastleConfig = ConfigSchema.parse({})

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'feat_abc',
    projectId: 'proj_1',
    slug: 'dark-mode',
    title: 'Dark mode',
    oneLiner: 'a dark theme',
    size: 'full',
    phase: 'ideation',
    branch: 'feature/dark-mode',
    status: 'active',
    createdAt: 0,
    ...overrides,
  }
}

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'sess_xyz',
    featureId: 'feat_abc',
    kind: 'ideation',
    status: 'launching',
    worktreePath: 'C:\\wt\\dark-mode',
    ...overrides,
  }
}

describe('renderSettings', () => {
  it('pre-allows the 4 runcastle MCP tools so our own tool calls never prompt', () => {
    const s = renderSettings('C:\\hooks\\hook-client.ts')

    // permissions.allow must cover every runcastle MCP tool, in the documented
    // `mcp__<server>__<tool>` form (code.claude.com/docs/en/permissions.md).
    expect(s.permissions.allow).toEqual(
      expect.arrayContaining([
        'mcp__runcastle__get_feature_context',
        'mcp__runcastle__emit_tickets',
        'mcp__runcastle__record_event',
        'mcp__runcastle__complete_phase',
      ]),
    )
    // the exported rule list is the single source and is fully included
    expect(s.permissions.allow).toEqual(expect.arrayContaining([...RUNCASTLE_MCP_ALLOW_RULES]))
    // every rule is anchored to our own server (no unanchored / cross-server globs)
    for (const rule of s.permissions.allow) expect(rule.startsWith('mcp__runcastle__')).toBe(true)
  })

  it('emits the verified hooks JSON shape with correct events + timeouts', () => {
    const s = renderSettings('C:\\hooks\\hook-client.ts')

    // SessionStart: matcher 'startup', command hook, timeout 10
    expect(s.hooks.SessionStart[0].matcher).toBe('startup')
    const start = s.hooks.SessionStart[0].hooks[0]
    expect(start.type).toBe('command')
    expect(start.timeout).toBe(10)
    expect(start.command).toBe('bun run "C:\\hooks\\hook-client.ts" session-start')

    // UserPromptSubmit: NO matcher, timeout 5 (inside its 30s budget)
    expect(s.hooks.UserPromptSubmit[0]).not.toHaveProperty('matcher')
    const prompt = s.hooks.UserPromptSubmit[0].hooks[0]
    expect(prompt.timeout).toBe(5)
    expect(prompt.command).toBe('bun run "C:\\hooks\\hook-client.ts" user-prompt')

    // SessionEnd: NO matcher, timeout 10
    expect(s.hooks.SessionEnd[0]).not.toHaveProperty('matcher')
    expect(s.hooks.SessionEnd[0].hooks[0].command).toBe(
      'bun run "C:\\hooks\\hook-client.ts" session-end',
    )
  })
})

describe('ptyExitMessage', () => {
  it('renders a numeric exit code verbatim', () => {
    expect(ptyExitMessage(0)).toBe('terminal exited (code 0)')
    expect(ptyExitMessage(137)).toBe('terminal exited (code 137)')
  })

  it('renders a missing code as "unknown", never the string "undefined"', () => {
    expect(ptyExitMessage(undefined)).toBe('terminal exited (code unknown)')
    expect(ptyExitMessage(null)).toBe('terminal exited (code unknown)')
    expect(ptyExitMessage(undefined)).not.toContain('undefined')
  })
})

describe('renderMcpConfig', () => {
  it('is an http server carrying the X-Runcastle-Session header', () => {
    const m = renderMcpConfig(session({ id: 'sess_777' }), config)
    expect(m.mcpServers.runcastle.type).toBe('http')
    expect(m.mcpServers.runcastle.url).toBe('http://localhost:4512/mcp')
    expect(m.mcpServers.runcastle.headers['X-Runcastle-Session']).toBe('sess_777')
  })
})

describe('renderSystemPrompt', () => {
  it('directs an ideation session to /runcastle:ideate with docs paths + MCP cheat-sheet', () => {
    const p = renderSystemPrompt(feature(), 'ideation')
    expect(p).toContain('/runcastle:ideate')
    expect(p).toContain('docs/features/dark-mode/')
    expect(p).toContain('get_feature_context')
    expect(p).toContain('emit_tickets')
    expect(p).toContain('complete_phase')
    expect(p).toContain('record_event')
  })

  it('directs a qa session to /runcastle:qa and forbids advancing phases', () => {
    const p = renderSystemPrompt(feature(), 'qa')
    expect(p).toContain('/runcastle:qa')
    expect(p).toMatch(/do not advance phases/i)
  })
})

describe('buildLaunchCommand', () => {
  const cmd = buildLaunchCommand({
    sessionId: 'sess_xyz',
    serverUrl: 'http://localhost:4512',
    featureTitle: 'Dark mode',
    worktreePath: 'C:\\wt\\dark-mode',
    pluginDir: 'C:\\repo\\packages\\skills\\packs\\runcastle',
    settingsPath: 'C:\\s\\settings.json',
    mcpConfigPath: 'C:\\s\\mcp.json',
    systemPromptPath: 'C:\\s\\system-prompt.md',
  })

  it('assembles the claude invocation with the verified flags', () => {
    expect(cmd.claudeCommand).toBe(
      'claude --settings "C:\\s\\settings.json" --mcp-config "C:\\s\\mcp.json" ' +
        '--strict-mcp-config --plugin-dir "C:\\repo\\packages\\skills\\packs\\runcastle" ' +
        '--append-system-prompt-file "C:\\s\\system-prompt.md" --permission-mode acceptEdits',
    )
  })

  it('opens a wt.exe tab with title + working dir', () => {
    expect(cmd.display).toContain('wt.exe -w 0 nt --title "runcastle: Dark mode" -d "C:\\wt\\dark-mode" cmd /k ')
  })

  it('embeds the env vars in the command line with NO space before && (no trailing space in value)', () => {
    expect(cmd.display).toContain(
      'set RUNCASTLE_SESSION_ID=sess_xyz&& set RUNCASTLE_SERVER_URL=http://localhost:4512&& claude ',
    )
    // guard specifically against a leaked trailing space before &&
    expect(cmd.display).not.toMatch(/RUNCASTLE_SESSION_ID=sess_xyz &&/)
    expect(cmd.display).not.toMatch(/RUNCASTLE_SERVER_URL=http:\/\/localhost:4512 &&/)
  })

  it('wraps the whole cmd /k payload in one quoted argument', () => {
    expect(cmd.display).toContain(
      'cmd /k "set RUNCASTLE_SESSION_ID=sess_xyz&& set RUNCASTLE_SERVER_URL=http://localhost:4512&& claude',
    )
    expect(cmd.display.endsWith('acceptEdits"')).toBe(true)
  })
})

describe('writeSessionArtifacts', () => {
  const created: string[] = []
  afterEach(() => {
    for (const id of created) rmSync(sessionDir(id), { recursive: true, force: true })
    created.length = 0
  })

  it('writes system-prompt.md, settings.json and mcp.json into the session dir', async () => {
    const sess = session({ id: `sess_test_${Date.now()}` })
    created.push(sess.id)

    const out = await writeSessionArtifacts({
      session: sess,
      feature: feature(),
      project: {
        id: 'proj_1',
        name: 'p',
        repoPath: 'C:\\repo',
        mainBranch: 'main',
      },
      config,
    })

    expect(out.systemPromptPath).toBe(`${sessionDir(sess.id)}\\system-prompt.md`)

    const settings = JSON.parse(readFileSync(out.settingsPath, 'utf8'))
    expect(settings.hooks.SessionStart[0].matcher).toBe('startup')
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain(hookClientPath())
    expect(settings.permissions.allow).toContain('mcp__runcastle__complete_phase')

    const mcp = JSON.parse(readFileSync(out.mcpConfigPath, 'utf8'))
    expect(mcp.mcpServers.runcastle.headers['X-Runcastle-Session']).toBe(sess.id)

    expect(readFileSync(out.systemPromptPath, 'utf8')).toContain('/runcastle:ideate')
  })
})
