# Drive chats become workers

## Problem

Two chats sit beside a running test drive: the Fix-drive chat, opened when the drive's setup
script fails, and the scenario chat, opened from "New scenario" or "Fix it". They are the last
delegated agents outside the worker model (ADR-0019 point 4). They have their own thread kinds,
launch paths, sidebar list and lifecycle: they never hand back, their lead never hears what they
committed, they do not show a worker's status or header, and the scenario chat forgets everything
when the drive ends. Every other delegated agent is a worker with a label, assignment, status and
handback; these two are the inconsistency left before runcastle is published.

## Approach

**What the human sees.** Nothing moves during a drive: the same buttons start the same chats,
docked beside the drive, in the same checkout, with the same tools and limits. The chat now
carries the worker header (label, status, Hand back) and an assignment card ("Fix drive" — fixes
this drive's setup; "Scenarios" — writes and fixes this drive's scenarios; started by you). In the
feature's sidebar page the two rows join the worker groups (Needs you / Working / Done) instead of
their own list. On a project drive the Scenarios worker is listed with the project's chats. A
drive worker ending its turn shows "needs you" and pings like any worker (decision 8). When the
drive stops, the workers go quiet into Done with a handback, and the next drive's button reopens
the same worker with its memory (decision 5). Old `drive-fix` and `scenario` chats stay as
read-only transcripts marked "Old drive chat" (decision 10).

**Shape.**

- **Worker kinds.** `WorkerKind` gains `fix-drive` and `scenario`. Placement is derived from the
  kind: the drive review (`review` + mode `drive`), `fix-drive` and `scenario` are **host
  workers**; every other kind is sandboxed. The review-only predicate (`isHostReview`) becomes a
  general host-worker predicate, and the review-specific parts (waiting for the drive slot, giving
  it back) stay keyed to the review. Host workers run in `project.repoPath` with the drive-chat
  posture of today: `bypassPermissions` on Claude Code, `workspace-write` on Codex, the edit guard
  (`.runcastle/` and `.gitignore`; the whole checkout in scenario setup mode) and the checkout
  guard (decision 9). Model from the "Drive chats" roster step, as today.
- **Owner.** A worker row is owned by a feature or by the project: `featureId` becomes nullable
  with a `projectId` column (migration backfills `projectId` from the feature). Only a project
  drive's Scenarios worker is project-owned (decision 2). Everything that lists or wakes "the
  feature's workers" keeps working on feature-owned rows; the project chat list adds its own.
- **Start and resume.** The existing routes (`feature.fixDrive`, `feature.openScenarioChat`) keep
  their inputs and guards, and now call one worker-service entry that finds the owner's worker of
  that kind or creates it, sets it working and sends the ask (the failure brief for Fix drive; the
  ask, the env and the runner for Scenarios; the lead's latest turns on a feature drive, as
  today's prompts carry). Today's prompt renderers become these workers' briefs plus the worker's
  hand-back instructions. The drive's in-memory link to its scenario thread now points at the
  worker. A press while the other drive worker is working is refused with which one is working
  (decision 13). Drive workers bypass the "agents working at once" slots and the account hold
  (decision 7). The resume cap that today starts a fresh drive-fix conversation when the old one is
  too long applies to both kinds.
- **Handback.** Host workers hand back through the host handback file the drive review uses. A
  drive worker's handback carries its summary, the branch its commits landed on, and the commits
  it made there during this drive (its files changed). Its brief tells it to name that branch in
  the chat whenever it commits, and the handback card shows it, so a commit on a project drive's
  base branch is never a surprise (decision 3). There is no land step: the worker goes straight to
  `handed-back` (Done), never `landed`, and `land_worker`, `send_back_worker` and `drop_worker`
  refuse it with the reason. The lead (or, for a project drive, the project chat) receives the
  handback card **without a wake**: it is delivered with its next message (decision 4). The
  Fix-drive worker hands back by itself once `retry_drive` leaves the app answering; its own
  `retry_drive` stop-and-start is not a drive stop.
- **Drive stop.** The drive's stop (human Stop, merge, anything that frees the slot) ends both
  drive workers' live turns and writes their handback on their behalf: commits during the drive,
  files touched, files left uncommitted (which come back with the checkout under the drive's
  existing carried-changes notice), and the worker's last message as summary (decision 12).
  Between drives a drive worker refuses messages, from the human and the lead, with "starts with
  your next drive's <button>".
- **Messages and ready.** Only the human writes to a drive worker: the lead's `message_worker`
  refuses one with the reason (decision 6). Drive workers never block `declare_ready`
  (interactive-workers decision 19 counts only workers with work to land). Feature Stop cancels
  their turns like any worker's.
- **Retired.** The `drive-fix` and `scenario` session kinds are no longer created. Their launch
  functions, kind-specific branches in the launcher, hooks, naming, threads and MCP audiences fold
  into the worker paths. Existing rows of those kinds read as "Old drive chat" transcripts that
  take no message, like old side chats. `get_work_record` lists drive workers with their handbacks.
- **Safety nets.** Drive workers get the worker runner's transient-error retry, stall detection
  and restart carry-on (`burns-become-workers` decisions 8–10). A restart that finds the drive
  gone hands them back as at a drive stop.

## Seams

- **The two drive routes** (existing): `feature.fixDrive` and `feature.openScenarioChat`. Observe
  the worker row created or resumed (kind, owner, status), the ask delivered, the refusal while
  the other drive worker works, and the refusal with no drive.
- **The worker service** (existing, extended): the drive-worker start/resume entry, the turn-end
  handback for host workers, and the drive-stop handback. Observe status transitions
  (`working` → `needs-you` → `handed-back`), the handback's commits and files, the absence of a
  lead wake, and the refusals of land, send back and drop.
- **The drive's stop** (existing, in the git service): observe that it ends drive workers' turns
  and leaves their uncommitted files under the carried-changes notice, and that `retry_drive` does
  not.
- **`worker.list` and the project's thread list** (existing tRPC): observe drive workers in the
  feature's groups and the project-drive Scenarios worker in the project's list; old drive chats as
  read-only entries.
- **Session start** (existing): observe that no `drive-fix` or `scenario` session row is created
  and that an old one refuses a message.

## Out of scope

- The test drive itself: starting, stopping, the drive slot (ADR-0014).
- Sending drive-script fixes to the base branch (decision 14).
- A sandboxed placement for drive workers (decision 1).
- Changing what the two chats can write or which tools they hold (decision 9).
- The drive review worker's behaviour, beyond sharing the host placement.

## Open questions

- The human's own answer on the wake rule (decision 4) and the new pings (decision 8): both
  change how runcastle behaves for them, and the orchestrator's yes does not settle them.
- Whether a project-drive Scenarios worker's handback card in the project chat is noise in
  practice; it is quiet by decision 4 either way.
