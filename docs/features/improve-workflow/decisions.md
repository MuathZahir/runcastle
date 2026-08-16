# Decisions — Improve Workflow (automatic review)

## 1. Review is a ticket type, not a dedicated workflow
**Decision:** Automatic review is implemented as a new ticket kind (`review`), emitted by the tickets session alongside implementation tickets and burned in the same run, ordered after all implementation tickets via `blockedBy`. It is not a separate registered workflow.
**Why:** Maximizes reuse of existing machinery — the burner, run rows, digests, ticket UI, and the blockedBy graph all work unchanged. Multiplicity (several review agents covering different areas) is just several review tickets; optionality (backend-only features get a "run tests / curl endpoints" review, or none at all) is just what the tickets session chooses to emit — no config flag or mode. The tickets session, which holds full ideation context, is the natural author of "what to verify and how." The dedicated-workflow shape (a `review` WorkflowDef) remains available later if review outgrows the burner.

## 2. Review findings land as test notes
**Decision:** Review agents write their findings through the existing test-notes channel (`docs/features/<slug>/test-notes.md` + the notes service), not a new artifact type. A new MCP wire exposing note-writing to agents is required (none exists today).
**Why:** Test notes already feed the whole Fix loop — promote note → fix ticket → burn — so agent findings ride the existing pipeline with zero new concepts. The review phase becomes "human consumes the review artifacts (walkthrough video, notes) and chooses Merge / Fix / Rethink" instead of manually exercising the app from zero.

## 3. Review tickets run on the integrated feature branch
**Decision:** Unlike implementation tickets, a review ticket does not get its own branch — it runs against the integrated `feature/<slug>` branch after all implementation tickets have landed, with a distinct capability set: boot the app (drive machinery), drive it with agent-browser, write test notes. No code edits.
**Why:** Review must exercise the merged result, not a slice. The `dry_run_drive` MCP machinery is the working template for agent-driven app boot; the singleton drive slot already enforces mutual exclusion.

## 4. Review executes host-side via the existing drive machinery
**Decision:** Review tickets run on the host (not the burner sandbox) and boot the app through the existing test-drive plumbing — `driveEnv` injection (per-branch DB via `{{id}}`), `driveSetupCommand`/`devCommand`/`driveStopCommand`, dev-URL sniffing. The drive's deny-on-active-run guard gets a carve-out for review-purpose drives (safe: by the time a review ticket runs, all implementation tickets are terminal and the feature branch is quiet). Preparation machinery is taken as-is; no new provisioning concepts in this feature.
**Why:** The burner sandbox has no app and no database — the host drive is the only machinery that runs a target app, and it already carries the per-branch DB convention. Riding it keeps this feature small. Consequence accepted: the review drive switches the real checkout unattended at the tail of a burn, same as a human-started drive. Multi-service preparation gaps (redis namespacing, compose project-names/ports/health-waits, `{{port}}`, hosted DBs) are parked as their own draft feature, "Preparation supports multi-service projects."

## 5. Thin lap 1: the spine; video walkthrough goes to lap 2
**Decision:** Lap 1 proves the spine end-to-end: one `review` ticket kind, executed host-side at the tail of the burn, booting the app via the drive machinery, driving it with agent-browser, writing findings as test notes surfaced in the existing review panel. One review ticket per feature to start. Deferred to later laps (recorded in the spec's `## Later laps`): the video walkthrough surfaced in ReviewBody (agent-browser records natively; storage + playback UI is the deferred surface), multiple review tickets covering different areas, and a review-prompt template library. Backend-only reviews ("run tests, curl endpoints") need no template — lap 1 tickets are prose and can already express that.
**Why:** The genuinely uncertain bet is "are agent findings worth reading," not "can we show a video." A thin lap lets the human test-drive the review agent itself on a real feature before investing in polish.

## 6. Review is advisory and best-effort
**Decision:** Findings are not failure: a review ticket reports `done` when the review ran to completion, however many bugs it found — the notes are the deliverable, not a verdict. `failed` means "couldn't review" (app wouldn't boot, drive slot taken, dirty tree, agent crash); G4 counts failed as terminal, so the feature still lands in `review` with no agent notes — today's status quo, no new blocking states. No gate hardening in lap 1: the Merge click remains the whole of G5; at most the existing merge-summary warnings gain a review-status line.
**Why:** Teeth (merge blocked on unresolved notes) should wait until the agent's findings have earned that authority — false-positive notes blocking merges would sour the feature. Graceful degradation keeps burn runs from ever being hostage to the host drive slot.

## 7. Review output must be loudly visible in the review phase
**Decision:** The review phase UI must make it obvious that review tickets ran and what they produced — a summary surface (e.g. "Review agent: N findings" on the review screen's summary card, with agent-authored notes visibly attributed), not merely rows quietly appended to the notes list. A review ticket that failed is surfaced the same way ("review could not run: <reason>").
**Why:** The human's review now starts from the agent's report; if that report is easy to miss, the feature silently degrades back to manual review from zero. (Raised explicitly by the user: "just having the test notes might not be easily noticeable.")

---

*Lap 2 — decided without a human test drive of lap 1 (the user's explicit call: the pre-existing test-drive experience made driving unattractive — which is itself the strongest argument for the video walkthrough). Lap 2's own burn will exercise lap 1's spine end-to-end, since its review ticket runs through the machinery lap 1 built.*

## 8. Lap 2: the review agent records a video walkthrough
**Decision:** For browser reviews, the review agent wraps its walkthrough in `agent-browser record start/stop`, producing a WebM that lands in the per-ticket review directory (the `reviewDir` convention lap 1 introduced, `~/.runcastle/reviews/<ticketId>/`). The server serves the recording and a small artifact listing over plain HTTP routes; the review screen plays it inline (WebM plays natively in browsers — no transcoding). Non-browser reviews (tests/endpoints) produce no video; absence is a normal state, not an error, and recording failures never fail the review — the notes remain the deliverable.
**Why:** The user skipped the lap-1 human test drive because driving is unattractive; the video lets review be consumed without driving at all. Storage rides the existing reviewDir convention (repo stays clean — a video in the checkout would dirty the tree and block the drive); plain HTTP (not tRPC) because it is media, streamed with range requests.

## 9. Review survives failed implementation tickets
**Decision:** For review-kind tickets, a blocker counts as satisfied when it is *terminal* (done, failed, or cancelled), not only when it is done — a carve-out from the generic cascade-fail blockedBy semantics, applying to review tickets only. The review prompt tells the agent to state in its summary note when it reviewed a feature with failed implementation tickets.
**Why:** Lap 1's own digest flagged this: the tickets skill tells sessions to block review on *every* implementation ticket, so one flaky ticket cascade-cancels the entire review. Reviewing a partially-failed feature is more valuable, not less — the agent reports what actually works. This also aligns the burner's behavior with gate G4, which already treats failed as terminal.

## 10. Drive purpose and ticket kind are visible while running
**Decision:** `activeDriveInfo` exposes the drive's purpose so the UI can say "review agent is driving" instead of the misleading "test drive active"; the run screen's per-ticket lanes show the review kind chip so a review ticket visibly behaves unlike its neighbours (no branch, no container, no merge-queue entry).
**Why:** Both are lap-1 "left undone" items recorded in the ticket digests — the presentation was deliberately deferred until the behavior was real.
