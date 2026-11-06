# Decisions — Interactive workers

Grilled with the human, 2026-11-06. The brief's "Understood" list is settled already and is not
repeated here.

## 1. Interactive workers run in a sandbox, as a trial
**Decision:** A worker runs inside a burn-image sandbox, the way the prototype built it
(`workers-prototype-an-agent-you-can-enter-inside-a-sandbox`, its decision 28): its own container,
its own bare copy of the feature branch, one published port, no way to reach runcastle or the host
repo. The human revisits this after using it.
**Why:** The human at checkpoint 1: "Let's try the sandbox. We can test it for now." The prototype
measured no speed reason to prefer the host; the sandbox lets a worker run with no permission
prompts safely.

## 2. The human's yes to the plan, or to an offer in chat, starts the workers
**Decision:** The workers the lead lists in its plan start when the human says yes to the plan; a
worker the lead offers later in chat starts on the human's yes in chat. There is no Start click
per worker. Each starts on its assignment at once, makes a first pass, and shows "needs you" when
its turn ends.
**Why:** A Start click per worker would approve the same thing twice. Starting a worker is cheap
(6–10 s plus an install) and an idle one stops its container, so the plan's yes is gate enough.

## 3. The sidebar's thread list becomes the worker list
**Decision:** The open feature's thread list in the sidebar is the worker list; the feature page
gets no second list. It orders by status, not start time: the lead's chat first, then workers that
need the human, then working ones, then a folded "Done (n)" for handed-back and landed workers. A
row moves only when its status changes. Each row shows the worker's label with its one-line purpose
beneath in a muted line. Features not open stay folded; their amber dot already lights when any
worker needs the human. The look gets a live design pass before it is built.
**Why:** The sidebar is already the one place threads are switched (`threads-in-the-sidebar`); a
second list on the feature page would be a second place to look. The human: "It might need better
UI."

## 4. The lead lands a handback with one tool, or sends it back, or drops it
**Decision:** A worker hands back with a short summary, which must include any direction the human
gave it directly. Runcastle adds the worker branch's commits and changed files and wakes the lead
once with that, never the transcript. The lead then either lands the worker's branch on the feature
branch with one tool, through the feature's landing queue like its own commits (the worker shows
"landed" and folds into Done; the lead resolves any conflict), or sends the work back with a
message (the worker returns to working), or drops the worker.
**Why:** The human's picture: "the worker hands the design back; the lead integrates". Nothing
lands unseen, and two workers' changes always have someone fitting them together.

## 5. Each assignment is "with you" or "on its own"; "with you" hands back only on the human's yes
**Decision:** The lead marks every worker's assignment in the plan as "with you" (taste work) or
"on its own". A "with you" worker makes its first pass, shows "needs you" and waits; it hands back
only once the human says they are happy, or presses the **Hand back** button in its chat header,
which tells the worker to write its summary and hand back. An "on its own" worker hands back when
its done-when is met, and shows "needs you" only when it asks a real question.
**Why:** The human's own example mixes the two ("taste work, each gets a worker with you; the data
changes run in the background"). Taste work must not reach the lead before the human has seen it.

## 6. A worker that needs the human pings desktop and phone
**Decision:** A worker entering "needs you" is a feature need like any other: runcastle pings the
desktop and every subscribed phone once ("<feature> · <worker label> needs you"), and the tap opens
that worker's chat, not the lead's. No batching; if several pings at once prove noisy in use,
bundling them per feature is a later fix.
**Why:** A "with you" worker is meant to be iterated with promptly; shown only in the sidebar it
would sit unseen and its container would stop on idle. The pings are runcastle's own, so a feature
held by an orchestrator thread still gets them.

## 7. Side chats become unassigned workers
**Decision:** The "+" on the open feature's sidebar row starts a worker with no assignment, in
place of today's side chat. It runs in a sandbox on its own branch like any worker, opens with the
feature's state and the lead's latest turns (as side chats do today), and waits for the human. It
hands back through the same Hand back button, and the lead lands, returns or drops it. A worker
only asked questions has nothing to hand back and just goes idle; a worker with commits stays out
of Done until it is handed back or dropped.
**Why:** One kind of thread instead of two, and nothing reaches the feature behind the lead's back
(a side chat once changed a feature after it was declared ready, unseen by its lead). Side chats
were used 4 times in two weeks, so losing the host checkout costs little.

