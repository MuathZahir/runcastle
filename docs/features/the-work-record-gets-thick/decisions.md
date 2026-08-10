# Decisions — The work record gets thick

## 1. One lap, whole feature
**Decision:** Spec the entire feature in one lap — per-ticket outcome digests, run-summary aggregation, and merge-time promotion of a feature-level outcome doc. No map, no thin lap 1.
**Why:** Every touch point (burner prompt template, ticket-burner workflow, DB schema, `get_work_record`, merge path) is an existing seam; nothing needs research or prototyping first, and the human is sure this is what they want.

## 2. Digest handover via file convention
**Decision:** The burner writes its per-ticket digest as a file (the `BLOCKED.md` pattern: written to the sandbox workspace and the repo dir, dual-write) as its last act before signaling `COMPLETE`; the host harvests it after the run.
**Why:** Burners have no MCP channel. The file convention is already proven for `BLOCKED.md` and its harvest machinery exists; the final-message channel loses the digest if the agent is cut off, and commit trailers are too cramped for real prose.
*(Refined by decision 3: the digest file is written to the sandbox workspace only — no dual-write into the repo dir, so it can never be committed.)*

## 3. Digest stored on the ticket row, never in the repo
**Decision:** The harvested digest lands in a `digest` column on the ticket row, served by `get_work_record` beside `seams`/`commits`/`error`. Per-ticket digest files are never committed; the repo gets prose only once, at merge, as the feature-level outcome doc.
**Why:** Parallel burners committing digest files would invite merge conflicts and diff noise; the DB is where ticket facts already live and where the work record is already queried from.

## 4. Digest content: three-part template, success-only
**Decision:** The burner prompt enforces a light template, ~10–15 lines: (1) what was actually done, past tense, including deviations from the ticket's stated approach; (2) surprises the spec/tickets didn't anticipate; (3) adjacent work noticed and deliberately left undone. The digest is a success artifact, written just before `COMPLETE`; failed/blocked tickets keep `BLOCKED.md`/`error` as their record.
**Why:** The ticket text is intent; the digest is what happened — the decay stamp the work record's "facts, never intent" philosophy calls for. "Left undone" moves from commit bodies (where it rots unseen) into the queryable record.

## 5. Run aggregation is mechanical, no LLM
**Decision:** At burn finalize, the digests harvested during that run are concatenated under per-ticket headers into a new field on the run row. The existing one-liner `run.summary` stays untouched for lists/timelines. No server-side LLM call.
**Why:** The server makes zero model calls outside sandboxed agents and should stay that way; digests are short by contract, so concatenation reads fine. The run-level value is provenance — which attempt produced which outcomes when a feature takes multiple runs.

## 6. Outcome doc promoted at merge, regenerated wholesale
**Decision:** Inside `mergeFeature`, just before the `--no-ff` merge, the host composes `docs/features/<slug>/outcome.md` from the DB — feature header (title, one-liner, shipped date, lap), then per-ticket sections in `seq` order carrying each digest; failed/cancelled tickets appear as one-line entries with status and error headline. Committed onto the feature branch, then merged. Regenerated wholesale on every merge, so multi-lap features get a fuller doc each lap with no append bookkeeping.
**Why:** Merge is the only moment "what was done" is final, and the feature-docs dir already rides the branch into main. Wholesale regeneration is idempotent and lap-proof. Including failures keeps the record honest, not a highlight reel.

## 7. `get_work_record` serves ticket digests; run aggregate is UI-only
**Decision:** `get_work_record` ticket entries gain a `digest` field. The run-level aggregate is NOT added to `get_work_record` — it is served to the UI (tRPC) only.
**Why:** The ticket digest is the point for agent consumers — deviations and surprises, not just commit SHAs. The run aggregate is the same digests re-concatenated; returning both would double response size with no new information. Its audience is the human reading a run row.

## 8. Missing digest never blocks done
**Decision:** Digest harvest is strictly best-effort. A ticket whose agent committed work and signaled `COMPLETE` but wrote no digest file is still `done`; `digest` stays null and the burn emits a `digest.missing` event for that ticket so the gap is visible in the timeline.
**Why:** Commits are the ground truth of done-ness; failing a ticket or spending another agent iteration over missing paperwork is the tail wagging the dog. Visible-but-tolerated keeps the record honest without distorting outcomes.

## 9. Minimal UI: existing surfaces only, no new views
**Decision:** A done ticket's card (`TicketsBody`/`RunBody`) shows its digest collapsed/expandable; the run row exposes the aggregate; `outcome.md` gets zero new UI — `DocPeek` picks it up as another feature doc. No dedicated work-record browser or seam-search UI.
**Why:** The existing surfaces are the natural homes and the digest is short by contract. Fancier browsing is a later feature if it ever earns its keep.
