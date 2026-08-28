# Test notes

## Lap 1

- [ ] [Code review — Spec axis] A defect whose fix ticket is orphaned disappears from the review page entirely — it is counted in "N defects found" but appears in neither "fixed" nor "still open", and renders no row.

What I did: read `defectState` in `packages/server/src/services/review-findings.ts:191-198` and traced every writer of ticket status against it.

What happens: `burnTickets` calls `mirrorFinding(t, 'fixing')` the moment a fix ticket starts (`ticket-burner.ts`, the `start()` path), so the finding row sits at `status: 'fixing'`. If the run then dies — server restart, killed burn — `sweepOrphanedBurning` (`packages/server/src/services/tickets.ts:260-278`) flips that `burning` ticket to `failed` by calling `updateTicket` directly and never touches the finding. Now `defectState` runs with `finding.status === 'fixing'` and `fixTicket.status === 'failed'`:
- L192 not dismissed; L193 neither `fixed` nor ticket `done`;
- L194 `fixTicket.status !== 'failed'` is false, so the `fixing` branch is skipped;
- L197 `finding.status === 'open' || finding.status === 'failed'` is false → returns `'fixing'`.

In `viewByFeature` (L232-244) `'fixing'` increments `found` only. The defect is not in `summary.fixed`, not in `summary.open`, and not pushed to `openDefects`. So the counts line renders "3 defects found" and nothing else, the open-defects list is empty, and `promoteOpenDefects` (L266) can never reach that finding — "Fix N open defects" will not offer it, because N excludes it. The defect is unrecoverable from the UI.

What I expected: a fix ticket that reached a terminal non-`done` status leaves its defect visible as open. Server restart during a fix wave is ordinary (`workflows/reconcile-runs.ts:57` sweeps on every boot), not an edge case.

Citation — spec, decision #9: "the counts line is computed from `review_findings` + fix-ticket status, never agent-written… a computed count cannot lie." And decision #6: "Whatever stops (cap or failure), the human must never have to ask 'what do I do now'." The service's own docstring at L179-188 states the intent this misses: "The join is what makes the counts unable to lie."

Repro: report a defect via `report_finding`, let its fix ticket reach `burning`, kill the server, restart it (boot reconciliation sweeps the orphan to `failed`), then open the feature's review page — the defect is counted in "found" and listed nowhere.

Note: ticket 2's own digest names the cause ("a fix ticket killed with its run leaves its finding stuck at `fixing`") and defers it to `burn-reliability`. The cause may belong there; the consequence — a fallback in `defectState` that maps this state to `fixing` instead of `open` — is in this ticket's read model. Treating an orphaned/terminal fix ticket as `open` at L194-197 closes it without touching the burner.
- [ ] [Code review — Spec axis] The `/runcastle:code-review` skill still tells the review agent to file findings with `add_test_note`, a tool this branch unregisters for every audience.

What I did: read the two halves of the review contract this branch changes.

What happens: `packages/skills/burner/review-ticket.md` is fully converted to `report_finding` (L119, L161). But `packages/skills/packs/runcastle/skills/code-review/SKILL.md:121` still reads: "Called **by the review-ticket burner**, each finding becomes its own test note (`mcp__runcastle__add_test_note`) — one note per finding… The burner's prompt says this; follow it there." Meanwhile `packages/server/src/mcp/server.ts:1531-1534` sets `report_finding: ['run']` and `add_test_note: []`, so `add_test_note` is registered for no recognized session kind at all. An agent that reads the skill and follows L121 calls a tool that is not on its list.

What I expected: the skill and the burner prompt to agree — which is exactly what the repo asks for in writing.

Citation — `packages/skills/burner/review-ticket.md:1`, the HTML comment at the head of the file this ticket edited: "The code review in step 1 is the burner's own rendition of `/runcastle:code-review`… **Keep the two in step.**" The diff moved one and left the other. Also CLAUDE.md's "Shotgun Surgery" exposure: the tool name now lives in three places (MCP table, burner prompt, skill pack) and only two moved.

Second stale line, same fix: `packages/skills/packs/runcastle/skills/tickets/SKILL.md:41` still describes the review ticket as one that "writes what it finds as test notes for the human's review phase" — this is the skill that authors the review ticket, so it is teaching the wrong output channel.

Repro: `grep -rn add_test_note packages/skills/packs/` on the feature branch returns `code-review/SKILL.md:121`; `grep -n "add_test_note" packages/server/src/mcp/server.ts` shows it mapped to the empty audience list.
- [ ] [Code review — Standards axis] `storeTickets` grew a boolean that silently reinterprets `blockedBy` into a second, unvalidated input language, and its docstring still describes only the first.