## 8. Workers carry the human's whole Claude setup; MCP servers can be switched off per server
**Decision:** At start or wake, a worker gets a read-only copy of the human's Claude setup: global
CLAUDE.md and rules, skills, agents, enabled plugins, model and effort settings, and their MCP
servers (user-level, plugin-provided and the repo's own) with their logins. Hooks stay out (they run
host-path scripts). A new **Workers** page in Settings lists every MCP server with an "Available to
workers" toggle, all on by default; the servers switched off are one machine-wide list in
runcastle's config, and a worker never sees their tools. A change applies at a worker's next start
or wake.
**Why:** The human: "Shouldn't all workers have the user's setup? … most users expect that",
as Claude Code's own subagents do. Workers run with no permission prompts, so leaving a server out
is the only reliable way to keep risky tools (Neon in write mode) out of reach.

## 9. A worker gets a worker-sized set of runcastle's tools, served from outside the sandbox
**Decision:** A worker's runcastle tools are: hand back, start its dev server, read the feature's
state (tickets, designs, decisions, the lead's latest turns), show a file or screenshot in its own
chat, and park a backlog feature. Runcastle serves them over the connection it already holds into
the container, so the sandbox still cannot reach runcastle. None of the lead's tools (tickets,
rounds, ready, landing, drives): a worker's only way to change the feature is its handback.
**Why:** Workers run with no permission prompts; given the lead's tools they could start rounds or
declare ready behind the lead, the side-chat trouble this feature removes.

## 10. No settings page: workers ask before MCP calls, as the human's own chats do
**Decision:** Supersedes the Workers settings page in 8 (the rest of 8 stands). A worker gets exactly
the human's setup with no per-server switch. Inside the sandbox it never asks (editing files and
running commands touch only its own copy); any call through the human's MCP servers asks the
human, following their own "always allow" rules, and a worker waiting on such a prompt shows
"needs you" and pings like any other need.
**Why:** The human: "In claude code, subagents have the exact same setup as the agents. What's the
difference here." The only difference was that workers never asked; making MCP calls ask closes it,
and a page of per-kind switches would read as managing every chat's servers.

