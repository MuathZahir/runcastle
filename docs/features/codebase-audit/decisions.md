# Decisions — Codebase Audit

## 1. The audit runs inside the ideation session
**Decision:** The recursive-codebase-audit tree runs in this ideation session itself; its report lands in `docs/features/codebase-audit/`. Lap 1 is then built from the findings, not from the audit as work.
**Why:** The audit is read-only analysis — the "look up facts" half of grilling, scaled up with subagents. Running it here keeps the full findings context in the one unbroken window that spec and tickets inherit. A waypoint map would re-pay orientation cost per session and lose cross-area consolidation; making the audit itself the tickets would put report-writing into burner sandboxes built to land code.

## 2. Scope: full repo, `vendor/` excluded
**Decision:** Audit everything — `packages/core`, `packages/server`, `packages/design-system`, `packages/skills`, `apps/web`, `site`, `scripts`, and the docs that pin contracts — except `vendor/` (and generated/lock artifacts).
**Why:** Vendored code isn't ours to fix; everything else is. The human explicitly confirmed full breadth.

## 3. UI/UX is audited at code level in this lap
**Decision:** The "UI/UX" slice of the audit reviews `apps/web` statically — component structure, design-system usage, UX copy, state/loading/error handling, accessibility patterns in code — rather than driving the running app. Prior runtime findings in `E2E-FINDINGS.md` are input, not re-derived.
**Why:** The recursive audit tree is a static-analysis instrument; a live test-drive of the UI is a different exercise (and partly already recorded). If a runtime UX pass is wanted, it can be its own follow-up.

## 4. Subagents run on Opus
**Decision:** Every orchestrator and leaf in the audit tree runs with `model: opus`.
**Why:** Human's call — audit quality over token cost; this is a deliberate spend.

## 5. Lap 1 deliverable: triaged fixes as tickets, remainder as GitHub issues
**Decision:** After the audit report is consolidated, findings are triaged with the human: top high-confidence, low-risk fixes become this lap's tickets; the long tail is filed as GitHub issues (the repo's tracker, per `docs/agents/issue-tracker.md`); rejected findings are recorded as rejected in the report.
**Why:** An audit yields far more than one lap of work. Tickets must stay burnable — small, verifiable code changes — while the backlog belongs in the tracker, not in a doc nobody re-reads.

## 6. Lap 1 = the seven "stop the bleeding" slices; the rest → GitHub issues
**Decision:** Lap 1 tickets: (1) server hardening one-liners, (2) contract spine — all 8 `rowToX` adapters through `.parse()`, (3) process lifecycle as **verify-and-fix** (post-`85a0f59`: verify `killTree` on a real Windows drive-stop, adopt at `registry.ts`, `drive-hooks.ts`, `scripts/dev.ts`, `pty-host.cjs`, restructure shutdown to await it), (4) child-env merge + stray-transcript deletion + gitignore, (5) web bug cluster, (6) verification gates (typecheck filters, minimal push/PR CI, vitest env firewall), (7) prompt/doc drift (P1 + findings-namespace P3). Everything else in `audit/REPORT.md` is filed as GitHub issues with `file:line` evidence.
**Why:** Small, high-confidence, burnable, test-drivable; nothing in lap 1 waits on an open design question. The structural work (event system, wire shapes, overlays, mutex) needs decisions and belongs in the tracker, not in this lap's tickets.

## 7. (D2) Server binds localhost only
**Decision:** `Bun.serve` gets `hostname: '127.0.0.1'` as the default. LAN exposure, if ever wanted, becomes an explicit opt-in that must bring auth with it.
**Why:** The server currently exposes unauthenticated filesystem listing, doc read, settings rewrite, host git identity, credential overwrite, and process spawn to the local network. Localhost-only is one line and matches the product's local-app form factor (CONTEXT decision #2).