What I did: read `packages/server/src/services/tickets.ts:88-120` against its own doc comment and its new caller.

What happens: the new option is
```ts
options: { blockedByAreGlobal?: boolean } = {},
…
const resolved = options.blockedByAreGlobal
  ? inputs.map((input, index) => ({ seq: startSeq + index, blockedBy: input.blockedBy }))
  : resolveBlocking(inputs, startSeq)
```
One boolean selects between two incompatible meanings of the same field — `blockedBy` as batch-local indices into `inputs`, or as absolute feature-wide seqs — and the `true` branch skips `resolveBlocking` entirely, so the out-of-range and self-edge rejection that branch documents does not run. The only caller is `reportFinding` (`services/review-findings.ts:95-97`), passing `blockedBy: [reviewTicket.seq]`, so nothing is exploitable today; the cost is on the next reader and the next caller.

The docstring immediately above it (L88-100) was not updated and now describes behaviour the function only sometimes has: "the batch-local `blockedBy` positions are resolved to global seqs — and out-of-range/self edges rejected — by core's `resolveBatchBlocking` … An invalid edge surfaces as `InvalidInputError`." Under `blockedByAreGlobal: true` none of those three sentences is true.

What I expected: either a separate, named entry point for the absolute-seq case, or a docstring that states both modes and says the global one is unvalidated.

Citation — smell: **Mysterious Name** (a flag argument whose name describes the data, not the mode switch it performs) plus the CLAUDE.md convention that a service's contract is its doc comment. Judgement call, not a hard violation: nothing documented forbids an options bag. The stale docstring half is not a judgement call.

Repro: read `packages/server/src/services/tickets.ts:88-120` — the doc comment's three claims about validation against the `blockedByAreGlobal: true` branch four lines below it.
- [ ] [Code review — Standards axis] The web re-declares the server's findings-summary wire shape by hand instead of inferring it, giving the counts line two definitions that can drift apart.

What I did: compared the two declarations.

What happens: `packages/server/src/services/review-findings.ts:208-213` defines the read model the router returns:
```ts
export interface FindingSummary {
  found: number
  fixed: number
  open: number
  observations: number
}
```
and `apps/web/src/lib/feature-ui.ts:1047-1052` declares a field-for-field identical copy under a different name:
```ts
export interface FindingCounts {
  found: number
  fixed: number
  open: number
  observations: number
}
```
`findingCountsLine()` and `FindingsSummaryBlock` are typed against the copy, so a field added, renamed or removed server-side does not fail the web typecheck — it fails silently at runtime, or renders a clause that is quietly always absent.

What I expected: the same treatment every other wire shape in this app gets. `apps/web/src/lib/api.ts:6-12` states the rule in a doc comment: "Router output types inferred straight from the server's `AppRouter` … **These are the exact wire shapes the UI renders**", and the file below it derives fourteen types that way (`FeatureFull`, `GateState`, `ProjectFinding`, `SettingsView`, …). This one should be `RouterOutputs['findings']['listByFeature']['summary']`.

Note on a near miss I checked and am NOT reporting: `OpenFindingFigure` at `feature-ui.ts:1080-1083` also inlines a core enum, but it follows this file's established `*Figure` convention for minimal structural parameter types (`RunFigure` L752, `ReviewTicketFigure` L793, `WalkthroughFigure` L847, `DriveFigure` L870, `DigestTicketFigure` L996). The repo endorses that pattern, so the smell is suppressed. `FindingCounts` is different — it is not a narrowing, it is an exact duplicate of a wire type.

Citation — `apps/web/src/lib/api.ts:6-12` (documented convention), and smell: **Duplicated Code**. This also touches decision #9's intent, "a computed count cannot lie": the count is computed in one place and typed in two.

Repro: add a field to `FindingSummary` in `packages/server/src/services/review-findings.ts` and run `bun run typecheck` — the web package passes without seeing it.
- [ ] [SUMMARY — review of the lap] Four notes, one code review on both axes, and a full drive of the review page. The feature works; one finding is worth fixing before it reaches a human on a bad day.

**Code review — Spec axis: 2 findings.** Worst within this axis: a defect whose fix ticket is orphaned vanishes from the review page entirely (`defectState`, `services/review-findings.ts:191-198`). Second: the `/runcastle:code-review` skill still tells the review agent to use `add_test_note`, which this branch unregisters for every audience, against that file's own "Keep the two in step" instruction.

