import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type {
  AgentRuntime,
  Feature,
  Project,
  RuncastleConfig,
  ScenarioFailure,
  SessionKind,
  SessionPurpose,
  SessionRow,
} from '@runcastle/core'
import { DEFAULT_RUNTIME, DRIVE_LOOP_KEYS } from '@runcastle/core'
import { designCropsDir, featureDocsRel, sessionDir } from '@runcastle/core/paths'
import type { DriveHookFailure } from '../services/drive-hooks'
import type { BranchDelta } from '../services/git'
import { ASSET_ENV, resolveAsset } from './asset-paths'
import { guardsEdits } from './edit-guard'
import { WAIT_MESSAGES_MODE } from './hook-client'
import { PRE_TOOL_MATCHER } from './install-guard'
import { resolvePluginDir } from './skills-root'
import {
  ENTRY_SKILLS,
  FEATURE_SKILL,
  ORCHESTRATING,
  PLANNING_ALONE,
  entrySkillsFor,
  skillRef,
} from './runtimes/skills'

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
   * The brief for a `scenario` session. Its scope follows the drive, so it
   * carries the drive rather than being briefed from `feature`.
   */
  scenario?: ScenarioBrief
  /**
   * Why the session was launched, when that changes its briefing — a relay, a
   * merge conflict to resolve or a self-planning run each add one sentence.
   */
  purpose?: SessionPurpose
  /**
   * The runtime this session's agent runs on, which decides how the briefing
   * spells a skill invocation (see {@link skillRef}) — a Codex session told to
   * invoke `/runcastle:feature` simply does nothing. Optional: a caller that does
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
 * What every feature chat may do in its checkout (`the-feature-lead-runs-rounds`
 * decisions 5 and 7; tickets-and-review-are-tools-not-phases decision 13). The
 * edit and install guards lift for every chat and side session
 * (`isUnguardedLead`), so the brief says what the lead may do rather than what
 * it may not, and how its commits travel.
 */
export function leadCodeRule(): string {
  return (
    '- **You may change code yourself.** A change small enough not to need a ticket is yours ' +
    'to make in this checkout, and you may install dependencies here to typecheck and test it. ' +
    "Verify with the project's own checks before you commit.\n" +
    '- **Your commits land through the feature\'s landing queue**, between ticket landings ' +
    'during a round, and they wait while the human is driving the feature. Use a conventional ' +
    '`feat(scope): …` subject; never reword a `ticket(<seq>): …` or `runcastle: …` commit.'
  )
}

/**
 * The one extra sentence a launch's errand adds to the feature brief. Every
 * errand is a situation the same lead handles (decision 4), so it changes the
 * brief by a line, not by a different brief.
 */
function purposeLine(purpose: SessionPurpose | undefined, runtime: AgentRuntime): string | undefined {
  switch (purpose) {
    case 'self-plan':
      return (
        "This is a self-planning run: plan this feature by yourself and do not build it, by the " +
        `${skillRef(runtime, FEATURE_SKILL)} skill's \`${PLANNING_ALONE}\`, ending on a request for the human's yes.`
      )
    case 'relay':
      return (
        "This is a relay run: the project's orchestrator, not the human, sent this conversation a " +
        "message — apply it by the skill's change-handling rules, marking any decision it changes as the orchestrator's."
      )
    case 'resolve-conflict':
      return (
        'This session resolves a merge conflict: merge the base branch in, resolve the conflicts ' +
        "from the feature docs' intent, verify the merge with the project's own checks, and commit it."
      )
    default:
      return undefined
  }
}

/**
 * The section a headless run of the feature's chat adds to its brief — a
 * self-planning run, a relay, or a lead woken because no terminal of it was
 * open (`the-feature-lead-runs-rounds` decision 12). Nobody is watching: a
 * question ends the turn and with it the process, and a tool it is refused will
 * never be approved, so both are stated as things to decide past rather than
 * wait on. Whether the run resumed its conversation is the kickoff's to say.
 */
function headlessRule(): string {
  return [
    '## No human is present',
    'Runcastle runs this conversation headless: nobody is watching this run.',
    '- Act on your opening prompt in this one run.',
    '- Never end your turn waiting on an answer — ending the turn ends the run. To ask the human',
    '  anything, call `wait_for_you` with why, then end your turn: their reply reaches you later',
    '  in this same conversation.',
    '- A refused tool is not a wait: do not retry it or wait for approval. Decide on what you',
    '  know and treat that decision as a candidate to check first.',
    OUTRANKS_TALKING_TO_THE_HUMAN,
  ].join('\n')
}

/**
 * The line the headless rule ends on. {@link renderSessionPrompt} appends
 * {@link talkingToTheHumanSection} after every brief, so it lands BELOW a
 * headless rule — and an agent that follows the last instruction it read would
 * end its run on a framed decision for nobody. Its writing rules still serve the
 * human who reads the `**Assumed.**` decisions later, so it is kept but outranked.
 */
