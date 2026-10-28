import type { AgentRuntime, SessionKind } from '@runcastle/core'

/**
 * How each runtime NAMES the runcastle skill pack — the one piece of the
 * briefing that cannot be runtime-neutral.
 *
 * The pack itself is a single content source (`packages/skills/packs/runcastle`)
 * rendered into whatever format the runtime discovers, but the *invocation* is
 * spelled by the CLI: Claude Code opens a plugin skill as `/runcastle:feature`,
 * where Codex discovers `.agents/skills/<name>/SKILL.md` and opens it as
 * `$feature`. Both the injected system prompts (`artifacts.ts`) and the kickoff
 * lines typed into a fresh terminal have to say it the session's way — a Codex
 * session told to invoke `/runcastle:feature` simply does nothing.
 */

/** The Claude Code plugin pack these skills ship as. */
const PACK = 'runcastle'

const SPELLINGS: Record<AgentRuntime, (skill: string) => string> = {
  'claude-code': (skill) => `/${PACK}:${skill}`,
  codex: (skill) => `$${skill}`,
}

/** How a session on `runtime` invokes the pack's `skill` (`/runcastle:qa`, `$qa`). */
export function skillRef(runtime: AgentRuntime, skill: string): string {
  return SPELLINGS[runtime](skill)
}

/**
 * Every SESSION-ENTRY skill in the pack — the ones whose whole procedure belongs
 * to one session kind. The reached skill (`code-review`) is deliberately not
 * here: any session may reach it.
 *
 * These used to carry `disable-model-invocation: true` so no session could pick
 * up another kind's procedure by description-matching. Claude Code now hard-blocks
 * the Skill tool for such a skill even when the kickoff names it explicitly —
 * which broke every launch, since the kickoff lines are prose ("invoke the
 * /runcastle:project skill…"), not user-typed slash commands. So the flags are
 * `false` and the cross-kind prohibition moved to per-session settings: each
 * session is launched with `Skill(runcastle:<x>)` DENY rules for every entry
 * skill that is not its own ({@link entrySkillsFor} → `entrySkillDenyRules` in
 * artifacts.ts).
 */
export const ENTRY_SKILLS = ['feature', 'qa', 'project', 'prepare'] as const
export type EntrySkill = (typeof ENTRY_SKILLS)[number]

/**
 * The entry skill(s) a session of `kind` may open — everything else in
 * {@link ENTRY_SKILLS} is denied to it.
 *
 * - `chat` gets `feature`: every feature chat is the feature's lead from its
 *   first message (tickets-and-review-are-tools-not-phases decision 4).
 * - `qa` is allowed nowhere: no live kind opens on it (the qa session kind was
 *   retired with one-chat-per-feature), which matches its pre-flip reachability
 *   of exactly zero.
 * - `drive-fix` and `scenario` have no entry skill at all — their whole briefing
 *   is the prompt.
 * - An UNKNOWN kind gets none, for the edit-guard's reason: a session whose kind
 *   we do not know is not one to hand another kind's procedure to.
 */
export function entrySkillsFor(kind?: SessionKind): readonly EntrySkill[] {
  switch (kind) {
    case 'chat':
      return ['feature']
    case 'prepare':
      return ['prepare']
    case 'project':
      return ['project']
    case 'drive-fix':
    case 'scenario':
    case 'side':
    case undefined:
      return []
  }
}

/**
 * A side session's opening (several-sessions-per-feature decisions 3 and 15):
 * what it is, its one limit, the shared folder, and to wait for the human. No
 * skill — the role is the whole briefing, and the side session's first move is
 * the human's ask. The fixed first sentence is what `promptMatchesKickoff`
 * recognises, so it must stay ahead of anything feature-specific.
 *
 * `held` is the form that rides ahead of the human's first message in one
 * prompt (decision 12): the ask is already there, so there is nothing to wait for.
 */
export function sideKickoffFor(held = false): string {
  return (
    'Proceed as a side session: you are a side session of this feature, opened beside its main ' +
    'chat, and you do not carry on the main chat\'s task. You may do anything the main chat does — ' +
    'read, write the spec and decisions, emit and edit tickets, resolve findings, park drafts, ' +
    'edit code — except run rounds: the main chat alone dispatches, stops and declares ready. ' +
    'The folder is shared with the main chat, so stage only your own files (`git add <paths>`, ' +
    `never \`-A\`).${held ? '' : " Wait for the human's ask."}`
  )
}

/** The pack's one skill for a feature's chat — its lead from the first message. */
export const FEATURE_SKILL = 'feature'

/**
 * The chat's opening move, spelled for `runtime`. One line for every feature
 * chat, whatever the feature's state: every chat on a feature is its lead from
 * its first message, with one brief and one skill
 * (tickets-and-review-are-tools-not-phases decision 4).
 */
export function chatKickoffFor(runtime: AgentRuntime): string {
  return `Proceed with your task: invoke ${skillRef(runtime, FEATURE_SKILL)} and continue this feature.`
}

/**
 * The feature skill's reference file for a session with nobody to answer it
 * (`features-plan-themselves`). Named verbatim by both halves of a
 * self-planning briefing, so the file and the pointer to it agree.
 */
export const PLANNING_ALONE = 'references/planning-alone.md'

