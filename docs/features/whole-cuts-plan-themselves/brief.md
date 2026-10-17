# Why this draft exists

"Features plan themselves" shipped after one lap. The human chose on 2026-10-12 to merge it as it stood and park everything its spec had deferred to later laps here, to pick up later. Nothing below has been grilled as a lap; it is the deferred list plus what lap 1's reviews left open.

The experience the original brief asked for is still not delivered: tell the project session what to build, the features get created, open any one and find its preview. Lap 1 needs one click per feature, with the human on that feature's page.

# What lap 1 shipped (input, not open questions)

- **Plan it yourself** sits beside Start on a draft, and on a started feature that has nothing planned and no earlier conversation. Start still opens the grill.
- **A self-planning run is headless.** It is the feature's planning session launched with no terminal (session purpose `self-plan`), on Claude Code print mode or Codex `exec`. The page says the feature is planning itself and offers Stop. When the run exits the server records whether the plan was complete.
- **The plan is made from skill text alone**, the ideation skill's "Planning without a human" section: frontier rounds, a depth rule, exactly one challenger, every decision marked assumed with its alternative, at most five to check first, then preview, spec and tickets with no waiting.
- **The chat resumes the run's conversation** in the ordinary interactive terminal. Driven for real on both CLIs.
- **Measured at review (one run each, small drafts):** Claude Code finished in 4 min 15 s with six decisions; Codex in about four minutes with one decision. The human has not reported how many decisions they would overturn; the count was the test lap 1 existed for, so ask for it first.

Read `docs/features/features-plan-themselves/decisions.md` and `spec.md` before grilling. Decision 3 there explains why nothing drives a loop.

# Parked scope (from that spec's Later laps)

1. **Runs that start with nobody on the page**, so a cut made by the project session plans itself. Today only a browser click launches a feature's session. Concurrency and token spend across a cut are undecided, and so is whether this needs a launch mode that cannot be interrupted by the human's own terminals.
2. **Dependents.** What a feature waiting on an unmerged sibling does: plan when it starts, or earlier. A plan written against unmerged code goes stale; the human's picture was a preview on every feature of a cut.
3. **Something that sends a run back to work**, only if real runs are seen stopping early. The known fix is runcastle answering the turn-end hook it already receives on both CLIs. `/goal` was tried by hand and its checker never agreed a run was finished and ignored its turn limit; a challenger asked to repeat until it found nothing never stopped.
4. **Making Plan it yourself the default**, once the human's test drives show the plans hold up. Runcastle is published and other people use Start.
5. **Self-planning a lap that is planned from review.**
6. **"Plan the rest yourself"** said in the middle of a grill.
7. **A time limit on a run.**

# Carried from lap 1's reviews (observations, none was a defect)

- **Check-first entries mostly omit why they are uncertain**, and the one real plan wrote its own markup for the group instead of using the starter page's list. The skill text asks for the right thing; the planner did not fully follow it. One sample.
- **An abandoned grill has no way into self-planning.** A started feature whose first chat ended with nothing planned shows only Resume session. The spec said "first session", so this was as designed, and it also meant that placement could not be driven.
- **The Chat tab during a run** still shows a live dot, a "Chat · lap 1" header and End session above the line saying there is no terminal to watch. It works as a second Stop.
- **Codex sessions run unsandboxed on Windows**, interactive chats included (`danger-full-access`, approvals off), bounded only by runcastle's own edit and install guards. The fix needed writes inside the feature worktree; Codex degrades workspace-write to read-only on Windows without its own sandbox setup, so the whole machine was granted. The human has not ruled on whether that trade stands.
- **Not driven by either review:** Plan it yourself on a started feature with nothing planned, and the stopped-short route on Codex after its fix.
- **Codex made one decision** for a two-sentence draft where Claude Code made six for three sentences. Too little to conclude from, but it is where to look if Codex plans read thin.

# What this must NOT swallow

- **Burning, judging a lap, merging, or starting waiting drafts without the human.** The unattended back half stays uncreated until planning is proven. Starting a planning run for a feature that is already started is in scope; clicking Start on a draft for the human is not.
- **The project session answering design questions.** It stays a shape griller.
- **The preview's form and its place on the page.** Plan preview owns them.
- **The charter.** The project session writes the record of the change to "human-in-the-loop only at the two ends".
- **Batched questions to the human.** Rejected in the project session; the grill with a human stays one question at a time.

# Size

Seven parked items and six observations are more than one ideation window is likely to hold. Item 1 is the core and is the natural first lap. The project session may want to cut this draft further before it is started.