const OUTRANKS_TALKING_TO_THE_HUMAN = [
  '- This section outranks "How to talk to the human" at the end of this brief: follow its',
  '  writing rules in what you leave behind for the human to read later, but put a question',
  '  to them only through `wait_for_you`.',
].join('\n')

/**
 * The injected system prompt (feature brief). One brief for every feature
 * `chat` — attended, headless wake, self-plan, relay, resolve-conflict — in any
 * state of the feature (tickets-and-review-are-tools-not-phases decision 4):
 * the chat is the feature's lead from its first message, and the feature skill
 * carries the whole loop. An errand adds one sentence ({@link purposeLine}), a
 * headless run the rules for nobody watching ({@link headlessRule}).
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
  purpose?: SessionPurpose,
  runtime: AgentRuntime = DEFAULT_RUNTIME,
  headless = false,
): string {
  if (kind === 'side') return renderSidePrompt(feature)
  const docs = featureDocsRel(feature.slug) // docs/features/<slug>
  const errand = purposeLine(purpose, runtime)
  // A self-planning run has nobody to answer it by definition, however it was launched.
  const unattended = headless || purpose === 'self-plan'

  return [
    `# runcastle — ${feature.title}`,
    '',
    feature.oneLiner,
    '',
    "You are this feature's **lead**, from your first message until the human merges it. You",
    'talk with the human, decide and record what the feature is, build it yourself or in rounds',
    'of sandboxed workers, check it, and hand it to the human to test-drive. Where possible this',
    "terminal RESUMES the feature's conversation, so you may already have its context above.",
    '',
    '## Feature',
    `- Slug: \`${feature.slug}\``,
    `- Branch: \`${feature.branch}\``,
    '',
    '## Knowledge (versioned in the target repo)',
    `Feature docs live at \`${docs}/\`:`,
    `- \`${docs}/brief.md\` — the brief the feature was created with.`,
    `- \`${docs}/decisions.md\` — decisions, recorded as they settle.`,
    `- \`${docs}/spec.md\` — the spec, written once the feature is concrete.`,
    'Write them in THIS working directory and commit them like any other change. Workers read',
    'them; keep them true when a round changes what was decided.',
    '',
    '## Rules',
    '- The human owns Merge and the drive; you never merge, and you never start a draft.',
    '- One round at a time. A dispatch is refused while a round runs, while the human is',
    '  driving this feature, and after Stop until the human replies.',
    leadCodeRule(),
    otherEntrySkillsRule(),
    '',
    ...(unattended ? [headlessRule(), ''] : []),
    '## Your task',
    ...(errand ? [errand] : []),
    unattended
      ? `Invoke the \`${skillRef(runtime, FEATURE_SKILL)}\` skill and do what your opening prompt asks, in this one run.`
      : `Invoke the \`${skillRef(runtime, FEATURE_SKILL)}\` skill and continue this feature.`,
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
 * A side session's brief (several-sessions-per-feature decisions 3, 5 and 15):
 * an extra conversation beside the main chat, in the same talk worktree, with
 * the main chat's write rules and every one of its tools except the round loop.
 * The role is stated here, in the kickoff (`sideKickoffFor`) and in the per-turn
 * hook label, so it holds even where one of them is read weakly (decision 3's
 * challenge).
 */
export function renderSidePrompt(feature: Feature): string {
  const docs = featureDocsRel(feature.slug)
  return [
    `# runcastle — ${feature.title} (side session)`,
    '',
    feature.oneLiner,
    '',
    `You are a **side session** of feature \`${feature.slug}\`, opened beside its main chat. The`,
    "main chat is the feature's lead; you are not it and you do not carry on its task. You",
    'started fresh: the feature state in your opening prompt, the docs and',
    '`get_feature_context` are how you learn what is going on.',
    '',
    '## Feature',
    `- Slug: \`${feature.slug}\``,
    `- Branch: \`${feature.branch}\``,
    '',
    '## Knowledge (versioned in the target repo)',
    `Feature docs live at \`${docs}/\` — brief, decisions, spec.`,
    '',
    '## Rules',
    '- **You may do anything the main chat does except run rounds.** Read, write the spec and',
    '  decisions, emit and edit tickets, resolve findings, park drafts — but the main chat',
    '  alone dispatches, stops and declares ready.',
    '- **The folder is shared with the main chat.** Stage only your own files',
    '  (`git add <paths>`, never `git add -A` or `git add .`).',
    '- **You may change code in this checkout**, and install dependencies here to typecheck',
    "  and test it; verify with the project's own checks before you commit. Your commits",
    "  land the way the main chat's do. Use a conventional `feat(scope): …` subject; never",
    '  reword a `ticket(<seq>): …` or `runcastle: …` commit.',
    '- The runcastle skill pack\'s session-entry skills belong to other kinds of session and are',
    '  denied to you by settings; the code-review skill remains yours to reach.',
    '',
    '## Your task',
    "Wait for the human's ask, then do it. Do not act before they say what they want.",
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
          'Every value the app needs to reach its data (above all the database URL) must go out',
          'through `drive.env`: scenarios reach the drive database only through that overlay, so a',
          'setup that hands it to the dev server some other way leaves them seeding the wrong one.',
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
    'Invoke the `/runcastle:prepare` skill; it carries the method. It is your only entry',
    "skill here — the pack's others belong to other session kinds and are denied by settings.",
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
    '- `get_feature_context` gives you the row, the phase, the ticket rows and the docs in one',
    '  call — a doc it lists in `notInlined` must be read before you act; `get_ticket({ seq })`',
    "  holds a ticket's context, acceptance criteria and digest.",
    '',
  ].join('\n')
}

