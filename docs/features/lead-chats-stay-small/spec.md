# Lead chats stay small

## Problem

A feature lead's chat only ever grows. Nothing compacts it, so a lead that planned, built and
fixed a feature carries every file it read, every screenshot it looked at and every test run
into each later call, often at 300–700k tokens. When the human comes back after an hour or
more, the whole context is written to the prompt cache again (76 such cold resumes cost 42% of
all cache-write spend in two weeks). And the lead does its own reading, surveying and
screenshot loops in that big window, because the skill tells it to build things itself and
never mentions its own subagents. The human pays for all of it and gets nothing more for it.

## Approach

**What the human sees.** Nothing new to do. A lead that has gone quiet compacts itself, and the
chat shows the existing "Chat compacted" divider with a short reason ("after planning", "while
idle", "before resuming", "long turn") and the size before and after when known. The lead picks
up the conversation as before; what it was waiting on, the human's latest words and its
uncommitted work survive the summary, and the docs hold everything settled. The manual
"Compact now" button in the context meter stays as it is.

**When runcastle compacts** (feature leads only, decision 9; context above 150k, decision 6):

- *After planning* — when a self-planning run ends (the place the thread lifecycle clears the
  self-planning purpose and sets the waiting state). Skipped once the feature has shipped.
- *While idle* — when the thread host is about to stop an idle lead process (the idle-stop
  timer, 30 minutes today), it compacts first and stops after. Skipped once shipped.
- *Before resuming* — when a turn is about to run and the last logged activity is more than
  55 minutes old (the safety net for a process stopped any other way, a server restart
  included). This one still runs after merge.
- *Inside a long turn* — Claude Code's own auto-compact window is set to 200k for feature leads
  (the `CLAUDE_CODE_AUTO_COMPACT_WINDOW` env var in the Claude runtime's launch env, which
  outranks settings files). Codex leads get Codex's own auto-compact token limit set to the same
  value when the Codex ACP runtime honours it; if it does not, say so and leave Codex alone.

A round coming back and a ready declaration get no trigger of their own (decision 7).

**How it compacts.** Through the existing compaction path on the agent host (the method behind
the "Compact now" button, which sends the runtime's `/compact` as a hidden prompt through the
normal turn queue). The automatic one passes keep-instructions on Claude Code (decision 10):
keep what the lead is waiting on, the human's latest words and anything agreed but not yet
written down, the work in progress and its uncommitted files, and note that
`docs/features/<slug>/` holds every settled decision. Codex compacts plainly.

After any compaction the lead re-reads its feature state before acting (decision 15): on
Claude Code the session-start hook, which runs again when a compacted session restarts, says
so in its added context; the keep-instructions say it too, and the skill says it for every
runtime.

The compaction must be invisible to the feature's state (decision 14): its turn end raises no
"needs you" notification, no orchestrator news, does not run the self-plan-ending logic again,
and leaves the waiting reason and status untouched. It never starts while a turn, a question or
a queued prompt is pending; a message the human sends during one waits in the queue (decision
13). The compaction records its trigger so the chat's divider can name it; the runtime's own
mid-turn auto-compact shows as "long turn".

Thresholds live beside the host's other timing constants, each overridable by an env var in the
same way as the resume caps, with `0` turning that trigger off for the install. The stale
comment above the launcher's re-entry cap ("there is no compaction … anywhere in runcastle")
is corrected.

**What the lead is told** (the feature skill; decisions 1–4 and 12). Edits stay inside the
delegation guidance, the "Build it the cheapest good way" section, the planning-alone survey and
screenshot steps, and one paragraph of the grilling reference, because "tools and skills say
less" edits the same files:

- Prefer your own subagents (not runcastle workers) for work whose output is larger than its
  conclusion: surveys and reading across several files return a short map; screenshot critique
  loops return a verdict and the final picture's path, which you still show the human.
- In a self-planning run, the codebase survey is one Explore-type subagent that returns a short
  map; the challenger stays as it is.
- Name a model for every subagent: Sonnet (on Codex, its smaller model) for read-only and
  critique work; your own model only where judgement needs it.
- You may still write code. A self-contained chunk goes to a general-purpose subagent with a
  short brief; you read its actual diff where it matters and run the checks yourself. A few
  edits you make yourself: read the file with Read, change it with Edit, no patch scripts in
  /tmp, no long heredocs.
- Grilling: a one-line swap of "Never compact. Never `/clear`." for: runcastle compacts you at
  quiet moments; never compact yourself; record each decision on disk the moment it settles.
- Orient: after a compaction, call `get_feature_context` before anything else.

## Seams

- **Agent host turn path** (existing): a host built with a fake runtime and short timers lets a
  test observe that an idle lead above the threshold receives a hidden compact prompt before its
  process stops, that a stale-gap turn is preceded by one, that below the threshold, for a
  non-feature thread, or with a pending turn nothing is sent, and that a human prompt sent during
  a compaction runs after it. Existing tests: agent host, session lifecycle.
- **Thread lifecycle** (existing): the self-plan-ending path compacts once and a compaction's own
  turn end does not change waiting state, notify, or re-run self-plan ending. Existing tests:
  self-plan launch, session lifecycle, lead delivery.
- **Runtime launch env** (existing): the Claude runtime's launch env for a feature lead carries
  the 200k auto-compact window, and a non-lead's does not. Existing test: launch artifacts.
- **Thread event fold** (existing): a `compacted` event carries its trigger and sizes, and the
  folded view exposes them. Existing tests: thread ACP map, thread usage.
- **Chat divider** (existing component): renders the reason and sizes; a compaction with no
  trigger (manual, or older logs) renders as today. Existing web test: thread column.
- **Skill text** (existing phrase-level skill test): the new delegation lines are present and
  "Never compact" is gone.

## Out of scope

- Runcastle workers and handbacks (`workers-prototype…`, `interactive-workers`): this uses the
  agent's own subagents.
- Compaction of burns → `cheaper-burns`. Orchestrator chat size and what wakes a lead →
  `agents-are-woken-only-when-it-matters` (it also edits the round-return wake message; this
  feature does not touch it).
- Slimming runcastle's tool results and trimming the skills → `tools-and-skills-say-less`.
- Compacting orchestrator, Q&A, prepare and project sessions.
- The launcher's re-entry cap for terminal sessions, beyond correcting its comment.
- A per-chat off switch; the install-wide env vars are the only off switch.

## Open questions

- Whether the Codex ACP runtime reads Codex's auto-compact token limit from the config runcastle
  writes; settled while building.
- Whether 150k is the right floor once real compactions are measured; the env var lets it move
  without a release. A re-run of the token analysis two weeks after merge would tell.
