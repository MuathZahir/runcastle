# Decisions — denied review drives: classify, wait, surface, retry

## 1. Whole feature, one lap, no map
**Decision:** Spec both denial paths (slot-held wait + dirty-tree surface/retry) in full for lap 1; no waypoint map, no deferred scope.
**Why:** The brief is already settled at the shape level from the project session; the four touched surfaces share the retriable-vs-final plumbing; the retry affordance looks buildable on the existing `ticket.retry` attempt-chain machinery rather than needing new invention.

## 2. Remaining dirty-tree denials are real human dirt
**Decision:** No further upstream dirt-elimination work; the design treats a dirty-tree denial as the human's own uncommitted changes in the main checkout, worth surfacing loudly and retrying after cleanup.
**Why:** `commitPipelineDocs` already fixed the dominant pipeline-caused case (staged `brief.md`); the human confirms recent dirt is their own. So the loud event + retry path is the main event, not a rare-case fallback.

## 3. Denial shape: verbatim reason + structured code + retriable flag + dirty files
**Decision:** Keep `deniedReason` (verbatim human-facing string) and add to the denial result: `deniedCode` enum (`dirty` | `slot_held` | `active_run`; both human-drive and dry-run slot flavors collapse to `slot_held`) and `retriable: boolean` derived from the code (`slot_held` → true, all else → false). The `dirty` denial additionally carries `dirtyFiles: string[]` from the porcelain output.
**Why:** The agent must not string-match prose to decide whether to wait; `retriable` keeps the burner-prompt logic enum-free ("if retriable, poll; else report"). The two slot flavors are identical to a waiting agent — someone holds the machine-wide slot and it frees on its own. Dirty files on the denial let both the loud event and the digest name the actual files.

## 4. Slot-held wait: ~10 polls ~30s apart, hard-coded, prompt-side
**Decision:** On a `slot_held` denial the review agent re-polls `review_drive start` roughly every 30 seconds for about ten attempts (~5 minutes), then falls back to Gates mode as today. The ceiling is expressed in the burner prompt as an attempt count, not a clock duration; it is not configurable per project. The `review_drive` tool description is rewritten to say `slot_held` is worth polling and `dirty` is final.
**Why:** Five minutes covers the realistic collision (a drive or dry run wrapping up); longer means a human mid-session who won't be waited out. A config knob needs a reader, a doc and a UI row nobody will tune — changing one prompt constant later is cheaper. Attempt-counting is reliable for an agent; clock-watching is not. Wait stays agent-side per the standing no-server-queue decision.

## 5. Dirty denial fires a `reviewdrive.denied` event; slot-held polling emits nothing
**Decision:** A `dirty` denial of a review drive emits `reviewdrive.denied` server-side at the moment of denial — message names the dirty files (truncated like `testdrive.carried_changes`), `data` carries `{ code: 'dirty', dirtyFiles }`. The review panel renders it as a prominent banner carrying the retry affordance, not just a timeline row. Slot-held polling emits no events; a timed-out wait is covered by the agent's observation and a digest wording that distinguishes "waited ~5 min, slot never freed" from "dirty tree". No OS-level notifications.
**Why:** The denial is the moment the human can still act, and it currently emits nothing — the SSE stream is the existing real-time channel. Ten poll events would spam a permanent timeline for a fallback working as designed. A notification channel is its own feature this one must not swallow.

## 6. Retry = extend `ticket.retry` to a done review ticket whose drive was denied dirty
**Decision:** The banner's "Retry review" button re-burns the review ticket through the existing per-ticket retry path, loosened to also accept a `done` review ticket whose run recorded a dirty-tree drive denial. The re-burn resumes the preserved session chain (the reviewer keeps its Gates findings and just does the drive pass), falling back to a fresh burn where resume is unsupported/capped, exactly as retry does today. The endpoint pre-checks the tree and refuses while still dirty, naming the still-dirty files. Eligibility derives from the existing record (the dirty-denial evidence on the run/event), not a new ticket status — the review ticket's lifecycle is untouched.
**Why:** The resume machinery the brief hoped for already exists in the burner (cross-run resume with fresh-start fallback); a parallel retry flow would duplicate it. A denial must never end the review (standing decision), so the ticket ends `done` and retry must accept that. The dirty pre-check avoids burning an agent that would only be denied again.

## 7. Banner lifecycle; review-purpose drives only
**Decision:** The banner appears while the latest review run recorded a dirty denial, and goes away when a retry burn starts, the feature leaves the review phase, or the human dismisses it (a new denial brings it back). The denial event and banner apply only to review-purpose drives; the human's manual Test drive keeps its current inline denial treatment.
**Why:** The banner is an actionable prompt, not a permanent record — the timeline event is the record. The manual drive UX is explicitly out of scope per the brief.
