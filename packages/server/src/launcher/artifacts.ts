import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type {
  Feature,
  Project,
  RuncastleConfig,
  SessionKind,
  SessionRow,
  Waypoint,
} from '@runcastle/core'
import { featureDocsRel, sessionDir } from '@runcastle/core/paths'

/**
 * Session launch artifacts (SPEC §5.2). Writes `system-prompt.md`,
 * `settings.json` (hooks) and `mcp.json` into `sessionDir(sessionId)`. The three
 * renderers are pure + exported so their exact shapes (verified against
 * docs/research/CC-INTEGRATION-NOTES.md) are unit-testable without touching disk.
 */

export interface SessionArtifacts {
  systemPromptPath: string
  settingsPath: string
  mcpConfigPath: string
}

export interface WriteArtifactsInput {
  session: SessionRow
  feature: Feature
  project: Project
  config: RuncastleConfig
  /** The claimed waypoint (kind=waypoint sessions) — injected into the prompt. */
  waypoint?: Waypoint
}

/** Absolute path to the standalone hook client (sibling of this module). */
export function hookClientPath(): string {
  return fileURLToPath(new URL('./hook-client.ts', import.meta.url))
}

/** The base server URL for a session (honours `config.serverPort`, default 4512). */
export function serverUrlFor(config: RuncastleConfig): string {
  return `http://localhost:${config.serverPort}`
}

// --- renderers (pure) -------------------------------------------------------

/**
 * The injected system prompt (feature brief). Directs the session to the pack's
 * entry skill, lists the on-disk knowledge paths and the MCP tool cheat-sheet.
 * A kind=waypoint session gets a dedicated prompt carrying its assigned waypoint.
 */
export function renderSystemPrompt(
  feature: Feature,
  kind: SessionKind,
  waypoint?: Waypoint,
): string {
  if (kind === 'waypoint') return renderWaypointPrompt(feature, waypoint)

  const docs = featureDocsRel(feature.slug) // docs/features/<slug>
  const entry =
    kind === 'ideation'
      ? 'Begin by invoking the `/runcastle:ideate` skill and drive the ideation session to completion.'
      : 'This is a Q&A session: invoke `/runcastle:qa`. Answer questions from the docs + code. Do NOT advance phases or emit tickets.'

  return [
    `# runcastle — ${feature.title}`,
    '',
    feature.oneLiner,
    '',
    '## Feature',
    `- Slug: \`${feature.slug}\``,
    `- Branch: \`${feature.branch}\``,
    `- Current phase: **${feature.phase}** (size: ${feature.size})`,
    '',
    '## Pipeline',
    'Features move ideation → spec → tickets → implementation → review → shipped.',
    'A `collapsed` feature skips the `spec` phase. Each transition is guarded by a',
    'gate; you cross a gate by calling the `complete_phase` MCP tool, which runs',
    'the gate check server-side and advances the feature.',
    '',
    '## Knowledge (versioned in the target repo)',
    `Feature docs live at \`${docs}/\`:`,
    `- \`${docs}/brief.md\` — the seed brief (title + one-liner).`,
    `- \`${docs}/decisions.md\` — decisions you capture while grilling (satisfies gate G1).`,
    `- \`${docs}/spec.md\` — the spec, for \`full\` features (satisfies gate G2).`,
    'Write these files in THIS working directory (the feature\'s talk worktree);',
    'they are committed to the feature branch automatically at phase boundaries.',
    '',
    '## runcastle MCP tools',
    'A `runcastle` MCP server is attached. Use these tools (not local files) for',
    'state that the runcastle UI needs to see:',
    '- `get_feature_context()` — full feature + phase + docs contents + tickets.',
    '- `record_event({ type, message })` — drop a timeline note at a milestone.',
    '- `emit_tickets({ tickets })` — emit the ticket batch (title, goal, context,',
    '  acceptanceCriteria, seams, blockedBy = 1-based positions within the batch).',
    '- `complete_phase({ phase })` — mark a phase done; advances past its gate.',
    '',
    '## Your task',
    entry,
    '',
  ].join('\n')
}

/**
 * The kind=waypoint system prompt (SPEC §13.5). Injects the assigned waypoint —
 * title, type, question — and the map/decisions paths, and directs the session to
 * `/runcastle:waypoint`, whose mode is chosen by the waypoint `type`. The agent
 * writes decision prose straight to `decisions.md`/`map.md`, may branch the map
 * with `emit_waypoints`, and ends by calling `resolve_waypoint`.
 */
export function renderWaypointPrompt(feature: Feature, waypoint?: Waypoint): string {
  const docs = featureDocsRel(feature.slug)
  const assigned = waypoint
    ? [
        '## Your waypoint',
        `- Title: **${waypoint.title}**`,
        `- Type: \`${waypoint.type}\` — grill / prototype / task-checklist mode.`,
        `- Question to answer: ${waypoint.question}`,
        '',
      ]
    : ['## Your waypoint', 'The assigned waypoint is on the map — read it via `get_feature_context`.', '']

  return [
    `# runcastle — ${feature.title} (waypoint session)`,
    '',
    feature.oneLiner,
    '',
    'This is a **mapped-ideation waypoint session**. You are working ONE waypoint',
    'on the feature map — not the whole feature. Answer its question, write the',
    'decision prose to the docs, then resolve the waypoint. Do NOT converge, spec,',
    'or emit tickets here.',
    '',
    ...assigned,
    '## Feature',
    `- Slug: \`${feature.slug}\``,
    `- Branch: \`${feature.branch}\``,
    `- Current phase: **${feature.phase}** (size: ${feature.size})`,
    '',
    '## Map + knowledge (versioned in the target repo)',
    `Feature docs live at \`${docs}/\`:`,
    `- \`${docs}/map.md\` — the map: destination, notes, open questions, out-of-scope.`,
    `- \`${docs}/decisions.md\` — where your decision prose lands (append, do not batch).`,
    'Write these files directly in THIS talk worktree — serial HITL makes it',
    'race-free. A dropped waypoint gets its gist recorded under Out of scope in map.md.',
    '',
    '## runcastle MCP tools',
    '- `get_feature_context()` — full feature + phase + docs + the map (waypoints + frontier).',
    '- `emit_waypoints({ waypoints })` — branch the map when you discover new questions.',
    '- `resolve_waypoint({ id, disposition, summary })` — END here: `resolved` (answered) or',
    '  `dropped` (not needed). Flips machinery only — write the prose to the docs FIRST.',
    '- `record_event({ type, message })` — drop a timeline note at a milestone.',
    '',
    '## Your task',
    'Invoke the `/runcastle:waypoint` skill and work your assigned waypoint to a resolution.',
    '',
  ].join('\n')
}

