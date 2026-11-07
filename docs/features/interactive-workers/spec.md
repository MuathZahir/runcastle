# Interactive workers

## Problem

A feature's lead does nearly everything in one conversation. Its window grows to 300–700k tokens,
and every reply re-reads all of it (1.3B tokens in two weeks, 99% of feature-chat spend). The
human can't split work off in a way that comes back: side chats exist, but nothing returns from
them, no agent offers one, and twice a side chat changed code its lead never heard about. When the
human wants to iterate on one piece of a design ("the header", "the thread list"), they do it in
the lead's chat, which grows further, or not at all.

The human wants this picture: the lead grills them, then hands the pieces to **workers**. The
human steps into any worker, iterates on that piece until it looks right, and the worker hands it
back to the lead, which fits the pieces together. They should never have to think "I should open a
new thread". The lead offers, and the list of workers makes it obvious what each one does and
which ones need them.

## Approach

### What the human sees

**The worker list is the feature's own sidebar page** (decisions 3, 24). Opening a feature swaps
the left sidebar to its page, built like the features list one level down. A header row holds a
back chevron to the features list, the feature's progress glyph and title, and a "+" that starts
an unassigned worker in place of a side chat (decision 7). Then come the **Lead** card, shaped like
the Orchestrator card, and the workers: those that need the human first, as plain rows, then the
**Working** shelf (queued workers included), then a folded **Done** lane. Done holds handed-back,
landed and dropped workers, and read-only **Old side chat** transcripts (decision 23). A worker
row is a feature row: its label, then its status glyph and word with its age, and the amber dot
when it needs the human. Its purpose is the row's hover text. A row moves only when its status
changes. Going back changes only the sidebar; the chat in front stays. The approved designs are
the design pages `workers-drill`, `workers-chat` and `workers-handback`.

**Workers start from the lead's offer.** After the grill, the lead's plan lists each worker with
its label, purpose and kind. A "with you" worker is taste work the human iterates on. An "on its
own" worker is self-contained background work. The human's yes to the plan starts them, and a yes
in chat starts one the lead offers later (decisions 2, 20). There is no Start click per worker.

**Stepping in.** A worker's chat opens on its **assignment card**, pinned at the top: label,
purpose, kind, goal, done-when, model, and who started it. The header shows its label and status,
**Open preview** while its dev server runs, and **Hand back** (decision 21). Previews go through
runcastle's design pass-through, so they work from the laptop, the VPS and the phone. Opening a
stopped worker's preview wakes its sandbox and dev server, not its agent (decision 15).

**Needs you.** A "with you" worker makes a first pass, then shows **needs you** and waits. An
"on its own" worker shows it only when it asks a real question, or when its permission checker
blocks something and it explains what it wanted (decisions 5, 11). Entering "needs you" pings the
desktop and phone like any feature need. The tap opens that worker's chat (decision 6).

**Handing back.** A "with you" worker hands back only after the human says they're happy or
presses Hand back. An "on its own" worker hands back when its done-when is met. The handback is a
card in the lead's chat: the worker's summary (which must carry any direction the human gave it),
commit count, files changed, a link to the worker. Beneath it is what the lead did: **Landed**,
**Sent back: …** or **Dropped** (decisions 4, 21).

### What the lead does

- **Offers workers by a firm rule** (decision 20). Taste work gets "with you" workers, one per
  piece judged separately. Self-contained build work gets "on its own" workers. Small jobs, landing
  and fix-ups it does itself. It offers in the plan, and mid-chat when the human starts iterating
  on a design in the lead's own chat. It picks each worker's model from the human's annotated
  models.
- **No more build tickets** (decision 13). All handed-off build work is workers. Rounds remain
  only for the end-of-feature review ticket until `burns-become-workers` retires them.
- **Lands a handback with one tool**, through the feature's landing queue like its own commits,
  then runs the project's checks itself. Or it sends the work back with a message, or drops the
  worker. Where one piece must wait for another, it starts the second after landing the first.
- **Messages any worker at any time.** A message sent mid-turn waits for the turn's end
  (decision 17).
- **Is woken by a worker only** by a handback, or once when the worker fails (decision 16).
- **Cannot declare ready** while a worker is working or holds unlanded commits (decision 19).

### What a worker is, underneath

A worker is a thread of a new session kind, **`worker`**, owned by one feature. It replaces the
`side` kind, which is removed (decisions 7, 13). Its record is a database row, not the prototype's
JSON file. The row holds label, purpose, kind (with you / on its own / unassigned), goal,
done-when, model, who started it, status, container, branch, preview port, and its latest
handback and what the lead did with it.

