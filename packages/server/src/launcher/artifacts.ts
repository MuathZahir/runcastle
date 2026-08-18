import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type {
  Feature,
  Project,
  RuncastleConfig,
  SessionKind,
  SessionPurpose,
  SessionRow,
  Waypoint,
} from '@runcastle/core'
import { featureDocsRel, sessionDir } from '@runcastle/core/paths'
import type { DriveHookFailure } from '../services/drive-hooks'
import type { BranchDelta } from '../services/git'
import { ASSET_ENV, resolveAsset } from './asset-paths'
import { EDIT_TOOL_MATCHER, guardsEdits } from './edit-guard'

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
 * entry skill, lists the on-disk knowledge paths and the MCP tool cheat-sheet.
 * A kind=waypoint session gets a dedicated prompt carrying its assigned waypoint.
 */
export function renderSystemPrompt(
  feature: Feature,
  kind: SessionKind,
  waypoint?: Waypoint,
  lap?: number,
  purpose?: SessionPurpose,
): string {
  if (kind === 'waypoint') return renderWaypointPrompt(feature, waypoint)
  if (kind === 'converge') return renderConvergePrompt(feature)
  if (kind === 'revisit') return renderRevisitPrompt(feature, lap, purpose)

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
 * At the `review` phase the same session is surfaced as **Iterate** (CONTEXT.md,
 * "Laps: iteration without a mode"; cited by name because the locked-decision
 * numbers get renumbered): the human has just test-driven the burned branch and
 * found things to fix. The kickoff line briefs the review-iteration move (read
 * the run outcome + ticket states, interview about the test drive, emit fix
 * tickets); the prompt below flags that purpose so the session knows the amended
 * docs + fix tickets feed a re-Burn that loops the feature back through
 * implementation.
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
): string {
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
      ? '- DO call `complete_phase` — this lap advances ideation → spec → tickets, and only you can.'
      : '- Do NOT call `complete_phase` — a revisit never moves the pipeline.',
    '- Do NOT touch `done`/`burning` tickets; if done work is now wrong, emit a new ticket that fixes it.',
    '- Docs first, tickets second: capture the decision prose before any ticket surgery.',
    // The conflict-resolution revisit is briefed to resolve the merge, so the
    // blanket ban would contradict the very kickoff it was opened with (F18).
    purpose === 'resolve-conflict' ? conflictResolutionRule() : noCodeRule(docs),
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
 * here can be RUN rather than guessed at, including the four that describe the
 * developer's own machine (the dev server, the local database, credentials) —
 * that is the capability the conversation exists to use, and the reason it must
 * also ask before touching anything stateful.
 *
 * The drive half of the brief is a CONTRACT plus a RECIPE PACK, not a worked
 * example (decision 7). Runcastle mandates only what it cannot do without —
 * scripts in `.runcastle/`, `RUNCASTLE_*` identity in, `drive.env` out,
 * idempotent steps, exit 0 meaning ready — and everything stack-shaped ships as
 * a recipe the agent adapts to the project it actually found. A single postgres
 * one-liner used to stand in for all of that, and a project one shape away from
 * it (compose, redis, a hosted database, a monorepo) had nothing to reason from.
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
    '`devCommand`, `driveSetupCommand`, `driveStopCommand`, `dbResetCommand` — can only be',
    'settled here. Run what you propose; do not guess it from config.',
    '',
    'The same access is why you must **ask before you act**. Anything that starts or stops a',
    'service, creates or migrates a database, or writes outside the repo needs the human to',
    'agree first — say what you are about to run and why, then wait.',
    '',
    '## What the four host keys mean',
    'Take this from here. These semantics live in runcastle\'s source, not in the installed',
    'build — grepping the shipped bundle for them finds nothing and proves nothing.',
    '',
    '- `devCommand` — spawned in a drive-owned terminal pane for the length of a test drive.',
    '  The first localhost URL it prints becomes the "Open app" link.',
    '- `driveSetupCommand` / `driveStopCommand` — run on the host, in the project repo, before',
    '  the dev pane starts and after the drive stops. They are the INVOCATION LINES of scripts',
    '  you write and commit (`bash .runcastle/drive-setup.sh`), not the machinery itself — see',
    '  the contract below.',
    '- `dbResetCommand` — NOT part of the drive loop. Its only consumer is the migration-drift',
    '  banner after a drive stops: when the drive branch and the branch you returned to disagree',
    '  about migration files, this is offered as the one-click dev-database rebuild.',
    '',
    '## The drive contract',
    'A drive is a script YOU write, committed to the project, plus the two things only the server',
    'can do. Everything else — ports, database names, redis indexes, compose project names, URLs',
    '— the script computes for itself. Runcastle mandates these seven points and nothing else:',
    '',
    '1. **The machinery lives in `.runcastle/`, committed to the repo.** Write the steps as real',
    '   scripts (`.runcastle/drive-setup.sh`, `.runcastle/drive-stop.sh`, or whatever this host',
    '   runs) and commit them. Versioning them with the code they prepare is the load-bearing',
    '   part: a branch that adds a package, a service or a migration amends its own script, and',
    '   the drive on that branch runs the amended version. Nothing inspects a diff, ever.',
    '2. **`driveSetupCommand` / `driveStopCommand` are one line each** — how to invoke those',
    '   scripts. Logic in the setting instead of the script is logic no branch can amend.',
    '3. **Identity comes in as `RUNCASTLE_*`.** Every drive hook and the dev pane are handed',
    '   `RUNCASTLE_SLUG` (the feature slug), `RUNCASTLE_BRANCH` (the branch under the wheel) and',
    '   `RUNCASTLE_ID` — that slug made identifier-safe (lowercase `[a-z0-9_]`, never leading',
    '   with a digit, length-capped), so it is legal as a database, schema or container name.',
    '   Derive every per-drive name from `RUNCASTLE_ID`. Never derive one from `git rev-parse`:',
    '   the dry run below drives under a synthetic identity on whatever branch is checked out.',
    '4. **Computed values go back out through `.runcastle/drive.env`.** Setup appends plain',
    '   `KEY=VALUE` lines there; when it exits, the server parses that file and overlays it',
    '   verbatim onto the dev pane and the stop hook, and shows the variable NAMES on the',
    '   timeline. It is the only way a value your script computed reaches the dev server — a',
    '   variable exported inside the script dies with the script. Truncate the file at the top of',
    '   setup so a rerun does not accumulate stale lines.',
    '5. **`.runcastle/drive.env` MUST be gitignored.** Add the entry yourself. The server deletes',
    '   the file when a drive ends, but a scratch file holding a connection string must never be',
    '   one `git add -A` away from a commit.',
    '6. **Every step is unconditionally idempotent.** Install, migrate, seed, compose up — run',
    '   them every time, never behind a "has anything changed?" check. A no-op on a clean tree is',
    '   cheap; a skipped install on a branch that added a package is a dead drive. This is how',
    '   the loop absorbs whatever a feature branch changed with no delta detection anywhere.',
    '7. **Exit 0 means the services are actually up.** The waits belong INSIDE the script —',
    '   `docker compose up --wait`, a `pg_isready` loop, curl-until-healthy — because the dev',
    '   pane starts the instant setup returns. The server waits for the app itself; it will not',
    '   wait for your database.',
    '',
    'Stop undoes what setup made, for this identity only: drop the database it created, take its',
    'compose project down with its volumes, free its ports. The human\'s own stack is never yours.',
    '',
    'Writing those files is the one exception to a preparation session not editing the repo: you',
    'may write `.runcastle/` and `.gitignore` in this checkout and nothing else. Show the human',
    'the script before you commit it — it is their repo and their PR.',
    '',
    '## Discover the shape before you author anything',
    'Projects differ in every dimension this touches, and a script fitted to a project you',
    'imagined is worse than no script at all. Find out first, by reading the repo and running',
    'things here — not by assuming:',
    '',
    '- **Package manager and workspace layout** — npm/pnpm/yarn/bun; one package or a monorepo',
    '  with workspaces, and which package the app actually is. Install, migrate and seed each run',
    '  from somewhere specific.',
    '- **OS and shell** — you are writing for THIS host. A Windows machine may want a `.ps1` or a',
    '  cross-platform `node`/`bun` script; do not hand a developer bash they cannot run.',
    '- **Docker** — installed, running, a compose file in the repo, and does the human actually',
    '  use it for this project?',
    '- **The services the app needs to boot** — database, redis, queues, object storage, a second',
    '  process. Read the config and the env example, then confirm with the human.',
    '- **Hosted or local data stores** — a local postgres you may freely `createdb` on is a very',
    '  different recipe from a hosted one where you may only branch or add a schema.',
    '- **How the app loads its environment** — see the audit below.',
    '',
    'Then write the smallest script that brings THAT shape up.',
    '',
    '## Recipes — adapt them, never copy them',
    'Each of these is one shape that has worked. Take the idea and fit it to what you found.',
    '',
    '**Postgres, one database per drive.** Name it from `RUNCASTLE_ID`, create it if it is not',
    'there, migrate, and hand the URL back:',
    '',
    '      DB="myapp_$RUNCASTLE_ID"',
    '      createdb "$DB" 2>/dev/null || true      # idempotent: already-there is success',
    '      DATABASE_URL="postgres://localhost/$DB" npm run migrate',
    '      echo "DATABASE_URL=postgres://localhost/$DB" >> .runcastle/drive.env',
    '',
    'Stop drops exactly that database: `dropdb --if-exists "myapp_$RUNCASTLE_ID"`.',
    '',
    '**docker compose.** Isolate the whole stack per drive with a project name derived from the',
    'identity, map host ports from variables the script chose, and let compose do the waiting:',
    '',
    '      export COMPOSE_PROJECT_NAME="myapp_$RUNCASTLE_ID"',
    '      export PG_PORT=$(pick_port "$RUNCASTLE_SLUG-pg")   # the port recipe below',
    '      docker compose up --wait -d',
    '      echo "COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME" >> .runcastle/drive.env',
    '      echo "DATABASE_URL=postgres://localhost:$PG_PORT/app" >> .runcastle/drive.env',
    '',
    'The compose file maps `"${PG_PORT}:5432"`; stop is `docker compose down -v`, which needs the',
    'same `COMPOSE_PROJECT_NAME` — which is why it goes into `drive.env` too.',
    '',
    '**Redis.** Do not run a second server. Take a logical database index or a key prefix derived',
    'in-script from `RUNCASTLE_ID` — a small hash into 1..15 for the index — and leave db 0 to the',
    'human, whose own work is already in it. Write `REDIS_URL=redis://localhost:6379/7` or',
    '`REDIS_PREFIX=$RUNCASTLE_ID:` out, and have stop flush only that index or prefix.',
    '',
    '**Hosted databases.** Where the vendor has branches (Neon and its kin), setup creates one',
    'named for `RUNCASTLE_ID` with the vendor CLI and writes the connection string it prints to',
    '`drive.env`; stop deletes that branch. Where the role has no CREATEDB grant, take a schema',
    'per drive instead — `CREATE SCHEMA IF NOT EXISTS "$RUNCASTLE_ID"` plus a URL with the search',
    'path pinned to it, and `DROP SCHEMA ... CASCADE` at stop. Ask the human which they have:',
    'it is their bill and their production neighbour.',
    '',
    '**Deterministic ports.** Every lap of a feature should keep the same URL, and no drive should',
    'collide with the human\'s own running stack. Hash the SLUG — not the branch, so laps agree —',
    'into a high range, then bind-probe upward for a free one:',
    '',
    '      base=$(( 20000 + $(printf %s "$RUNCASTLE_SLUG" | cksum | cut -d" " -f1) % 10000 ))',
    '      port=$base; while port_in_use "$port"; do port=$((port + 1)); done',
    '      echo "PORT=$port" >> .runcastle/drive.env',
    '',
    'The dev pane inherits `PORT` from the overlay, so the URL it prints — the "Open app" link —',
    'is the port the script picked.',
    '',
    '## Audit how the app loads its environment',
    'The overlay is process environment, which beats a `.env` file in dotenv, Prisma and Next by',
    'default. One pattern defeats it: a loader told to clobber what is already exported —',
    '`dotenv.config({ override: true })` and its equivalents — ignores everything the script',
    'computed and quietly keeps the app on the shared database. That is a drive that looks',
    'perfect while testing the wrong data. No machinery can detect it; you are the detector.',
    '',
    'Grep the app\'s entry points and config for env loading and decide, for each, which side',
    'wins. Where the process environment loses: get it fixed — you may not edit app code from',
    'this session, so propose the change (usually dropping `override`) and let the human make it',
    '— or, if it must stay, record the finding with `record_event` naming the file and what it',
    'breaks, so the first confusing drive is not a mystery.',
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
    '## Closing move: propose a dry-run drive',
    'Once the open keys are recorded, end the session by PROPOSING one — recorded values that',
    'have never been driven look exactly as trustworthy as values that run perfectly, and the',
    'first person to find out otherwise is someone mid-feature with a broken environment.',
    '',
    '**Ask before you act.** This starts services and creates a database on their machine. Name',
    'what will run — the setup command, the dev command, the stop command — then wait. If they',
    'decline, end the session normally: the keys simply stay unverified, and the drive UI will',
    'keep saying so.',
    '',
    'On a yes, `dry_run_drive({ action })` runs it in two halves and you inspect between them:',
    '',
    '1. `start` — the server runs `driveSetupCommand` with the identity variables, reads back the',
    '   `.runcastle/drive.env` it wrote (the reply lists the variable NAMES it parsed) and spawns',
    '   `devCommand` in a real drive pane under that overlay. Identity is the reserved slug',
    '   `prep-dry-run`, so `RUNCASTLE_ID` is `prep_dry_run` and a script deriving from it makes',
    '   e.g. `myapp_prep_dry_run`, on the current branch. Nothing is checked out.',
    '2. While it is up, check what the server cannot: the variable names came back as you meant',
    '   them, the temp database exists and is FRESH, the migrations applied, and the app actually',
    '   RESPONDS at the sniffed URL — the server waits for it to answer before "Open app" goes',
    '   live, but only you can say the page is the right one. `status` gives you the pane and the',
    '   URL while you work.',
    '3. `stop` — the server runs `driveStopCommand` under the same overlay. Then check the',
    '   cleanup: temp database gone, no orphaned process, container or volume left behind.',
    '',
    'Anything off at any step, fix it — amend the script, or `record_finding` for a key — and run',
    'the WHOLE thing again until a pass is clean. Watch especially for a `myapp_prep_dry_run` left',
    'standing after the stop: an idempotent setup will happily reuse it on the next start, so a',
    'teardown that never worked reads exactly like a drive that did.',
    '',
    'The verified stamps are computed server-side from what the machinery observed, and only on a',
    'clean full pass. You cannot mark your own homework: your deeper checks decide whether to',
    'retry, never what gets stamped.',
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
    '- `create_feature({ title, oneLiner, baseBranch?, brief?, tickets? })` — the point of',
    '  this session. It does NOT open a terminal on what it creates; the new card appearing',
    '  in the rail is the feedback, and the human decides what to work on next.',
    '- `get_project_context()` — the project, its charter, its live ADRs, and a one-line',
    '  index of every feature.',
    '- `get_work_record({ featureSlug? | seam? })` — what features actually did: tickets by',
    '  status, seams, commits, errors, and each burner\'s digest of what it actually did,',
    '  what surprised it and what it left undone. Facts, never intent.',
    '- `record_event({ type, message })` — drop a note on the project timeline.',
    '',
    'Every merged feature\'s docs are already on disk in this worktree — read them with your',
    'ordinary file tools. The index says where.',
    '',
    '## Your task',
    'Invoke the `/runcastle:project` skill, then open by asking the human what they brought.',
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

export async function writeSessionArtifacts(
  input: WriteArtifactsInput,
): Promise<SessionArtifacts> {
  const { session, feature, config, waypoint, prepare, projectBrief, driveFix, lap, purpose } =
    input
  const dir = sessionDir(session.id)
  mkdirSync(dir, { recursive: true })

  const systemPromptPath = join(dir, 'system-prompt.md')
  const settingsPath = join(dir, 'settings.json')
  const mcpConfigPath = join(dir, 'mcp.json')

  // A session that is not briefed from its feature row — a project-scoped one,
  // or the host-side drive fix — supplies its kind's brief instead. Exactly one
  // of the four is always present: a session with none would spawn a terminal
  // with no instructions at all.
  const systemPrompt = driveFix
    ? renderDriveFixPrompt(driveFix)
    : feature
      ? renderSystemPrompt(feature, session.kind, waypoint, lap, purpose)
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