/** Everything a `scenario` session is handed about the drive it lands scenarios on. */
export interface ScenarioBrief {
  project: Project
  /** The feature being driven; absent on a project drive. */
  feature?: Feature
  /** The branch under the wheel — the one the scenario is committed onto. */
  branch: string
  /** The `RUNCASTLE_*` identity every drive hook and scenario runs with. */
  identity: Readonly<Record<string, string>>
  /** The `drive.env` overlay, names AND values: a scenario runs with these. */
  envOverlay: Readonly<Record<string, string>>
  /** The drive's app URL — what a relative `ENTRY_URL` resolves against. */
  driveUrl?: string
  /** The project's scenario runner command, when one is set. */
  runner?: string
  /** Every path under `.runcastle/scenarios/` at HEAD, `_` shared code included. */
  files: readonly string[]
  /** What the human asked for, from ＋ New scenario. */
  description?: string
  /** The scenario Fix it was clicked on, and how it failed. */
  fix?: { file: string; failure?: ScenarioFailure }
  /** True when `.runcastle/scenarios/` did not exist at launch (decision 5). */
  setup: boolean
}

/** A scenario failure in the words the drive panel shows the human. */
function scenarioFailureLine(failure: ScenarioFailure): string {
  switch (failure.reason) {
    case 'exit':
      return `exited ${failure.exitCode ?? 'without a code'}`
    case 'no-entry-url':
      return 'exited 0 but printed no ENTRY_URL'
    case 'timeout':
      return 'ran past the two-minute timeout and was killed'
    case 'no-runner':
      return 'could not run: no scenario runner is set'
  }
}

/** The Fix it ask: the failed file, how it failed, its output tail, and what to do. */
function scenarioFixLines(fix: NonNullable<ScenarioBrief['fix']>): string[] {
  return [
    `The human clicked **Fix it** on \`${fix.file}\`.`,
    ...(fix.failure
      ? [
          `It ${scenarioFailureLine(fix.failure)}. Its output (tail):`,
          '',
          '```',
          fix.failure.outputTail.length > 0 ? fix.failure.outputTail : '(the scenario produced no output)',
          '```',
        ]
      : ['Its failure is no longer on the drive; run it with `run_scenario` to see it again.']),
    '',
    'Repair it — usually a fixture or model the app changed — commit, and land the human with',
    '`run_scenario`.',
  ]
}

/**
 * What ＋ New scenario or Fix it hands a scenario chat that is already live and
 * docked: the same ask its launch briefing would carry, typed into its terminal
 * since a running session has no argv left. Undefined when the door carried
 * nothing new (a plain ＋ New scenario reopening the chat).
 */
export function renderScenarioFollowUp(
  ask: Pick<ScenarioBrief, 'description' | 'fix'>,
): string | undefined {
  if (ask.fix) return scenarioFixLines(ask.fix).join('\n')
  if (ask.description) {
    return [
      `The human asked for a new scenario: ${ask.description}`,
      '',
      'Write it, commit, and land the human with `run_scenario`.',
    ].join('\n')
  }
  return undefined
}

/**
 * The injected brief for a `scenario` session (drive-scenarios decision 8): the
 * ＋ New scenario chat, or Fix it on a failed scenario, docked beside a running
 * drive.
 *
 * It carries the drive's identity and its `drive.env` VALUES — unlike the
 * drive-fix brief, which names keys only — because the agent writes code that
 * runs with them and must reach the drive's isolated database exactly as the
 * runner will. "Proven on first use" is the whole point, so the landing rule is
 * absolute: the human is landed through `run_scenario`, the same runner the
 * picker uses, never by the agent running the script itself.
 */
