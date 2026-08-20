import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type {
  AgentRuntime,
  Feature,
  Project,
  RuncastleConfig,
  SessionKind,
  SessionPurpose,
  SessionRow,
  Waypoint,
} from '@runcastle/core'
import { DEFAULT_RUNTIME, DRIVE_LOOP_KEYS } from '@runcastle/core'
import { featureDocsRel, sessionDir } from '@runcastle/core/paths'
import type { DriveHookFailure } from '../services/drive-hooks'
import type { BranchDelta } from '../services/git'
import { ASSET_ENV, resolveAsset } from './asset-paths'
import { EDIT_TOOL_MATCHER, guardsEdits } from './edit-guard'
import { skillRef } from './runtimes/skills'

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
   * The brief for a `drive-fix` session. Feature-scoped but host-side, so it
   * carries its own feature rather than being briefed from `feature` — the
   * failure it exists to repair is not something the feature row can say.
   */
  driveFix?: DriveFixBrief
  /**
   * Why the session was launched, when that changes its briefing — today only
   * the conflict-resolution revisit, which is told to resolve the merge rather
   * than that it may not write code.
   */
  purpose?: SessionPurpose
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
  /**
   * The runtime this session's agent runs on, which decides how the briefing
   * spells a skill invocation (see {@link skillRef}) — a Codex session told to
   * invoke `/runcastle:ideate` simply does nothing. Optional: a caller that does
   * not say gets {@link DEFAULT_RUNTIME}, the runtime every session ran on
   * before there was a second one.
   */
  runtime?: AgentRuntime
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
 * The rule that REPLACES {@link noCodeRule} for the resolve-conflict session
 * (ADR-0007 §6). Its whole job is to merge the base branch in and resolve the
 * conflicts, which is code — and the blanket ban is why it could not: told to
 * resolve and then told edits are denied, the agent believed the rule, aborted
 * the merge and emitted a ticket to carry it instead (E2E F18). The guard now
 * allows these writes while the merge is in progress; this is the same truth
 * in the briefing.
 */
export function conflictResolutionRule(): string {
  return (
    '- **This session resolves a merge conflict, so it DOES write code here.** Edit the ' +
    'conflicted files in this checkout, resolving them from the feature docs’ intent, and ' +
    'commit the merge. That is the exception and its whole extent: the edit guard exempts ' +
    'writes only while the merge is in progress, so work the merge revealed but did not ' +
    'cause still rides a ticket.'
  )
}

/**
 * The injected system prompt (feature brief). Directs the session to the pack's
 * entry skill and lists the on-disk knowledge paths.
 *
 * PRECEDENCE — which layer owns "which skill opens this session":
 * **the LAP owns it, then the kind.** A session is a lap iff `lap` is set (the
 * launcher derives that from feature state, not from a kickoff string — see
 * {@link WriteArtifactsInput.lap}), and a lap's opening move is always
 * `/runcastle:revisit`, whatever kind row it rides. That is why the `lap` test
 * comes FIRST here rather than only inside the `revisit` branch: a lap-N grill
 * is created as `kind: 'ideation'`, and it used to fall through to the generic
 * feature brief, which said "invoke `/runcastle:ideate`" while the lap kickoff
 * line typed into the same terminal said "invoke `/runcastle:revisit` for LAP N".
 * Two entry skills, no defined precedence. There is exactly one now, and it is
 * the same one `lapKickoff` names.
 *
 * Deliberately NO MCP tool cheat-sheet in any renderer. Every tool a session can
 * call is already in its tool list with a longer, schema-backed description, and
 * registration is filtered by audience — so a hand-written list here can name a
 * tool this session was never given. Where a prompt must CONSTRAIN which tools
 * apply it says so in one line of policy, never as a field-level restatement.
 */
export function renderSystemPrompt(
  feature: Feature,
  kind: SessionKind,
  waypoint?: Waypoint,
  lap?: number,
  purpose?: SessionPurpose,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
): string {
  if (lap !== undefined) return renderRevisitPrompt(feature, lap, purpose, runtime)
  if (kind === 'waypoint') return renderWaypointPrompt(feature, waypoint, runtime)
  if (kind === 'converge') return renderConvergePrompt(feature, runtime)
  if (kind === 'revisit') return renderRevisitPrompt(feature, lap, purpose, runtime)
  if (kind === 'qa') return renderQaPrompt(feature, runtime)

  const docs = featureDocsRel(feature.slug) // docs/features/<slug>

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
    '## Rules',
    noCodeRule(docs),
    '',
    '## Your task',
    `Begin by invoking the \`${skillRef(runtime, 'ideate')}\` skill and drive the ideation session to completion.`,
    '',
  ].join('\n')
}

