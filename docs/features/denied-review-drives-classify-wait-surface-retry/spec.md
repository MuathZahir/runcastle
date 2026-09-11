# Denied review drives: classify, wait, surface, retry

## Problem

A review ticket that cannot start its drive silently downgrades to Gates mode (repo-only review), and the human learns about it from the digest, after the fact. Two very different causes get the same flat treatment — the `review_drive` tool tells the agent every refusal "is final and never worth retrying":

- **Slot held (transient).** The machine-wide drive slot — one active drive of any kind — is taken by a human test drive, another review drive, or a prep dry run. The review collides, gives up instantly, and delivers the weaker no-app review even when the slot would free in ninety seconds.
- **Dirty tree (needs the human to act).** The human leaves agents working, comes back, and finds "couldn't drive: dirty working tree" buried in a digest — no notification at the time it happened, and no way to get the drive-mode review after cleaning up.

## Approach

From the human's perspective: a review that collides with a busy drive slot now waits it out and usually still delivers the drive-mode review; a review blocked by their own uncommitted files tells them *immediately* — a banner in the review panel naming the dirty files — and, once they've cleaned up, a **Retry review** button relaunches the same reviewer, which resumes its previous conversation and does the drive pass it was blocked from, instead of redoing the whole review.

The shape, in four layers:

**1. Classified denials (service layer).** The drive-start denial result keeps its verbatim human-facing `deniedReason` string and gains two structured fields: `deniedCode` — an enum of `dirty` | `slot_held` | `active_run`, with both slot flavors (human/review drive, dry run) collapsing to `slot_held` — and `retriable: boolean`, derived from the code (`slot_held` → true, everything else → false). A `dirty` denial additionally carries `dirtyFiles: string[]` taken from the porcelain status. The singleton slot semantics are untouched; contention is still never fought over server-side.

**2. The loud event (service layer → SSE → review panel).** A `dirty` denial of a *review-purpose* drive emits a `reviewdrive.denied` event on the feature timeline at the moment of denial — message naming the dirty files (truncated like the existing carried-changes event), `data` carrying `{ code: 'dirty', dirtyFiles }`. Slot-held polling emits nothing (ten poll rows would spam a permanent timeline). The human's manual Test drive keeps its current inline denial treatment; no OS-level notifications.

**3. The wait (tool description + burner skill).** The `review_drive` tool description is rewritten: a `slot_held` denial is worth polling, a `dirty` one is final. The review-ticket burner skill instructs: on `slot_held`, re-poll `start` roughly every 30 seconds for about **ten attempts** (~5 minutes, expressed as an attempt count because agents count attempts reliably and clocks poorly), then fall back to Gates mode exactly as today. Not configurable per project. The digest wording distinguishes "waited ~5 min, slot never freed" from "dirty tree" so the human can tell the outcomes apart.

**4. The retry (per-ticket retry path + review panel).** The review panel renders the `reviewdrive.denied` event as a prominent banner carrying a **Retry review** button. The button re-burns the review ticket through the *existing* per-ticket retry path, loosened to also accept a `done` review ticket whose run recorded a dirty-tree drive denial (a denial never ends the review, so the ticket ends `done`, not `failed`). The re-burn resumes the preserved session chain — the resumed reviewer keeps its Gates findings and does just the drive pass — falling back to a fresh burn where resume is unsupported or capped, exactly as retry does today. The endpoint pre-checks the tree and refuses while it is still dirty, naming the still-dirty files. Eligibility derives from the existing run/event record, not a new ticket status. Banner lifecycle: shown while the latest review run recorded a dirty denial; gone when a retry burn starts, the feature leaves review phase, or the human dismisses it (a new denial brings it back).

## Seams

- **Drive-start denial result** (existing, extended): the service-level result of starting a test/review drive. Observes: `deniedCode`, `retriable`, `dirtyFiles`, and that verbatim `deniedReason` is preserved. Testable by seeding a dirty tree / an occupied slot and asserting the classified shape.
- **`review_drive` MCP tool result** (existing, extended): what the review agent actually sees. Observes: the classified denial passing through the tool boundary intact, and the rewritten description.
- **Feature event stream** (existing): `reviewdrive.denied` emitted exactly on a dirty review-drive denial, with dirty files in message and data; nothing emitted on slot-held denials or for human-purpose drives.
- **Per-ticket retry procedure** (existing, loosened): accepts a `done` review ticket with a recorded dirty denial; refuses with still-dirty files while the tree is dirty; refuses everything it refuses today. Observes: the eligibility rule and the pre-check, plus resume-vs-fresh selection via the burner's existing chain machinery.
- **Review-ticket burner skill text** (existing, edited): the poll-with-attempt-count instructions and the two digest wordings. Observed by prompt-contract review rather than runtime assertion.
- **Review panel banner** (new UI surface on existing event/query data): visibility rules (appear on latest-run dirty denial; clear on retry start / phase exit / dismissal) and the retry button wiring.

## Out of scope

- Server-side drive queueing, preemption, or a blocking start call — the singleton slot semantics stay; the wait lives agent-side.
- The hook-failure drive-fix flow ("Fix drive", `retry_drive`, drive-fix sessions) — imitated in spirit, not redesigned or touched.
- Eliminating causes of dirty trees — the dominant pipeline-caused case is already fixed upstream; remaining dirt is confirmed human dirt.
- The human's manual Test drive UX, including any banner or notification for its denials.
- A per-project timeout knob for the slot wait, and any OS-level notification channel.

## Open questions

- Whether the resumed reviewer's second digest replaces or appends to the first — left to implementation; either is acceptable so long as the human can see both outcomes happened.
