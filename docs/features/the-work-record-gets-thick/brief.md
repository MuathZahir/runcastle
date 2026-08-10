## Why this exists

Nothing today records *what was actually done* in a feature at any useful granularity. The human finishes a burn and sees only "X tickets done"; after merge, coming back to a feature answers nothing about what changed. This was fact-checked during intake, and the gap is deeper than UI: `get_work_record` exists and is the right agent-facing shape (tickets with seams, commits, run summaries — facts, never intent), but the record it serves is thin. For `tickets-are-thick` the entire stored outcome was run summary `"1/1 tickets done"`, `seams: []`, and one bare commit sha. The merged docs on disk (`docs/features/<slug>/`) are brief/spec/decisions — all intent from *before* the code existed, no retrospective.

The root cause: the burner knows what it did — files touched, approach taken, deviations from the ticket — and that knowledge dies with its sandbox. Only the done/failed status and commit shas survive. The UI can't show what was never captured. Commits are in git, but a diff is not a digest: "what was done and why it differs from the plan" is non-regenerable once the burner's context closes. That non-regenerability is why this must be captured at the moment of work, not derived later.

## What it is — one pipeline, three stages

1. **Capture at burn.** The burner writes a short per-ticket **outcome digest** when it completes a ticket: what it did, files/seams touched, deviations from the ticket's intent. Stored in the machinery store (SQLite) alongside the ticket. This should also fix the empty-`seams` problem — seams should actually get populated by the burner.
2. **Aggregate at run end.** The run summary becomes an aggregation of the ticket digests instead of "X tickets done", and the post-burn UI surfaces the digests (per ticket: what happened, what was touched).
3. **Promote at merge.** Merging a feature promotes a feature-level outcome doc into `docs/features/<slug>/` (alongside brief/spec/decisions) — the retrospective "what was done", built from the digests. This serves both the human coming back later and agents: `get_work_record` and any future session reading the shipped feature's docs.

The reason this is one feature and not two: the merge retrospective's raw material *is* the burn digests. Splitting burn-reporting from merge-promotion would make the second feature depend entirely on the first.

## What it must NOT swallow (settled during intake)

- **Live observation of running burns** — streaming progress, richer mid-run logs. Already a charter deferred thread, and a different problem: this feature is about *remembering*, not *watching*.
- **Metrics / analytics** — time-per-ticket, throughput dashboards, etc. Out.

## Consumers to keep in mind

- The human, twice: right after a burn ("what did it just do?") and long after merge ("what was done here?").
- `get_work_record` — its shape is already right; this feature feeds it real content (digests, populated seams) rather than changing its contract, unless the digest needs a new field there.
- Future feature sessions and the project session, which read shipped features' docs off disk.
