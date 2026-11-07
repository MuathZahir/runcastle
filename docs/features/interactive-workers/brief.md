## Purpose

The core of the **worker model** cut (2026-11-06). Two levels: the orchestrator delegates to features; each feature's lead delegates to **workers**. A worker is a thread with a label, an assignment (goal + done-when), its own workspace and branch, a status (working / needs you / handed back / landed / failed) and a **handback** (short summary + commits/files) that wakes its lead once. The human can open any worker and talk to it.

The human's picture (2026-11-06): designing the sidebar, the lead grills the human, then delegates components to different workers. The human clicks a worker and iterates on that component with the agent until it looks good; the worker hands the design back; the lead integrates. "I wouldn't think to create a new thread, since that chat has all the context" — so **the agent must proactively know when to hand work to a worker and offer it**, and it must be easy to see what each worker does and navigate between them. It must make sense as a software development lifecycle.

## Why

Token analysis (2026-10-23 to 11-06): feature chats were 1.3B tokens, 99% the lead working alone in one window that grows to 300–700k. Side chats (`several-sessions-per-feature`) were used 4 times in two weeks: nothing comes back from them (that feature decided "no notice to the main chat"), and no agent offers one. Side chats also caused trouble: one committed a fix on a feature whose lead had already declared it ready, and the lead was never told (35418a3f); another rewrote shipped `runcastle move` code onto main with no feature recording it (14e693da). The handback is the missing piece — the lead reads handbacks, not the worker's work, and that keeps it small.

## Understood (settled with the human)

- **The lead may still write code itself.** Its prompt prefers handing work to a worker; when starting a sandbox isn't worth it, it does the job itself.
- The lead **offers** workers, typically in its plan after grilling ("header and thread list are taste work, each gets a worker with you; the data changes run in the background"). The human starts them with a click — the existing draft's rule "no threads without the human's click" is the starting point to grill, not a settled decision.
- **Drowning is solved by labels and a list**: each feature has a worker list like the main sidebar — the lead's chat, then workers grouped by status, "needs you" on top, done collapsed, each with a one-line purpose.
- **Side chats become workers the human starts** without an assignment.
- The lead's own in-reply subagents stay invisible; a worker is something with its own workspace, record and handback.
- Where interactive workers run (sandbox vs host worktree) is **decided by the human at checkpoint 1** from the prototype's findings — read `docs/features/workers-prototype-an-agent-you-can-enter-inside-a-sandbox/` before planning.

## Must not swallow

- Moving burn tickets, reviews and conflict resolvers onto workers → `burns-become-workers`.
- The wake rule for news → `agents-are-woken-only-when-it-matters` (this feature's handback must follow it: a parent is woken by a handback or a real question only).
- Compaction and subagent delegation → `lead-chats-stay-small`.

## Open

- What a worker's assignment and handback look like to the human; whether a worker that needs feedback notifies the human or only shows "needs you" (on held features only the orchestrator may notify the phone).
- Whether the main sidebar shows workers or only the feature page does.
- Supersedes the drafts `agents-hand-work-to-a-new-thread` and (partly) `open-a-worker-while-it-works`.

## Ordering

Waits on the prototype; up next — its branch is cut when the prototype merges, but it is planned only after the human's checkpoint-1 decision. `burns-become-workers` waits on this.

## Working agreement (cut 1, agreed 2026-11-06): checkpoints

**Checkpoint 2 is this feature**: when it is ready, the orchestrator starts a drive and the human plays with interactive workers before burns move over. The orchestrator merges it only once the human has passed it there.

## Added by the orchestrator, 2026-11-06

## Planning mode: grill with the human (2026-11-06)

The human decided this feature is planned in a full grill with them, not by a self-planning run. It shapes how they work with agents and what they see, so they want to be on the same page before anything is built. The orchestrator does not call plan_feature on it; it tells the human to open this feature's chat.

## Added by the orchestrator, 2026-11-06

## Checkpoint 1: sandbox (the human, 2026-11-06)

"Let's try the sandbox. We can test it for now." Interactive workers run in a sandbox, the way the prototype built them, as a trial the human will revisit after using it. Still open for the human: what of their own setup (skills, CLAUDE.md, rules, MCP servers, plugins) is brought into a worker's sandbox — the prototype found the sandbox starts clean. Read `docs/features/workers-prototype-an-agent-you-can-enter-inside-a-sandbox/report.md` for the measurements and the gaps it left (preview through runcastle's proxy for the VPS, dev servers bound to all interfaces, failure handling, the resume guard looking inside the sandbox).