export function renderScenarioPrompt(brief: ScenarioBrief): string {
  const { project, feature, branch, identity, envOverlay, driveUrl, runner, files, setup } = brief
  const kv = (vars: Readonly<Record<string, string>>): string[] =>
    Object.entries(vars).map(([k, v]) => `- \`${k}\` = \`${v}\``)
  const overlay = kv(envOverlay)
  const drive = feature ? `the test drive of ${feature.title}` : 'the project drive'

  const ask: string[] = brief.fix
    ? ['## Fix this scenario', ...scenarioFixLines(brief.fix)]
    : brief.description
      ? ['## What the human asked for', brief.description, '']
      : [
          '## What the human asked for',
          'Nothing yet. **First ask the human what state they want to land in**, then write it.',
          '',
        ]

  const setupBlock: string[] = setup
    ? [
        '## Setup mode — this branch has no scenarios yet',
        '`.runcastle/scenarios/` does not exist on this branch, so you set scenarios up first. You',
        'may edit anywhere in this checkout for that. In order:',
        '',
        '1. **Login route — only if the app has sign-in.** Add the drive-only route described below,',
        '   through the app\'s own sign-in code.',
        "2. **Typecheck.** Make the project's typecheck (or equivalent) cover `.runcastle/scenarios/`;",
        '   dot-folders are often excluded by default, and a scenario must break loudly when the',
        '   model changes.',
        '3. **Base fixtures** under `.runcastle/scenarios/_fixtures/` ("a buyer", "3 products"), so',
        '   each scenario is a few lines. When the app authenticates its API with tokens, add a',
        '   fixture that mints one for the seeded user, so API scenarios can print `TOKEN=`.',
        '4. **The runner.** Record the command that runs one scenario file with',
        '   `set_scenario_runner({ command })`; it must contain `{file}` (e.g. `bun {file}`,',
        '   `bin/rails runner {file}`).',
        '5. **The scenario** the human asked for.',
        '',
      ]
    : [
        '## What you may edit',
        'Only `.runcastle/` — the scenarios and their `_` shared code. The guard denies the rest; a',
        'change the app itself needs belongs in a ticket, so tell the human.',
        '',
      ]

  return [
    `# runcastle — a scenario for ${drive}`,
    '',
    'This is a **scenario session**, docked beside a running test drive. A scenario is a project',
    'command that seeds a state and prints the URL to land on, so the human starts a drive where',
    'the thing they want to test already exists — signed in, data in place.',
    '',
    ...ask,
    ...setupBlock,
    '## The drive',
    `- project: ${project.name} (\`${project.repoPath}\`)`,
    `- branch under the wheel: \`${branch}\``,
    `- app URL: ${driveUrl ? `\`${driveUrl}\`` : 'not answering yet'}`,
    '',
    'The identity every scenario runs with:',
    ...kv(identity),
    '',
    overlay.length > 0
      ? 'The `drive.env` overlay (the drive\'s isolated database and friends), which every scenario run also gets:'
      : 'The drive\'s setup wrote no `drive.env` overlay, so a scenario sees only the identity above.',
    ...overlay,
    '',
    '## The scenario contract',
    '- A scenario is a file at `.runcastle/scenarios/<group>/<name>.<ext>`. The folder is the group',
    '  (`checkout/` → Checkout), the file name the display name (`expired-coupon.ts` → Expired coupon).',
    "- It is real app code: it imports the app's own models and factories.",
    '- Files and folders starting with `_` (e.g. `_fixtures/`) are shared code, never listed.',
    '- Every run gets a fresh `RUNCASTLE_SCENARIO_RUN` (short hex). Use it to make every entity',
    '  unique (`buyer_<run>`), so several scenarios coexist in one drive\'s database.',
    '- It prints `ENTRY_URL=<url>` on stdout; the last such line wins. A relative URL resolves',
    '  against the app URL. Exit 0 with an `ENTRY_URL` is success; anything else fails, and so does',
    '  a run past two minutes.',
    '- It may also print `TOKEN=<value>` (the last such line wins): a credential for API calls, e.g.',
    '  a bearer token for the seeded user.',
    '- **An API call** is a sibling `.http` file at the same path (`feed/blocked-only.ts` +',
    '  `feed/blocked-only.http`), in the standard `.http` format: a request line `METHOD path`,',
    '  header lines, a blank line, then an optional body. One request per scenario. `{{token}}` is',
    '  replaced with `TOKEN` and `{{run}}` with `RUNCASTLE_SCENARIO_RUN`, and a relative path',
    '  resolves against the app URL. Write one when the human asks about an API or endpoint.',
    "  The human sends it from the drive's API view with **Try it**; you cannot send it yourself,",
    '  so landing its scenario with `run_scenario` is your proof.',
    '',
    `The scenario runner: ${runner && runner.trim() !== '' ? `\`${runner}\` (\`{file}\` is the repo-relative path)` : '**not set** — record one with `set_scenario_runner` before landing'}.`,
    '',
    files.length > 0
      ? 'What `.runcastle/scenarios/` holds on this branch:'
      : 'There are no scenario files on this branch yet.',
    ...files.map((f) => `- \`${f}\``),
    '',
    '## The login route',
    'Only if the app has sign-in. Being signed in lives partly in the browser, which neither a',
    'scenario nor runcastle can write: the app runs in a cross-origin panel. So the app carries one',
    'drive-only route, e.g. `/__drive/login?token=…&to=…`:',
    '- it exists only when the drive environment is set (a `RUNCASTLE_*` variable is present), and',
    '  never in production;',
    '- the scenario seeds the user like any other entity and mints a one-time token for it;',
    "- the route checks the token, signs in through the app's own sign-in code, and redirects to `to`.",
    'An app without sign-in, or a scenario meant to land signed out, prints a plain `ENTRY_URL`.',
    '',
    '## Rules',
    `- **Commit before landing.** \`git commit\` your work onto \`${branch}\`, the branch checked out`,
    '  here, before the final `run_scenario`. Never push, never switch branches, never stop the drive.',
    '- **Land only through `run_scenario({ file })`.** It runs the scenario through the same runner',
    "  the picker uses and points the human's drive panel at its `ENTRY_URL` — that is what proves",
    '  it. Never run the scenario yourself as the landing. If it fails, read the failure it returns,',
    '  fix, commit and retry.',
    '- Make entities unique with `RUNCASTLE_SCENARIO_RUN`; never reset the database.',
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
  /** The resolved session branch it was cut from and lands back on. */
  base: string
  /**
   * How many project notes were open when this session launched. Counted here so
   * an ordinary New chat can OFFER to triage them; the count is a snapshot and
   * the session reads the pile itself with `list_project_notes`, which is what
   * stays live as notes are jotted mid-chat.
   */
  openNotes: number
  /**
   * The project's Orchestrator setting was on at launch (`whole-cuts-plan-themselves`
   * decision 14): this session is the orchestrator, and its prompt says so.
   */
  orchestrate?: boolean
  /**
   * One line per thing that ended on the orchestrator's features since its last
   * session ended — read only when {@link orchestrate} is set.
   */
  catchUp?: string[]
}

