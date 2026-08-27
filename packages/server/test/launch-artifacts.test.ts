import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionDir } from '@runcastle/core/paths'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Feature, Project, RuncastleConfig, SessionRow } from '@runcastle/core'
import { RuncastleConfig as ConfigSchema, SessionKind } from '@runcastle/core'
import type { WriteArtifactsInput } from '../src/launcher/artifacts'
import {
  RUNCASTLE_MCP_ALLOW_RULES,
  SESSION_BASH_ALLOW_RULES,
  SESSION_BASH_READ_RULES,
  sessionBashAllowRules,
  SESSION_START_SOURCES,
  hookClientPath,
  renderMcpConfig,
  renderSettings,
  renderSystemPrompt,
  writeSessionArtifacts,
} from '../src/launcher/artifacts'
import { ptyExitMessage } from '../src/launcher/launcher'
import type { RuntimeLaunchInput, RuntimeLaunchSpec } from '../src/launcher/runtimes'
import {
  CC_NESTING_ENV,
  KICKOFF_LINES,
  buildClaudeArgs,
  claudeRuntime,
} from '../src/launcher/runtimes/claude'
import {
  KICKOFF_LINES as CODEX_KICKOFF_LINES,
  codexHomeDir,
  codexRuntime,
  mcpServerTables,
  renderCodexHooks,
} from '../src/launcher/runtimes/codex'
import { resolvePluginDir } from '../src/launcher/skills-root'

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
    awaitingInput: false,
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

  /**
   * The blanket `git add`/`git commit` grant was justified on the worktree being
   * docs-only. That is false for the two HOST-SIDE kinds: `prepare` and
   * `drive-fix` both run in `project.repoPath` — the developer's own checkout,
   * with their own uncommitted work in it — where an unprompted `git add -A`
   * commits their entire dirty tree. Doubly pointed because the prepare brief's
   * own drive contract warns that `.runcastle/drive.env` "must never be one
   * `git add -A` away from a commit".
   */
  it('narrows the git write surface for the kinds that hold the real checkout', () => {
    for (const kind of ['prepare', 'drive-fix'] as const) {
      const allow = sessionBashAllowRules(kind)
      expect(allow).not.toContain('Bash(git add:*)')
      expect(allow).not.toContain('Bash(git commit:*)')
      // scoped to exactly what their edit guard lets them have written
      expect(allow).toContain('Bash(git add .runcastle:*)')
      expect(allow).toContain('Bash(git add .gitignore:*)')
      // and the read rules are untouched
      expect(allow).toEqual(expect.arrayContaining([...SESSION_BASH_READ_RULES]))
    }
    // the docs-only talk kinds keep the blanket grant the reasoning covers
    for (const kind of ['ideation', 'qa', 'waypoint', 'converge', 'revisit'] as const) {
      expect(sessionBashAllowRules(kind)).toEqual(
        expect.arrayContaining([...SESSION_BASH_ALLOW_RULES]),
      )
    }
    // and `project` still gets read-only (whole-repo write, prompts for the rest)
    expect(sessionBashAllowRules('project')).toEqual([...SESSION_BASH_READ_RULES])
  })

  /**
   * The paged-context tools added with the `get_feature_context` reshape. Without
   * an allow rule, the first reach for a fifth doc stops the session on an
   * interactive permission prompt.
   */
  it('pre-approves the paged-context tools', () => {
    const s = renderSettings('C:\\hooks\\hook-client.ts')
    for (const tool of ['read_feature_doc', 'list_tickets', 'read_adr']) {
      expect(s.permissions.allow).toContain(`mcp__runcastle__${tool}`)
    }
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

  /**
   * Ticket 4 — the turn-state hook. Without `Stop` the server only ever hears
   * that a prompt went IN, so a live session looks identical whether the agent
   * is mid-turn or has been waiting on the human for an hour.
   */
  it('registers the Stop hook so the end of an agent turn is observable', () => {
    const s = renderSettings('C:\\hooks\\hook-client.ts')

    // Stop takes NO matcher (CC-INTEGRATION-NOTES §2 — silently ignored there).
    expect(s.hooks.Stop[0]).not.toHaveProperty('matcher')
    expect(s.hooks.Stop[0].hooks[0]).toMatchObject({
      type: 'command',
      command: 'bun run "C:\\hooks\\hook-client.ts" stop',
      timeout: 5,
    })
  })

  it('registers Stop for every session kind — turn state is not kind-specific', () => {
    for (const kind of ['ideation', 'qa', 'waypoint', 'converge', 'revisit', 'prepare', 'project'] as const) {
      const s = renderSettings('C:\\hooks\\hook-client.ts', kind)
      expect(s.hooks.Stop[0].hooks[0].command).toBe('bun run "C:\\hooks\\hook-client.ts" stop')
    }
  })

  /**
   * The talk-session edit guard (F2). Nothing but a prompt sentence stood
   * between a session told to grill and a session that just implemented the
   * feature itself — full checkout, `acceptEdits`, no deny hook anywhere.
   */
  it('registers the PreToolUse edit guard for every kind but `project`', () => {
    for (const kind of ['ideation', 'qa', 'waypoint', 'converge', 'revisit', 'prepare'] as const) {
      const guard = renderSettings('C:\\hooks\\hook-client.ts', kind).hooks.PreToolUse
      expect(guard).toHaveLength(1)
      expect(guard?.[0].matcher).toBe('Edit|Write|NotebookEdit|apply_patch')
      expect(guard?.[0].hooks[0]).toMatchObject({
        type: 'command',
        command: 'bun run "C:\\hooks\\hook-client.ts" pre-tool',
        timeout: 5,
      })
    }
    // decision 18 gives the project session whole-repo write access — it is the
    // one kind whose commits are the point of the session
    expect(renderSettings('C:\\hooks\\hook-client.ts', 'project').hooks.PreToolUse).toBeUndefined()
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
  it('directs an ideation session to /runcastle:ideate with the docs paths', () => {
    const p = renderSystemPrompt(feature(), 'ideation')
    expect(p).toContain('/runcastle:ideate')
    expect(p).toContain('docs/features/dark-mode/')
    expect(p).toContain('complete_phase')
  })

  /**
   * No renderer restates the MCP tool list any more. Every tool is already in
   * the session's tool list with a schema-backed description, registration is
   * filtered by audience — so a hand-written copy can name a tool this session
   * was never given — and the copies that existed had already drifted apart
   * from each other and from the schema.
   */
  it('carries no MCP tool cheat-sheet in any renderer', () => {
    const prompts = [
      renderSystemPrompt(feature(), 'ideation'),
      renderSystemPrompt(feature(), 'qa'),
      renderSystemPrompt(feature({ mapped: true }), 'waypoint'),
      renderSystemPrompt(feature({ mapped: true, phase: 'spec' }), 'converge'),
      renderSystemPrompt(feature({ phase: 'review' }), 'revisit'),
    ]
    for (const p of prompts) expect(p).not.toContain('## runcastle MCP tools')
  })

  /**
   * A qa session is READ-ONLY, and used to fall through the generic feature
   * brief: the whole `## Pipeline` section on how to cross gates, a cheat-sheet
   * for `emit_tickets`/`complete_phase`, and a `## Knowledge` section naming the
   * docs as files to WRITE — roughly a fifth of the prompt was operating
   * instructions for the two tools the same document forbade 30 lines later.
   */
  it('gives a qa session its own read-only prompt with no pipeline instructions', () => {
    const p = renderSystemPrompt(feature(), 'qa')
    expect(p).toContain('/runcastle:qa')
    expect(p).toMatch(/does not advance the pipeline/i)
    expect(p).toContain('docs/features/dark-mode/')
    // none of the writer's brief survives
    expect(p).not.toContain('## Pipeline')
    expect(p).not.toContain('## Knowledge')
    expect(p).not.toContain('emit_tickets')
    expect(p).not.toContain('complete_phase')
    // and it is materially shorter than the brief it used to share
    expect(p.length).toBeLessThan(renderSystemPrompt(feature(), 'ideation').length)
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
    expect(p).toContain('map.md')
    // a waypoint session must NOT be told to converge / emit tickets
    expect(p).not.toContain('emit_tickets')
    // it states the no-code rule itself rather than leaving the guard's denial
    // to be the session's first notice of it
    expect(p).toMatch(/Talk sessions do not write code/)
  })

  it('directs a revisit session to /runcastle:revisit with ticket-surgery tools, no phase writes', () => {
    const p = renderSystemPrompt(feature({ phase: 'implementation' }), 'revisit')
    expect(p).toContain('/runcastle:revisit')
    expect(p).toContain('decisions.md')
    // a revisit never moves the pipeline
    expect(p).toMatch(/do not call `complete_phase`/i)
  })

  it('flags the review-iteration purpose for a revisit at the review phase (ticket 6)', () => {
    const review = renderSystemPrompt(feature({ phase: 'review' }), 'revisit')
    expect(review).toContain('Review iteration')
    expect(review).toMatch(/fix ticket/i)
    // it points at the PER-TICKET facts that are actually in the payload —
    // there is no run outcome in `get_feature_context`, `get_work_record` is
    // gated shut for feature sessions, and `digest` is no longer returned
    expect(review).toContain('get_feature_context')
    expect(review).toMatch(/`commits`/)
    expect(review).toMatch(/`error`/)
    expect(review).not.toMatch(/run outcome/i)
    expect(review).not.toContain('digest')
    // burning from review loops back through implementation; the phase never
    // advances from within the session
    expect(review).toMatch(/click Burn/i)
    // the section is review-only — an implementation revisit never carries it
    expect(renderSystemPrompt(feature({ phase: 'implementation' }), 'revisit')).not.toContain(
      'Review iteration',
    )
  })

  /**
   * A lap is passed in, never inferred: by the time the artifacts are written
   * the rethink route has already flipped the phase back to `ideation`, so the
   * old `phase === 'review'` test rendered a lap session the plain revisit
   * prompt — complete with a "never call complete_phase" rule contradicting the
   * lap briefing the same session was about to be typed (F2).
   */
  it('renders the lap framing when a lap is passed, and drops the complete_phase ban', () => {
    const p = renderSystemPrompt(feature({ phase: 'ideation', lap: 2 }), 'revisit', undefined, 2)
    expect(p).toContain('This is lap 2')
    expect(p).toContain('ideation → spec → tickets')
    // its two optional inputs, and that missing ones are normal
    expect(p).toContain('test-notes.md')
    expect(p).toContain('## Lap 1')
    expect(p).toContain('## Later laps')
    expect(p).toMatch(/OPTIONAL/i)
    // the rule that used to contradict the briefing is inverted, not merely dropped
    expect(p).not.toMatch(/Do NOT call `complete_phase`/i)
    expect(p).toMatch(/DO call `complete_phase`/)
  })

  it('leaves a plain revisit exactly as it was — no lap framing, ban intact', () => {
    const p = renderSystemPrompt(feature({ phase: 'implementation', lap: 3 }), 'revisit')
    expect(p).not.toContain('This is lap')
    expect(p).toMatch(/Do NOT call `complete_phase`/i)
  })

  it('states the no-code rule in the revisit and ideation prompts', () => {
    for (const p of [
      renderSystemPrompt(feature(), 'ideation'),
      renderSystemPrompt(feature({ phase: 'review' }), 'revisit'),
      renderSystemPrompt(feature({ phase: 'ideation', lap: 2 }), 'revisit', undefined, 2),
    ]) {
      expect(p).toMatch(/Talk sessions do not write code/)
      // and it says where the line is, and where the change goes instead
      expect(p).toContain('docs/features/dark-mode/')
      expect(p).toMatch(/ticket/i)
    }
  })

  /**
   * E2E F18 — the conflict-resolution revisit was briefed to resolve the merge
   * AND told edits are denied. The agent believed the ban, aborted the merge and
   * emitted a ticket to carry it instead, so the feature never worked.
   */
  it('tells the conflict-resolution revisit that it does write code here', () => {
    const p = renderSystemPrompt(feature({ phase: 'review' }), 'revisit', undefined, undefined, 'resolve-conflict')
    expect(p).not.toMatch(/Talk sessions do not write code/)
    expect(p).toMatch(/resolves a merge conflict, so it DOES write code/i)
    // the exception is bounded: other work still rides a ticket
    expect(p).toMatch(/ticket/i)
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
    // the `size`/`full` concept was DELETED (migration 0008 drops the column),
    // so the spec step must not be handed a condition it cannot evaluate
    expect(p).not.toContain('`full`')
    // and it states the no-code rule, which `guardsEdits` enforces anyway
    expect(p).toMatch(/Talk sessions do not write code/)
    // the incomplete re-convergence rule is gone; the skill owns the complete
    // one, including the "complete_phase for spec first" clause this omitted
    expect(p).not.toMatch(/already exists \(a previous converge session/)
  })

  /**
   * The lap owns the entry skill, then the kind. A lap-N grill is created as
   * `kind: 'ideation'` and used to render the generic feature brief ("invoke
   * `/runcastle:ideate`") while the lap kickoff typed into the same terminal
   * said "invoke `/runcastle:revisit` for LAP N" — two entry skills, no defined
   * precedence, and the `lap` parameter never read on that path.
   */
  it('routes a lap-N ideation session to the revisit prompt, one entry skill', () => {
    const p = renderSystemPrompt(feature({ phase: 'ideation', lap: 3 }), 'ideation', undefined, 3)
    expect(p).toContain('This is lap 3')
    expect(p).toContain('/runcastle:revisit')
    expect(p).not.toContain('/runcastle:ideate')
    expect(p).toMatch(/DO call `complete_phase`/)
    // and it is byte-identical to the revisit rendering of the same lap
    expect(p).toBe(
      renderSystemPrompt(feature({ phase: 'ideation', lap: 3 }), 'revisit', undefined, 3),
    )
  })

  /**
   * A conflict-resolution revisit is ALWAYS at `review` (its only launch site is
   * the review body's conflict card), and its whole job is a `git merge`. It was
   * also getting 591 chars of fix-ticket interview — the same failure shape as
   * F18, fixed in the Rules block and missed in this guard.
   */
  it('does not brief the conflict-resolution revisit as a review iteration', () => {
    const p = renderSystemPrompt(
      feature({ phase: 'review' }),
      'revisit',
      undefined,
      undefined,
      'resolve-conflict',
    )
    expect(p).not.toContain('Review iteration')
    expect(p).not.toMatch(/fix ticket/i)
    expect(p).toMatch(/resolves a merge conflict/i)
    // strictly shorter than the review-iteration revisit it used to also be
    expect(p.length).toBeLessThan(
      renderSystemPrompt(feature({ phase: 'review' }), 'revisit').length,
    )
  })

  /**
   * A lap advances the pipeline and writes no code; a conflict resolution writes
   * code and advances nothing. One session cannot be both, and the tRPC route
   * takes `kickoffLine` and `purpose` as free parameters — so the exclusion is
   * asserted where the two meet rather than left to call-site luck.
   */
  it('refuses to render one revisit as both a lap and a conflict resolution', () => {
    expect(() =>
      renderSystemPrompt(
        feature({ phase: 'ideation', lap: 2 }),
        'revisit',
        undefined,
        2,
        'resolve-conflict',
      ),
    ).toThrow(/both lap 2 and a conflict resolution/i)
  })
})

describe('buildClaudeArgs', () => {
  it('assembles the claude argv with the verified flags (embedded PTY spawn)', () => {
    const args = buildClaudeArgs({
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
    // the edit guard reaches the session as a real registered hook, not just a rule
    expect(settings.hooks.PreToolUse[0].matcher).toBe('Edit|Write|NotebookEdit|apply_patch')
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain('pre-tool')

    const mcp = JSON.parse(readFileSync(out.mcpConfigPath, 'utf8'))
    expect(mcp.mcpServers.runcastle.headers['X-Runcastle-Session']).toBe(sess.id)

    expect(readFileSync(out.systemPromptPath, 'utf8')).toContain('/runcastle:ideate')
  })
})

/**
 * The AgentRuntime seam. Every launch now goes through an adapter, so the thing
 * to pin is that the Claude adapter builds EXACTLY what the four launch sites
 * used to build inline — same argv, same three artifact files, same env, same
 * scrub list — for every session kind. `buildClaudeArgs` is the pre-refactor
 * argv builder, unchanged, so comparing against it is comparing against what
 * shipped before.
 */
describe('claudeRuntime.writeArtifacts', () => {
  const created: string[] = []
  afterEach(() => {
    for (const id of created) rmSync(sessionDir(id), { recursive: true, force: true })
    created.length = 0
  })

  const project: Project = { id: 'proj_1', name: 'p', repoPath: 'C:\\repo' }

  /** The brief each kind is launched with — exactly the one its launch site passes. */
  function briefFor(kind: SessionKind): Partial<WriteArtifactsInput> {
    if (kind === 'prepare') {
      return { prepare: { project, remainingKeys: ['devCommand'], established: [] } }
    }
    if (kind === 'project') {
      return { projectBrief: { project, branch: 'runcastle/project', worktreePath: 'C:\\wt\\p' } }
    }
    if (kind === 'drive-fix') {
      return {
        driveFix: {
          project,
          feature: feature(),
          failure: {
            phase: 'setup',
            command: 'bash .runcastle/drive-setup.sh',
            exitCode: 3,
            timedOut: false,
            output: 'boom',
          },
          envKeys: [],
          delta: { base: 'main', branch: 'feature/dark-mode', stat: '' },
        },
      }
    }
    return { feature: feature() }
  }

  async function launchSpec(
    kind: SessionKind,
    extra: Partial<RuntimeLaunchInput> = {},
  ): Promise<RuntimeLaunchSpec> {
    const sess = session({ id: `sess_rt_${kind}`, kind })
    created.push(sess.id)
    return claudeRuntime.writeArtifacts({
      session: sess,
      project,
      config,
      ...briefFor(kind),
      worktreePath: 'C:\\wt\\dark-mode',
      serverUrl: 'http://localhost:4512',
      model: 'claude-sonnet-5',
      ...extra,
    })
  }

  it.each(SessionKind.options)('builds the pre-refactor argv for a %s session', async (kind) => {
    const spec = await launchSpec(kind)
    const dir = sessionDir(`sess_rt_${kind}`)

    expect(spec.argv).toEqual(
      buildClaudeArgs({
        pluginDir: resolvePluginDir(),
        settingsPath: join(dir, 'settings.json'),
        mcpConfigPath: join(dir, 'mcp.json'),
        systemPromptPath: join(dir, 'system-prompt.md'),
        model: 'claude-sonnet-5',
        strictMcp: false,
      }),
    )
    // the three files the launch sites used to collect from writeSessionArtifacts
    expect(spec.files).toEqual([
      join(dir, 'system-prompt.md'),
      join(dir, 'settings.json'),
      join(dir, 'mcp.json'),
    ])
    for (const file of spec.files) expect(existsSync(file)).toBe(true)
  })

  it('carries the two runcastle env vars and the CC nesting scrub list', async () => {
    const spec = await launchSpec('ideation')
    expect(spec.env).toEqual({
      RUNCASTLE_SESSION_ID: 'sess_rt_ideation',
      RUNCASTLE_SERVER_URL: 'http://localhost:4512',
    })
    // the marker that makes a nested CC skip writing its transcript, breaking --resume
    expect(spec.envScrub).toContain('CLAUDE_CODE_CHILD_SESSION')
    expect(spec.envScrub).toEqual([...CC_NESTING_ENV])
  })

  it('passes the launch options through to the flags they used to set inline', async () => {
    const resumed = await launchSpec('revisit', { resumeSessionId: 'cc-42' })
    expect(resumed.argv.slice(0, 2)).toEqual(['--resume', 'cc-42'])

    // the project session's `default` posture (decision 18), chosen by its site
    const projected = await launchSpec('project', { permissionMode: 'default' })
    expect(projected.argv[projected.argv.indexOf('--permission-mode') + 1]).toBe('default')

    // strictMcp is the adapter's own reading of config.sessionMcp
    const strict = await launchSpec('qa', {
      config: ConfigSchema.parse({ sessionMcp: 'runcastleOnly' }),
    })
    expect(strict.argv).toContain('--strict-mcp-config')
  })

  it('spells the kickoff line for every kind (the launcher no longer holds a table)', () => {
    for (const kind of SessionKind.options) {
      expect(claudeRuntime.kickoffLine(kind)).toBe(KICKOFF_LINES[kind])
    }
  })
})

/**
 * The Codex adapter (decision 9). Where the Claude adapter passes flags against
 * the human's real home, this one BUILDS a home — so what has to be pinned is
 * the content of that home, since every per-session decision the flags used to
 * carry now lives in a file inside it.
 *
 * `CODEX_HOME` is redirected at a temp dir for the whole block: the adapter
 * borrows the human's credentials and (on `inherit`) their MCP servers from
 * there, and a test that read the developer's real `~/.codex` would pass or fail
 * on whether they happen to be logged in.
 */
describe('codexRuntime.writeArtifacts', () => {
  const project: Project = { id: 'proj_1', name: 'p', repoPath: '/repo' }
  const created: string[] = []
  let userHome: string
  let worktree: string
  let realCodexHome: string | undefined

  beforeEach(() => {
    userHome = mkdtempSync(join(tmpdir(), 'runcastle-codex-home-'))
    worktree = mkdtempSync(join(tmpdir(), 'runcastle-codex-wt-'))
    realCodexHome = process.env.CODEX_HOME
    process.env.CODEX_HOME = userHome
    writeFileSync(join(userHome, 'auth.json'), '{"tokens":{"id_token":"real"}}', 'utf8')
  })

  afterEach(() => {
    if (realCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = realCodexHome
    for (const id of created) rmSync(sessionDir(id), { recursive: true, force: true })
    created.length = 0
    rmSync(userHome, { recursive: true, force: true })
    rmSync(worktree, { recursive: true, force: true })
  })

  async function launchSpec(
    kind: SessionKind = 'ideation',
    extra: Partial<RuntimeLaunchInput> = {},
  ): Promise<RuntimeLaunchSpec> {
    const sess = session({ id: `sess_codex_${kind}`, kind })
    created.push(sess.id)
    return codexRuntime.writeArtifacts({
      session: sess,
      feature: feature(),
      project,
      config,
      worktreePath: worktree,
      serverUrl: 'http://localhost:4512',
      model: 'gpt-5.6-sol',
      ...extra,
    })
  }

  /** The generated `config.toml` of a just-written session home. */
  function configToml(sessionId: string): string {
    return readFileSync(join(codexHomeDir(sessionId), 'config.toml'), 'utf8')
  }

  it('writes a synthetic CODEX_HOME: config, hooks, per-kind prompt, borrowed auth', async () => {
    const spec = await launchSpec('ideation')
    const home = codexHomeDir('sess_codex_ideation')

    expect(spec.files).toEqual(
      expect.arrayContaining([
        join(home, 'config.toml'),
        join(home, 'hooks.json'),
        join(home, 'AGENTS.md'),
        join(home, 'auth.json'),
      ]),
    )
    for (const file of spec.files) expect(existsSync(file)).toBe(true)

    // auth is BORROWED byte-for-byte, never managed (decision 5)
    expect(readFileSync(join(home, 'auth.json'), 'utf8')).toBe(
      readFileSync(join(userHome, 'auth.json'), 'utf8'),
    )
  })

  it('pins the model, the acceptEdits analogue, project trust and the MCP identity header', async () => {
    await launchSpec('ideation')
    const toml = configToml('sess_codex_ideation')

    expect(toml).toContain('model = "gpt-5.6-sol"')
    // the `--permission-mode acceptEdits` analogue: writes inside the worktree
    // without prompting — a dialog blocks BEFORE SessionStart, stranding the session
    expect(toml).toContain('sandbox_mode = "workspace-write"')
    expect(toml).toContain('approval_policy = "never"')
    // the first-run "do you trust this folder?" gate, answered up front
    expect(toml).toContain(`[projects.${JSON.stringify(worktree)}]`)
    expect(toml).toContain('trust_level = "trusted"')
    // the same server, behind the same identity header the MCP route already gates on
    expect(toml).toContain('[mcp_servers.runcastle]')
    expect(toml).toContain('url = "http://localhost:4512/mcp"')
    expect(toml).toContain('http_headers = { "X-Runcastle-Session" = "sess_codex_ideation" }')
  })

  it('maps the project session\'s `default` posture to an approval policy that asks', async () => {
    await launchSpec('project', {
      permissionMode: 'default',
      projectBrief: { project, branch: 'runcastle/project', worktreePath: worktree },
    })
    const projected = configToml('sess_codex_project')
    // decision 18: a project session runs against the whole repo checkout, which
    // is why the Claude path is downgraded to `default` — `untrusted` is Codex's
    // "always ask", so the same session on a Codex model asks too
    expect(projected).toContain('approval_policy = "untrusted"')
    // only the approval gate moves; the sandbox is the same one every kind runs in
    expect(projected).toContain('sandbox_mode = "workspace-write"')

    // a worktree-scoped kind keeps the acceptEdits analogue: it writes inside its
    // own checkout unattended
    await launchSpec('qa')
    expect(configToml('sess_codex_qa')).toContain('approval_policy = "never"')
  })

  it('registers the five lifecycle events against the same runtime-neutral hook client', async () => {
    await launchSpec('ideation')
    const hooks = JSON.parse(
      readFileSync(join(codexHomeDir('sess_codex_ideation'), 'hooks.json'), 'utf8'),
    )

    const client = hookClientPath()
    // `toMatchObject`, not `toEqual`: this test writes a real home on whatever
    // platform it runs on, and win32 entries carry a `commandWindows` besides.
    // The exact per-platform shape is pinned in the next test, which names the
    // platform instead of inheriting the host's.
    expect(hooks.hooks.SessionStart[0].hooks[0]).toMatchObject({
      type: 'command',
      command: `bun run "${client}" session-start`,
    })
    expect(hooks.hooks.UserPromptSubmit[0].hooks[0].command).toBe(`bun run "${client}" user-prompt`)
    expect(hooks.hooks.Stop[0].hooks[0].command).toBe(`bun run "${client}" stop`)
    expect(hooks.hooks.SessionEnd[0].hooks[0].command).toBe(`bun run "${client}" session-end`)
    // the edit guard reaches a Codex session as the same deny hook, matching the
    // tool name Codex edits files with
    expect(hooks.hooks.PreToolUse[0].matcher).toBe('Edit|Write|NotebookEdit|apply_patch')
    expect(hooks.hooks.PreToolUse[0].hooks[0].command).toBe(`bun run "${client}" pre-tool`)
  })

  /**
   * The one thing about a hook entry that varies by platform, pinned against a
   * NAMED platform — so the same three cases are proven whichever host runs the
   * suite, rather than only the branch the host happens to take.
   */
  it('adds the win32 spelling of every hook command, and only there', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const posix = renderCodexHooks('/tmp/hook-client.ts', 'ideation', platform)
      expect(posix.hooks.SessionStart[0].hooks[0]).toEqual({
        type: 'command',
        command: 'bun run "/tmp/hook-client.ts" session-start',
      })
      for (const group of Object.values(posix.hooks)) {
        for (const hook of group?.[0].hooks ?? []) {
          expect(hook).not.toHaveProperty('commandWindows')
        }
      }
    }

    const win = renderCodexHooks('C:\\hooks\\hook-client.ts', 'ideation', 'win32')
    expect(win.hooks.SessionStart[0].hooks[0]).toEqual({
      type: 'command',
      command: 'bun run "C:\\hooks\\hook-client.ts" session-start',
      commandWindows: 'bun run "C:\\hooks\\hook-client.ts" session-start',
    })
    for (const group of Object.values(win.hooks)) {
      for (const hook of group?.[0].hooks ?? []) {
        expect(hook.commandWindows).toBe(hook.command)
      }
    }
  })

  it('exempts the one kind that may write code from the edit guard, as Claude does', () => {
    expect(renderCodexHooks('/tmp/hook-client.ts', 'project').hooks.PreToolUse).toBeUndefined()
    expect(renderCodexHooks('/tmp/hook-client.ts', 'qa').hooks.PreToolUse).toHaveLength(1)
  })

  it('writes the per-kind prompt as AGENTS.md, spelled the way Codex invokes a skill', async () => {
    await launchSpec('ideation')
    const ideation = readFileSync(join(codexHomeDir('sess_codex_ideation'), 'AGENTS.md'), 'utf8')
    expect(ideation).toContain('$ideate')
    expect(ideation).not.toContain('/runcastle:')

    await launchSpec('qa')
    expect(readFileSync(join(codexHomeDir('sess_codex_qa'), 'AGENTS.md'), 'utf8')).toContain('$qa')
  })

  it('builds the argv and env — the home IS the configuration', async () => {
    const spec = await launchSpec('ideation')

    expect(spec.argv).toEqual(['--dangerously-bypass-hook-trust'])
    expect(spec.env).toEqual({
      CODEX_HOME: codexHomeDir('sess_codex_ideation'),
      RUNCASTLE_SESSION_ID: 'sess_codex_ideation',
      RUNCASTLE_SERVER_URL: 'http://localhost:4512',
    })
    expect(spec.envScrub).toEqual([])
  })

  it('resumes the conversation the SessionStart hook recorded', async () => {
    const spec = await launchSpec('revisit', { resumeSessionId: 'codex-sess-42' })
    expect(spec.argv).toEqual(['resume', 'codex-sess-42', '--dangerously-bypass-hook-trust'])
  })

  it('merges the human’s own MCP servers on `inherit`, and none on `runcastleOnly`', async () => {
    writeFileSync(
      join(userHome, 'config.toml'),
      [
        'model = "gpt-5.6-terra"',
        '',
        '[mcp_servers.linear]',
        'command = "linear-mcp"',
        '',
        '[shell_environment_policy]',
        'inherit = "all"',
      ].join('\n'),
      'utf8',
    )

    await launchSpec('ideation')
    const inherited = configToml('sess_codex_ideation')
    expect(inherited).toContain('[mcp_servers.linear]')
    expect(inherited).toContain('command = "linear-mcp"')
    // only the server tables come across — not the rest of their configuration
    expect(inherited).not.toContain('[shell_environment_policy]')
    expect(inherited).not.toContain('gpt-5.6-terra')
    expect(inherited).toContain('[mcp_servers.runcastle]')

    await launchSpec('qa', { config: ConfigSchema.parse({ sessionMcp: 'runcastleOnly' }) })
    const isolated = configToml('sess_codex_qa')
    expect(isolated).not.toContain('linear')
    expect(isolated).toContain('[mcp_servers.runcastle]')
  })

  it('never lets the human’s own `runcastle` entry shadow the generated one', () => {
    const merged = mcpServerTables(
      [
        '[mcp_servers.runcastle]',
        'url = "http://stale"',
        '',
        '[mcp_servers.linear]',
        'command = "x"',
      ].join('\n'),
    )
    expect(merged).not.toContain('http://stale')
    expect(merged).toContain('[mcp_servers.linear]')
  })

  it('renders the skill pack into the worktree without adding a tracked file', async () => {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: worktree })

    const spec = await launchSpec('ideation')
    const skill = join(worktree, '.agents', 'skills', 'ideate', 'SKILL.md')

    expect(spec.files).toContain(skill)
    // Codex resolves `$ideate` from the frontmatter name, so the kickoff line and
    // the rendered pack have to agree about what the skill is called
    expect(readFileSync(skill, 'utf8')).toContain('name: ideate')
    expect(codexRuntime.kickoffLine('ideation')).toContain('$ideate')

    // the invariant: skills load and the human's diff is untouched — via
    // .git/info/exclude, never their .gitignore, which is their file and their PR
    expect(
      execFileSync('git', ['status', '--porcelain'], { cwd: worktree, encoding: 'utf8' }).trim(),
    ).toBe('')
    expect(readFileSync(join(worktree, '.git', 'info', 'exclude'), 'utf8')).toContain('.agents/')
    expect(existsSync(join(worktree, '.gitignore'))).toBe(false)
  })

  it('renders nothing into a worktree that is not on disk (the smoke path computes one)', async () => {
    const absent = join(tmpdir(), 'runcastle-codex-absent-wt')
    const spec = await launchSpec('ideation', { worktreePath: absent })
    expect(spec.files.some((f) => f.includes('.agents'))).toBe(false)
    expect(existsSync(absent)).toBe(false)
  })

  it('spells every kickoff line the way Codex invokes a skill', () => {
    for (const kind of SessionKind.options) {
      expect(codexRuntime.kickoffLine(kind)).toBe(CODEX_KICKOFF_LINES[kind])
      expect(codexRuntime.kickoffLine(kind)).not.toContain('/runcastle:')
    }
    expect(codexRuntime.kickoffLine('converge')).toContain('$converge')
  })
})

/**
 * The fail-early precheck (decision 7), which for Codex has a second half the
 * Claude adapter has no equivalent of: a session runs on a COPY of the human's
 * own credentials, so "logged out" is not a session that logs in — it is a
 * synthetic home with no credentials in it at all.
 */
describe('codexRuntime.checkReady', () => {
  let home: string
  let realCodexHome: string | undefined

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'runcastle-codex-ready-'))
    realCodexHome = process.env.CODEX_HOME
    process.env.CODEX_HOME = home
    vi.spyOn(codexRuntime, 'resolveBinary').mockReturnValue(join(home, 'codex'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (realCodexHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = realCodexHome
    rmSync(home, { recursive: true, force: true })
  })

  it('is ready when the CLI resolves and the human is logged in', () => {
    writeFileSync(join(home, 'auth.json'), '{}', 'utf8')
    expect(codexRuntime.checkReady()).toEqual({ ok: true })
  })

  it('refuses with a doctor hint when the CLI is nowhere this server can see', () => {
    // `resolveTool` returns the bare name when PATH and the recovery dirs both
    // came up empty — exactly the case a spawn would ENOENT on.
    vi.spyOn(codexRuntime, 'resolveBinary').mockReturnValue('codex')
    const ready = codexRuntime.checkReady()

    expect(ready.ok).toBe(false)
    if (ready.ok) return
    expect(ready.reason).toContain('`codex`')
    expect(ready.doctorHint).toContain('runcastle doctor')
  })

  it('refuses with the login fix when there are no credentials to borrow', () => {
    const ready = codexRuntime.checkReady()

    expect(ready.ok).toBe(false)
    if (ready.ok) return
    expect(ready.reason).toContain(join(home, 'auth.json'))
    expect(ready.doctorHint).toContain('codex login')
  })
})
