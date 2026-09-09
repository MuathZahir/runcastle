## Why this feature exists

Today a review ticket that cannot start its drive silently downgrades to Gates mode (repo-only review) and the human learns about it from the digest, after the fact. Two denial paths cause this, and they deserve opposite treatments — but the current `review_drive` tool description (packages/server/src/mcp/server.ts:1684) flattens them into one rule: "Refusals (a dirty tree, a drive the human is already running) are final and never worth retrying."

**Path 1 — slot held (transient).** The drive slot is a module-level singleton (`testDriveState`, packages/server/src/services/git.ts:1826): one active drive of any kind, machine-wide — human test drive, another review drive, or a prep dry run. A second `start` gets `DENY_ACTIVE` and never queues. A review that collides delivers the weaker no-app review even if the slot would free in 90 seconds. The burner already polls within its turn (that's how it waits for the dev URL), so agent-side polling is mechanically fine.

**Path 2 — dirty tree (needs a human or an agent to act).** Waiting never fixes it. The human's real complaint: they leave agents working, come back, and find "couldn't drive because of dirty working tree" buried in a digest — no notification at the time, no offer to retry the review after cleaning up.

## What was agreed (project session, 2026-09-08)

- One feature covering both paths — the retriable-vs-final classification is shared plumbing and the seams overlap too much to burn as separate features without collision.
- **Slot-held →** the review agent polls `review_drive start` (~15–30s interval) up to a max timeout, then falls back to Gates mode as today. Human floated 5 minutes as the ceiling; whether it should be configurable per project is an open design question for ideation.
- **Dirty-tree →** deny immediately (no waiting), but fire a loud, immediate event naming the dirty files so the human sees it in real time, and offer a retry of the review from the review panel after cleanup. Ideally the retry resumes the same review session rather than restarting from scratch — drive-fix sessions already do exactly this (resume machinery at packages/server/src/launcher/launcher.ts:755–775, "it already knows what it tried"), but whether a non-interactive review burner can resume the same way is a real design question, not settled.
- Human explicitly does not want a denial to be the reason a review ends. Note: it already doesn't end the review — Gates-mode fallback is the existing behavior (packages/skills/burner/review-ticket.md, "Could not review" section). What's missing is the wait, the visibility, and the retry.

## Prior art the design must respect

- `commitPipelineDocs` (git.ts:1745) already fixed the historically dominant dirty-tree cause: the pipeline leaving `brief.md` staged ("three of four review drives were refused with nothing dirty but a brief"). Remaining dirt is presumed real. The human was asked what their recent dirty files actually were and hasn't answered yet — worth asking again in ideation, since if it's still pipeline-caused dirt the right fix is upstream of all of this.
- The drive-fix flow ("Fix drive" button, `retry_drive` tool, resumed sessions) exists for hook failures of a drive that *started*. A dirty-tree denial happens before any drive exists, so that flow never triggers. It's the pattern to imitate for the retry affordance, possibly the machinery to extend.
- Contention is deliberately never fought over server-side (git.ts:2194). The agreed approach keeps the wait on the agent/prompt side (poll the tool), not a server-side queue or blocking call — a blocking MCP call for minutes was considered and rejected.

## Surfaces this touches

- `packages/server/src/services/git.ts` — denial results (add a retriable/final discriminant, or distinguishable reasons; dirty-file list in the denial).
- `packages/server/src/mcp/server.ts` — `review_drive` tool description rewrite; result shape.
- `packages/skills/burner/review-ticket.md` — the poll-with-timeout instructions; when to give up and go to Gates mode; digest wording.
- `apps/web` review panel + events — the dirty-tree denial event and the retry affordance.

## What this feature must NOT swallow

- The existing hook-failure drive-fix flow — extend or imitate, don't redesign it.
- Eliminating causes of dirty trees (partly done via `commitPipelineDocs`; anything further is its own work).
- Server-side drive queueing/preemption — explicitly rejected; the singleton slot semantics stay.
- The human's own manual Test drive UX — this is about the review ticket's path.
