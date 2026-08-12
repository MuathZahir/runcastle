# Runcastle Codebase Audit — Consolidated Report

**Method:** recursive audit tree — 5 Opus orchestrators (server-brain, server-runtime,
web, contracts, periphery), ~19 leaf agents, one shared briefing
(`audit/BRIEFING.md`). Full per-area reports in `audit/reports/*.md` (this file is
the ranked synthesis; every claim below cites the area report that carries the
quoted evidence). Root spot-verified the anchor findings against source directly:
`index.ts:105-132`, `dev-pane.ts:159-170`, `ticket-burner.ts:1523-1544`,
`feature-ui.ts:1155-1199`, `ShippedBody.tsx:18-40`, `config-load.ts:38-62`,
`drizzle/0004`, the `rowToX` inventory (8 adapters, not the 6 the contracts
report counted).

**Verification gates for all downstream work:** `bun run typecheck` (core+server
only — see V1), `bun run test` (vitest; unset inherited `RUNCASTLE_*` first).

> **Post-audit update (merge `85a0f59`, 2026-08-11):** main merged in after the
> audit ran. Commits `f2fc8c3`/`fe60bac` land `pty/kill-tree.ts` (shared, async
> `killProcessTree`) with per-backend `PtySession.killTree()`, fix the sidecar
> supervisor-kill defect, make dev-pane teardown bounded+async, and `await` the
> two `stopDevPane` calls in `git.ts`. Findings **2.3** (partially fixed — see
> amended row), **1.19** and **1.14** (both still standing, re-scoped) updated in
> place; root re-verified every affected site post-merge.

## Diagnosis in a sentence

The product's *executed* contracts are solid and its test discipline is real, but
the repo systematically trusts what it never re-checks — types without runtime
validation, docs without derivation, prompts without cross-checks, child
processes without a kill/env policy, and a verification gate that covers half the
workspaces — so bugs the repo has already paid for once (F19 blank screen, F18
shadowed button, the committed stray transcript) keep recurring as a class.

---

## Tier 1 — Latent bugs (violations, high confidence, verified)