**Code review — Standards axis: 2 findings.** Worst within this axis: `storeTickets`'s new `blockedByAreGlobal` boolean reinterprets `blockedBy` into a second, unvalidated input language while its docstring still documents only the first. Second: the web hand-declares `FindingCounts` instead of inferring it from the router, against the rule stated in `apps/web/src/lib/api.ts:6-12`. Both are judgement calls; neither is a hard violation. Two more Standards candidates came back from the sub-agent and I dropped them after opening the files: `OpenFindingFigure`'s inline enum follows this file's established `*Figure` convention, and `promoteOpenDefects` does emit a mutation event (`finding.fixing`), so the CLAUDE.md event rule is satisfied. One remark not worth a ticket: `Burn ${pending} ticket${pending === 1 ? '' : 's'}` is now written three times in `feature-ui.ts` (L1850, L1886, L1920) with no pluralization helper in the repo.

**I confirmed the orphan finding live, and it is worse in the UI than on paper.** I seeded the drive's own throwaway database with a review lap of four defects and two observations, one defect in the orphaned state (fix ticket `failed` by the sweep, finding still `fixing`). The page rendered "4 defects found · 1 fixed automatically · 2 still open · 2 observations" — 1 + 2 = 3 of 4. After I dismissed the other two, it read **"4 defects found · 1 fixed automatically · 2 observations"**: no "still open" clause at all, no Open Defects card, and the next-step bar offering Merge & ship, while a high-severity defect sat unresolved in the database with no way to reach it from the UI. That is the exact "what do I do now" silence decisions #6 and #9 were written against, and it is reachable by an ordinary server restart mid-fix-wave.

**Verified by driving** (drive started clean, dev server on :20996, checkout switched to the feature branch): the lead card renders the review's digest prose verbatim under "What landed this lap", then the computed counts line, then observations as compact title + expandable detail (AC4). The open-defects list shows severity chip + title + a one-line reason — I saw both "over the auto-fix cap" and "fix failed: verify command \"bun run test\" exited 1" — with per-row Dismiss and expandable detail (AC4). Dismiss works and the count drops live: the counts line went 2 → 1 → 0 still open and the primary button relabelled "Fix 2 open defects" → "Fix 1 open defect" → gone, without a reload (AC4). The next-step bar showed "Fix N open defects" as primary with Merge & ship demoted to a secondary while defects were open, and reverted once none was (AC5); merge-conflict outranking it is enforced in code at `feature-ui.ts:1860-1880`, ordered above the defects rule, which I read but could not stage. A human note I typed was captured, rendered compact as an 80-character headline with the remainder behind a disclosure, and kept its handled/Edit/Delete controls (AC6); the Address-notes dialog offered "1 open note from the drive" and contained none of the six findings, which is decision #7 holding.

**One correction to my own pass, so nobody re-derives it:** three `agent-browser` clicks on Dismiss reported success and changed nothing, which looked like a broken button. It was not. A programmatic `.click()` on the same element dismissed the finding immediately — the button sits below the fold and the synthetic pointer click was missing it. Dismiss is correctly wired; that was my tooling, not the app.

**Verified without driving.** AC1: `mcp/server.ts:1531-1534` maps `report_finding: ['run']` and `add_test_note: []`, asserted by `test/mcp-tools.test.ts:693-696`; the review prompt's steps are now 1 code review, 2 drive, 3 report findings, 4 stop the drive, 5 digest — the summary-note step is gone. AC2: `test/review-findings.test.ts:79-83` proves eight defects mint tickets and the ninth returns `overCap: true` with `fixTicketId: null`. AC3: `test/ticket-burner.test.ts:608` admits fix tickets once the review is terminal and burns them in the same run finalizing once, `:647` fails one fix ticket without touching its siblings, and `test/runner.test.ts:121` wires the live ticket store. AC7: on the feature branch `bun run typecheck` is clean and `bun run test` is **138 files, 2268 passed, 13 skipped, 0 failed**.

**One thing both implementers got wrong, in the reassuring direction:** tickets 2 and 3 each reported `packages/server/test/dev-pane.test.ts > kills the child process tree` failing and read it as a pre-existing environment fault. It does not fail here. The full suite is green on the host, so that failure was their sandbox's PID namespace and nothing is outstanding.

Nothing in this feature was left unbuilt — all three implementation tickets landed, and I found no surface missing outright. I could not exercise the auto-fix wave end to end (that needs a real burn with a live agent, which a review drive cannot start), so the admission path is verified by its tests and by reading the scheduler, not by watching it run.
