# Decisions — Designs wait for you

Planned by a self-planning run on 2026-10-25, with nobody present. Every decision
below is the planner's own and is marked assumed until the human confirms it.

## 1. A self-planning run designs whenever the feature changes how a screen looks
**Decision:** A self-planning run designs the feature's screens when, and only when, the feature adds a screen or changes a screen's layout. A small visual change (a colour, a label, one control) is described in the plan as today, without designing, since it would not repay the install. A feature with no screen is planned exactly as today. There is no new option to ask for it: the run judges it from the brief and the code, as an attended chat judges when to offer design.
**Why:** The brief's own words are "a feature that plans itself while the human is away also designs its screens". An opt-in switch would be one more choice to make at "Plan it yourself" and in the orchestrator's `plan_feature`, for a behaviour the human already said they want.
**Assumed.** Alternative: an opt-in, such as a "Plan and design it yourself" option beside "Plan it yourself".
**Challenged:** it turns the behaviour on everywhere before the brief's own first test has shown that designs made alone are worth reviewing; keep a switch until that test passes.

## 2. Unapproved designs stay uncommitted in the feature's worktree
**Decision:** The run leaves what it designed (components, preview pages, sample data, and the recorded design-server command in `.runcastle/design.json`) uncommitted in the feature's worktree. Only the human's approval commits it, as `design: <what>`, which is today's design-mode rule (design-mode decision 6). The docs the run writes are committed as usual.
**Why:** "What you approved is what ships": workers fork from the branch tip, so nothing committed can be mistaken for approved. It is also what the brief's one-liner says ("approves, which commits"), and it needs no new kind of commit. The cost: the work is not on the branch. Archiving keeps a worktree that has uncommitted changes, so archive is safe; deleting the worktree by hand loses it.
**Assumed.** Alternative: commit the designs at once as a proposal (for example `design-proposal: <what>`), so they are on the branch and survive the worktree, and treat approval as a no-op or a follow-up commit.
**Challenged:** uncommitted work is fragile over waits of days: main moves under it, and the agent's later work mixes with the design files in one worktree. Commit proposals to a side ref that workers never fork from (for example `refs/runcastle/design/<slug>`), and copy them onto the branch on approval.

## 3. The run looks at its own screens, briefly, then the server stops
**Decision:** The run starts the design server (`start_design_server`, which also records the command for later) only to check its own work: each preview page loads, and where `agent-browser` (the browser tool review agents already use) is on the host, it screenshots each page and critiques it against the project's design docs before finishing. It never opens the design panel. The design server a headless run started stops when that run ends, instead of lingering until the 30-minute idle stop. Today a headless run's end leaves every design server alone, because headless runs never started one. With no `agent-browser`, the run checks that the pages compile and serve, and says in its closing message that it never saw them.
**Why:** The open question is whether designs made with nobody watching are worth reviewing; an agent that never sees its screens makes that much less likely. A frontend dev server for a few minutes is cheap (design-mode decision 3), while one left running for the whole absence is what the brief rules out. Starting it through runcastle, not in the agent's own shell, proves the recorded command works, so the human's Open in design later starts it without help.
**Assumed.** Alternative: design blind, checked by the project's typecheck only, so no server ever runs while the human is away.

## 4. Choices the run could not settle become Tweaks for the human
**Decision:** The run designs as an attended chat does (the feature skill's design guide: real components, one preview page per state, sample data), and where a look is genuinely open (two layouts, a density, an accent) it leaves a small Tweaks menu on that preview page instead of guessing. At most two open choices per screen: past that, the run picks and lists its picks, so it does not hand every matter of taste back to the human. Its closing message names each open choice. The Tweaks menu is deleted when the human settles, as today; nothing from it ships.
**Why:** With nobody to ask, a guess on a matter of taste is the likeliest thing to be iterated on. Showing the alternatives side by side lets the human settle it with one look instead of a round of chat.
**Assumed.** Alternative: the run picks one look for every choice and lists its guesses in the closing message.

## 5. "Designs waiting" is the existing waiting reason, and the plan opens them
**Decision:** No new status or button. The run ends as every self-planning run does, with `wait_for_you`, and its reason names the designs ("designs to look at · start round 1?"), so the feature sits under Needs you. Each designed screen is a designed-screen entry in the plan preview, with its Open in design button (design-mode decision 7); that button already starts the design server from the recorded command and opens the design panel at the page. Opening the feature does not open anything by itself: the human opens the Plan view and picks a screen.
**Why:** Every piece already exists, so the feature adds no machinery to keep. The plan is the natural place to look anyway: it shows the screens beside the decisions they come from. Not starting a dev server on every visit keeps "it starts when the human opens the design to look" literal.
**Assumed.** Alternative: opening a feature with designs waiting opens the design panel at its first screen, as the result of the human's click on the feature (the brief's "likely" shape).
**Challenged:** going through many features one by one, the extra clicks per feature are real friction; clicking a feature to look at its designs is exactly "the human opens the design to look", so opening the design panel at the first screen breaks no rule.