## 11. Workers run in their provider's automatic permission mode
**Decision:** Supersedes the permission part of 10. A Claude Code worker runs in Claude Code's auto
mode (a checker model blocks anything irreversible, destructive or aimed outside its environment;
the human's own allow, ask and deny rules still apply first). A Codex worker runs with Codex's
auto-review (a reviewer model checks every action that would need approval, MCP calls included).
When the checker blocks something, the worker explains in its chat what it wanted to do, which
shows "needs you" and pings. If the automatic mode is not available on the human's plan, the
worker falls back to 10: free inside its sandbox, asking before any MCP call.
**Why:** The human asked for the providers' own auto modes. They match the human's own agent more
closely than a fixed rule, and they cover MCP calls too.

## 12. This feature builds Codex workers too
**Decision:** Workers run on Codex as well as Claude Code. A Codex worker matches a Claude Code one:
Codex's chat connection inside the sandbox, the human's Codex setup brought in (its instructions
file, skills, config and MCP servers, as 8 does for Claude Code), resume after an idle stop, and
auto-review (11). The prototype's Claude-Code-only limit is removed.
**Why:** Side chats become workers (7), so Claude-Code-only workers would take side chats away from
Codex users. Burns and chats already run Codex, the burns inside the same sandbox image.

## 13. All build work moves to workers; the review round stays until `burns-become-workers`
**Decision:** From this feature on, the lead hands off build work only as workers ("with you" or "on
its own") and no longer writes build tickets. An "on its own" worker gets the lead's assignment and
hands back when done; the lead lands it and runs the project's checks itself, and where one piece
must wait for another it starts the second after landing the first. Rounds remain only for the
end-of-feature review ticket. `burns-become-workers` must retire the review round, the remaining
ticket and round machinery and the conflict-fixing agent, leaving no rounds and no old code behind.
This feature removes what it replaces itself: the side-chat thread kind and the lead's build-ticket
guidance.
**Why:** Two background tools would make the lead pick inconsistently. Rebuilding the review
(app-driving, screenshots, the Review Package) is the heart of `burns-become-workers` and would
roughly double this feature. The human: "Make sure that the next feature will retire it. I don't
want old code and inconsistencies."

## 14. One limit for agents working at once, shared by ticket agents and workers
**Decision:** The existing machine-wide "how many burns at once" setting becomes "agents working at
once" and counts ticket agents and workers in the middle of a turn together. A worker waiting for
the human, or stopped on idle, does not count. A worker over the limit waits in line, shows
"queued" in the sidebar, and starts by itself when a slot frees.
**Why:** Workers and burns load the same machine; two separate limits would be two numbers for one
machine. Not counting waiting workers keeps stepping into a "with you" worker unblocked.

## 15. Previews go through runcastle's pass-through and wake only the sandbox
**Decision:** A worker's preview goes through runcastle's existing design pass-through (the one the
phone's Design screen uses), routed to that worker, so it works on the laptop, the VPS and the
phone alike. The worker's chat header shows "Open preview" while its dev server runs. Opening a
stopped worker's preview starts its container and dev server but not its agent; it stops again
after the usual idle time. The worker's instructions say its dev server must accept connections
from outside the container, and its dev-server tool says so when it does not.
**Why:** The prototype's `localhost:<port>` address breaks once runcastle moves to the VPS.
Looking at a design hours later should not need a throwaway message to wake the agent.

## 16. A failed worker wakes its lead once
**Decision:** When a worker's container dies, its setup fails or its agent crashes, it shows
"failed" in the sidebar and the lead gets one short message saying what failed; the lead retries,
drops it, or does the job itself.
**Why:** Only a handback wakes the lead otherwise, so a lead could wait forever on a worker that
will never hand back.

## 17. The lead can message any worker at any time
**Decision:** The lead sends any worker a message; one sent mid-turn waits for the turn's end, as
runcastle's own messages to chats do.
**Why:** A lead correcting a running worker is the normal case, not only after a handback.

## 18. Dropping a worker removes it; a feature's workers go when it merges or is archived
**Decision:** Dropping a worker removes its container and branch. When the feature merges or is
archived, all its workers are removed.
**Why:** Each stopped worker keeps a full copy of the repo plus installed packages; nothing else
would ever clean them up.

## 19. No "ready" while a worker works or holds unlanded work
**Decision:** The lead cannot declare ready while any worker is working or holds commits that have
not landed; it lands or drops each first. A worker that hands back after the feature is ready is
landed by the lead, who then declares ready again.
**Why:** It closes the gap where a side chat changed a ready feature unseen by its lead.

## 20. The lead's rule for offering workers
**Decision:** The lead's instructions carry a firm rule. Taste work (a screen, a component, wording:
anything the human would look at and tweak) gets a "with you" worker, one per piece judged
separately. Self-contained build work that would take the lead more than a few minutes or much
file reading gets an "on its own" worker. Small jobs (a few lines, docs, landing handbacks, fixing
what a handback got slightly wrong) the lead does itself. It offers workers in its plan after the
grill (label, one-line purpose, kind each) and mid-chat when the human starts iterating on a design
in the lead's own chat. It picks each worker's model from the models the human described in
Settings.
**Why:** The human: "I wouldn't think to create a new thread". A loose "prefer workers" rule is how
side chats ended up never offered.

## 21. Assignment and handback are cards
**Decision:** A worker's chat opens with an assignment card that stays at its top: label, one-line
purpose, "with you" or "on its own", goal, done-when, model, and who started it (the lead, or
"Started by you" for a "+" worker, which has no goal). The worker's chat header shows its label,
status, "Open preview" while its dev server runs, and "Hand back". A handback is a card in the
lead's chat (summary, commit count, files changed, a link to the worker's chat) with what the lead
did beneath it ("Landed", "Sent back: …", "Dropped"); the worker's own chat ends with a matching
"Handed back" line. The look is settled in the design pass.
**Why:** Plain messages would let the assignment scroll away and a handback read like any other
message in the lead's chat.

## 22. Workers are on for everyone; the experimental setting goes
**Decision:** Workers ship on for every user and `experimentalWorkers` is removed. Without Docker or
Podman running, the "+" and the lead's worker offers say so in plain words and point at the setup
check (doctor), as a burn does today.
**Why:** Side chats become workers (7); a switch would keep the old side-chat code alive for anyone
who turned workers off, two code paths the human does not want.