/**
 * The kind=qa system prompt. A Q&A session is READ-ONLY — it answers questions
 * about a feature that usually already shipped — and it used to fall through the
 * generic feature brief, which is written for the session that drives the
 * pipeline. So a session forbidden to advance a phase or emit a ticket was
 * handed the `## Pipeline` section explaining how to cross gates and a
 * cheat-sheet for `complete_phase`/`emit_tickets`, then told thirty lines later
 * that both were banned; roughly a fifth of its prompt was operating
 * instructions for the two tools the same document forbids. It was also pointed
 * at `decisions.md`/`spec.md` as files to WRITE.
 *
 * This renders what a reader needs and nothing a writer would: identity, the
 * docs dir framed as source material, and the task line. The server refuses the
 * mutating tools for this kind, so the prompt does not have to enumerate them.
 */
export function renderQaPrompt(feature: Feature, runtime: AgentRuntime = DEFAULT_RUNTIME): string {
  const docs = featureDocsRel(feature.slug)
  return [
    `# runcastle — ${feature.title} (Q&A session)`,
    '',
    feature.oneLiner,
    '',
    'This is a **Q&A session**: the human has questions about a feature that already',
    'exists. You answer them from the record. Nothing here changes state — this session',
    'does not advance the pipeline, emit tickets or edit the feature, and the server will',
    'refuse those tools if you try.',
    '',
    '## Feature',
    `- Slug: \`${feature.slug}\``,
    `- Branch: \`${feature.branch}\``,
    `- Current phase: **${feature.phase}**`,
    '',
    '## What you read',
    `This feature's docs are at \`${docs}/\` — brief, decisions, spec, map — and they are`,
    'source material here, not files to amend. Read the CODE too: where the answer lives in',
    'the implementation, cite what you actually found rather than what the docs predicted.',
    '',
    '## Your task',
    `Invoke the \`${skillRef(runtime, 'qa')}\` skill and answer what the human asks.`,
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
export function renderWaypointPrompt(
  feature: Feature,
  waypoint?: Waypoint,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
): string {
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
    '## Rules',
    noCodeRule(docs),
    '- End by resolving your waypoint (`resolved` when you answered it, `dropped` when it',
    '  turned out not to be needed) — but write the decision prose to the docs FIRST. The',
    '  resolve flips machinery; it does not record anything.',
    '- Your tools here are the map\'s: read the context, branch the map, resolve your',
    '  waypoint, note a milestone. The pipeline tools are not yours — a waypoint session',
    '  does not spec, emit tickets or cross a gate, and the server refuses it.',
    '',
    '## Your task',
    `Invoke the \`${skillRef(runtime, 'waypoint')}\` skill and work your assigned waypoint to a resolution.`,
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
export function renderConvergePrompt(
  feature: Feature,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
): string {
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
    '## Rules',
    noCodeRule(docs),
    '- DO call `complete_phase` — this session crosses the remaining gates itself (spec,',
    '  then tickets). Nothing else will.',
    '',
    '## Your task',
    `Invoke the \`${skillRef(runtime, 'converge')}\` skill. Working from the map + decisions only,`,
    `run \`${skillRef(runtime, 'spec')}\` then \`${skillRef(runtime, 'tickets')}\` in this one window. Do NOT`,
    're-grill and do NOT reopen resolved waypoints — converge.',
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
 * At the `review` phase the same session is surfaced as **Iterate** (CONTEXT.md,
 * "Laps: iteration without a mode"; cited by name because the locked-decision
 * numbers get renumbered): the human has just test-driven the burned branch and
 * found things to fix. The prompt below flags that purpose so the session knows
 * the amended docs + fix tickets feed a re-Burn that loops the feature back
 * through implementation. It points at the PER-TICKET facts (`status`,
 * `commits`, `lap`, `error`) rather than at a "run outcome": there is no run in
 * the `get_feature_context` payload, and `get_work_record` is gated shut for
 * feature sessions, so the old wording sent the session looking for something it
 * could not reach. `digest` is not in that payload either.
 *
 * The `resolve-conflict` purpose is EXCLUDED from that briefing even though it
 * is also always at `review` — its whole job is a `git merge`, and a fix-ticket
 * interview is not a smaller version of that, it is a different job.
 *
 * `lap` — passed explicitly by the launcher, never inferred from the phase (see
 * {@link WriteArtifactsInput.lap}) — turns this into the LAP prompt: the session
 * is running the front half of the pipeline again, so it not only may call
 * `complete_phase`, it is the only thing that will.
 */
export function renderRevisitPrompt(
  feature: Feature,
  lap?: number,
  purpose?: SessionPurpose,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
): string {
  // Mutually exclusive briefings: a lap says "complete_phase through ideation →
  // spec → tickets", a conflict resolution says "you DO write code here and the
  // pipeline does not move". Rendering both produces a session instructed to do
  // two incompatible jobs. Unreachable through the UI today, but the tRPC route
  // takes `kickoffLine` and `purpose` as free parameters, so the exclusion is
  // asserted where the two actually meet rather than left to call-site luck.
  if (lap !== undefined && purpose === 'resolve-conflict') {
    throw new Error(
      `cannot brief one revisit session as both lap ${lap} and a conflict resolution — ` +
        'a lap advances the pipeline and writes no code; resolving a conflict writes code ' +
        'and advances nothing. Launch them as separate sessions.',
    )
  }
  const docs = featureDocsRel(feature.slug)
  const lapIteration = lap
    ? [
        // Per-session FACTS only — which lap, which sections carry its inputs,
        // and the licence to advance. The lap procedure itself lives in
        // `revisit/SKILL.md`, which is loaded before any of this is acted on; a
        // second copy here is a second thing to keep true.
        `## This is lap ${lap}`,
        `You are running **lap ${lap}** of this feature (ADR-0010): the human test-drove what`,
        `lap ${lap - 1} burned and came back with what it taught them. Its inputs, both`,
        'OPTIONAL — a missing one is normal, not an error:',
        `- \`${docs}/test-notes.md\`, section \`## Lap ${lap - 1}\` — what the drive surfaced.`,
        `- \`${docs}/spec.md\`, section \`## Later laps\` — scope parked by earlier laps.`,
        `New decisions go under a \`## Lap ${lap}\` heading in \`${docs}/decisions.md\`.`,
        '',
        'Unlike an ordinary revisit a lap MOVES the pipeline, and only this session will:',
        'you `complete_phase` through **ideation → spec → tickets** in THIS window. Stop',
        'early and the feature sits at ideation with no lap tickets and no way forward.',
        'The `/runcastle:revisit` skill carries the rest of the procedure — follow it.',
        '',
      ]
    : []
  // A conflict-resolution revisit is ALWAYS at `review` (its only launch site is
  // the review body's conflict card), and its whole job is a `git merge`. Told it
  // was a fix-ticket interview as well, it got two mandates and picked one — the
  // same failure shape as F18, which `conflictResolutionRule` fixed in the Rules
  // block and missed here.
  const reviewIteration =
    !lap && feature.phase === 'review' && purpose !== 'resolve-conflict'
      ? [
          '## Review iteration',
          'This feature is at **review**: its tickets were burned and the human has been',
          'test-driving the branch. Treat this as a fix-ticket interview — call',
          '`get_feature_context` and read what the burn actually did, ticket by ticket: each',
          'one carries its `status`, the `commits` it landed, the `lap` it belongs to, and an',
          '`error` when it failed. Ask what the test drive surfaced (bugs, rough edges,',
          'tweaks), then emit fix tickets for that work and edit/cancel any stale pending',
          'tickets. Do NOT advance the phase: once the cards are ready, tell the human to',
          'review them and click Burn — burning from review loops the feature back through',
          'implementation and returns it here when the run finishes.',
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
    '## Rules',
    // A lap is the one revisit that MUST move the pipeline — the blanket ban
    // used to be rendered into lap sessions too, flatly contradicting the lap
    // briefing that had just told them to complete_phase through to tickets (F2).
    lap
      ? '- DO call `complete_phase` — this lap advances ideation → spec → tickets, and only you can.'
      : '- Do NOT call `complete_phase` — a revisit never moves the pipeline.',
    '- Do NOT touch `done`/`burning` tickets; if done work is now wrong, emit a new ticket that fixes it.',
    '- Docs first, tickets second: capture the decision prose before any ticket surgery.',
    // The conflict-resolution revisit is briefed to resolve the merge, so the
    // blanket ban would contradict the very kickoff it was opened with (F18).
    purpose === 'resolve-conflict' ? conflictResolutionRule() : noCodeRule(docs),
    '',
    '## Your task',
    `Invoke the \`${skillRef(runtime, 'revisit')}\` skill and work through what the human brings up.`,
    '',
  ].join('\n')
}

/** One already-established prepared key, with how much to trust it now. */
export interface PrepareFinding {
  key: string
  source: string
  evidence?: string
  /**
   * When a dry-run drive last PROVED this value (ms epoch); absent means never.
   * Carried through from `listFindings`, which has always returned it — the
   * brief used to drop it, so a value measured this morning and a value
   * measured a year ago read identically to the agent that had to decide
   * whether to re-derive either.
   */
  verifiedAt?: number
  /** Commits landed on the main branch since it was established (same reason). */
  staleCommits?: number
}

/**
 * What the SERVER already knows about the host, because it is running on it.
 * Every field here is a probe the prompt used to send the agent off to make —
 * `existsSync` for a compose file, `existsSync` for `.runcastle/`, a lockfile
 * scan, `process.platform` — which is an expensive way to learn something the
 * process writing the prompt could answer for free.
 */
export interface PrepareHost {
  /** `process.platform` — decides what language the drive scripts are written in. */
  platform: string
  /** A `docker-compose.y*ml` / `compose.y*ml` exists at the repo root. */
  hasCompose: boolean
  /** `.runcastle/` already exists — this project has been prepared before. */
  hasDriveMachinery: boolean
  /** The package manager its lockfile names, when there is one. */
  packageManager?: string
}

/** What a preparation conversation needs to know before it opens its mouth. */
export interface PrepareBrief {
  project: Project
  /** Prepared keys still empty (and not human-owned) — the agenda. */
  remainingKeys: readonly string[]
  /** Keys already established, with who established them and how fresh it is. */
  established: readonly PrepareFinding[]
  /** What the server probed about this machine (optional: older callers/tests). */
  host?: PrepareHost
}

/** `staleCommits` / `verifiedAt` rendered as the one clause that matters. */
function findingAge(f: PrepareFinding): string {
  const parts: string[] = []
  if (f.verifiedAt === undefined) parts.push('never verified by a drive')
  else parts.push(`verified ${daysAgo(f.verifiedAt)}`)
  if (f.staleCommits !== undefined && f.staleCommits > 0) {
    parts.push(`${f.staleCommits} commit(s) behind`)
  }
  return parts.join(', ')
}

/** "today" / "3 days ago" — precision beyond a day is noise in a briefing. */
function daysAgo(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/**
 * The injected brief for a `prepare` session — the only way a project is
 * prepared.
 *
 * PER-SESSION FACTS ONLY. This used to be the largest artifact in the system —
 * 13,494 chars, ~3,374 tokens — and 90% of it was procedure: the drive
 * contract, the discovery method, five stack recipes and a dry-run walkthrough,
 * all rendered unconditionally on every launch. It branched on `remainingKeys`
 * in exactly one place, 34 characters long, so a session opened to settle one
 * key carried ~11,000 characters that could not apply to it — and it GREW as
 * work completed, because `established` appends evidence faster than
 * `remainingKeys` shrinks.
 *
 * All of that now lives in `/runcastle:prepare` (and its `references/recipes.md`,
 * which loads only when a recipe is reached for), so it arrives when it is
 * needed rather than before it is known to be. What stays here is what the skill
 * cannot know: which repo, what the server already probed about this machine,
 * which keys are open, what is established and how stale, and the standing
 * rules that must be true before the agent's first move rather than after it
 * loads a skill.
 *
 * The framing that carries it is still that this session is on the HOST. Every
 * key here can be RUN rather than guessed at — that is the capability the
 * conversation exists to use, and the reason it must also ask before touching
 * anything stateful.
 */
export function renderPreparePrompt(brief: PrepareBrief): string {
  const { project, remainingKeys, established, host } = brief
  const open = remainingKeys.length > 0
  // The drive prose is gated on the agenda actually reaching the drive loop.
  // `dbResetCommand` is deliberately NOT in this set: the prompt's own text says
  // it is not part of the drive loop, so a session opened to settle it alone was
  // reading a drive contract that disclaimed itself.
  const drives = remainingKeys.some((k) => (DRIVE_LOOP_KEYS as readonly string[]).includes(k))

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
    '*this* machine: the dev server, the local database, docker, credentials. Run what you',
    'propose; do not guess it from config.',
    '',
    'The same access is why you must **ask before you act**. Anything that starts or stops a',
    'service, creates or migrates a database, installs software, or writes outside the repo',
    'needs the human to agree first — say what you are about to run and why, then wait.',
    '',
    'You may write `.runcastle/` and `.gitignore` in this checkout and nothing else; a hook',
    'enforces it. Any other change to the repo is theirs to make.',
    '',
    ...(host
      ? [
          '## What the server already checked',
          'Take these as read — they were probed on this machine, not inferred:',
          `- Platform: \`${host.platform}\` — write the drive scripts in a language this host runs.`,
          `- Compose file at the repo root: ${host.hasCompose ? '**yes**' : 'no'}.`,
          `- \`.runcastle/\` drive machinery: ${
            host.hasDriveMachinery ? '**already present** — read it before you author anything' : 'not there yet'
          }.`,
          `- Package manager: ${host.packageManager ? `\`${host.packageManager}\` (from its lockfile)` : 'no lockfile found at the repo root'}.`,
          '',
        ]
      : []),
    ...(established.length > 0
      ? [
          '## Already established — do not re-derive',
          'Recorded findings. Treat them as true unless the human says otherwise; replacing a',
          'measured value with a fresh guess makes preparation worse, not better. The age is',
          'there so you can tell a value measured today from one measured a year and 400',
          'commits ago — say so when it looks stale, rather than silently re-running it.',
          '',
          ...established.map(
            (f) =>
              `- \`${f.key}\` (${f.source}; ${findingAge(f)})${f.evidence ? ` — ${f.evidence}` : ''}`,
          ),
          '',
        ]
      : []),
    '## Still open',
    open
      ? remainingKeys.map((k) => `- \`${k}\``).join('\n')
      : 'Nothing. Every prepared key already has a value, so this session is a **confirmation,\n' +
        'not a preparation**: report what is recorded and how stale it is, ask the human whether\n' +
        'it still holds, and stop. Do not re-derive a settled value and do not propose a dry-run\n' +
        'drive unasked.',
    '',
    ...(drives
      ? [
          '## These keys are the drive loop',
          'The open keys include the host drive hooks, so this session authors machinery, not',
          'just settings. Two things to have in hand before you propose anything, both of which',
          'the `/runcastle:prepare` skill spells out in full: the **drive contract** (scripts',
          'live in `.runcastle/` and are committed; identity comes in as `RUNCASTLE_*`; computed',
          'values go back out through `.runcastle/drive.env`; every step is idempotent; exit 0',
          'means the services are actually up), and the **closing dry-run drive** that proves',
          'them. A recorded drive command that has never been driven is not evidence.',
          '',
        ]
      : []),
    '## Recording what you establish',
    'One `record_finding` call per key, and `evidence` is not optional in spirit: record what',
    'you ran and what it printed, or what the human told you. Set `userSupplied: true` ONLY',
    'when the human gave you the value or confirmed it verbatim — it permanently stops',
    'automatic runs from improving that key, and the only way back is them clearing it.',
    '',
    '## Secrets',
    'This is a development environment and the human has agreed to supply real connection',
    'strings and credentials here. Store them as given. Do not paste a secret into a timeline',
    'note or a commit message — `record_finding` is the only place a value belongs.',
    '',
    '## Your task',
    'Invoke the `/runcastle:prepare` skill; it carries the method.',
    open
      ? 'Then open by telling the human which fields are still open and what you need from them ' +
        'for each, and work them one at a time.'
      : 'Then confirm the recorded values with the human and stop — there is nothing open to work.',
    '',
  ].join('\n')
}

/** Everything a drive-fix session is handed about the drive that just died. */
export interface DriveFixBrief {
  project: Project
  feature: Feature
  /** The setup hook that failed — the whole reason this session exists. */
  failure: DriveHookFailure
  /** NAMES of the variables setup wrote to `.runcastle/drive.env`, if any. */
  envKeys: readonly string[]
  /** What this feature branch changed against its base, as `--stat` text. */
  delta: BranchDelta
}

/**
 * The injected brief for a `drive-fix` session (decision 9).
 *
 * A fitted prompt rather than prepare's, because the mandates differ in the way
 * that matters: preparation establishes and verifies every key, and this session
 * exists to unblock ONE drive that is failing right now. Told to prepare, an
 * agent re-derives a project it already knows; told to fix this drive, it reads
 * the failure it was handed and works the delta.
 *
 * Four things it is given that no other prompt has: the failure output itself
 * (a human staring at a hookFailure blob is exactly what the one-click exists to
 * end), the variable names the setup script managed to hand back before it died,
 * the branch delta — the usual culprit is something this branch added and the
 * script does not bring up — and where the feature's own docs are.
 *
 * It runs on the HOST, in the real checkout, on the feature branch the failed
 * drive left checked out. So it carries prepare's ask-before-act rule verbatim,
 * and one prepare does not need: the fix belongs in the branch, committed, both
 * because the drive contract says a branch carries its own setup and because the
 * retry cannot even start on a dirty tree.
 */
/** A drive command as the brief renders it — or the fact that it is unset. */
function cmdOrUnset(command?: string | null): string {
  return command && command.trim() !== ''
    ? `\`${command}\``
    : '**not set** — the drive had nothing to run for this step'
}

export function renderDriveFixPrompt(brief: DriveFixBrief): string {
  const { project, feature, failure, envKeys, delta } = brief
  const docs = featureDocsRel(feature.slug)
  return [
    `# runcastle — fixing the test drive for ${feature.title}`,
    '',
    'This is a **drive-fix session**. A test drive of this feature failed to come up, the human',
    'clicked "Fix drive", and you are the recovery. Your mandate is narrow and complete:',
    '**repair the environment and retry THIS drive until it comes up.** Nothing else.',
    '',
    '## What failed',
    `The \`${failure.phase}\` hook of the drive on \`${delta.branch}\` did not succeed.`,
    '',
    `- command: \`${failure.command}\``,
    `- outcome: ${failure.timedOut ? 'timed out' : `exited ${failure.exitCode ?? 'without a code'}`}`,
    '',
    'Its output (tail):',
    '',
    '```',
    failure.output.length > 0 ? failure.output : '(the command produced no output)',
    '```',
    '',
    '## What the drive ran with',
    // The project row is right here, and these are the three commands the drive
    // is made of — the session used to be told to go read them out of the
    // settings UI it cannot see, or infer them from a script it has not opened.
    `- \`driveSetupCommand\`: ${cmdOrUnset(project.driveSetupCommand)}`,
    `- \`devCommand\`: ${cmdOrUnset(project.devCommand)}`,
    `- \`driveStopCommand\`: ${cmdOrUnset(project.driveStopCommand)}`,
    '',
    envKeys.length > 0
      ? `Setup wrote these variables to \`.runcastle/drive.env\` before it stopped: ` +
        `${envKeys.map((k) => `\`${k}\``).join(', ')}. The server overlays that file verbatim ` +
        'onto the dev pane and the stop hook; read the file for the values.'
      : 'Setup wrote no `.runcastle/drive.env` at all — so nothing it computed reached the dev ' +
        'pane. If the script is supposed to write one, that alone may be the fault.',
    '',
    'The identity the server passed in is `RUNCASTLE_SLUG`, `RUNCASTLE_BRANCH` and',
    '`RUNCASTLE_ID` (the identifier-safe slug). Everything else a drive needs, the script',
    'computes for itself and hands back through that file.',
    '',
    '## What this branch changed',
    `\`${delta.base}...${delta.branch}\`:`,
    '',
    '```',
    delta.stat.length > 0 ? delta.stat : '(no delta against the base branch)',
    '```',
    '',
    'Read it before you theorise. The usual fault is something this branch added — a package, a',
    'migration, a service, a required variable — that the drive script does not bring up, and the',
    'contract says the branch carries its own setup.',
    '',
    '## Where to work',
    `You are on the developer's own machine, in \`${project.repoPath}\`, NOT in a sandbox. The`,
    `failed drive is still holding the wheel with \`${delta.branch}\` checked out — that is the`,
    'state you need, so do not switch branches or stop the drive by hand.',
    '',
    'The machinery is `.runcastle/` in this checkout, on this branch right now. Fix it there and',
    '**commit it to the feature branch** — a branch carries its own setup, so the fix must ride it',
    'to review, and `retry_drive` cannot even start on a dirty tree. Those files and `.gitignore`',
    'are the only ones you may write; the guard denies the rest, and a change to the app itself',
    'belongs in a ticket.',
    '',
    '**Ask before you act.** Anything that starts or stops a service, creates or migrates a',
    'database, installs software, or writes outside the repo needs the human to agree first — say',
    'what you are about to run and why, then wait. You are on their machine and their stack is',
    'running next to yours.',
    '',
    '## Retrying',
    '`retry_drive()` stops the failed drive if it is still holding the slot, starts a fresh drive',
    'of this feature, and hands back what the machinery saw: the setup hook outcome, the variable',
    'names it wrote, and the dev pane with the sniffed URL and whether it answers yet. Fix, commit,',
    'retry, read — until setup exits 0 and the app is serving. Then tell the human it is up and',
    'stop; the drive is theirs to test.',
    '',
    'If the fault turns out to be a WRONG SETTING rather than a broken script, you cannot',
    'correct it from here: `record_finding` is project-scoped and this session is feature-',
    'scoped, so it will refuse you. Say which key is wrong and what it should be, and let the',
    'human change it or open a preparation session — do not spend retries working around it.',
    '',
    '## The feature',
    `- \`${docs}/\` — this feature's own docs (brief, spec, decisions, tickets).`,
    `- branch \`${delta.branch}\`, based on \`${delta.base}\`.`,
    '- `get_feature_context` gives you the row, the phase, the docs and the tickets in one call.',
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
 *
 * The task line asks first and explores second on purpose: told only to drive
 * the session, the agent opens with `get_project_context` — charter plus every
 * live ADR in full — and the human waits through a whole orientation pass, and
 * often a subagent digest of it, before it says hello.
 */
export function renderProjectPrompt(
  brief: ProjectBrief,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
): string {
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
    '## Your tools',
    'You have the project-level tools and NONE of the feature pipeline\'s — a session with',
    'no feature has no business advancing one through a gate. `create_feature` is the point',
    'of this session, and it does NOT open a terminal on what it creates: the new card',
    'appearing in the rail is the feedback, and the human decides what to work on next.',
    '',
    'Every merged feature\'s docs are already on disk in this worktree — read them with your',
    'ordinary file tools. The project context\'s feature index says where.',
    '',
    '## Your task',
    `Invoke the \`${skillRef(runtime, 'project')}\` skill, then open by asking the human what they brought.`,
    'Do not explore the project first: orienting before you know the ask spends their wait on',
    'context you may not need. Once they have told you, read only what answering calls for.',
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
    /** End of an agent turn — the other half of the session's turn state. */
    Stop: { hooks: CommandHook[] }[]
    SessionEnd: { hooks: CommandHook[] }[]
    /** The talk-session edit guard; absent for the one kind that may write code. */
    PreToolUse?: { matcher: string; hooks: CommandHook[] }[]
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
  'mcp__runcastle__dry_run_drive',
  'mcp__runcastle__retry_drive',
  // The paged-context tools. `get_feature_context` no longer inlines every doc
  // — it inlines brief/map/decisions/spec and indexes the rest — so the reach
  // for a fourth doc is a tool call, and an un-allowed one stalls the session on
  // a permission prompt at exactly the moment it went looking for evidence.
  'mcp__runcastle__read_feature_doc',
  'mcp__runcastle__list_tickets',
  'mcp__runcastle__read_adr',
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
 *
 * THREE kinds fail that test, not one. `prepare` and `drive-fix` both run in
 * `project.repoPath` — the developer's own checkout, with their own uncommitted
 * work in it — so a blanket `Bash(git add:*)` there pre-approves `git add -A`
 * over their whole dirty tree. The prepare brief's own drive contract warns that
 * `.runcastle/drive.env` "must never be one `git add -A` away from a commit",
 * and the permission rule was granting exactly that. They get the read rules
 * plus a `git add` narrowed to the only paths their edit guard lets them write
 * anyway ({@link DRIVE_MACHINERY_WRITABLE}); a commit still prompts, which is
 * right for a commit landing on the human's branch in the human's checkout.
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

/**
 * The scoped `git add` a host-side session gets instead of the blanket one:
 * exactly the paths its edit guard permits it to have written.
 */
export const HOST_SESSION_BASH_WRITE_RULES: readonly string[] = [
  'Bash(git add .runcastle:*)',
  'Bash(git add .gitignore:*)',
]

/** Kinds that run in the developer's OWN checkout rather than a talk worktree. */
const HOST_SIDE_KINDS: readonly SessionKind[] = ['prepare', 'drive-fix']

/** The git rules a session of `kind` is launched with (see the split above). */
export function sessionBashAllowRules(kind?: SessionKind): readonly string[] {
  if (kind === 'project') return SESSION_BASH_READ_RULES
  if (kind && HOST_SIDE_KINDS.includes(kind)) {
    return [...SESSION_BASH_READ_RULES, ...HOST_SESSION_BASH_WRITE_RULES]
  }
  return SESSION_BASH_ALLOW_RULES
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
 * - `UserPromptSubmit`/`Stop`/`SessionEnd` take NO `matcher` (unsupported →
 *   omitted). `Stop` fires when the agent finishes a turn: paired with
 *   `UserPromptSubmit` it is what tells the server whether a live session is
 *   working or waiting on its human, and it is registered for every kind
 *   because a turn ends the same way whatever the session was opened to do.
 * - `PreToolUse` matches the file-write tools and carries the talk-session edit
 *   guard (see {@link evaluateEditGuard}) — registered for every kind except
 *   `project`, the one allowed to write code. A kind is needed to make that
 *   distinction, so an omitted `kind` gets the guard: a session whose kind we do
 *   not know is not one to hand whole-repo write access to.
 * - Timeouts (seconds): SessionStart 10, UserPromptSubmit 5 (well inside its 30s
 *   hard budget), SessionEnd 10, Stop 5, PreToolUse 5 (it blocks every edit).
 */
export function renderSettings(hookClient: string, kind?: SessionKind): SessionSettings {
  const cmd = (event: string): CommandHook => ({
    type: 'command',
    command: `bun run "${hookClient}" ${event}`,
    timeout: event === 'session-start' || event === 'session-end' ? 10 : 5,
  })
  return {
    permissions: { allow: [...RUNCASTLE_MCP_ALLOW_RULES, ...sessionBashAllowRules(kind)] },
    hooks: {
      SessionStart: SESSION_START_SOURCES.map((source) => ({
        matcher: source,
        hooks: [cmd('session-start')],
      })),
      UserPromptSubmit: [{ hooks: [cmd('user-prompt')] }],
      Stop: [{ hooks: [cmd('stop')] }],
      SessionEnd: [{ hooks: [cmd('session-end')] }],
      ...(kind === undefined || guardsEdits(kind)
        ? { PreToolUse: [{ matcher: EDIT_TOOL_MATCHER, hooks: [cmd('pre-tool')] }] }
        : {}),
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

/**
 * The header a RUN-scoped agent identifies itself with — the twin of
 * `X-Runcastle-Session`, for an agent that has no session to be. Lives here,
 * beside the config that spells it, so the writer and the MCP server that gates
 * on it read the same constant.
 */
export const RUN_HEADER = 'X-Runcastle-Run'

/**
 * `mcp.json` for the burner's review agent — the same server every talk session
 * gets, identified by the RUN rather than by a session, because a review ticket
 * burning at the tail of a run has no session row. `review_drive` and
 * `add_test_note` are gated on exactly this header.
 */
export function renderRunMcpConfig(runId: string, config: RuncastleConfig): McpConfig {
  return {
    mcpServers: {
      runcastle: {
        type: 'http',
        url: `${serverUrlFor(config)}/mcp`,
        headers: { [RUN_HEADER]: runId },
      },
    },
  }
}

// --- writer -----------------------------------------------------------------

/**
 * The whole briefing for one session, whichever of the four briefs it carries.
 *
 * A session that is not briefed from its feature row — a project-scoped one, or
 * the host-side drive fix — supplies its kind's brief instead. Exactly one of
 * the four is always present: a session with none would spawn a terminal with no
 * instructions at all.
 *
 * Exported because a runtime injects it differently: Claude Code appends the
 * file with `--append-system-prompt-file`, where Codex reads `AGENTS.md` out of
 * its home dir. Same prose, two destinations.
 */
export function renderSessionPrompt(input: WriteArtifactsInput): string {
  const { session, feature, waypoint, prepare, projectBrief, driveFix, lap, purpose, runtime } =
    input
  if (driveFix) return renderDriveFixPrompt(driveFix)
  if (feature) return renderSystemPrompt(feature, session.kind, waypoint, lap, purpose, runtime)
  if (prepare) return renderPreparePrompt(prepare)
  if (projectBrief) return renderProjectPrompt(projectBrief, runtime)
  throw new Error(`session ${session.id} has no feature and no project-session brief`)
}

export async function writeSessionArtifacts(
  input: WriteArtifactsInput,
): Promise<SessionArtifacts> {
  const { session, config } = input
  const dir = sessionDir(session.id)
  mkdirSync(dir, { recursive: true })

  const systemPromptPath = join(dir, 'system-prompt.md')
  const settingsPath = join(dir, 'settings.json')
  const mcpConfigPath = join(dir, 'mcp.json')

  writeFileSync(systemPromptPath, renderSessionPrompt(input), 'utf8')
  writeFileSync(
    settingsPath,
    JSON.stringify(renderSettings(hookClientPath(), session.kind), null, 2),
    'utf8',
  )
  writeFileSync(mcpConfigPath, JSON.stringify(renderMcpConfig(session, config), null, 2), 'utf8')

  return { systemPromptPath, settingsPath, mcpConfigPath }
}