## 6. The human approves or iterates in the feature's chat; the yes to round 1 approves what is left
**Decision:** The human looks, then talks to the feature's chat, which resumes the run's conversation. They can approve a screen ("the list is good"), and the agent commits it as `design: <what>`, or ask for changes, and the agent iterates live as in any design session. Their yes to start round 1 also approves every design still uncommitted, as it stands: the agent commits them before it dispatches. Its closing message, and the ask for the yes, list the designed screens by name and say the yes commits them as they are. A screen the human rejects outright is dropped, and the tickets that named it are updated.
**Why:** One ask is enough, and it keeps the rule that workers fork from the design the human saw. Asking for a separate design approval before the round's yes would be a second gate that says the same thing.
**Assumed.** Alternative: designs need their own explicit approval, and the agent refuses to start round 1 while any design is uncommitted.
**Challenged:** a skimmed "yes, start" approves screens the human never opened, which defeats the feature. The yes should approve only screens the human opened or talked about, and the agent should name the rest and ask about them.

## 7. When a screen cannot be served, the plan draws it by hand
**Decision:** If the run cannot get a screen onto a preview page (no frontend dev server it can work out, a page the server builds, native mobile), it draws that screen as a hand mock in the plan preview, as a plan does today, and says so in its closing message. The run does not stop or ask.
**Why:** Design mode's honest limits already name these cases. A plan with a mock is still a plan the human can say yes to; stopping would leave the feature with no plan at all.
**Assumed.** Alternative: the run skips the screen's look entirely and leaves it for an attended design session.

## 8. Only the human approves a design; an orchestrator relay never does
**Decision:** A message relayed from the project's orchestrator never approves a design and never counts as the yes that commits designs (decision 6). If the orchestrator relays "start round 1" on a feature whose designs are still uncommitted, the agent does not start it: it answers that the designs wait for the human and calls `wait_for_you`. A relay that carries the human's own words ("the human approved the sidebar design") counts as the human's, as `grilling.md` already says of relayed answers.
**Why:** The point of the feature is that the human approves the look before anything is wired. In the brief's own example, an orchestrated whole-app redesign stops once each area is designed, so that the human can go through them one by one. How the orchestrator batches "N designs ready" belongs to *One orchestrator, no mode*; this decision only keeps it from approving on the human's behalf.
**Assumed.** Alternative: the orchestrator may approve designs, as it holds every other click in orchestration mode (`whole-cuts-plan-themselves` decision 4).

## 9. Built whole by the feature's agent, no tickets
**Decision:** The work is small and lives in two places, so the feature's agent builds it itself in one go, without workers: the feature skill's text (planning alone may design; design rules for a headless run; the closing message and the yes), the self-planning briefing line that says "do not build", and the one server rule that stops a headless run's design server when the run ends (decision 3). The project's typecheck and tests check it; no review ticket, because the real test is the human's drive: a self-planning run on a feature with screens, judged by looking at what it designed.
**Why:** It is a few files of prompt text and one stop rule, which would not split into tickets worth a sandbox each. The question the brief wants answered first (are designs made alone worth reviewing?) is answered by running one, not by a review agent reading the diff.
**Assumed.** Alternative: hand it to a round of workers with a review ticket.
**Challenged:** ship the prompt text first, run one real headless design and judge it (the brief's suggested first step), and add the server stop rule only if the answer is "worth it".

## 10. Each run designs against the base branch; consistency across features is the orchestrator's
**Decision:** A run designs with the project's existing components and design docs as they are on the feature's base branch. It cannot see a sibling feature's uncommitted designs, and does not try to. Where its screen needs a shared component changed (a button, a sidebar row), it changes it in its own worktree and says so in the closing message, so the human sees it when they look. Keeping a whole-app redesign consistent across features, and settling two features that change the same shared component, belong to *One orchestrator, no mode* (cross-cutting changes).
**Why:** The brief keeps cross-cutting changes out of this feature. A run that read other worktrees would design against work nobody has approved.
**Assumed.** Alternative: a run reads its siblings' waiting designs and matches them.

## 11. No limit on runs designing at once
**Decision:** Runcastle adds no limit or queue for self-planning runs that design. Each pays its own dependency install, and its design server lives only for the minutes the run checks its screens (decision 3). How many features plan at once stays the human's or the orchestrator's call.
**Why:** The brief names per-feature installs as the accepted machine cost. Short-lived servers on their own ports (design-mode decision 3) do not contend, and a limit would be machinery added before anyone has felt the cost.
**Assumed.** Alternative: let only one or two runs design at a time and queue the rest.

## 12. Iterating can also happen while the human is away
**Decision:** The human may ask for changes and leave ("make the list denser, I'll look tomorrow"). The agent redesigns without anyone watching, checks its screens as in decision 3, leaves the changes uncommitted, and calls `wait_for_you` again with a reason naming what changed ("designs updated · look again?"). Nothing new is built for this: it is the feature's chat working on, as it does today.
**Why:** It is the same loop the feature exists for, at a smaller size. A rule that iterating needs the human watching would make them stay for every change.
**Assumed.** Alternative: changes asked for in chat are made only while the human is watching the design panel.
