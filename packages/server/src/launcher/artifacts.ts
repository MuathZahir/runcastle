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
import { ASSET_ENV, resolveAsset } from './asset-paths'

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
  /** Absent for a project-scoped `prepare` session, which has `prepare` instead. */
  feature?: Feature
  project: Project
  config: RuncastleConfig
  /** The claimed waypoint (kind=waypoint sessions) — injected into the prompt. */
  waypoint?: Waypoint
  /** The brief for a `prepare` session; required when `feature` is absent. */
  prepare?: PrepareBrief
  /** The brief for a `project` session; the other way `feature` may be absent. */
  projectBrief?: ProjectBrief
  /**
   * The lap this session was opened to run (a Rethink lap, or a lap-N grill).
   * Passed EXPLICITLY rather than read off `feature.lap`, because a lap is not
   * something the feature row can be asked about: an ordinary revisit on a
   * lap-3 feature is not running a lap, and the rethink route bumps `lap` and
   * flips the phase back to `ideation` BEFORE launching — which is how the lap
   * framing used to be lost entirely (F2, `renderRevisitPrompt` keyed on
   * `phase === 'review'` and by then the phase had moved).
   */
  lap?: number
}

/**
 * Absolute path to the standalone hook client (sibling of this module in a
 * checkout; vendored beside the bin and named by `RUNCASTLE_HOOK_CLIENT` in a
 * published install — issue #51). It is spawned by a separate `bun`, so it must
 * be a real file on disk, never bundled.
 */
export function hookClientPath(): string {
  return resolveAsset(ASSET_ENV.hookClient, fileURLToPath(new URL('./hook-client.ts', import.meta.url)))
}

/** The base server URL for a session (honours `config.serverPort`, default 4512). */
export function serverUrlFor(config: RuncastleConfig): string {
  return `http://localhost:${config.serverPort}`
}

// --- renderers (pure) -------------------------------------------------------

/**
 * The rule that keeps a talk session a conversation (F2). Every HITL feature
 * session — grill, qa, revisit, lap — runs in a FULL checkout of the feature
 * branch with `--permission-mode acceptEdits`, so nothing about the environment
 * stops an agent from simply implementing what it was asked to discuss. One did:
 * a lap whose briefing was swallowed read the docs, decided the work was small,
 * and started editing source instead of grilling — no spec, no tickets, no way
 * for the feature to reach review.
 *
 * Stated here AND enforced by the PreToolUse deny hook (`renderSettings`), for
 * the reason the burn guard gives: a prompt rule is advisory, a deny is not.
 */
export function noCodeRule(docs: string): string {
  return (
    `- **Talk sessions do not write code.** You may write this feature's docs under \`${docs}/\` ` +
    'and nothing else in this checkout. Every code change rides a ticket, burned by an ' +
    'implementation agent in its own sandbox — even the one-line fix that is obviously faster ' +
    'to just do. This is enforced by a hook, not left to your judgement: edits outside the docs ' +
    'are denied.'
  )
}

/**
 * The injected system prompt (feature brief). Directs the session to the pack's
 * entry skill, lists the on-disk knowledge paths and the MCP tool cheat-sheet.
 * A kind=waypoint session gets a dedicated prompt carrying its assigned waypoint.
 */
