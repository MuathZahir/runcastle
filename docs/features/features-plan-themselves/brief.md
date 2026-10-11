# Why this feature exists

Planning is the one stretch of the loop where the human is a synchronous participant. Everything after the Burn click already runs unattended: the burn, the review that drives the app and records a video, the fix tickets and the verification pass (charter decision 9, `four-states-and-two-hard-rules` decision 5, `review-as-a-lap-trail`). The cost the human named on 2026-10-09 is the sequence: one question per turn and the waiting between turns. Grilled features on disk carry a median of 8 recorded decisions (72 of 129 features have a `decisions.md`; counted from decision headings, approximate). The human also reported accepting recommendations unread when tired, so the grill is a weaker check than it looks.

The experience they want: tell the project session what to build, the features get created, open one, see its artifact, then Burn or keep talking to make it what they want. They want this in real runcastle, on main, not on an experimental line.

# Understood (settled in the project session; input, not open questions)

1. **Two roles, not a solo planner.** The human's argument, accepted: the grill works because the agent walks the whole design tree with a second party, and a planner alone cuts corners. Turn-taking forces enumeration, and someone else declares the tree exhausted.
2. **The second party is a challenger, not an answerer.** An agent handed a question with a recommendation attached mostly confirms it. The challenger's job is to name the branches the planner did not ask about and to refuse "done" while any remain. Where it would have decided differently from the planner, that decision is one to mark for the human.
3. **`/goal` drives the loop** (the human's proposal). Per the Claude Code docs, a fast model checks the condition after every turn and starts another turn if it does not hold; it works in interactive mode, so the terminal stays watchable. It is built for a verifiable end state, and "the whole design tree is defined" is not verifiable by itself. So the condition must be checkable: the tree is written down (every open question logged as it is found, each closed by a recorded decision) and a challenge pass comes back empty.
4. **It never blocks on the human.** The planner decides, records the decision as assumed, and marks the least certain ones. Those surface in the plan preview. There is no escalation inbox.
5. **Steering happens afterwards in the feature's own chat** (`one-chat-per-feature`), not in the project session.
6. **It stops at Burn.** The two human clicks of `four-states-and-two-hard-rules` decision 3 stay.
7. **A dial on the one path, not a second pipeline.** ADR-0012 retired mapped ideation because it was a second mode that 5 of 153 features entered while every prompt and skill kept accounting for it.
8. **Complexity is a hard boundary.** The human's words: "I don't want to increase the complexity considerably for something that doesn't bring much benefit." The first lap is a skill mode plus launching the planning session at Start with its briefing in the launch (ADR-0009). No server-run second agent, no question protocol or ask tool, no inbox.

# Rejected in the project session; do not re-propose

- **Batched questions to the human.** Their words: "even worse (very overwhelming)". The human-run grill stays one question at a time.
- **A solo planner with no second party.**
- **Tools that let the project session message a feature agent.** ADR-0009: nothing types into a live terminal.

# Open (for this feature's own session)

- The trigger: every started feature plans itself, or a choice at Start or at creation between "grill me" and "plan it yourself". A feature born from a rich project-session brief and one born from a title and one-liner are different inputs.
- How the challenger runs. A subagent of the planning session is the cheapest, but the planner then writes its own checker's prompt. The project session's lean for lap 1 is the subagent, revisited if plans cut corners.
- A bound on the loop: a condition that never holds spends tokens indefinitely. The draft `auto-continue-burns-after-provider-limit-reset` covers burns only and explicitly excludes talk sessions.
- Codex: whether it has an equivalent of `/goal` is unchecked, and runcastle runs both CLIs.
- How `/goal` and the kickoff briefing compose in the launch argv (ADR-0009 points 2 and 7).
- The signal that a plan is ready for the human's look, and what the feature shows while it is still planning.
- Dependents: the project session's default is that a draft waiting on a sibling plans when it starts, not before, since a plan written against unmerged code goes stale. The human's picture was opening any feature of a cut and finding a preview. Decide.
- The token cost of planning features that then get redirected, and concurrency when one cut starts several.
- The shape of an assumed decision in `decisions.md` (the ideate skill appends each decision as it locks, `packages/skills/packs/runcastle/skills/ideate/SKILL.md:45`).
- The hand test: the human may run `/goal` by hand with a "grill yourself and log every question" instruction on a real feature before this starts. If they did, begin from what it showed.
- What the human wants to test-drive first: create a feature with a real brief, walk away, come back to a plan and a preview, and count how many decisions they would overturn.

# What this feature must NOT swallow

- **The preview artifact's form and its surface in the app.** "Plan preview" owns them; consume what it built.
- **Auto-burn, a lap judge, auto-merge, auto-start of waiting drafts.** The unattended back half is deliberately uncreated until this is proven.
- **The project session answering design questions.** It stays a shape griller (ADR-0012 decision 2).
- **The charter.** This overturns "human-in-the-loop only at the two ends" for planning. The project session writes that ADR and amends `CONTEXT.md` once this feature's decisions are recorded; feature sessions cannot.

# Ordering

Waits on "Plan preview", which must merge first: this feature's output is audited through that preview, and both rewrite the ideate skill and the feature page.