**Statuses:** working, queued, needs you, handed back, landed, dropped, failed. Old side chats keep
their `side` rows and are rendered read-only.

**The sandbox** is the prototype's (decision 1). A container from the project's burn image, its
own bare copy of the feature branch, one published port bound to the host's loopback, no route to
runcastle or the host repo. It stops after the idle time and resumes on the next message or
preview open. Its conversation-reload guard looks inside the sandbox, not on the host disk.

**Runtimes** (decision 12). Claude Code and Codex. Each runs its ACP adapter inside the container
over `docker exec -i` / `podman exec -i`, resumes after an idle stop, and runs in its provider's
automatic permission mode: Claude Code's auto mode, Codex's auto-review. If that mode isn't
available, the worker is free inside its sandbox and asks before any MCP call (decisions 10, 11).

**The human's setup** goes in at start and wake as a read-only copy (decision 8):
- Claude Code: global CLAUDE.md, rules, skills, agents, enabled plugins, model and effort
  settings, and MCP servers (user-level, plugin-provided, the repo's own) with their logins.
- Codex: the equivalents (its instructions file, skills, config, MCP servers).

Hooks stay out. No settings page.

**Runcastle's tools for a worker** (decision 9): hand back, start its dev server, read the
feature's state, show a file or screenshot in its own chat, park a backlog feature. Runcastle
serves them from outside over the connection it already holds into the container, so the sandbox
gains no route out. None of the lead's tools.

**The limit** (decision 14). The machine-wide "burns at once" setting becomes "agents working at
once". It counts ticket agents and workers mid-turn together. Workers over it queue and start by
themselves.

**Always on** (decision 22). `experimentalWorkers` is removed. Without Docker or Podman, the "+"
and the lead's offers say so and point at the doctor.

**Cleanup** (decision 18). Dropping a worker removes its container and branch. A feature's merge
or archive removes all its workers.

### Lead tools (names provisional until built)

Start a worker (label, purpose, kind, goal, done-when, model), message a worker, land a worker,
send a worker back, drop a worker, and worker rows inside `get_feature_context`. The worker-side
tools are listed above.

## Seams

- **The worker service** (new, grown from the prototype's): start, message, hand back, land, send
  back, drop, fail, idle-stop, wake. You can observe the worker row's status changes, the events
  emitted, the message delivered to the lead, and the commits on the feature branch after a land.
  It is tested with a fake sandbox engine, so the whole lifecycle runs without Docker.
- **The sandbox engine** (existing in the prototype, extended). Run arguments, the setup script,
  the copy of the human's setup, adapter exec arguments per runtime, and the permission-mode
  flags. Observed as the exact command lines and files it produces. A Docker-backed smoke test
  covers the real path once.
- **The MCP audience table** (existing). The `worker` kind's tool set and the lead's new tools.
  Observed as the tool list per session kind.
- **The feature need** (existing, feature-need). A worker entering needs you raises a need whose
  tap opens the worker. Observed as the need event and the push body.
- **The worker grouping** (new, the web `workers` lib). Grouping and ordering by worker
  status. A pure function, tested directly.
- **The design pass-through** (existing). Routing to a worker's preview, and waking a stopped
  sandbox on open. Observed as the proxied response.
- **`declare_ready`** (existing). It refuses while a worker works or holds unlanded commits.
- **Web components** (new): the worker rows, the assignment card, the worker chat header, the
  handback card. They're settled in the design pass and tested at the component tier STYLE.md
  names.

## Out of scope

- Moving review tickets, the remaining ticket and round machinery, and the conflict resolver onto
  workers, and retiring rounds: `burns-become-workers`, which must leave no rounds and no old
  code behind (decision 13).
- Drive-fix (scenario) chats becoming workers. ADR-0019 lists them, but no feature owns them yet.
- The general wake rule for news: `agents-are-woken-only-when-it-matters`. This feature wakes a
  lead only on a handback or a failure.
- Compaction and in-reply subagents: `lead-chats-stay-small`.
- A machine-wide worker pool beyond the shared limit, and bundling several pings into one.

## Open questions

- Whether Claude Code's auto mode is available with the token workers run on (`CLAUDE_CODE_OAUTH_TOKEN`).
  The fallback in decision 10 covers a no.
- The exact way runcastle serves the worker's runcastle tools from outside the sandbox: an MCP
  server inside the container that relays over the held `docker exec` stream, or ACP's
  client-provided MCP. Decided when built. Either way the sandbox gains no route out.
- How the project's recorded dev command is made to accept outside connections in a worker
  (a flag, an env var, or the worker fixing it). Decided per project, as the prototype found.