interface CommandHook {
  type: 'command'
  command: string
  timeout: number
}

export interface SessionSettings {
  permissions: { allow: string[] }
  hooks: {
    SessionStart: { matcher: string; hooks: CommandHook[] }[]
    UserPromptSubmit: { hooks: CommandHook[] }[]
    SessionEnd: { hooks: CommandHook[] }[]
  }
}

/** Kept as an alias so existing importers of the old name keep compiling. */
export type HooksSettings = SessionSettings

/**
 * Our own MCP tools, as Claude Code permission-rule strings. Format is
 * `mcp__<server>__<tool>` (double underscore between server and tool), verified
 * against code.claude.com/docs/en/permissions.md — this is the most-specific
 * documented form and suppresses the interactive permission prompt for each
 * tool. The `<server>` segment is `runcastle`, matching `mcpServers.runcastle`
 * in the generated `mcp.json` (`renderMcpConfig`); the tool names match the
 * `registerTool` names in `mcp/server.ts`.
 */
export const RUNCASTLE_MCP_ALLOW_RULES: readonly string[] = [
  'mcp__runcastle__get_feature_context',
  'mcp__runcastle__emit_tickets',
  'mcp__runcastle__record_event',
  'mcp__runcastle__complete_phase',
  'mcp__runcastle__escalate_to_map',
  'mcp__runcastle__emit_waypoints',
  'mcp__runcastle__resolve_waypoint',
]

/**
 * The `settings.json` for a session (CC-INTEGRATION-NOTES §2 verified shape).
 *
 * - `permissions.allow` pre-approves runcastle's own MCP tools so a session's
 *   `mcp__runcastle__*` tool calls never interrupt the user with a permission
 *   prompt (they are the app's own trusted tools).
 * - `command` = `bun run "<abs hook-client.ts>" <route-event>` where the route
 *   event is the kebab-case `/api/hooks/:event` segment the client POSTs to.
 * - `SessionStart` matches `startup` (the source for a fresh `claude` launch).
 * - `UserPromptSubmit`/`SessionEnd` take NO `matcher` (unsupported → omitted).
 * - Timeouts (seconds): SessionStart 10, UserPromptSubmit 5 (well inside its 30s
 *   hard budget), SessionEnd 10.
 */
export function renderSettings(hookClient: string): SessionSettings {
  const cmd = (event: string): CommandHook => ({
    type: 'command',
    command: `bun run "${hookClient}" ${event}`,
    timeout: event === 'user-prompt' ? 5 : 10,
  })
  return {
    permissions: { allow: [...RUNCASTLE_MCP_ALLOW_RULES] },
    hooks: {
      SessionStart: [{ matcher: 'startup', hooks: [cmd('session-start')] }],
      UserPromptSubmit: [{ hooks: [cmd('user-prompt')] }],
      SessionEnd: [{ hooks: [cmd('session-end')] }],
    },
  }
}

export interface McpConfig {
  mcpServers: {
    runcastle: {
      type: 'http'
      url: string
      headers: Record<string, string>
    }
  }
}

/**
 * `mcp.json` — the runcastle Streamable-HTTP MCP server. Session identity rides
 * the verified `headers` field (CC-INTEGRATION-NOTES §4) as `X-Runcastle-Session`
 * so each terminal's tool calls resolve to their own feature.
 */
export function renderMcpConfig(session: SessionRow, config: RuncastleConfig): McpConfig {
  return {
    mcpServers: {
      runcastle: {
        type: 'http',
        url: `${serverUrlFor(config)}/mcp`,
        headers: { 'X-Runcastle-Session': session.id },
      },
    },
  }
}

// --- writer -----------------------------------------------------------------

export async function writeSessionArtifacts(
  input: WriteArtifactsInput,
): Promise<SessionArtifacts> {
  const { session, feature, config, waypoint } = input
  const dir = sessionDir(session.id)
  mkdirSync(dir, { recursive: true })

  const systemPromptPath = join(dir, 'system-prompt.md')
  const settingsPath = join(dir, 'settings.json')
  const mcpConfigPath = join(dir, 'mcp.json')

  writeFileSync(systemPromptPath, renderSystemPrompt(feature, session.kind, waypoint), 'utf8')
  writeFileSync(settingsPath, JSON.stringify(renderSettings(hookClientPath()), null, 2), 'utf8')
  writeFileSync(mcpConfigPath, JSON.stringify(renderMcpConfig(session, config), null, 2), 'utf8')

  return { systemPromptPath, settingsPath, mcpConfigPath }
}
