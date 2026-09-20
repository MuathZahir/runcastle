import type { AgentRuntime, SessionKind } from '@runcastle/core'

/**
 * How each runtime NAMES the runcastle skill pack — the one piece of the
 * briefing that cannot be runtime-neutral.
 *
 * The pack itself is a single content source (`packages/skills/packs/runcastle`)
 * rendered into whatever format the runtime discovers, but the *invocation* is
 * spelled by the CLI: Claude Code opens a plugin skill as `/runcastle:ideate`,
 * where Codex discovers `.agents/skills/<name>/SKILL.md` and opens it as
 * `$ideate`. Both the injected system prompts (`artifacts.ts`) and the kickoff
 * lines typed into a fresh terminal have to say it the session's way — a Codex
 * session told to invoke `/runcastle:ideate` simply does nothing.
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
 * to one session kind. The chained/reached skills (`spec`, `tickets`,
 * `code-review`) are deliberately not here: any session may reach them.
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
export const ENTRY_SKILLS = [
  'ideate',
  'qa',
  'converge',
  'revisit',
  'waypoint',
  'project',
  'prepare',
] as const
export type EntrySkill = (typeof ENTRY_SKILLS)[number]

/**
 * The entry skill(s) a session of `kind` may open — everything else in
 * {@link ENTRY_SKILLS} is denied to it.
 *
 * - `chat` gets both of its openings (see {@link chatKickoffFor}): the one
 *   conversation persists across feature states, so a chat that opened on
 *   `ideate` can legitimately be resumed into `revisit` territory.
 * - `qa` is allowed nowhere: no live kind opens on it (the qa session kind was
 *   retired with one-chat-per-feature), which matches its pre-flip reachability
 *   of exactly zero.
 * - `drive-fix` has no entry skill at all — its whole briefing is the prompt.
 * - An UNKNOWN kind gets none, for the edit-guard's reason: a session whose kind
 *   we do not know is not one to hand another kind's procedure to.
 */
export function entrySkillsFor(kind?: SessionKind): readonly EntrySkill[] {
  switch (kind) {
    case 'chat':
      return ['ideate', 'revisit']
    case 'waypoint':
      return ['waypoint']
    case 'converge':
      return ['converge']
    case 'prepare':
      return ['prepare']
    case 'project':
      return ['project']
    case 'drive-fix':
    case undefined:
      return []
  }
}

/** Which skill the feature's one chat opens on — see `chatOpening` in artifacts.ts. */
export type ChatOpening = 'ideate' | 'revisit'

/**
 * The chat's opening move, spelled for `runtime`.
 *
 * The one chat has TWO of them, because one kind now covers the whole feature: a
 * feature that has not produced a decision, a spec or a ticket yet opens on
 * `ideate` — the grilling that creates them — and every other state opens on
 * `revisit`, amending a record that exists. Which one is a question about the
 * feature's artifacts, so only a caller holding the feature can answer it; the
 * per-kind table below can hold just one line and holds the revisit form, while
 * the launcher composes the real line (`chatKickoffHeader`) with the opening the
 * artifacts call for and the system prompt names.
 */
export function chatKickoffFor(runtime: AgentRuntime, opening: ChatOpening): string {
  return opening === 'ideate'
    ? `Proceed with your task: invoke the ${skillRef(runtime, 'ideate')} skill and drive this ` +
        "feature's ideation to completion."
    : `Proceed with your task: invoke the ${skillRef(runtime, 'revisit')} skill and continue this ` +
        "feature's conversation."
}

/**
 * The per-kind kickoff line typed into a freshly-live session so no session
 * starts dead. Each line names the same opening skill its appended system prompt
 * does (`renderSystemPrompt` in artifacts.ts) so the injected line and the brief
 * agree on the first move. A per-purpose revisit briefing arrives as
 * `launchSession`'s own `kickoffLine`, not from this table.
 *
 * Built per runtime rather than written out once, because the only thing that
 * differs between two runtimes' tables is {@link skillRef}. Reached through each
 * adapter's `kickoffLine`, never indexed directly by the launcher.
 */
export function kickoffLinesFor(runtime: AgentRuntime): Record<SessionKind, string> {
  const skill = (name: string): string => skillRef(runtime, name)
  return {
    // State-unknown default: a chat launched through `launchSession` gets the
    // composed line instead, which picks between this feature's two openings.
    chat: chatKickoffFor(runtime, 'revisit'),
    waypoint:
      `Proceed with your task: invoke the ${skill('waypoint')} skill and work your assigned ` +
      'waypoint to a resolution.',
    converge:
      `Proceed with your task: invoke ${skill('converge')} and drive spec then tickets ` +
      'from map.md + decisions.md, per your system prompt.',
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
  }
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