/**
 * The heading of the project skill's section for the orchestrator
 * (`whole-cuts-plan-themselves`), read only when the project's Orchestrator
 * setting is on. Named verbatim by the orchestrating briefing, so the skill's
 * heading and the pointer to it agree.
 */
export const ORCHESTRATING = 'Orchestrating'

/**
 * The opening of a self-planning run's prompt, spelled for `runtime` — the
 * `self-plan` counterpart of {@link chatKickoffFor}. A headless run has no human
 * on the other end, so the line says so before anything else, plans (designing
 * the screens it adds or reshapes, designs-wait-for-you) without building, and
 * ends by asking for the human's yes.
 */
export function selfPlanKickoffFor(runtime: AgentRuntime): string {
  return (
    'Proceed with your task: no human is present and nobody will reply to you. Invoke ' +
    `${skillRef(runtime, FEATURE_SKILL)} and follow its \`${PLANNING_ALONE}\` to plan this feature ` +
    'by yourself in this one run: plan it, design its screens where it adds or reshapes them, ' +
    "do not build it, and end by asking for the human's yes."
  )
}

/**
 * The per-kind kickoff line typed into a freshly-live session so no session
 * starts dead. Each line names the same opening skill its appended system prompt
 * does (`renderSystemPrompt` in artifacts.ts) so the injected line and the brief
 * agree on the first move. A per-purpose briefing (relay, conflict) arrives as
 * `launchSession`'s own `kickoffLine`, not from this table.
 *
 * Built per runtime rather than written out once, because the only thing that
 * differs between two runtimes' tables is {@link skillRef}. Reached through each
 * adapter's `kickoffLine`, never indexed directly by the launcher.
 */
export function kickoffLinesFor(runtime: AgentRuntime): Record<SessionKind, string> {
  const skill = (name: string): string => skillRef(runtime, name)
  return {
    // A chat launched through `launchSession` gets this line followed by the
    // feature's state (`chatKickoffHeader`).
    chat: chatKickoffFor(runtime),
    // The method moved out of the prompt and into a skill, so this names it like
    // every other entry line does. The rest of the line is the opening MOVE — a
    // headless run already measured what it could, so the useful first thing is
    // naming the gap, not re-deriving the repo.
    prepare:
      `Proceed with your task: invoke the ${skill('prepare')} skill and work through the ` +
      'unestablished preparation fields with the human. Start by telling them which fields are ' +
      'still open and what you need from them for each; ask before running anything that touches ' +
      'their database or services.',
    project: `Proceed with your task: invoke the ${skill('project')} skill and drive the project session.`,
    // No skill either: the failure, the drive's own environment and the branch
    // delta all arrive as the appended system prompt (renderDriveFixPrompt), so
    // the line only has to point at the first move — read the failure, do not
    // start repairing anything before saying what you are about to do.
    'drive-fix':
      'Proceed with your task: the drive whose setup just failed is in your system prompt. Read ' +
      'the failure, work out what the environment is missing, and tell me what you propose to ' +
      'change before you change it; then fix it and retry the drive with retry_drive.',
    // No skill: the drive, the runner, the existing scenarios and the human's
    // ask (or the failed scenario) all ride the appended system prompt
    // (renderScenarioPrompt), so the line only points at the first move.
    scenario:
      'Proceed with your task: the drive you are writing a scenario for is in your system prompt. ' +
      'If it carries no description or failure, first ask me what state I want to land in; ' +
      'otherwise write (or fix) the scenario, commit it, and land me with run_scenario.',
    // No skill: the side role is the briefing (see sideKickoffFor); the launcher
    // composes it with the feature state (`sideKickoff`).
    side: sideKickoffFor(),
  }
}

/**
 * The kickoff for a project session opened from the Notes card's Triage button.
 *
 * An EXPLICIT briefing, which per ADR-0009 #4 is why such a launch is always
 * fresh: it is this session's opening move, not a nudge to carry on. It names
 * the tool rather than the note texts — the pile changes the moment a note is
 * jotted mid-chat, so the session reads it live (decisions.md #6).
 */
export function projectTriageKickoffFor(runtime: AgentRuntime): string {
  return (
    `Proceed with your task: invoke the ${skillRef(runtime, 'project')} skill and triage this ` +
    "project's open notes (list them with list_project_notes)."
  )
}

/**
 * The prepare kickoff for a project with NOTHING left to establish.
 *
 * The 0-keys path used to give the session four instructions, three of which
 * were to work an empty list: the prompt rendered "_Nothing is unset… say so and
 * **stop**_" while its task line still said to tell the human which fields were
 * open and its closing move still ordered a dry-run drive — and this line, typed
 * into the terminal ahead of all of it, said "Start by telling them which fields
 * are still open". All four now say confirm-and-stop. Spelled per runtime for
 * the same reason the table above is.
 */
export function prepareConfirmKickoffFor(runtime: AgentRuntime): string {
  return (
    `Proceed with your task: invoke the ${skillRef(runtime, 'prepare')} skill. Every prepared field already ` +
    'has a value, so this is a confirmation, not a preparation — tell me what is recorded and ' +
    'how stale it is, ask whether it still holds, and stop. Do not re-derive a settled value.'
  )
}
