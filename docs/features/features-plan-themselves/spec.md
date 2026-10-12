# Features plan themselves

## Problem

Planning is the one stretch of the loop where the human has to sit in the conversation. The grill asks one question per turn and the human waits between turns; a typical feature takes about eight. When tired, the human accepts recommendations unread, so the grill is also a weaker check than it looks. Everything after Burn already runs without them.

The human wants to say what to build, come back, look at a plan, and either burn it or talk to change it.

## Approach

### What the human sees

Wherever a feature's planning session is first opened there are now two choices. The existing one keeps its meaning and opens the grill. Beside it sits **Plan it yourself** (decisions 5, 12). The two places are the Start action on a draft, and the first session action on a started feature that has no decisions, spec or tickets yet.

Choosing Plan it yourself starts a **self-planning run**. There is no terminal to watch (decision 9). The feature's next-step row says the feature is planning itself and offers one action, **Stop**; the chat is not offered while the run is going. The preview and the tickets appear on the page as the run writes them, through the docs watch and ticket events that exist today. The feature list shows its existing "working" state (decision 11).

When the run finishes, the page is the ordinary planning page: preview, tickets, Burn. The feature has not moved; Burn is still the human's click (decision 10). If the run ends before the plan is complete, or the human presses Stop, the row says planning stopped before the plan was complete and offers the chat (decisions 3, 11).

Opening the chat after a self-planning run resumes that run's conversation in the ordinary interactive terminal. From there it is the conversation the human already knows: they say what to change, the session edits the decision, redraws the preview and reconciles the spec and tickets (decisions 9, 10).

### How a plan gets made without a human

This is skill text in the ideation skill: a section for planning with no human present. The grill with a human is unchanged, including one question at a time.

- **One turn, own recommendations.** The session asks its design questions as it would ask the human, each with a recommended answer and the main alternative, then accepts its own recommendations and continues. Nothing replies to it (decisions 1, 3).
- **Frontier rounds.** A round is every open question that does not depend on an unanswered one. The next round is what those answers opened. Each round is written to `decisions.md` as it is decided, so a run that dies keeps what it had (decision 2).
- **Depth rule.** A decision is recorded only if it changes what the feature is or does for its users, or the human might reasonably overturn it. Anything an engineer would settle while building goes to the spec as detail (decision 6).
- **One challenger.** When a round would be empty, the session runs exactly one challenger: a separate agent given only the brief and the decisions, asked for branches never asked and for decisions it would have made differently. The session must not tell it what to conclude. Its branches are asked as one more round and decided, with what they open. A decision it disagrees with is marked challenged with its reason, and the planner's answer stands. No second pass (decision 4). The skill names the agent-spawning tool each CLI's way: Claude Code's Agent tool and Codex's `spawn_agent`. If the session has no such tool, it challenges its own plan as a separate pass and says in the record that the challenge was not independent.
- **Refused tools.** A headless run is refused any tool that would have needed approval. The planner does not retry or wait: it decides on what it knows and treats that decision as a candidate to check first (decision 9).
- **Straight through.** The session then draws the preview, writes the spec and emits the tickets in the same run, without waiting for confirmation, and completes each planning step as it does today (decision 10).

### The record of a self-made decision

Every decision the session made without the human is marked assumed in `decisions.md` and carries its main alternative (decision 7). A challenged decision also carries the challenger's reason. The entry keeps the existing shape with one added line; this came from the planning conversation:

```markdown
## 4. Tags and dates are left out of the PDF
**Decision:** The PDF carries the title and body only.
**Why:** The brief asks for the note, not its filing.
**Assumed.** Alternative: a small footer with tags and the last-edited date.
```

When the human confirms or changes a decision in the chat, the session removes the line. This rule is added to the skill that handles later changes as well as the ideation skill, because the change usually happens in a resumed conversation.

### What the preview adds

The planner picks at most five decisions to **check first**: guesses about the human's intent the brief did not settle, decisions that force several others, and decisions the challenger disagreed with (decision 8). The preview's decisions part opens with this group. Each entry shows the decision, its alternative and why it is uncertain. The remaining decisions follow in the existing list, each showing that it was assumed. The preview rules and the starter page in the skill pack gain this group; a preview of a grilled feature has no such group and looks as it does today.

### The launch

A self-planning run is the feature's planning session launched a second way (decision 9). It is the same session kind, with the same briefing artifacts, skill pack, edit and install guards, tools and model resolution, and it is recorded as the feature's chat conversation. It differs in three ways:

