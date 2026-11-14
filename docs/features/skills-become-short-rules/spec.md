# Skills become short rules

## Problem

The human runs features through two agents: the feature lead and the project's orchestrator.
Both start with long instructions (about 8K tokens for a lead, 12–16K for an orchestrator), and
about half of it is step-by-step procedure for one situation or another, with about 15% written
as a patch after one incident. The same rule appears in several places and the copies have drifted
into contradiction: the lead's briefing says "one round at a time" while its skill says there are
no rounds. The rules that matter most (when to ask versus decide, plain words, stepping back when
stuck) are buried, and plans have grown huge (20 decisions for five sentences of intent). The human
wants agents that apply a short set of rules with judgement.

## Approach

**What the human gets.** Both agents run on a short numbered list of rules they can read in a
minute: 11 for the lead, 12 for the orchestrator (drafts in `preview.html`, settled by the human's
yes there; workers write each skill from its list and the human reads the final text at review,
decision 12). Plans hold only the decisions the
human made or must make; build detail goes to the spec (decision 8). Any agent that fails twice at
the same problem changes its approach, and after a third failure stops and asks (decision 7).

**Shape.**

- **Entry skills.** `feature/SKILL.md` and `project/SKILL.md` become: one opening line saying who
  the agent is, the numbered rules (one or two sentences each), and a short "Pages" list naming each
  reference page and when to read it. No situation sections, no "Do NOT" list, no tool sections.
  Targets: about 5K bytes for the lead, about 6K for the orchestrator.
- **Reference pages are formats, not procedures**, each under 6K:
  - lead: the Plan page (`preview.md` with its starter), design mode (`design.md`), the shapes of
    `decisions.md` and `spec.md` (one page, merging `grilling.md`'s record format and `spec.md`),
    planning alone (one page, decision 9). `workers.md` and `checking-your-work.md` fold into the
    rules and the worker tools' descriptions.
  - orchestrator: project preparation (one page from `preparation.md` and its recipes: the eight
    settings and their evidence, the drive script rules, the sandbox Dockerfile rule, the dry run,
    asking before starting services), the charter's format. `intake.md` keeps only the brief's
    shape (a few lines, inside the rules or a small page); `routing.md`, `health-sweeps.md` and
    `triage.md` fold into rules and the tools' descriptions.
- **Nothing the human relies on silently disappears.** Each behaviour today's skills describe either
  maps to a rule, moves to a tool description, or is listed as dropped in the worker's handback, so
  the human can check it at review. Known mappings: portfolio-first consult → orchestrator rule
  "look before you advise"; shape-grill before cutting → "never guess what, where or who"; runaway
  guard and stuck section → "two tries, then three" rule; review at the end → lead rule 8.
- **Briefings** (`renderSystemPrompt`, `renderProjectPrompt`, `talkingToTheHumanSection` in the
  launcher's artifacts) shrink to session facts: feature or project, branch, docs folder, whether a
  human is present (headless runs keep the "one turn, never end on a question without
  `wait_for_you`" fact), and the skill to open first. Every round, ticket, owner and waiting-kind line
  goes (decision 1). Rules copied from the skills go (decision 3).
- **Tool contracts** move into the MCP tool descriptions (decision 4). Starting list, from the
  survey: `get_feature_context` (call first and after compaction; read what is not inlined; drop
  "rounds" and "ticket rows" from its text), `start_worker` (model from `annotatedModels`; queueing;
  Docker refusal), `start_review`, `land_worker`, `send_back_worker`, `drop_worker`, `declare_ready`
  (relay warnings), `start_design_server`, `show_design`, `show_file` (words before it fold away),
  `show_panel`, `notify_human`; orchestrator: `send_to_feature` (clears Stop; autopilot only),
  `merge_feature`, `show_plan`/`show_design`/`show_review_package` with `slug`, `stop_feature_run`
  (only ends a headless planning run), `dry_run_drive`, `record_finding`, `triage_project_note`. Each
  description stays short: what it does, when it refuses, what it returns.
- **Shared rules** (never guess what, where or who; plain words; one question at a time) appear once
  in each session's context. Two skills each carrying their own copy is fine; a briefing repeating
  its skill is not.
- **Tests.** `never-guess.test.ts`'s identity check and the phrase pins in `feature-skill.test.ts` and
  `orchestrator-skill.test.ts` go. Kept: frontmatter and skill-deny checks, the preview starter's
  inline checks, and the briefing tests that assert session facts. Added: a size budget per entry
  skill and per reference page (decision 10).
- **Measuring** (decision 11): a script under `scripts/` that, for each session kind, sums the
  briefing, the entry skill and the descriptions of that kind's tools, and prints bytes and
  estimated tokens (bytes ÷ 4). Run on main before work and on the branch before ready; both tables
  go in the outcome. Before ready, a subagent plans the "Agents test like owners" brief by the new
  lead skill; its decision count and plan size are compared with the original's 20 decisions.

**Order of work.** The lead writes the measuring script and records main's numbers. The two "on its
own" skill workers run in parallel, each owning only its skill folder and reporting which contracts
it removed and which behaviours it dropped. Then one "on its own" worker does briefings, tool
descriptions and tests from those reports. Then the replay, the project's checks, and the Review
worker.

## Seams

- **The entry skill files** (existing): readable and sized; the size-budget test observes them.
- **Each session kind's briefing** (existing: the launcher's prompt renderers, tested in
  `launch-artifacts.test.ts`): observe that it carries session facts and the skill to open, and no
  round or ticket wording.
- **The MCP tool list per audience** (existing: `toolsForAudience`): observe each tool's description
  text; the measuring script reads it here.
- **The measuring script** (new): one command, one table per session kind.

## Out of scope

- Worker, review, Q&A and code-review prompts (decision 2).
- Any machinery change: waits, autopilot, ownership, tool refusals. Those belong to the features that
  already merged.
- The charter (`CONTEXT.md`); its "Rules, not procedures" principle already exists, and the
  orchestrator has already brought locked decisions 9 and 18 in line with autopilot (ADR-0022).

## Open questions

- Whether the rule counts hold once written; a worker may land at 10 or 13 if the agreed
  list writes that way, and says so in its handback.
- Whether a real run after publish shows agents asking too much or too little; the fix is to sharpen
  a rule, not add one.
