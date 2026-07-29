import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { sessionDir } from '@runcastle/core/paths'
import { afterEach, describe, expect, it } from 'vitest'
import type { Feature, RuncastleConfig, SessionRow } from '@runcastle/core'
import { RuncastleConfig as ConfigSchema } from '@runcastle/core'
import {
  RUNCASTLE_MCP_ALLOW_RULES,
  SESSION_BASH_ALLOW_RULES,
  SESSION_START_SOURCES,
  hookClientPath,
  renderMcpConfig,
  renderSettings,
  renderSystemPrompt,
  writeSessionArtifacts,
} from '../src/launcher/artifacts'
import { buildClaudeArgs, ptyExitMessage } from '../src/launcher/launcher'

const config: RuncastleConfig = ConfigSchema.parse({})

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 'feat_abc',
    projectId: 'proj_1',
    slug: 'dark-mode',
    title: 'Dark mode',
    oneLiner: 'a dark theme',
    mapped: false,
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
    // the mapped-ideation tools are pre-allowed too (waypoint sessions use them)
    expect(s.permissions.allow).toEqual(
      expect.arrayContaining([
        'mcp__runcastle__emit_waypoints',
        'mcp__runcastle__resolve_waypoint',
      ]),
    )
    // the project session's three (decision 19) — server-side kind gating makes
    // them inert for a feature session, so every session is launched with them
    expect(s.permissions.allow).toEqual(
      expect.arrayContaining([
        'mcp__runcastle__create_feature',
        'mcp__runcastle__get_project_context',
        'mcp__runcastle__get_work_record',
      ]),
    )
    // the exported rule list is the single source and is fully included
    expect(s.permissions.allow).toEqual(expect.arrayContaining([...RUNCASTLE_MCP_ALLOW_RULES]))
    // every rule is either anchored to our own MCP server or a scoped git Bash
    // rule — no unanchored / cross-server globs, nothing beyond git + our tools
    for (const rule of s.permissions.allow) {
      expect(rule).toMatch(/^(mcp__runcastle__\w+|Bash\(git [a-z-]+:\*\))$/)
    }
  })

  it('pre-allows the benign git commands the skills run (no Bash approval stalls)', () => {
    const s = renderSettings('C:\\hooks\\hook-client.ts')

    // the E2E-observed stalls: `git rev-parse` (converge) and doc add/commit
    // (waypoint work) — plus the rest of the read-mostly git surface, in the
    // documented `Bash(<prefix>:*)` trailing-wildcard form.
    expect(s.permissions.allow).toEqual(
      expect.arrayContaining([
        'Bash(git status:*)',
        'Bash(git rev-parse:*)',
        'Bash(git log:*)',
        'Bash(git diff:*)',
        'Bash(git add:*)',
        'Bash(git commit:*)',
        'Bash(git branch:*)',
        'Bash(git show:*)',
      ]),
    )
    // the exported list is the single source and is fully included
    expect(s.permissions.allow).toEqual(expect.arrayContaining([...SESSION_BASH_ALLOW_RULES]))
    // git-only: no rule allows a non-git Bash command, and none is a bare glob
    for (const rule of s.permissions.allow.filter((r) => r.startsWith('Bash('))) {
      expect(rule).toMatch(/^Bash\(git /)
    }
    expect(s.permissions.allow).not.toContain('Bash')
    expect(s.permissions.allow).not.toContain('Bash(*)')
  })

  it('emits the verified hooks JSON shape with correct events + timeouts', () => {
    const s = renderSettings('C:\\hooks\\hook-client.ts')

    // SessionStart: one entry per source, command hook, timeout 10. REGRESSION:
    // registering `startup` alone meant every `--resume` launch (revisit, merge-
    // conflict resolve, any reopened terminal) fired source=resume, matched
    // nothing, and never reached the hook receiver — so the session never went
    // live and its kickoff was never typed.
    expect(s.hooks.SessionStart.map((h) => h.matcher)).toEqual([...SESSION_START_SOURCES])
    expect(s.hooks.SessionStart.map((h) => h.matcher)).toContain('resume')
    for (const entry of s.hooks.SessionStart) {
      const start = entry.hooks[0]
      expect(start.type).toBe('command')
      expect(start.timeout).toBe(10)
      expect(start.command).toBe('bun run "C:\\hooks\\hook-client.ts" session-start')
    }

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

  it('injects the assigned waypoint + map state into a waypoint session', () => {
    const wp = {
      id: 'wpt_1',
      featureId: 'feat_abc',
      seq: 1,
      title: 'auth model',
      type: 'grilling' as const,
      question: 'sessions or JWT?',
      blockedBy: [],
      status: 'claimed' as const,
    }
    const p = renderSystemPrompt(feature({ mapped: true }), 'waypoint', wp)
    expect(p).toContain('/runcastle:waypoint')
    expect(p).toContain('auth model')
    expect(p).toContain('sessions or JWT?')
    expect(p).toContain('resolve_waypoint')
    expect(p).toContain('emit_waypoints')
    expect(p).toContain('map.md')
    // a waypoint session must NOT be told to converge / emit tickets
    expect(p).not.toContain('emit_tickets')
  })

  it('directs a revisit session to /runcastle:revisit with ticket-surgery tools, no phase writes', () => {
    const p = renderSystemPrompt(feature({ phase: 'implementation' }), 'revisit')
    expect(p).toContain('/runcastle:revisit')
    expect(p).toContain('update_ticket')
    expect(p).toContain('cancel_ticket')
    expect(p).toContain('emit_tickets')
    expect(p).toContain('decisions.md')
    // a revisit never moves the pipeline
    expect(p).toMatch(/do not call `complete_phase`/i)
  })

  it('flags the review-iteration purpose for a revisit at the review phase (ticket 6)', () => {
    const review = renderSystemPrompt(feature({ phase: 'review' }), 'revisit')
    expect(review).toContain('Review iteration')
    expect(review).toMatch(/fix ticket/i)
    expect(review).toContain('emit_tickets')
    // burning from review loops back through implementation; the phase never
    // advances from within the session
    expect(review).toMatch(/click Burn/i)
    // the section is review-only — an implementation revisit never carries it
    expect(renderSystemPrompt(feature({ phase: 'implementation' }), 'revisit')).not.toContain(
      'Review iteration',
    )
  })

  it('directs a converge session to /runcastle:converge over ONLY the compressed knowledge', () => {
    const p = renderSystemPrompt(feature({ mapped: true, phase: 'spec' }), 'converge')
    expect(p).toContain('/runcastle:converge')
    // reads only the compressed knowledge — map + decisions, never transcripts
    expect(p).toContain('map.md')
    expect(p).toContain('decisions.md')
    expect(p).toMatch(/do not read the waypoint session transcripts/i)
    // it runs the existing spec → tickets skills
    expect(p).toContain('/runcastle:spec')
    expect(p).toContain('/runcastle:tickets')
    expect(p).toContain('emit_tickets')
  })
})

describe('buildClaudeArgs', () => {
  it('assembles the claude argv with the verified flags (embedded PTY spawn)', () => {
    const args = buildClaudeArgs({
      sessionId: 'sess_xyz',
      serverUrl: 'http://localhost:4512',
      featureTitle: 'Dark mode',
      worktreePath: 'C:\\wt\\dark-mode',
      pluginDir: 'C:\\repo\\packages\\skills\\packs\\runcastle',
      settingsPath: 'C:\\s\\settings.json',
      mcpConfigPath: 'C:\\s\\mcp.json',
      systemPromptPath: 'C:\\s\\system-prompt.md',
      model: 'claude-sonnet-5',
    })
    expect(args).toEqual([
      '--settings',
      'C:\\s\\settings.json',
      '--mcp-config',
      'C:\\s\\mcp.json',
      '--plugin-dir',
      'C:\\repo\\packages\\skills\\packs\\runcastle',
      '--append-system-prompt-file',
      'C:\\s\\system-prompt.md',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'claude-sonnet-5',
    ])
  })

  it('omits --strict-mcp-config by default so a session keeps the human’s own MCP servers', () => {
    const base = {
      sessionId: 'sess_xyz',
      serverUrl: 'http://localhost:4512',
      featureTitle: 'Dark mode',
      worktreePath: 'C:\\wt\\dark-mode',
      pluginDir: 'C:\\repo\\pack',
      settingsPath: 'C:\\s\\settings.json',
      mcpConfigPath: 'C:\\s\\mcp.json',
      systemPromptPath: 'C:\\s\\system-prompt.md',
      model: 'claude-sonnet-5',
    }
    // default (sessionMcp: 'inherit') — the flag would suppress user/project/plugin servers
    expect(buildClaudeArgs(base)).not.toContain('--strict-mcp-config')
    // ...but runcastle's own server is always attached either way
    expect(buildClaudeArgs(base)).toContain('--mcp-config')

    // sessionMcp: 'runcastleOnly' — opt back in to the hermetic tool surface
    const strict = buildClaudeArgs({ ...base, strictMcp: true })
    expect(strict).toContain('--strict-mcp-config')
    // still immediately after the config it restricts to
    expect(strict[strict.indexOf('--strict-mcp-config') - 1]).toBe('C:\\s\\mcp.json')
  })

  it('prepends --resume <ccSessionId> when resuming a released waypoint', () => {
    const base = {
      sessionId: 'sess_xyz',
      serverUrl: 'http://localhost:4512',
      featureTitle: 'Dark mode',
      worktreePath: 'C:\\wt\\dark-mode',
      pluginDir: 'C:\\repo\\pack',
      settingsPath: 'C:\\s\\settings.json',
      mcpConfigPath: 'C:\\s\\mcp.json',
      systemPromptPath: 'C:\\s\\system-prompt.md',
      model: 'claude-sonnet-5',
    }
    // no resume → no --resume flag
    expect(buildClaudeArgs(base)).not.toContain('--resume')
    // with resume → the flag leads the argv, followed by the cc session id
    const args = buildClaudeArgs({ ...base, resumeSessionId: 'cc-42' })
    expect(args.slice(0, 2)).toEqual(['--resume', 'cc-42'])
  })

  it('always carries --model from config so sessions never inherit the CLI default', () => {
    const args = buildClaudeArgs({
      sessionId: 'sess_xyz',
      serverUrl: 'http://localhost:4512',
      featureTitle: 'Dark mode',
      worktreePath: 'C:\\wt\\dark-mode',
      pluginDir: 'C:\\repo\\pack',
      settingsPath: 'C:\\s\\settings.json',
      mcpConfigPath: 'C:\\s\\mcp.json',
      systemPromptPath: 'C:\\s\\system-prompt.md',
      model: 'claude-sonnet-5',
      resumeSessionId: 'cc-42',
    })
    // present on the resume path too (both spawn paths share buildClaudeArgs)
    const at = args.indexOf('--model')
    expect(at).toBeGreaterThan(-1)
    expect(args[at + 1]).toBe('claude-sonnet-5')
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

    expect(out.systemPromptPath).toBe(join(sessionDir(sess.id), 'system-prompt.md'))

    const settings = JSON.parse(readFileSync(out.settingsPath, 'utf8'))
    expect(settings.hooks.SessionStart.map((h: { matcher: string }) => h.matcher)).toEqual([
      ...SESSION_START_SOURCES,
    ])
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain(hookClientPath())
    expect(settings.permissions.allow).toContain('mcp__runcastle__complete_phase')

    const mcp = JSON.parse(readFileSync(out.mcpConfigPath, 'utf8'))
    expect(mcp.mcpServers.runcastle.headers['X-Runcastle-Session']).toBe(sess.id)

    expect(readFileSync(out.systemPromptPath, 'utf8')).toContain('/runcastle:ideate')
  })
})