/**
 * The orchestrating section of the project prompt: who this session is in the
 * mode, where its judgement is written down, that nothing will prompt it, and
 * what happened on its features while it was not live (decision 11).
 */
function renderOrchestratingSection(catchUp: string[], runtime: AgentRuntime): string[] {
  return [
    `## ${ORCHESTRATING}`,
    "This project's Orchestrator setting (experimental) is on: **you are the orchestrator** for",
    'this project. You run the features you create, and any the human hands you, from planning',
    `through merge. Read and follow the "${ORCHESTRATING}" section of the`,
    `\`${skillRef(runtime, 'project')}\` skill — it is how you judge every step; nothing here`,
    'replaces it. In this mode it is you, not the human, who decides what to work on next.',
    '',
    'You run without permission prompts: you edit the repo and run commands without asking.',
    '',
    ...(catchUp.length > 0
      ? ['### Since you were last live', ...catchUp.map((line) => `- ${line}`)]
      : ['Nothing has happened on your features since you were last live.']),
    '',
  ]
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
  const { project, branch, worktreePath, base, openNotes, orchestrate, catchUp } = brief
  return [
    `# runcastle — ${project.name} (project session)`,
    '',
    'This is the **project session**: a conversation that belongs to the project, not to',
    'any one feature. There is no feature state to move and no planning step to report here.',
    '',
    '## What this session is for',
    '- **Intake and decomposition** — the job no other surface can do. Take whatever the',
    '  human brings, grill it until it resolves into N features, and create them with',
    '  `create_feature`. A feature born here carries a real brief: the reasoning you just',
    '  worked out, not a restated one-liner.',
    '- **Portfolio Q&A** — "have we already decided X?", "did we ever build Y?" — the same',
    '  lookup intake needs anyway to avoid creating a duplicate feature.',
    '- **Routing** — an incoming thing is one of exactly five destinations: a new feature,',
    '  a quick change, an existing feature\'s revisit, more rounds on something in review',
    "  (a message to that feature's agent), or nothing. Say which, and why.",
    '- **Curation, advisory only** — you may report that two in-flight features are on a',
    '  collision course or that an ADR looks stale. You do NOT fix either. Every fix routes',
    '  back through a feature, through promotion at merge, or through the charter.',
    '- **The charter (`CONTEXT.md`)** — you are the only session in runcastle allowed to',
    '  write it. Create it lazily: when there is first something to write, not before.',
    '',
    '## Where you are working — and where your writes go',
    `- Working directory: \`${worktreePath}\` — a runcastle-owned worktree, NOT the human's`,
    `  checkout at \`${project.repoPath}\`.`,
    `- Branch: \`${branch}\`, cut from \`${base}\` when this session launched.`,
    `- **Your commits land on \`${base}\` when this terminal closes**, arriving`,
    "  in the human's checkout the way a `git pull` does. Write real code and real docs —",
    '  there is no sandbox here — and commit everything you write before you finish.',
    '  A session that edits without committing leaves a dirty tree, which is exactly what',
    '  blocks a test drive and jams the next merge. Land what you wrote; leave it clean.',
    '',
    '## Your tools',
    'You have the project-level tools and NONE of the feature pipeline\'s — a session with',
    'no feature has no business moving one through it. `create_feature` is the point',
    'of this session, and it does NOT open a terminal on what it creates: the new card',
    'appearing in the rail is the feedback, and the human decides what to work on next.',
    '',
    'Every merged feature\'s docs are already on disk in this worktree at',
    '`docs/features/<slug>/` — read them with your ordinary file tools. An in-flight',
    'feature\'s docs are not: `read_feature_brief({ slug })` returns its brief.',
    '',
    "The runcastle skill pack also carries the feature sessions' entry skills; they are",
    'denied to this session by settings. Yours is the one named below.',
    '',
    ...(orchestrate ? renderOrchestratingSection(catchUp ?? [], runtime) : []),
    '## Your task',
    `Invoke the \`${skillRef(runtime, 'project')}\` skill, then open by asking the human what they brought.`,
    'Do not explore the project first: orienting before you know the ask spends their wait on',
    'context you may not need. Once they have told you, read only what answering calls for.',
    // The jotted pile, offered rather than acted on: a plain New chat is not a
    // triage session, and the human may have opened it for something else
    // entirely. The Triage button's own launch briefs the work outright.
    ...(openNotes > 0
      ? ['', `This project has ${openNotes} open notes — offer to triage them.`]
      : []),
    '',
  ].join('\n')
}