- **Purpose.** The session carries a new purpose, `self-plan`, beside the existing `resolve-conflict` and `start-lap`. The purpose is what the briefing, the page and the exit handling key on.
- **Briefing.** The opening briefing and the injected prompt tell the session that no human is present and that it follows the skill's section for planning without one, through spec and tickets.
- **Headless.** The runtime adapter describes a non-interactive launch: Claude Code's print mode and Codex's `exec`, each with the briefing as its prompt. The process is owned by the same registry that owns the terminals, so ending it is the existing end-session path and its exit is the existing exit path. Nothing renders its output.

The launch is refused, with a sentence saying why, unless the feature is at planning with no planning artifacts and no session live. While a self-planning run is live, a chat launch is refused with a sentence telling the human to stop the run first; it must never attach a terminal to a headless process.

When the run's process exits, the server records whether the plan was complete, meaning the tickets step was completed for this lap, and emits an event saying so. The page's "stopped short" state is derived, not stored: no session is live, the lap's most recent planning session was a self-planning run, and the tickets step is not complete. Opening the chat makes a newer session and the state clears.

Opening the chat afterwards is the existing chat launch. It resumes the feature's most recent conversation by the id the session reported at start, which a headless run reports the same way. If that conversation cannot be resumed, the chat starts fresh from the docs, as it already does when a conversation is unavailable.

### Both CLIs

Both runtimes are in lap 1 (decision 9). The hand runs on a toy feature showed each CLI planning headless in one turn and exiting cleanly, each finished session resuming by id with full context, and Codex's headless mode never asking for approval. Two things were not reachable from the planning session and are the first things the build checks: a headless-created session opening in the interactive terminal on each CLI, and Codex planning headless inside the session home runcastle generates, with its hooks, skills and tools.

## Seams

- **The runtime launch description** (existing). Each adapter turns a launch input into a complete launch spec without spawning. A headless self-planning launch is observable here as the non-interactive argv for each runtime with the briefing as its prompt, and an interactive launch is observably unchanged.
- **The session launcher with spawning off** (existing). Launching with the `self-plan` purpose is observable as the session row's kind and purpose, the briefing recorded on the launch event, and the rendered command. The refusals are observable here too: self-planning on a feature that already has planning artifacts or a live session, and a chat launch while a self-planning run is live.
- **The briefing renderers** (existing, pure). The injected prompt and the opening line for a self-planning session say no human is present and name the ideation skill, spelled per runtime.
- **The process exit handler** (existing). A self-planning run's exit is observable as the event that says whether the plan was complete, alongside the existing ended and exited events.
- **The next-step resolver** (existing, pure). Given a feature's state it returns the bar. Observable: the second choice on a draft and on a started feature with nothing planned, the planning-itself bar with Stop and without the chat, the unchanged ready-to-burn bar after a finished run, and the stopped-short bar with the chat as its primary.
- **The skill pack** (existing content). The ideation skill's new section, the change-handling skill's rule for the assumed line, and the preview rules and starter page are content. They are checked by reading them against decisions 1 to 4 and 6 to 10, and judged at the test drive.

No new seam is introduced.

## Out of scope

- The preview's form, its frame and its place on the page. Plan preview owns them; this feature adds one group to the decisions part.
- Burning, judging a lap, merging, or starting drafts without the human.
- The project session answering design questions. It stays a shape griller.
- The charter and its record of this change. The project session writes them once these decisions are on the branch.
- Batched questions to the human. The grill with a human stays one question at a time.
- Showing a self-planning run's output while it works.
- Quick changes, which have no planning session.

## Open questions

Answered by lap 1 and its review drives:

- **Interactive resume of a headless session.** Works on both CLIs. A session that ran headless opens in the interactive terminal by its id, with its context.
- **Codex in the generated session home.** The start hook fires under `exec` and the conversation id is recorded. The first run could write nothing, because every runcastle tool call and file write was refused; that was fixed in the lap and re-driven.
- **Length of a real run.** A small draft planned itself in about four minutes on each CLI and finished without stopping. Larger features have not been measured.
- **The branch's skill pack.** The drive loaded the branch's own pack.

Still open:

- **Codex sessions run unsandboxed on Windows.** The fix above runs every Codex session there with full access and approvals off, interactive chats included, bounded by runcastle's own edit and install guards. The human has not ruled on whether that trade stands. It is carried in the draft named under Later laps.
- **Volume, and whether the planner picks the right decisions to check first.** The driven plans made six decisions and one. The human's own count of decisions they would overturn has not been recorded. In the one complete plan read at review, two of three check-first entries did not say why they were uncertain.
- **Cost.** A toy plan cost under a dollar of Opus usage. A real feature's cost is unknown.

## Later laps

None. The feature merges after lap 1 (decision 13). The scope that was deferred here is parked as the draft feature "Whole cuts plan themselves" (`whole-cuts-plan-themselves`), which waits on this feature's merge, together with the observations lap 1's reviews left open.
