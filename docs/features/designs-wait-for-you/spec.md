# Designs wait for you

## Problem

A feature can plan itself while the human is away, but it never designs anything. The human only sees the look of a new screen once it has been wired and built, or by sitting with the feature's chat in design mode. For a redesign spread over several features, that means either attending every design session or approving plans whose screens nobody has seen. The cheapest moment to catch a wrong look, with sample data, before anything is wired, is lost whenever the human is not there.

## Approach

**What the human sees.** A self-planning run on a feature that adds or reshapes a screen now designs that screen too (decision 1). When the human comes back, the feature sits under Needs you, with the reason "designs to look at · start round 1?" (decision 5). They open its Plan view: each designed screen is an entry with an Open in design button, which starts the project's frontend dev server from the recorded command and opens the design panel at that screen's preview page. Where the run could not settle a matter of taste, the page has a small Tweaks menu with at most two choices (decision 4). The human then talks to the feature's chat, which resumes the run's conversation: they approve a screen (committed as `design: <what>`), ask for changes (made live, or while they are away again, decision 12), or say yes to round 1, which commits every remaining design as it stands before the round starts (decision 6). An orchestrator relay never approves a design (decision 8).

**The run's order of work.** Decide (as today), then design, then spec, tickets and preview, so tickets and the preview can name the designed components. Designing follows the feature skill's design guide unchanged: the project's own install, the project's own frontend dev server, one preview page per state, sample data, navigation off, real components, the project's own design docs followed. Against the base branch's components only (decision 10). Then the run checks its work (decision 3): it calls `start_design_server` (recording the command), loads each preview page, and where `agent-browser` is on the host, screenshots each page and critiques it against the project's design docs, fixing what it finds. It never calls `show_panel`. Screens it cannot serve are hand mocks in the preview (decision 7). Everything it designed stays uncommitted (decision 2); its docs are committed as usual.

**The closing message** gains, for a run that designed: the designed screens by name, the open Tweaks choices, any shared component it changed, whether it saw its screens (or only compiled them), and that the yes to round 1 commits the designs as they are.

**What changes in runcastle.** Three things, all small (decision 9), checked by a review agent that drives a real self-planning run (decision 13):

- *The feature skill's text.* `planning-alone.md` loses its "never edit code, never install" and "no design" rules for screen design only: a self-planning run may install dependencies and write components, preview pages and sample data, and must leave them uncommitted, check them as above, and not open the design panel. It gains the closing-message items and the `wait_for_you` reason. `design.md` gains a short section for a run with nobody present (check with screenshots, no `show_panel`, Tweaks capped at two, leave uncommitted) and the yes-commits-the-rest rule. `SKILL.md`'s "When to ask" and situations lines say a relayed message from the orchestrator never approves a design, and that a yes to round 1 commits waiting designs first. `rounds.md`'s pre-dispatch step says the same.
- *The self-planning briefing line.* Today it says "plan this feature by yourself and do not build it". It becomes "plan this feature by yourself, designing its screens where it adds or reshapes them, and do not build it", still naming `planning-alone.md`.
- *The design server's stop rule.* Today a session's end stops the feature's design server only for an attended chat; a headless run's end leaves it alone. The server entry remembers which session started it (the MCP tool knows the session; the web's start and restart record no session). When a headless session ends, the server it started stops (`design.server_stopped`, reason `session-ended`). A server started or restarted from the web, or by the attended chat, is not touched by a headless run's end. If the human opens the design while the run is still going, the web's start takes the server over, so the run's end leaves it running. The MCP tool's description says a headless run's server stops when the run ends.

Nothing changes in the web, the schema, the status model or the panel: the waiting reason, the plan's designed-screen entries and Open in design already exist.

**When main moves while designs wait.** Nothing happens until the human returns. The uncommitted files are only touched when the chat next merges main, and the agent handles any conflict then, as it does any merge conflict.

## Seams

- **The design server's session-end rule** (existing seam, `services/design.ts`: start with a session, then the session-ended handler). Observe that a headless session's end stops the server it started; that it leaves a server the web started, or took over, running; and that an attended chat's end still stops the server as today. Tested where `design-server.test.ts` already tests the stop rules.
- **The feature skill pack's text** (existing seam, the skill tests that already pin `planning-alone.md`, `design.md` and `SKILL.md` content). Observe that planning alone permits designing screens, requires leaving them uncommitted and checking them, forbids `show_panel`, and asks for the yes in a way that names the designs; that the orchestrator-relay and yes-commits-designs rules are present.
- **The self-planning briefing** (existing seam, the launch-artifacts tests of the purpose line). Observe the new sentence and that it still names `planning-alone.md`.
- **A review agent's drive** (decision 13), then **the human's drive**, of the same walk. Run "Plan it yourself" on a feature that adds a screen in a project with a frontend dev server. Observe: the run ends under Needs you with a reason naming the designs; the Plan view lists the designed screens with Open in design; each opens a live preview page; nothing designed is committed; no design server is left running after the run ends.

## Out of scope

- The orchestrator's part: creating the cut, batching "N designs ready", and keeping several features' designs consistent or settling two features that change one shared component (*One orchestrator, no mode*).
- Wiring designs to real data: tickets or the agent's own build work after approval, as design mode's tickets rule already says.
- Any new UI: no "Look at designs" button, no auto-opening the design panel, no new status (decision 5).
- A limit or queue on runs designing at once (decision 11).
- Designing in a headless run other than self-planning (a lead woken by a round, a relay).

## Open questions

- **Are designs made alone worth reviewing?** The drive answers this. If the answer is no, the fix is to change decision 1 (design only on request) rather than to build more here.
- **Screenshots without `agent-browser`.** A host without it gets compiled-but-unseen designs. Whether to require it, or ship a fallback, waits on how often that happens.