interface CommandHook {
  type: 'command'
  command: string
  timeout: number
  /** Runs in the background and wakes Claude when it exits 2 (implies `async`). */
  async?: true
  asyncRewake?: true
}

/**
 * The orchestrator's message waiter hook's timeout, in seconds. An async hook
 * still gets the 10-minute default when none is set, and an orchestrator idles
 * far longer than that waiting on a burn — a waiter killed at ten minutes would
 * leave nothing listening until its next turn end. A day outlasts any wait.
 */
const MESSAGE_WAITER_TIMEOUT_S = 86_400

export interface SessionSettings {
  permissions: { allow: string[]; deny: string[] }
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
  'mcp__runcastle__record_finding',
  'mcp__runcastle__dry_run_drive',
  'mcp__runcastle__retry_drive',
  // The paged-context tools. `get_feature_context` no longer inlines every doc
  // — it inlines brief/map/decisions/spec and indexes the rest — so the reach
  // for a fourth doc is a tool call, and an un-allowed one stalls the session on
  // a permission prompt at exactly the moment it went looking for evidence.
  'mcp__runcastle__read_feature_doc',
  'mcp__runcastle__list_tickets',
  'mcp__runcastle__get_ticket',
  'mcp__runcastle__read_adr',
  // The project session's three (decision 19). Every session is launched with
  // the whole list: the MCP server gates each tool on the calling session's
  // kind, so a rule for a tool a feature session can only be refused is inert.
  'mcp__runcastle__create_feature',
  'mcp__runcastle__get_project_context',
  'mcp__runcastle__get_work_record',
  'mcp__runcastle__read_feature_brief',
  // The notes-triage tools, project-only for the same reason and so inert
  // elsewhere too. A triage chat is briefed at launch to list the open notes,
  // so an un-allowed `list_project_notes` stalls the session on a permission
  // prompt before triage says its first word.
  'mcp__runcastle__list_project_notes',
  'mcp__runcastle__triage_project_note',
  'mcp__runcastle__update_project_note',
  // Re-ordering parked drafts (ADR-0013) — project-only at the server, likewise.
  'mcp__runcastle__set_feature_dependencies',
  // The feature lead's round tools. "Run until ready" dispatches and declares
  // with nobody watching, and a headless wake (`claude -p --resume`) has no one
  // to answer a prompt at all — an un-allowed one stops the loop dead.
  'mcp__runcastle__dispatch_round',
  'mcp__runcastle__stop_round',
  'mcp__runcastle__declare_ready',
  'mcp__runcastle__wait_for_you',
]

/**
 * Benign git commands the session skills actually run, pre-approved so
 * `--permission-mode acceptEdits` sessions never stall on an interactive Bash
 * approval prompt (E2E finding: `git rev-parse` and doc commits during planning
 * sessions each sat waiting for a human). Rule syntax is the
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

/**
 * The `Read(...)` allow rule for the session's own skill pack — the plugin dir
 * passed as `--plugin-dir`, which lives OUTSIDE the session's working directory.
 * Without it a skill's `./references/*` read is a permission prompt, and in a
 * self-planning run (`-p`) nobody is there to answer it: one was refused
 * `feature/references/preview.md` and the starter page, and drew its preview by
 * hand. A prompt for runcastle's own files is wrong interactively too, so every
 * kind gets the rule — read-only and scoped to the pack, nothing wider.
 *
 * `//` anchors the pattern at the filesystem root (a single `/` anchors at the
 * settings file's own dir), and Windows paths are matched in POSIX form with the
 * drive as `/c` (code.claude.com/docs/en/permissions, "Read and Edit"). A pure
 * string conversion, so the Windows spelling is testable on any host.
 */