export function renderSystemPrompt(
  feature: Feature,
  kind: SessionKind,
  waypoint?: Waypoint,
  lap?: number,
): string {
  if (kind === 'waypoint') return renderWaypointPrompt(feature, waypoint)
  if (kind === 'converge') return renderConvergePrompt(feature)
  if (kind === 'revisit') return renderRevisitPrompt(feature, lap)

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
    `- Current phase: **${feature.phase}**`,
    '',
    '## Pipeline',
    'Features move ideation → spec → tickets → implementation → review → shipped.',
    'Each transition is guarded by a gate; you cross a gate by calling the',
    '`complete_phase` MCP tool, which runs the gate check server-side and advances',
    'the feature.',
    '',
    '## Knowledge (versioned in the target repo)',
    `Feature docs live at \`${docs}/\`:`,
    `- \`${docs}/brief.md\` — the seed brief (title + one-liner).`,
    `- \`${docs}/decisions.md\` — decisions you capture while grilling (satisfies gate G1).`,
    `- \`${docs}/spec.md\` — the spec (satisfies gate G2).`,
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
    '## Rules',
    noCodeRule(docs),
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
    `- Current phase: **${feature.phase}**`,
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

/**
 * The kind=converge system prompt (ADR-0001 / SPEC §13.5). The converge session
 * closes a mapped feature: it reads ONLY the compressed knowledge — `map.md` +
 * `decisions.md` — never the waypoint transcripts, then runs `/runcastle:spec` →
 * `/runcastle:tickets` in one unbroken window. The feature has already crossed G1
 * into spec, so this rejoins the normal pipeline with no special-casing.
 */
export function renderConvergePrompt(feature: Feature): string {
  const docs = featureDocsRel(feature.slug)
  return [
    `# runcastle — ${feature.title} (converge session)`,
    '',
    feature.oneLiner,
    '',
    'This is a **mapped-ideation converge session**. The map is charted and its',
    'waypoints are terminal; your job is to turn the compressed knowledge into a',
    'spec and tickets — the same output an unbroken ideation session produces.',
    '',
    '## Read ONLY the compressed knowledge',
    `Read only these two files under \`${docs}/\`:`,
    `- \`${docs}/map.md\` — the destination, notes, and out-of-scope decisions.`,
    `- \`${docs}/decisions.md\` — every decision the waypoint sessions locked.`,
    'Do NOT read the waypoint session transcripts — the map and decisions ARE the',
    'compression; that is the whole point of the map. Trust them.',
    '',
    '## Feature',
    `- Slug: \`${feature.slug}\``,
    `- Branch: \`${feature.branch}\``,
    `- Current phase: **${feature.phase}**`,
    '',
    '## runcastle MCP tools',
    '- `get_feature_context()` — full feature + phase + docs contents (map + decisions).',
    '- `emit_tickets({ tickets })` — emit the ticket batch at the end of `/runcastle:tickets`.',
    '- `complete_phase({ phase })` — cross each remaining gate (spec, then tickets).',
    '- `record_event({ type, message })` — drop a timeline note at a milestone.',
    '',
    '## Your task',
    'Invoke the `/runcastle:converge` skill. Working from the map + decisions only,',
    'run `/runcastle:spec` (for a `full` feature) then `/runcastle:tickets` in this',
    'one window. Do NOT re-grill and do NOT reopen resolved waypoints — converge.',
    `If \`${docs}/spec.md\` already exists (a previous converge session wrote it`,
    'before dying), read it, skip spec-writing, and proceed straight to tickets.',
    '',
  ].join('\n')
}

/**
 * The kind=revisit system prompt. A revisit reopens a finished conversation
 * (usually the grilling) because the human remembered something or changed
 * their mind. The session amends the docs to match the new reality, then does
 * ticket surgery — `update_ticket` for stale tickets, `cancel_ticket` for
 * obsolete ones, `emit_tickets` for new work. It NEVER advances phases: the
 * pipeline position stays wherever it is, and downstream phases pick up the
 * amended docs/tickets on their own.
 *
 * At the `review` phase the same session is surfaced as **Iterate** (CONTEXT
 * decision #6): the human has just test-driven the burned branch and found
 * things to fix. The kickoff line briefs the review-iteration move (read the run
 * outcome + ticket states, interview about the test drive, emit fix tickets);
 * the prompt below flags that purpose so the session knows the amended docs +
 * fix tickets feed a re-Burn that loops the feature back through implementation.
 *
 * `lap` — passed explicitly by the launcher, never inferred from the phase (see
 * {@link WriteArtifactsInput.lap}) — turns this into the LAP prompt: the session
 * is running the front half of the pipeline again, so it not only may call
 * `complete_phase`, it is the only thing that will.
 */
export function renderRevisitPrompt(feature: Feature, lap?: number): string {
  const docs = featureDocsRel(feature.slug)
  const lapIteration = lap
    ? [
        `## This is lap ${lap}`,
        `You are running **lap ${lap}** of this feature (ADR-0010): the human test-drove what`,
        `lap ${lap - 1} burned and came back with what it taught them. Unlike an`,
        'ordinary revisit, a lap MOVES the pipeline — you drive the whole front half of it in',
        'THIS session: grill the human about the drive, then `complete_phase` through',
        '**ideation → spec → tickets**, emitting this lap’s tickets on the way. Nothing else',
        'advances it; if you stop early the feature sits at ideation with no lap tickets and',
        'the human has no way forward.',
        '',
        'Your inputs, both OPTIONAL — a missing one is normal, not an error:',
        `- \`${docs}/test-notes.md\`, section \`## Lap ${lap - 1}\` — what the drive surfaced.`,
        `- \`${docs}/spec.md\`, section \`## Later laps\` — scope parked by earlier laps.`,
        'Say plainly which you found, then interview the human from what they tell you.',
        '',
        `Write what you settle on into \`${docs}/decisions.md\` under a \`## Lap ${lap}\` heading`,
        '(supersede, never rewrite), amend `spec.md` for this lap (pruning anything you promote',
        'out of `## Later laps`), then `emit_tickets` for this lap’s work. Finish by telling the',
        'human to review the cards and click Burn.',
        '',
      ]
    : []
  const reviewIteration =
    !lap && feature.phase === 'review'
      ? [
          '## Review iteration',
          'This feature is at **review**: its tickets were burned and the human has been',
          'test-driving the branch. Treat this as a fix-ticket interview — read the latest',
          'run outcome and every ticket’s state via `get_feature_context`, ask what the test',
          'drive surfaced (bugs, rough edges, tweaks), then emit fix tickets for that work and',
          'edit/cancel any stale pending tickets. Do NOT advance the phase: once the cards are',
          'ready, tell the human to review them and click Burn — burning from review loops the',
          'feature back through implementation and returns it here when the run finishes.',
          '',
        ]
      : []
  return [
    `# runcastle — ${feature.title} (revisit session)`,
    '',
    feature.oneLiner,
    '',
    'This is a **revisit session**: the human came back to a feature whose',
    'earlier sessions are finished — they remembered something, or a decision',
    'changed. Where possible this terminal RESUMES the previous conversation, so',
    'you may already have its context above. Your job: fold the new information',
    'into the record, then reconcile the tickets with it. The docs are the',
    'artifact — later phases read them, never the transcripts.',
    '',
    ...lapIteration,
    ...reviewIteration,
    '## Feature',
    `- Slug: \`${feature.slug}\``,
    `- Branch: \`${feature.branch}\``,
    `- Current phase: **${feature.phase}**`,
    '',
    '## Knowledge (versioned in the target repo)',
    `Feature docs live at \`${docs}/\`:`,
    `- \`${docs}/decisions.md\` — append the new/changed decisions with a dated "revisited" note.`,
    `- \`${docs}/spec.md\` — if it exists, amend the affected sections in place.`,
    `- \`${docs}/map.md\` — if the feature is mapped, keep the map honest too.`,
    '',
    '## runcastle MCP tools',
    '- `get_feature_context()` — feature + phase + docs + ALL tickets (with ids and statuses).',
    '- `update_ticket({ id, ...fields })` — rewrite a stale pending/failed ticket\'s content.',
    '- `cancel_ticket({ id, reason })` — cancel a pending/failed ticket that is now unnecessary.',
    '- `emit_tickets({ tickets })` — add tickets for NEW work the change requires.',
    '- `record_event({ type, message })` — drop a timeline note summarising the revisit.',
    '',
    '## Rules',
    // A lap is the one revisit that MUST move the pipeline — the blanket ban
    // used to be rendered into lap sessions too, flatly contradicting the lap
    // briefing that had just told them to complete_phase through to tickets (F2).
    lap
      ? `- DO call \`complete_phase\` — this lap advances ideation → spec → tickets, and only you can.`
      : '- Do NOT call `complete_phase` — a revisit never moves the pipeline.',
    '- Do NOT touch `done`/`burning` tickets; if done work is now wrong, emit a new ticket that fixes it.',
    '- Docs first, tickets second: capture the decision prose before any ticket surgery.',
    noCodeRule(docs),
    '',
    '## Your task',
    'Invoke the `/runcastle:revisit` skill and work through what the human brings up.',
    '',
  ].join('\n')
}

/** What a preparation conversation needs to know before it opens its mouth. */
export interface PrepareBrief {
  project: Project
  /** Prepared keys still empty (and not human-owned) — the agenda. */
  remainingKeys: readonly string[]
  /** Keys already established, with who established them. */
  established: readonly { key: string; source: string; evidence?: string }[]
}

/**
 * The injected brief for a `prepare` session — the only way a project is
 * prepared.
 *
 * The framing that carries it is that this session is on the HOST. Every key
 * here can be RUN rather than guessed at, including the five that describe the
 * developer's own machine (the dev server, the local database, credentials) —
 * that is the capability the conversation exists to use, and the reason it must
 * also ask before touching anything stateful.
 */
export function renderPreparePrompt(brief: PrepareBrief): string {
  const { project, remainingKeys, established } = brief
  return [
    `# runcastle — preparing ${project.name}`,
    '',
    'This is a **preparation session**: a project-scoped conversation whose job is to',
    'establish the settings every later agent depends on, and to record them with evidence.',
    'There is no feature here and no pipeline to advance.',
    '',
    '## Where this runs — and why that matters',
    `You are on the developer's own machine, in \`${project.repoPath}\`, NOT in a sandbox.`,
    'That is the point of this session. A throwaway container can never verify anything about',
    '*this* machine: the dev server, the local database, docker, credentials. Those keys —',
    '`devCommand`, `driveSetupCommand`, `driveStopCommand`, `driveEnv`, `dbResetCommand` —',
    'can only be settled here. Run what you propose; do not guess it from config.',
    '',
    'The same access is why you must **ask before you act**. Anything that starts or stops a',
    'service, creates or migrates a database, or writes outside the repo needs the human to',
    'agree first — say what you are about to run and why, then wait.',
    '',
    ...(established.length > 0
      ? [
          '## Already established — do not re-derive',
          'These are recorded findings. Treat them as true unless the human says otherwise;',
          'replacing a measured value with a fresh guess makes preparation worse, not better.',
          '',
          ...established.map(
            (f) => `- \`${f.key}\` (${f.source})${f.evidence ? ` — ${f.evidence}` : ''}`,
          ),
          '',
        ]
      : []),
    '## Still open',
    remainingKeys.length > 0
      ? remainingKeys.map((k) => `- \`${k}\``).join('\n')
      : '_Nothing is unset. Confirm the existing values still hold, then say so and stop._',
    '',
    '## Recording what you establish',
    '- `record_finding({ key, value, evidence, userSupplied })` — one call per key.',
    '- `userSupplied: true` means the human GAVE you this value or confirmed it verbatim.',
    '  That marks it as theirs and permanently stops automatic runs from overwriting it.',
    '- Leave it false for anything you worked out yourself, even with them watching —',
    '  that stays improvable by a later run. Getting this backwards silently retires a',
    '  field from preparation forever, and the only way back is the human clearing it.',
    '- `evidence` is not optional in spirit: record what you ran and what it printed, or',
    '  what the human told you. A value with no account of itself is a guess with a source field.',
    '',
    '## Secrets',
    'This is a development environment and the human has agreed to supply real connection',
    'strings and credentials here. Store them as given. Do not paste a secret into a timeline',
    'note or a commit message — `record_finding` is the only place a value belongs.',
    '',
    '## Your task',
    'Open by telling the human which fields are still open and what you need from them for',
    'each. Work them one at a time: propose, ask, run it if they agree, then record it.',
    '',
  ].join('\n')
}

/** What the project session needs to know about where it is working. */
export interface ProjectBrief {
  project: Project
  /** The runcastle-owned branch it commits to (`runcastle/project`). */
  branch: string
  /** Its worktree — never the human's checkout (decision 18). */
  worktreePath: string
}

/**
 * The injected brief for a `project` session (decisions 17–20).
 *
 * Two things it must say that no other prompt has to. First, what this session
 * is FOR: intake and decomposition terminating in `create_feature`, with
 * portfolio Q&A, routing and curation as support jobs — naming it by scope
 * ("a session at project level") would describe a container and invite exactly
 * the open-ended do-stuff agent the guided pipeline exists to prevent. Second,
 * where its writes go: this is the one session with whole-repo write access, it
 * works on a runcastle-owned branch, and its commits reach the human's checkout
 * when the terminal closes. A session that writes but never commits leaves the
 * tree dirty, which is precisely what blocks a test drive and the next merge —
 * so "land what you wrote and leave the tree clean" is its closing move.
 */
export function renderProjectPrompt(brief: ProjectBrief): string {
  const { project, branch, worktreePath } = brief
  return [
    `# runcastle — ${project.name} (project session)`,
    '',
    'This is the **project session**: a conversation that belongs to the project, not to',
    'any one feature. There is no phase to advance and no gate to cross here.',
    '',
    '## What this session is for',
    '- **Intake and decomposition** — the job no other surface can do. Take whatever the',
    '  human brings, grill it until it resolves into N features, and create them with',
    '  `create_feature`. A feature born here carries a real brief: the reasoning you just',
    '  worked out, not a restated one-liner.',
    '- **Portfolio Q&A** — "have we already decided X?", "did we ever build Y?" — the same',
    '  lookup intake needs anyway to avoid creating a duplicate feature.',
    '- **Routing** — an incoming thing is one of exactly five destinations: a new feature,',
    '  a quick change, an existing feature\'s revisit, a Rethink lap on something in',
    '  review, or nothing. Say which, and why.',
    '- **Curation, advisory only** — you may report that two in-flight features are on a',
    '  collision course or that an ADR looks stale. You do NOT fix either. Every fix routes',
    '  back through a feature, through promotion at merge, or through the charter.',
    '- **The charter (`CONTEXT.md`)** — you are the only session in runcastle allowed to',
    '  write it. Create it lazily: when there is first something to write, not before.',
    '',
    '## Where you are working — and where your writes go',
    `- Working directory: \`${worktreePath}\` — a runcastle-owned worktree, NOT the human's`,
    `  checkout at \`${project.repoPath}\`.`,
    `- Branch: \`${branch}\`, cut from \`${project.mainBranch}\` when this session launched.`,
    `- **Your commits land on \`${project.mainBranch}\` when this terminal closes**, arriving`,
    "  in the human's checkout the way a `git pull` does. Write real code and real docs —",
    '  there is no sandbox here — and commit everything you write before you finish.',
    '  A session that edits without committing leaves a dirty tree, which is exactly what',
    '  blocks a test drive and jams the next merge. Land what you wrote; leave it clean.',
    '',
    '## runcastle MCP tools',
    'Four, and none of the feature pipeline\'s — a session with no feature has no business',
    'advancing one through a gate:',
    '- `create_feature({ title, oneLiner, baseBranch?, brief?, ticket? })` — the point of',
    '  this session. It does NOT open a terminal on what it creates; the new card appearing',
    '  in the rail is the feedback, and the human decides what to work on next.',
    '- `get_project_context()` — the project, its charter, its live ADRs, and a one-line',
    '  index of every feature.',
    '- `get_work_record({ featureSlug? | seam? })` — what features actually did: tickets by',
    '  status, seams, commits, errors. Facts, never intent.',
    '- `record_event({ type, message })` — drop a note on the project timeline.',
    '',
    'Every merged feature\'s docs are already on disk in this worktree — read them with your',
    'ordinary file tools. The index says where.',
    '',
    '## Your task',
    'Invoke the `/runcastle:project` skill and drive the project session.',
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
  'mcp__runcastle__update_ticket',
  'mcp__runcastle__cancel_ticket',
  'mcp__runcastle__record_event',
  'mcp__runcastle__complete_phase',
  'mcp__runcastle__escalate_to_map',
  'mcp__runcastle__emit_waypoints',
  'mcp__runcastle__resolve_waypoint',
  'mcp__runcastle__record_finding',
  // The project session's three (decision 19). Every session is launched with
  // the whole list: the MCP server gates each tool on the calling session's
  // kind, so a rule for a tool a feature session can only be refused is inert.
  'mcp__runcastle__create_feature',
  'mcp__runcastle__get_project_context',
  'mcp__runcastle__get_work_record',
]

/**
 * Benign git commands the session skills actually run, pre-approved so
 * `--permission-mode acceptEdits` sessions never stall on an interactive Bash
 * approval prompt (E2E finding: `git rev-parse` during converge and doc commits
 * during waypoint work each sat waiting for a human). Rule syntax is the
 * documented `Bash(<prefix>:*)` trailing-wildcard form
 * (code.claude.com/docs/en/permissions — ":* suffix can be used as a trailing
 * wildcard"). Scoped reasoning: these sessions live in docs-only talk
 * worktrees, so even `git add`/`git commit` can only touch the feature docs.
 * Deliberately git-only — nothing here loosens beyond git + the runcastle MCP
 * tools above.
 *
 * Split by write mode because the scoped reasoning only covers half of it: the
 * WRITE rules are pre-approved on the strength of the worktree being docs-only,
 * so a session that can touch the whole repo and land it on the base branch
 * (kind `project`, decision 18) gets the read-only half and prompts for the
 * rest — the same thing the human's own Claude Code does.
 */
export const SESSION_BASH_READ_RULES: readonly string[] = [
  'Bash(git status:*)',
  'Bash(git rev-parse:*)',
  'Bash(git log:*)',
  'Bash(git diff:*)',
  'Bash(git branch:*)',
  'Bash(git show:*)',
]
export const SESSION_BASH_WRITE_RULES: readonly string[] = [
  'Bash(git add:*)',
  'Bash(git commit:*)',
]
export const SESSION_BASH_ALLOW_RULES: readonly string[] = [
  ...SESSION_BASH_READ_RULES,
  ...SESSION_BASH_WRITE_RULES,
]

/** The git rules a session of `kind` is launched with (see the split above). */
export function sessionBashAllowRules(kind?: SessionKind): readonly string[] {
  return kind === 'project' ? SESSION_BASH_READ_RULES : SESSION_BASH_ALLOW_RULES
}

/**
 * Every `SessionStart` source we register the hook for (CC-INTEGRATION-NOTES §3;
 * `fork` added in CC 2.1.214, reported as `resume` before that).
 *
 * REGRESSION THIS FIXES: the settings used to register `matcher: 'startup'`
 * ALONE, so a `--resume` launch — every revisit, every reopened terminal, every
 * merge-conflict "Resolve with agent" — fired `SessionStart` with source
 * `resume`, matched nothing, and never reached our hook receiver. The session
 * therefore never went `live`, never recorded its `ccSessionId`, and never got
 * its kickoff line typed: the terminal opened on the old conversation and just
 * sat there. One matcher per source (rather than one alternation matcher) keeps
 * this working whether Claude Code compares the matcher as a regex or as a
 * literal string.
 */
export const SESSION_START_SOURCES = ['startup', 'resume', 'clear', 'compact', 'fork'] as const

/**
 * The `settings.json` for a session (CC-INTEGRATION-NOTES §2 verified shape).
 *
 * - `permissions.allow` pre-approves runcastle's own MCP tools so a session's
 *   `mcp__runcastle__*` tool calls never interrupt the user with a permission
 *   prompt (they are the app's own trusted tools), plus the benign git commands
 *   the skills run (`SESSION_BASH_ALLOW_RULES`) so docs-worktree sessions never
 *   stall on a Bash approval prompt. `kind` narrows that git surface to the
 *   read-only rules for the one kind whose worktree is not docs-only
 *   (see {@link sessionBashAllowRules}); omitted, every rule is granted.
 * - `command` = `bun run "<abs hook-client.ts>" <route-event>` where the route
 *   event is the kebab-case `/api/hooks/:event` segment the client POSTs to.
 * - `SessionStart` is registered for EVERY source (see
 *   {@link SESSION_START_SOURCES}) — a resumed session is a started session.
 * - `UserPromptSubmit`/`SessionEnd` take NO `matcher` (unsupported → omitted).
 * - Timeouts (seconds): SessionStart 10, UserPromptSubmit 5 (well inside its 30s
 *   hard budget), SessionEnd 10.
 */
export function renderSettings(hookClient: string, kind?: SessionKind): SessionSettings {
  const cmd = (event: string): CommandHook => ({
    type: 'command',
    command: `bun run "${hookClient}" ${event}`,
    timeout: event === 'user-prompt' ? 5 : 10,
  })
  return {
    permissions: { allow: [...RUNCASTLE_MCP_ALLOW_RULES, ...sessionBashAllowRules(kind)] },
    hooks: {
      SessionStart: SESSION_START_SOURCES.map((source) => ({
        matcher: source,
        hooks: [cmd('session-start')],
      })),
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
  const { session, feature, config, waypoint, prepare, projectBrief, lap } = input
  const dir = sessionDir(session.id)
  mkdirSync(dir, { recursive: true })

  const systemPromptPath = join(dir, 'system-prompt.md')
  const settingsPath = join(dir, 'settings.json')
  const mcpConfigPath = join(dir, 'mcp.json')

  // A project-scoped session has no feature to brief from; the caller supplies
  // its kind's brief instead. Exactly one of the three is always present — a
  // session with none would spawn a terminal with no instructions at all.
  const systemPrompt = feature
    ? renderSystemPrompt(feature, session.kind, waypoint, lap)
    : prepare
      ? renderPreparePrompt(prepare)
      : projectBrief
        ? renderProjectPrompt(projectBrief)
        : (() => {
            throw new Error(`session ${session.id} has no feature and no project-session brief`)
          })()

  writeFileSync(systemPromptPath, systemPrompt, 'utf8')
  writeFileSync(
    settingsPath,
    JSON.stringify(renderSettings(hookClientPath(), session.kind), null, 2),
    'utf8',
  )
  writeFileSync(mcpConfigPath, JSON.stringify(renderMcpConfig(session, config), null, 2), 'utf8')

  return { systemPromptPath, settingsPath, mcpConfigPath }
}