| # | Finding | Where | Key | Effort |
|---|---------|-------|-----|--------|
| 1.1 | `Bun.serve` sets no `idleTimeout` (Bun default 10s) while SSE heartbeats at 25s — every SSE stream is reaped before its first heartbeat (~13s reconnect cycle); the terminal WebSocket is a third victim (matches E2E F11/F14). Root-verified. | `server/src/index.ts:105` + `apps/web/lib/stream.ts:31` | `missing-idle-timeout:server` | S |
| 1.2 | No `hostname` on `Bun.serve` and no auth middleware — unauthenticated LAN reach to fs listing, doc read, settings rewrite, host git identity, credential overwrite, process spawn. Root-verified. Mitigation is one line (`hostname: '127.0.0.1'`); whether LAN access is ever wanted is a **human decision** (D2). | `server/src/index.ts:105-112` | `no-auth:local-server` | S |
| 1.3 | No spawn guard for ideation/qa/converge sessions — two "Start grill" clicks ⇒ two `claude` processes in one worktree on the same `decisions.md`. | `launcher/launcher.ts:352,399,414,795` | `missing-guard:spawn-ideation` | M |
| 1.4 | `sessionFinished` constant-`true` for every non-waypoint kind — live qa/revisit conversations swept without `endLive` confirmation. | `launcher/launcher.ts:294-296` | `wrong-predicate:session-finished` | S |
| 1.5 | Failed burn renders green — `RunBody` regex-matches `/finished/` while `notifications.ts` reads the payload correctly and says "Burn failed". | `RunBody.tsx:425-434` vs `notifications.ts:96-112` | `latent-bug:success-without-evidence` | S |
| 1.6 | Merge-conflict branch hides Burn — `feature-ui.ts:1167` returns before the `pending > 0` branch at `:1193`, so with a conflict + pending fix tickets the Burn affordance vanishes; the branch's own comment states the anti-vanish principle it violates. Root-verified. Pairs with `edit-guard.ts:36` denying the revisit-conflict path ADR-0007 §6 designs (E2E F18, one layer earlier). | `apps/web/lib/feature-ui.ts:1167` + `launcher/edit-guard.ts:36` | `bug:next-step-conflict-hides-burn` | M |
| 1.7 | Shipped hero has never shown a merge time: server emits `feature.shipped` then `feature.status`; the reverse id-scan always finds `feature.status` first, so `when` is always `''`. Root-verified. | `bodies/ShippedBody.tsx:20-23` | `bug:shipped-body-merged-at` | S |
| 1.8 | Empty `RUNCASTLE_BURN_CONFLICT_ATTEMPTS` → `Number('') === 0` → silently disables in-loop conflict resolution (the `!== undefined` guard deliberately admits `''`). Root-verified. | `core/src/config-load.ts:49-51` | `latentbug:env-empty-string` | S |
| 1.9 | Research workflow silently downgrades podman → **no sandbox**, running the AFK agent on the host without saying so. | `workflows/research.ts:270,100` | `inconsistent:sandbox-selection` | S |
| 1.10 | Migration 0004 backfill: for events whose feature row no longer exists (deleted features), `COALESCE` writes the old `feature_id` value into `project_id` — shipped data corruption; needs a repair migration. Root-verified. | `drizzle/0004_events_project_id.sql:16` | `latent-bug:events-backfill` | M |
| 1.11 | `buildBurnAgent` builds a **replacement** env of one variable (`CLAUDE_CODE_OAUTH_TOKEN`) instead of merging `process.env` — strips `HOME`/`USERPROFILE`, which is how a 284KB Claude Code transcript for an unrelated project got committed at `packages/server/~/.claude/` (twice). Root-verified the env site; periphery verified the artifact is safe to delete (zero references). | `workflows/ticket-burner.ts:1529-1532` | `leak:child-env-inheritance` | S |
| 1.12 | Zero DB indexes across all 19 migrations while `events` is polled at 1.5s. | `drizzle/*.sql`, `core/db-schema.ts` | `perf:missing-event-indexes` | S |
| 1.13 | TOCTOU races on the singleton working copy — check-then-act around the user's singular checkout; no async mutex exists anywhere in the repo, so every drive/merge/gate path contends unguarded. Sharp end: `services/gates.ts` can wrongly pass or block a promotion. | `services/git.ts:1344,1486-1518` + `services/gates.ts` | `latent-bug:singleton-toctou` | L |
| 1.14 | Shutdown races teardown: `killAll(); server.stop(); process.exit(0)` synchronously — the sidecar `kill()` only queues a frame that never flushes. Root-verified; **still standing post-`85a0f59`, and sharper now: the correct teardown (`killTree`) is async, so the sync `process.exit(0)` guarantees it can't be used here without restructuring shutdown.** | `server/src/index.ts:128-132` | `race:shutdown-teardown` | M |
| 1.15 | Gate override never checks its `gate` argument — `overrideGate` advances via `nextPhase(feature)` regardless of which gate was named. | `services/gates.ts:183` | `unvalidated:gate-override-id` | S |
| 1.16 | `resolveWaypoint` missing guard (resolvable regardless of state). | `services/waypoints.ts:270` | `missing-guard:waypoint-resolve` | S |
| 1.17 | `run.cancel` returns `{ok:true}` for unknown run ids, emitting nothing. | `trpc/routers/run.ts:24-28` | `latent-bug:success-without-evidence` | S |
| 1.18 | Setup terminal leaks: PTY created with no DB session row, unreachable by `feature.endSession` (E2E F5 root cause). | `trpc/routers/setup.ts:55` | `leak:setup-terminal` | S |
| 1.19 | `scripts/dev.ts` kills only direct children; ports 4512/4513 are held by grandchildren → orphaned on Windows; stale 4512 answers `/health` and fools `devtool.ts:439-454`; `strictPort: true` then fails the next dev run. **Still standing post-`85a0f59`** (the commit touched only the server's PTY paths) — folds into the 2.3 adoption ticket now that `kill-tree.ts` exists to import. | `scripts/dev.ts:56` | `leaked-process:dev-launcher` | S |
| 1.20 | Web smalls, each verified by the web orchestrator: `merged.at` Number coercion (`SettingsOverlay.tsx:154` → `core/config.ts:169`); 4 dialogs dismiss on backdrop *drag* (vs `FormOverlay.tsx:57-61` doing it right); `--warn` CSS token used ×17, defined ×0; stale test-drive client state (`ProjectShell.tsx:35`, `Workspace.tsx:103,248`); SSE live-status tracked but never surfaced (`lib/live.ts:92-97` — the visibility half of 1.1). | apps/web (various) | several | S each |

## Tier 2 — Structural, repo-wide (the tree's real prize)

| # | Finding | Kind | Effort |
|---|---------|------|--------|
| 2.1 | **Unvalidated contract spine** (3/3 contracts leaves + brain): all 12 enum DB columns are `$type<>()` compile-time casts (0 `enum:` uses, 0 CHECKs); ~20 of ~25 core entity schemas never `.parse()`d; 0/59 tRPC `.output()`; web faithfully propagates via `RouterOutputs`. The repo already paid for this once — F19's blank screen produced `parsePhase` (`core/schemas.ts:23-36`) and fixed only that instance; 11 columns share the failure mode. **Fix at the existing seam: route all 8 `rowToX` adapters (repo.ts ×4, events.ts, tickets.ts, waypoints.ts, test-notes.ts) through their schema's `.parse()`.** | violation | S–M |
| 2.2 | **The event system needs one owner** (all 5 areas): 94 string-literal event types with no union/enum, 3 naming conventions, 7 synonym pairs (`research.error` vs `research.failed` 30 lines apart), 80/94 consumed by nothing; emission is inconsistent in 4 shapes (no event — `mergeFeature`, all of `setup.ts` incl. OAuth-token writes (structurally blocked by `events.project_id NOT NULL`); caller-emits; double-emits; router-emits); web timeline is type-agnostic (renders `stripMarkdown(message)`, falls back to printing the raw type string) so there is no consumer-side safety net. Fix: `EVENT_TYPES` union in core + merge synonyms + emission rule (needs D1). | violation | M–L |
| 2.3 | **`killProcessTree(pid)` shared module** — PARTIALLY FIXED by `85a0f59`: module extracted (`pty/kill-tree.ts`), `PtySession.killTree()` on both backends, sidecar supervisor-kill fixed, dev-pane + `git.ts` drive teardown adopted. **Remaining (root re-verified post-merge): `registry.ts` `kill()`/`killAll()` still `entry.pty.kill()` (session end + server shutdown leak grandchildren), `drive-hooks.ts:163` still `child.kill()` + grace timer, `scripts/dev.ts:56` untouched, `pty-host.cjs` untouched.** Lap-1 ticket becomes *verify and fix*: verify `killTree` on a real Windows drive-stop, adopt at the remaining sites. | violation | S–M (was M) |
| 2.4 | **Child-env spawn policy** — 3 spawn paths, no shared keep/scrub policy; made structural by `asset-paths.ts:73-77` mutating global `process.env` at boot. Covers 1.11 and the `RUNCASTLE_*` test-pollution footgun. | violation | M |
| 2.5 | **Duplicate wire shapes** — same shape declared 2–6× with no type link: MCP inputs ×12 vs tRPC, PTY frames ×4, ticket-edit ×4, `GateId` ×2; `satisfies` used once in ≥4 chances. Concrete casualty: **an agent can blank a ticket title a human can't; a human can't fix seams an agent can** (`services/tickets.ts:150` behind two different contracts). | violation | M |
| 2.6 | **Repeated switch on session kind** — 12+ sites (runtime H6); root cause of `noCodeRule` reaching 2 of 6 prompt renderers while `edit-guard` denies 8 of 9 kinds (waypoint *prototype* sessions are told to build a spike, then denied every write with no warning — periphery #8). | violation | M |
| 2.7 | **JSON boundaries unschema'd** — 12/13 `JSON.parse` sites unvalidated server-side incl. two modules reading the same file with one validating (`settings.ts:264` vs `config-load.ts:23`); plus scripts (`devtool.ts:401` feeds a global `git config` write). Fix: `readJsonFile(path, schema)`. | violation | S–M |
| 2.8 | **Overlay shell + focus management** — 9 overlays, 9 hand-rolled Escape handlers, 4 with `role="dialog"`, and 3 total `.focus()`/`activeElement`/`createPortal` references in all of `apps/web/src`. One `<Overlay>` with a focus trap. | violation | M |
| 2.9 | **Query-cache growth + poll cadence** — cursor in the TanStack query key ⇒ unbounded cache; `useEventLog` mounted 3–5× per screen; `useLivePoll` opt-in with 5/22 sites defeating SSE backoff. | violation | M |
| 2.10 | **Disabled-without-reason buttons** — 6 of 9 primary buttons disable with no reason surfaced; UI-SPEC §3 promises otherwise (generalizes E2E F3). | violation | S–M |
| 2.11 | **Client hand-mirrors server preconditions** in 7 places, each naming the function it copies, no test comparing sides — F18 is this pattern going stale. | judgement | M |
| 2.12 | **`errMsg`/error-taxonomy** — `errMsg` ×8 (`errors.ts` already exists); `GateError`(412) vs `InvalidInputError`(400) used interchangeably. | violation | S |
| 2.13 | **Test-harness duplication** — `initRepo` verbatim ×16 across server tests; 46 test-only exports (24/62 on `ticket-burner.ts` alone) marking the same seams. Direction: `@runcastle/test-fixtures`. | judgement | M |
| 2.14 | **`design-system` is residue, not a peer** — zero product importers; 25 importers under `.design-sync/previews`; extracted *from* the app, redesigns return by re-wiring, not file swap. It still matches UI-SPEC §4 while the app drifted from both (every "app vs spec colours" finding collapses into this). Cheapest correct action: relabel in README/CLAUDE.md; decide direction later (D6). Its 6 hand-copied domain enums (incl. a `'blocked'` status core doesn't have) are unshipped and cheap to fix now. | judgement | S (label) |

## Tier 3 — Verification-gate holes (violations; why Tiers 1–2 went unseen)

- **V1** No push/PR CI at all (`.github/` has only `release.yml` on tags); root `typecheck` filters 2 of 4 typed workspaces — `apps/web` (15.6k lines) and `design-system` are typechecked by **nothing** (both define working `typecheck` scripts nothing calls; the release path's vite build strips types without checking). Two `--filter` flags + one workflow. (periphery #3, web H-1)
- **V2** `scripts/` in no tsconfig and no typecheck filter; the smoke walk **cannot run** (calls removed `project.init`, omits a required `projectId`). (contracts H9)
- **V3** 94 of 99 test files outside every `tsc` include; platform-skips report green on Windows (`canon.test.ts:8` returns early; `dry-run-drive.test.ts:66` hardcodes `/bin/sh`); six tests set only `USERPROFILE` so they read the developer's real `~/.runcastle`. (brain H14/16)
- **V4** Root `vitest.config.ts` spans `apps/*` too — one `setupFiles` env firewall retires the known `RUNCASTLE_*` footgun. (brain H14)
- **V5** Generated artifacts unwired in CI: `site/assets/app-ui.css` 47 commits stale (153/613 classes missing, 19 dead); same shape risk for drizzle output and design tokens. (periphery #6, H10)
- **V6** No dead-export tooling; 14 confirmed dead exports + `loopBackPhase`/`rethinkPhase` (exported, SPEC-blessed, unit-tested, uncalled — **a test is not a caller**); one `knip`/`ts-prune` sweep. (brain H8, contracts H11)

## Tier 4 — Drift (docs & prompts; the product injects these)

- **P1** Skill-pack prompts vs code, all verified: `tickets/SKILL.md:68` restores a `tickets.emitted` double-log the code removed and tests assert against; `spec/SKILL.md:18` "exactly these sections" omits `## Later laps` while 4 consumers read it back (lap 2 silently finds nothing); burner/research prompt branch claims wrong (`feature/<slug>` vs `runcastle/ticket/...`, and research told to commit to the feature branch it must never touch); `revisit/SKILL.md:38` promises a refusal `complete_phase` doesn't perform; `blockedBy` reads optional, schema requires it; `renderTemplate` fails open by design so the fix is a typed key set at the resolver (`ticket-burner.ts:1808`). (periphery, runtime)
- **P2** SPEC authority drift: covers 25/59 tRPC procedures, 7/14 MCP tools; `CLAUDE.md` says 4 tools; three incompatible authority claims across SPEC/UI-SPEC/CLAUDE.md; §5.5 wire shape contradicts live code. **Diagnostic: every *executed* contract held (12/12 skill MCP names, 5/5 gates, ports, 10/10 ADRs); every merely *read* contract drifted → derive the derivable maps instead of writing them more carefully** (D4). `CORRECTIONS.md` abandoned (3 entries, ~35 unrecorded changes). (contracts H4/H5/H14, runtime H4)
- **P3** Findings-log namespace collision: two logs share F1–F25; 96 `(findings F<N>)` code comments cite `docs/features/identify-random-issues.../findings.md`, root `E2E-FINDINGS.md` has 0 status markers and 0 of its 19 verifiable findings fixed; three citation schemes in comments. Rename/status-mark + disambiguate. (periphery #4/#5, runtime H14)
- **P4** Counts & citations: fork attribution says "five of six" in NOTICE, skills README and the **public** compare page (8 skills, 6 forked); `plugin.json` says 4; `CONTEXT.md` decision-number citations drifted after renumbering (`artifacts.ts:265` cites #6 meaning Git topology) — cite by name. (periphery H5/H14)
- **P5** `docs/research/POSIX-VERIFICATION.md` stale item-by-item (some items live: `git.ts:65-73` canon lowercasing; item-level re-verification needed). Node-pty patch hunk 1 load-bearing but referenced nowhere — its own retirement checklist would delete it. (runtime H11)

## Tier 5 — Cleanups (small, safe, high-confidence)

`NotImplementedError` never constructed: delete `errors.ts:15` + 5 guard branches + SPEC mentions · delete stray `packages/server/~/` + gitignore `~/`, `.claude/` · delete `scripts/fix-feature-phase.ts` (dead AND mutates prod DB unguarded — the exact footgun `devtool.ts:54-63` prevents) · dead PTY barrel · `awaitProjectLandings` test-only · 4 orphaned site assets (~124KB) · sandcastle container template byte-identical ×2, hand-synced, unpinned installers · ~500 identical lines of chrome across 8 site pages · 5 script-logging variants · repo-root resolution ×4 idioms + `assetPaths` (likely one module).

## Human decisions surfaced (not fixable by fiat)

- **D1** Event-emission rule semantics: "every state change" vs "every state change the UI shows" — decides ~⅓ of emission findings. (brain)
- **D2** Server binding: recommend `hostname: '127.0.0.1'` default; LAN mode, if ever wanted, becomes an explicit opt-in with auth. (brain H7)
- **D3** Working-copy concurrency: introduce an async mutex/queue around drive/merge/gate operations, or accept TOCTOU and guard the sharp ends only. (brain H5)
- **D4** Doc strategy: derive tRPC/MCP/ownership maps from code vs keep hand-maintaining SPEC. (contracts H4/H5)
- **D5** `implementation` vs `build`: deliberate UI label (`PHASE_LABELS` maps it; site/README/UI agree) — record it in `docs/agents/domain.md` rather than "fixing" either side. (contracts H13, periphery retraction)
- **D6** `design-system` direction: relabel now; later — re-extract as real shared package, or keep as design-sync residue. (web Q(a))
- **D7** `site/assets/video/runcastle-demo-1440.mp4` (11.5MB, 88% of site weight, referenced): host externally or keep in git. (periphery)

## Considered and rejected (do not re-investigate)

`all-waypoints-terminal` gate is alive (mapped-feature G1 variant, implemented + twice-tested) · "build" phase label is not drift (deliberate `PHASE_LABELS` mapping) · `npm publish` in release CI is documented necessity (OIDC ≥ npm 11.5.1) · empty `lib`/`types` in `tsconfig.base.json` fine (workspaces opt back in) · core is genuinely IO-free, zero `any`/casts, browser-safe barrel holds · zod↔drizzle mirroring correct wherever both sides carry the field · web: zero `any`/`dangerouslySetInnerHTML`, xterm/WS teardown complete per UI-SPEC §5, MutationCache net verified across 46 sites, inline-style drift is a non-finding · site: no broken links/anchors, sitemap matches · brain withdrew ~15 over-export claims (exported return types are legitimate surface) · an early "web switches missing defaults" claim was withdrawn — tsc enforces it; the reportable fact is the unvalidated premise (2.1).

**Exemplars worth imitating, not touching:** `util/resolve-executable.ts`, `services/test-notes.ts`, the no-mock test discipline (zero `vi.mock` in 79 files, real services on real SQLite) — its gaps sit exactly where Tier 1 findings are (zero rollback tests, zero concurrency tests).

## Coverage

server services/tRPC/db/util (5 sub-reports) · server launcher/PTY/routes/MCP/workflows/dev/doctor/bin/migrations (4) · apps/web + design-system (4) · core + cross-boundary contracts + doc drift (3) · skills/scripts/site/root hygiene (3). **Not audited:** `vendor/` (excluded by decision), `patches/` content beyond the node-pty patch's referencedness, runtime behavior (static analysis only — no servers started), `docs/features/*` working docs.