export function skillPackReadRule(packDir: string): string {
  const posix = packDir
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`)
    .replace(/\/+$/, '')
  return `Read(/${posix}/**)`
}

/** Kinds that run in the developer's OWN checkout rather than a talk worktree. */
const HOST_SIDE_KINDS: readonly SessionKind[] = ['prepare', 'drive-fix', 'scenario']

/**
 * The `Skill(...)` DENY rules a session of `kind` is launched with: every
 * session-entry skill in the pack that is not this kind's own (see
 * {@link entrySkillsFor} and the history on `ENTRY_SKILLS`). Rule syntax is the
 * documented skill-permission form (code.claude.com/docs/en/skills — "Allow or
 * deny specific skills with permission rules"): `Skill(name)` matches an exact
 * bare invocation, `Skill(name *)` the same skill invoked with arguments; both
 * are emitted so an argumented call cannot slip past the exact rule. The name is
 * the plugin-namespaced one (`runcastle:<skill>`), matching how Claude Code
 * resolves pack skills.
 *
 * This is the mechanical half of the same layering the edit guard uses: the
 * prompt states the policy in one line ({@link otherEntrySkillsRule}), settings
 * enforce it. `drive-fix` and an unknown kind deny all of them.
 */
export function entrySkillDenyRules(kind?: SessionKind): string[] {
  const allowed = new Set<string>(entrySkillsFor(kind))
  return ENTRY_SKILLS.filter((skill) => !allowed.has(skill)).flatMap((skill) => [
    `Skill(runcastle:${skill})`,
    `Skill(runcastle:${skill} *)`,
  ])
}

/**
 * The prompt half of {@link entrySkillDenyRules} — the one line of policy the
 * settings enforce, rendered into every prompt that names an entry skill. All
 * pack skills' descriptions are loaded into every session (that is what flipping
 * `disable-model-invocation` to false costs), so the line exists to make a
 * denied invocation a non-event rather than a surprise.
 */
function otherEntrySkillsRule(): string {
  return (
    "- The runcastle skill pack also carries other session kinds' entry skills; they are " +
    'denied to this session by settings. Your entry skill is the one named under "Your task".'
  )
}

/**
 * The git rules a session of `kind` is launched with (see the split above). A
 * scenario session in setup mode (`purpose`) may write the whole checkout — the
 * login route, the typecheck config — so its `git add` is not narrowed to
 * `.runcastle/`; its commit still prompts, like every host-side commit.
 */
export function sessionBashAllowRules(kind?: SessionKind, purpose?: SessionPurpose): readonly string[] {
  if (kind === 'project') return SESSION_BASH_READ_RULES
  if (kind === 'scenario' && purpose === 'scenario-setup') {
    return [...SESSION_BASH_READ_RULES, 'Bash(git add:*)']
  }
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
 *   (see {@link sessionBashAllowRules}); omitted, every rule is granted. With
 *   `skillPackDir` it also lets the session read its own skill pack
 *   ({@link skillPackReadRule}).
 * - `permissions.deny` blocks the pack entry skills that belong to OTHER session
 *   kinds ({@link entrySkillDenyRules}) — the enforcement behind flipping their
 *   `disable-model-invocation` frontmatter to false.
 * - `command` = `bun run "<abs hook-client.ts>" <route-event>` where the route
 *   event is the kebab-case `/api/hooks/:event` segment the client POSTs to.
 * - `SessionStart` is registered for EVERY source (see
 *   {@link SESSION_START_SOURCES}) — a resumed session is a started session.
 * - `UserPromptSubmit`/`Stop`/`SessionEnd` take NO `matcher` (unsupported →
 *   omitted). `Stop` fires when the agent finishes a turn: paired with
 *   `UserPromptSubmit` it is what tells the server whether a live session is
 *   working or waiting on its human, and it is registered for every kind
 *   because a turn ends the same way whatever the session was opened to do.
 * - `PreToolUse` matches the file-write and shell tools and carries the
 *   talk-session edit guard (see {@link evaluateEditGuard}) and the talk-worktree
 *   install guard (`evaluateInstallGuard`) — registered for every kind except
 *   `project`, the one allowed to write code. A kind is needed to make that
 *   distinction, so an omitted `kind` gets the guard: a session whose kind we do
 *   not know is not one to hand whole-repo write access to.
 * - Timeouts (seconds): SessionStart 20 (room for the hook client's retries — it
 *   records the conversation id a resume needs), UserPromptSubmit 5 (well inside its 30s
 *   hard budget), SessionEnd 10, Stop 5, PreToolUse 5 (it blocks every edit).
 * - An `orchestrate` session (`purpose`) also gets the message waiter on
 *   SessionStart and Stop: an `asyncRewake` hook running the hook client's
 *   `wait-messages` mode, which long-polls for the orchestrator's pending
 *   `[runcastle]` lines and exits 2 with them, waking Claude whether it is idle
 *   or mid-turn (`whole-cuts-plan-themselves` decision 20). A fresh waiter starts
 *   at every session start and turn end; the server answers only the newest.
 *   A feature's chat with a terminal — its lead — gets the same waiter for the
 *   lead's messages (`the-feature-lead-runs-rounds` decision 12); the server
 *   lets it go when a turn starts, so they arrive at the turn's end. A headless
 *   run gets none: its process exits at its turn end, taking a waiter's lines
 *   with it, so its messages wait for the next resume instead.
 *   Every other session's settings carry no trace of it.
 */
export function renderSettings(
  hookClient: string,
  kind?: SessionKind,
  skillPackDir?: string,
  purpose?: SessionPurpose,
  headless = false,
  cropsDir?: string,
): SessionSettings {
  const cmd = (event: string): CommandHook => ({
    type: 'command',
    command: `bun run "${hookClient}" ${event}`,
    timeout: event === 'session-start' ? 20 : event === 'session-end' ? 10 : 5,
  })
  const waiter: CommandHook[] =
    purpose === 'orchestrate' || (kind === 'chat' && !headless)
      ? [
          {
            type: 'command',
            command: `bun run "${hookClient}" ${WAIT_MESSAGES_MODE}`,
            timeout: MESSAGE_WAITER_TIMEOUT_S,
            async: true,
            asyncRewake: true,
          },
        ]
      : []
  return {
    permissions: {
      allow: [
        ...RUNCASTLE_MCP_ALLOW_RULES,
        ...sessionBashAllowRules(kind, purpose),
        ...(skillPackDir ? [skillPackReadRule(skillPackDir)] : []),
        // Select-area crops live under the data dir, outside the worktree; the
        // chat reads the path typed into it without a prompt.
        ...(cropsDir ? [skillPackReadRule(cropsDir)] : []),
      ],
      deny: entrySkillDenyRules(kind),
    },
    hooks: {
      SessionStart: SESSION_START_SOURCES.map((source) => ({
        matcher: source,
        hooks: [cmd('session-start'), ...waiter],
      })),
      UserPromptSubmit: [{ hooks: [cmd('user-prompt')] }],
      Stop: [{ hooks: [cmd('stop'), ...waiter] }],
      SessionEnd: [{ hooks: [cmd('session-end')] }],
      ...(kind === undefined || guardsEdits(kind)
        ? { PreToolUse: [{ matcher: PRE_TOOL_MATCHER, hooks: [cmd('pre-tool')] }] }
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
 * The section every interactive session's prompt ends with: brief the human
 * like a senior advisor joining partway through. Appended once, by
 * {@link renderSessionPrompt}, so every renderer — today's and any added later
 * — carries it without a per-renderer edit. Burn agents never talk to the
 * human, so the burner prompts do not get it.
 */
export function talkingToTheHumanSection(): string {
  return [
    '## How to talk to the human',
    "The human makes the decisions, but they don't have your context. Treat them as a senior advisor joining partway through. They haven't read the code or the docs you just read, and they may have forgotten what was settled weeks ago.",
    "- **Define the project's terms the first time you use them.** Any name from this project's code, docs or decisions (a module, a function, a table, a domain concept, a decision number) gets a short plain-words gloss in the same sentence. Define it again if it hasn't come up for a while. If the name adds nothing, describe the thing instead. Runcastle's own workflow words (burn, lap, drive, Go, gate, ticket, feature) are the human's own tool: don't explain them.",
    '- **Bring the context with the decision.** Before asking them to decide, say in a few sentences what the situation is, why it needs deciding now, the options that matter, what you recommend and why, and what it costs if that turns out wrong. They should be able to decide without opening a file.',
    '- **Give the conclusion, not the search.** Tell them what you found and the one fact it rests on, not the trail of reads that got you there.',
    '- **Condense.** Three sentences of context beat a page. They will ask if they want more.',
    '- **Play each decision back in one line**, so you both know what was settled.',
    '',
  ].join('\n')
}

/**
 * The whole briefing for one session, whichever of the five briefs it carries.
 *
 * A session that is not briefed from its feature row — a project-scoped one, or
 * the host-side drive fix and scenario chat — supplies its kind's brief instead.
 * Exactly one of the five is always present: a session with none would spawn a terminal with no
 * instructions at all.
 *
 * Exported because a runtime injects it differently: Claude Code appends the
 * file with `--append-system-prompt-file`, where Codex reads `AGENTS.md` out of
 * its home dir. Same prose, two destinations.
 */
export function renderSessionPrompt(input: WriteArtifactsInput): string {
  return `${renderBrief(input).trimEnd()}\n\n${talkingToTheHumanSection()}`
}

/** The kind-specific brief {@link renderSessionPrompt} carries, before its shared closing section. */
function renderBrief(input: WriteArtifactsInput): string {
  const {
    session,
    feature,
    prepare,
    projectBrief,
    driveFix,
    scenario,
    purpose,
    runtime,
  } = input
  if (driveFix) return renderDriveFixPrompt(driveFix)
  if (scenario) return renderScenarioPrompt(scenario)
  if (feature) {
    return renderSystemPrompt(feature, session.kind, purpose, runtime, session.headless)
  }
  if (prepare) return renderPreparePrompt(prepare)
  if (projectBrief) return renderProjectPrompt(projectBrief, runtime)
  throw new Error(`session ${session.id} has no feature and no project-session brief`)
}

/** `pluginDir` is the pack the session is launched with, made readable in its settings. */
export async function writeSessionArtifacts(
  input: WriteArtifactsInput,
  pluginDir: string = resolvePluginDir(),
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
    JSON.stringify(
      renderSettings(
        hookClientPath(),
        session.kind,
        pluginDir,
        session.purpose,
        session.headless,
        session.kind === 'chat' && session.featureId ? designCropsDir(session.featureId) : undefined,
      ),
      null,
      2,
    ),
    'utf8',
  )
  writeFileSync(mcpConfigPath, JSON.stringify(renderMcpConfig(session, config), null, 2), 'utf8')

  return { systemPromptPath, settingsPath, mcpConfigPath }
}