## 8. (D1) The event rule: every durable state change emits, service-owned
**Decision:** Every durable state change emits an event, whether or not the UI currently renders it. Emission is owned by the service that mutates — never the router, never the caller. The `events.project_id NOT NULL` blocker for pre-project setup events becomes a schema change riding the event-system issue, not an exception to the rule.
**Why:** The events table is the timeline/audit log, not just UI fuel — credential and host-config writes with zero trace are what a work record must never miss. A grep-able rule ("writes but doesn't emit") stays enforced; per-case "is this UI-visible?" judgment is exactly how four divergent emission shapes evolved. Emitting costs one line; reconstructing a missing event is impossible.

## 9. (D3) Working-copy concurrency: one async mutex in git.ts
**Decision:** All working-copy operations (drive, merge, gate checks) run through a single in-process async mutex/queue — `withWorkingCopy(fn)` in `services/git.ts`. No sharp-end spot guards. Rides the GitHub issue, not lap 1.
**Why:** The server is the checkout's sole owner, so an in-process queue eliminates the TOCTOU class outright; git.ts already centralizes the operations so the seam exists. Parallel features all contend for this one checkout and parallelization is a locked first-class goal — spot guards are whack-a-mole, and each guard is itself a check-then-act.

## 10. (D4) Contract maps are derived; prose stays human — minimal form
**Decision:** One `docs:generate` script emits the mechanical contract maps (tRPC procedure list from the router, MCP tool table from the registry, phase/gate tables from core's pipeline defs) as plain markdown; CI freshness check is just `run script && git diff --exit-code`. SPEC's drifted sections point at the generated maps; authority order recorded once: code > generated maps > SPEC prose (intent/invariants). CORRECTIONS.md retired into ADRs. No doc framework, no introspection library.
**Why:** The audit's diagnostic — every executed contract held, every merely-read one drifted — says derivation beats discipline. The abandoned CORRECTIONS ledger is the sweep-and-discipline strategy's corpse.

## 11. Standing constraint: no overengineering (applies to every decision here)
**Decision:** All audit fixes take the smallest form that kills the finding's class: the mutex is ~20 lines in git.ts, the docs generator is one script + a diff check, the event union is one const array in core, CI is one workflow. When a lap-1 ticket or filed issue can choose between "simple now" and "general later", choose simple now.
**Why:** Human directive at D4 confirmation: don't let the fixes become brittle machinery before there are users. Echoes CONTEXT's own locked principle — "flexible guidance over brittle machinery; when in doubt, less mechanism."

## 12. (D5) "build" is the UI label for the domain phase `implementation`
**Decision:** Keep both words; record in `docs/agents/domain.md` that `build` is the canonical user-facing label for the domain phase `implementation` (mirroring how `PHASE_LABELS` already works). No renames on either side. Rides the lap-1 doc-drift ticket.
**Why:** The two-layer vocabulary is deliberate and consistent on every surface; only the vocabulary authority doc doesn't know it, which makes every future auditor re-flag it. Renaming would churn the DB/wire/skills or the public site for zero user value.

## 13. (D6) design-system: relabel as the design-sync surface, defer direction
**Decision:** README/CLAUDE.md stop presenting `packages/design-system` as a peer package; it is documented as the Claude Design round-trip surface owned by `.design-sync`. Its 6 hand-copied domain enums get corrected while touching it (unshipped, cheap). No app migration onto it, no re-extraction — the direction question is explicitly deferred until a second real consumer exists.
**Why:** One caller is a hypothetical seam. The app is the only real consumer of its own styles; committing to a shared design package now is the overengineering decision #11 forbids, and deleting it breaks the live design round-trip.

## 14. (D7) Demo video stays in git; next re-record moves to external hosting
**Decision:** `site/assets/video/runcastle-demo-1440.mp4` (11.5MB) stays committed — no hosting change now. Tripwire: the first time the demo is re-recorded, the new video goes to external hosting instead of git, so the current blob remains the only one in history. Recorded as a note on the site GitHub issue, not work.
**Why:** The cost of the committed video is already sunk; the real risk is history stacking on replacement. Standing up hosting machinery to save already-spent megabytes is the exact overengineering decision #11 forbids.
