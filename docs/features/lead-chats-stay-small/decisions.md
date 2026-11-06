# Decisions — Lead chats stay small

Planned without the human (self-planning run, 2026-11-06). Every decision below is the
lead's own recommendation, marked **Assumed.** until the human confirms it.

Check first: 5, 6, 8, 16

## 1. The lead hands reading, surveys and screenshot loops to its own subagents
**Decision:** The feature skill tells the lead to prefer its own subagents (Claude Code's Agent tool, Codex's `spawn_agent`) for work whose output is bigger than its conclusion: code surveys, reading across several files, and screenshot critique loops. The subagent returns a short map, a verdict, or a picture path, and the lead keeps only that. The lead still shows the human the final picture (`show_file`, or `show_design`'s picture), so moving the loop out of the lead hides nothing from them. Small edits the lead still makes itself.
**Why:** Reading code (~430M tokens), browser and screenshots (~220M) and tests (~73M) were done by the lead at huge context and then carried for every later call. A subagent pays for the reading once, in a small window.
**Assumed.** Alternative: leave the skill's "build it yourself" wording and rely on compaction alone.

## 2. Writing code yourself stays allowed
**Decision:** The skill prefers delegating but does not forbid the lead writing code. A self-contained chunk (a module with its tests, a component) goes to a general-purpose subagent with a short brief; the lead then reads the actual diff of anything non-trivial and runs the project's checks itself, rather than trusting the subagent's summary. A change of a few edits the lead makes itself, with the Edit tool.
**Why:** The human said on 2026-11-06 that the lead may still write code when handing it off isn't worth it. These are the agent's own subagents, not runcastle workers: no container, no ticket.
**Assumed.** Alternative: the lead writes all code itself and delegates only reading.

## 3. Read-only subagents name a cheaper model
**Decision:** The skill tells the lead to name a model for every subagent it spawns: Sonnet for surveys, mapping and screenshot critique (on Codex, its smaller model); the lead's own model only for work that needs it (UI judgement, tricky code).
**Why:** 58 of 113 subagents ran on Opus only because no model was set. Haiku was weighed and rejected for surveys: a missed fact in a map costs more than the saving.
**Assumed.** Alternative: Haiku for read-only mapping.

## 4. Edits go through the Edit tool, files are read with Read
**Decision:** The skill tells the lead to read files it will change with the Read tool and change them with Edit, never with Python patch scripts in /tmp or long heredocs.
**Why:** 157 scratch patch scripts and 43 failed heredocs, most likely because reading with `sed -n` leaves Edit's read-first rule unmet.
**Assumed.** Alternative: say nothing and let compaction cap the cost.

## 5. Compaction keeps the same conversation
**Decision:** Runcastle compacts the lead's existing conversation through the path the context meter's "Compact now" button already uses (runcastle sends the runtime's `/compact` command as a hidden prompt). It does not start a fresh lead thread seeded from the docs.
**Why:** That path already works on both runtimes, and the chat already shows a "Chat compacted" divider for it. A fresh thread would lose what is not yet in the docs (what the lead is waiting on, an agreement still being worded) and would split the chat the human scrolls.
**Assumed.** Alternative: start a fresh lead thread seeded from the feature's docs ("the docs are the artifact").

## 6. Runcastle compacts a lead at three moments, only above 150k
**Decision:** A feature lead whose context is above 150k tokens is compacted (a) right after its self-planning run ends, (b) when it has sat idle long enough that runcastle is about to stop its process (today 30 minutes), before stopping it, and (c) before a turn that starts after a gap of more than 55 minutes, if (b) did not already run. Below 150k nothing happens.
**Why:** (a) and (b) run while the prompt cache is still warm, so the compaction itself is cheap, and the next turn, often hours later, rebuilds ~70k instead of 400–700k. (c) is the safety net for a process that stopped another way (a server restart): it pays one cold read but stops the carry. 150k is the brief's line; below it a summary saves too little to pay for itself.
**Assumed.** Alternative: compact only before a cold turn (c), never while idle.

## 7. A round coming back and a ready declaration get no trigger of their own
**Decision:** The brief's other natural breaks, a round coming back and the lead declaring ready, are covered by the idle rule in 6(b): a round or a drive takes longer than the 30-minute idle stop, so the lead is already compacted when the round's wake or the human's notes arrive.
**Why:** One rule instead of three hooks, and no compaction lands while the lead is about to act on fresh results.
**Assumed.** Alternative: compact explicitly when a round is dispatched or when the lead declares ready.
**Challenged:** A round shorter than 30 minutes comes back to an uncompacted 300k+ lead; add a trigger at dispatch unless the 200k ceiling applies. (It does apply: leads run on 1M models with the ceiling from 8, so a lead never carries much past 200k into a short round.)

## 8. A 200k ceiling inside long turns, for Claude Code leads
**Decision:** Feature leads on Claude Code run with Claude Code's own auto-compact window set to 200k tokens, so a long build turn compacts itself instead of running to 400–700k. Codex leads get the same ceiling through Codex's own auto-compact limit, where the Codex runtime honours it.
**Why:** 22 sessions peaked above 400k; a replay of real calls says compacting at 200k saves ~600M tokens over two weeks against ~400M at 300k. It bites because leads run on 1M-context models: 270 of the ~350 feature chats on record picked a `[1m]` model. Decisions are written to disk as they settle, so a mid-turn summary loses little.
**Assumed.** Alternative: 300k, which keeps more working detail in a long turn and saves about a third less.

## 9. Only feature leads; after merge, only before a resume
**Decision:** Automatic compaction applies to feature leads only. Once the feature has shipped, the after-planning and idle compactions stop, and only the before-resuming one (6c) still runs, when someone reopens the lead. Orchestrator chats, Q&A, prepare and project sessions keep today's behaviour.
**Why:** The brief scopes this to feature chats (1.3B of ~1.85B chat tokens); orchestrator size belongs to "agents are woken only when it matters" and burns to "cheaper burns". A shipped lead is rarely resumed, so compacting it while idle is spend for nothing, but the rare resume (f750479c wrote 490k for a 6-call merge) is exactly the cost this feature removes.
**Assumed.** Alternative: every long-lived chat kind.

## 10. The compaction is told what to keep
**Decision:** Runcastle's automatic compaction asks Claude Code to keep what the lead is waiting on, the human's latest words and anything agreed but not yet written down, the work in progress and its uncommitted files, and to say that the feature's docs hold the rest. Codex takes no instructions and compacts plainly.
**Why:** The old worry about compaction was that it "silently drops exactly the decision prose". Decisions now go to `decisions.md` as they settle, and these instructions cover what is not on disk yet.
**Assumed.** Alternative: a plain `/compact` with no instructions.

## 11. The human sees each automatic compaction
**Decision:** The chat's existing "Chat compacted" divider says when runcastle compacted on its own and why ("after planning", "while idle", "before resuming", "long turn"), with the size before and after when known. No other screen changes.
**Why:** If the lead forgets something after a compaction, the human should be able to see that one happened and when.
**Assumed.** Alternative: compact silently.

## 12. The skill stops saying "never compact"
**Decision:** The feature skill's grilling guidance drops "Never compact. Never `/clear`." It says instead that runcastle compacts the lead at quiet moments, the lead never compacts itself, and everything settled must be on disk at once, which is why decisions are recorded one at a time.
**Why:** The old rule contradicts this feature; the reason behind it (keep decisions safe) survives as "write them down now".
The edit is a one-line swap in the grilling reference, the only skill edit outside the delegation guidance and the "build it the cheapest good way" section, and the orchestrator is told so because "tools and skills say less" edits the same files.
**Assumed.** Alternative: keep the rule for grilling only and compact only outside it.
**Challenged:** The brief limits this feature's skill edits to the delegation guidance and the build-it-yourself section so the sibling feature rebases cleanly; the grilling section is outside that. (The rule flatly contradicts this feature, so it has to go; one paragraph is a trivial conflict to resolve.)
**Changed by the orchestrator:** the grilling edit is a one-line swap of the "never compact" sentence, nothing more, because "tools and skills say less" trims the same reference files in parallel.

## 13. A message sent during a compaction waits for it
**Decision:** While runcastle compacts a lead, the chat shows the lead working, and a message the human sends waits in the lead's queue and runs once the compaction finishes. Runcastle never starts a compaction while a turn, a question or a queued message is pending.
**Why:** The most likely clash is right after planning, when the human comes back to the plan. Interrupting a compaction halfway would waste it; a few seconds' wait costs the human little.
**Assumed.** Alternative: cancel the compaction when the human types.

## 14. A compaction never pings the human or moves the feature
**Decision:** An automatic compaction is not a turn as far as the feature is concerned: it raises no "needs you" ping, no orchestrator news, and leaves the feature's status and waiting reason exactly as they were. The idle timer that stops the lead's process counts from the compaction's end.
**Why:** It runs as a hidden prompt through the same turn path as a real message; without this, every quiet moment would end with a false "lead finished" alert and could clear "Waiting for you · plan to approve".
**Assumed.** Alternative: none worth taking; listed so the build does not miss it.

## 15. After any compaction, the lead re-reads its feature state first
**Decision:** After every compaction (runcastle's own at a quiet moment, or the runtime's 200k ceiling mid-turn), the lead's first move is to call `get_feature_context` (waiting question, running round, ready declaration) before acting on the summary. On Claude Code a hook that runs when a compacted session restarts tells it so; the keep-instructions and the feature skill say it too, which is what Codex leads get.
**Why:** A summary is the model's own judgement and nothing checks it; one cheap read of the record does.
**Assumed.** Alternative: trust the summary.
**Changed by the orchestrator:** added on its go-ahead, 2026-11-06.

## 16. Runcastle turns compaction on for its feature leads, whatever the human's own settings say
**Decision:** A runcastle-launched feature lead's per-session Claude Code settings carry `autoCompactEnabled: true`. Those settings reach Claude Code as `--settings`, which outranks the human's own `~/.claude/settings.json`, so an `autoCompactEnabled: false` there no longer switches off the 200k ceiling. Only feature leads get it: the human's own Claude Code and the orchestrator's chat keep the human's setting. With the ceiling turned off for the install, the override goes too.
**Why:** The human's settings on this machine say `autoCompactEnabled: false`, which made the ceiling from 8 inert; the burner already overrides it the same way for workers.
**Assumed.** Alternative: respect the human's own `autoCompactEnabled: false`, leaving the ceiling off on this machine.
**Changed by the orchestrator:** added on the orchestrator's call, 2026-11-06; the orchestrator later withdrew its claim to settle it for the human, so it waits for them.
