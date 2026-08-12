# The work record gets thick

## Problem

When a burner finishes a ticket, everything it learned evaporates with the sandbox. The work record keeps structural residue — seams, commits, status, error — but not the story: what was actually done (versus what the ticket asked for), what surprised the agent, what it noticed and deliberately left alone. Later consumers pay for this: a project session asking "what did that feature actually do?" gets commit SHAs; a burner touching the same seam next month re-discovers the same gnarly coupling; a human reading a shipped feature's docs finds intent (brief, decisions, spec) but no account of what happened. The ticket text can't fill the gap — it is intent written before the code existed, and the burner may have satisfied it by another route.

## Approach

Three layers of prose, each mechanical above the first:

**Per-ticket digest.** The implement-ticket burner prompt gains a contract: as its last act before signaling `COMPLETE`, the agent writes a digest file (`DIGEST.md`) at the sandbox workspace root — the same host-visible location where `BLOCKED.md` lands, but workspace-only (no dual-write into the repo, so it can never be committed). The digest follows a light three-part template, ~10–15 lines: (1) what was actually done, past tense, including deviations from the ticket's stated approach; (2) surprises the spec/tickets didn't anticipate; (3) adjacent work noticed and deliberately left undone. It is a success artifact — failed/blocked tickets keep `BLOCKED.md`/`error` as their record. After a successful run the workflow harvests the file and stores it in a new `digest` column on the ticket row. Harvest is strictly best-effort: a done ticket with no digest file is still done — `digest` stays null and the burn emits a `digest.missing` event so the gap is visible in the timeline. A ticket retried across runs gets one digest, from the attempt that succeeded. Conflict-resolver agents never write digests; landing is plumbing.

**Run aggregate.** At burn finalize, the digests harvested during that run are concatenated under per-ticket headers into a new field on the run row — strictly mechanical, no server-side LLM call ever. The existing one-liner `run.summary` is untouched. The aggregate's value is provenance: when a feature takes multiple runs, each run row tells you which attempt produced which outcomes.

**Feature outcome doc.** Inside the merge path, just before the `--no-ff` merge, the host composes `outcome.md` in the feature's docs dir from the DB: a feature header (title, one-liner, shipped date, lap), then per-ticket sections in `seq` order carrying each digest; failed/cancelled tickets appear as one-line entries with status and error headline — the record is honest, not a highlight reel. The doc is committed onto the feature branch and rides the merge into main beside the other feature docs. It is regenerated wholesale from the DB on every merge, so multi-lap features get a fuller doc each lap with no append bookkeeping. Composition is a pure function (feature + tickets in, markdown out) so it is testable without git.

**Serving.** `get_work_record` ticket entries gain the `digest` field — this is the payoff for agent consumers (project sessions, revisit sessions, future burners querying by seam). The run aggregate is deliberately NOT added to `get_work_record` (it would double responses with re-concatenated information); it is served to the UI via tRPC only. UI is minimal and uses existing surfaces: ticket cards show the digest collapsed/expandable when present, run rows expose the aggregate, and `outcome.md` needs zero new UI because the existing doc-viewing surface picks it up as another feature doc.

## Seams

- **Burner prompt template** *(existing)* — the rendered implement-ticket prompt; observe that the digest contract (file name, location, template, success-only timing) is present and correctly parameterized.
- **Digest harvest in the ticket-burner workflow** *(existing, extended)* — the post-run boundary where `BLOCKED.md` is already read; observe that a workspace `DIGEST.md` lands on the ticket row, that absence yields null + `digest.missing` event, and that failed runs harvest nothing.
- **Tickets service** *(existing)* — schema + update path; observe the `digest` column round-trips.
- **Run finalize in the runner/workflow** *(existing, extended)* — observe the run row's aggregate field is the mechanical concatenation of that run's harvested digests.
- **Outcome-doc composer** *(new, pure)* — feature + tickets in, markdown out; observe ordering, header content, digest inclusion, and honest rendering of failed/cancelled tickets. The single new seam, deliberately IO-free.
- **Merge path in the git service** *(existing, extended)* — observe that merging a feature commits `outcome.md` onto the feature branch before the `--no-ff` merge, and that a second-lap merge regenerates it.
- **`get_work_record` MCP tool** *(existing, extended)* — observe ticket entries carry `digest` and run entries do not carry the aggregate.
- **tRPC surface for the UI** *(existing, extended)* — observe ticket and run payloads expose digest/aggregate for the web app.

## Out of scope

- Any server-side LLM summarization — all aggregation is mechanical concatenation.
- Digests for failed/blocked tickets (`BLOCKED.md`/`error` remain their record) and for conflict-resolver agents.
- Research/waypoint runs — this feature is about ticket burns only.
- Committing per-ticket digest files to the repo; the only repo artifact is `outcome.md` at merge.
- New UI views (work-record browser, seam-search UI); only existing surfaces are touched.
- Backfilling digests for already-shipped features.

## Open questions

None — all branches were resolved during ideation.
