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
