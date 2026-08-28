# Test notes

## Lap 1

- [ ] [Spec axis — implemented but wrong] Setting the reviewer to a model on a runtime you have no AFK token for makes the review ticket fail "auth missing" before it ever runs, even though reviews execute host-side and need no container credential.

What I did: read the wiring end to end. `resolveBurnDeps` (packages/server/src/workflows/ticket-burner.ts:3986) sets `ticketAuthMissing` from `ticketCredentials(ticket)`, which after this diff resolves a review ticket through the new `review` step. `gateTicketAuth` (same file, line 2548) then wraps EVERY ticket whenever `config.sandbox !== 'noSandbox'`, with no `isReviewTicket` exemption — while `executeReviewTicket` runs under `noSandbox()` / `onHost: true` (packages/server/src/workflows/review-ticket.ts:398,401).

Reproduce: `sandbox: 'docker'`, `.env` holding only `CODEX_API_KEY`, then set `stepModels.review` to a Claude model whose host `claude` CLI is interactively logged in. `burnAuthReady('claude-code', undefined)` is false, so the gate emits `auth.missing` and returns `{ status: 'failed' }` for the review ticket without launching it.

Expected: a review ticket, which always runs on the already-authenticated host, should skip the container auth gate — a one-line `isReviewTicket` bypass in `gateTicketAuth`, matching the fork the rest of the burner already makes.

Note this is technically pre-existing (a per-ticket model assignment on a review ticket already hit it) and ticket 1's own digest lists it under "Left undone" — but this feature is precisely what makes it easy to reach, since choosing a cross-runtime reviewer from settings is the advertised use case.
- [ ] [Spec axis — partial] On any project that sets its own model, the new review-model setting silently does nothing: the reviewer and the implementers collapse back onto one model, which is exactly the state the request complains about.

Spec line: "there's no way to choose the model of the reviewer agent (I usually want it different than the models of the implementers) from the settings. I want to add this".

What I did: read the precedence chain in packages/core/src/config.ts:544 — `resolveModelEntry` computes `id = runOverride ?? project?.model ?? config.stepModels[step] ?? config.model`. `stepModels` sits BELOW `project.model`, so with a per-project model set, both `resolveTicketModel(...'review')` and `resolveTicketModel(...'implement')` return that same project model and `stepModels.review` is never consulted.

What happened: the setting is machine-wide only and is defeated by a per-project model override. Expected (or at least worth a decision): the reviewer's step model should still be able to differ from the implementers' within a project that pins a model — otherwise the feature works only on projects that have not set one.

Mitigation as landed: the settings overlay does state the precedence in its body ("a project that sets its own model ignores these"), so it is disclosed rather than hidden. Uniform with every other step, so this may be the intended trade-off — but the brief's whole point is reviewer ≠ implementer, and this is the case where that is unachievable.
- [ ] [Standards axis — hard violation: docstring contradicts the behaviour its own test pins] Two comments on this branch claim the change is a no-op for machines that never set a review model. It is not, for any machine that has `stepModels.implement` set — and their reviewer silently moves to a different model on the next burn.

Citation — CLAUDE.md establishes docstrings as the contract for this codebase (the file ownership table and per-file role prose; every touched function here carries a rationale docstring). Two of them are now false:

1. packages/server/src/workflows/ticket-burner.ts, `resolveTicketModel` docstring: "a machine with no `review` override simply inherits the default model exactly as before."
2. packages/core/test/config.test.ts, new case: "// Unset: the reviewer follows the default, so a machine that never touches the setting behaves exactly as it did before the step existed."

Before this diff, `resolveTicketModel` resolved the `implement` step for every ticket, review included — so a review ticket picked up `stepModels.implement`. After it, a review ticket resolves `stepModels.review ?? config.model` and skips `implement` entirely.

The branch's own test proves it: packages/server/test/ticket-burner-units.test.ts, config `{ model: 'claude-sonnet-5', stepModels: { implement: 'claude-opus-5' } }`, and the new case "leaves a review with no review override on the default model" expects `'claude-sonnet-5'` — i.e. NOT the opus the reviewer would have used before.

Expected: the behaviour is defensible (arguably the right default), but the comments should say what it is — "inherits the default rather than the implementers' step override, a deliberate change for machines that set `stepModels.implement`" — rather than asserting byte-for-byte equivalence. Same correction applies to ticket 1's digest, which repeats the claim.
- [ ] [Drive] Could not drive the app: `review_drive({ action: "start" })` refused with "Working tree has uncommitted changes — commit or stash first".

What I did: called `start`, got the refusal, then ran `git status --porcelain` read-only to see what was dirty. The only entry is `?? docs/features/model-chooser-for-review-agent/` — an untracked directory holding this feature's own `brief.md`, i.e. scaffolding this run itself wrote into the checkout, not human work-in-progress. (The checkout was also already sitting on `feature/model-chooser-for-review-agent` rather than `main`.)

What happened: no dev server, so I could not visually confirm the settings surface. Expected: the run's own scaffolding should not be what blocks the run's own review drive — either the drive's dirty-tree check should ignore `docs/features/<slug>/`, or the scaffolding should be committed before the review ticket burns.

I did not retry, commit or stash — refusals are final and the checkout is the human's.

What this cost the review: the settings overlay path is verified only by reading, not by clicking. Statically it is sound — `STEP_KEYS` is derived from `MODEL_STEPS` (apps/web/src/lib/settings.ts:128), so `review` flows into `unsetStepKeys` and the "Add override" picker automatically, and `STEP_LABEL.review = 'Review'` (line 122) makes the row read as a name; the server builds one field per `ModelStep` and validates writes against the same set. The three code-review findings are unaffected — none of them needed the app.
- [ ] [Summary of the review pass]

Scope: `git diff main...feature/model-chooser-for-review-agent` — one commit (9f1b176), 9 files, +103/−28. All of it is ticket 1; no implementation ticket failed, so this is a review of a fully-built feature.

CODE REVIEW — Standards axis: 1 hard finding, 2 judgement calls. Worst within this axis is the docstring/comment contradiction: `resolveTicketModel`'s docstring and the new core test comment both assert the change is byte-for-byte a no-op for machines that never set a review model, and the branch's own test disproves it for any machine with `stepModels.implement` set. Judgement calls not filed as separate notes: the web test now pins the whole row object (`toContainEqual({ key: 'stepModels.review', label: 'Review' })`) where a key assertion plus a label assertion would survive a field being added; and `step-models.test.ts` loops nine steps but still omits `revisit`, `prepare`, `project`. Confirmed no baseline smells — `MODEL_STEPS` is a genuine single source, so adding a step touched no switch anywhere.

CODE REVIEW — Spec axis: 2 findings, no scope creep. Worst within this axis is the auth-gate one: `gateTicketAuth` has no `isReviewTicket` exemption, so a cross-runtime reviewer — the headline use case — can fail `auth.missing` before launching on any container sandbox. The other is that `project.model` outranks `stepModels.review`, so the setting no-ops on projects that pin a model. I traced the wire myself and confirm the happy path is real: overlay write → `stepModels.review` in config.json → `loadConfig()` in `resolveBurnDeps` → `resolveTicketModel` forks on `isReviewTicket` → `ticketCredentials` → `executeReviewTicket({ model, token })`. The chosen model and its runtime do reach the review agent's launch.

VERIFIED BY RUNNING, not by driving: `bun run typecheck` clean across all four projects plus scripts; the four affected test files green at 4 files / 256 tests — exactly the figures ticket 1's digest claims.

NOT VERIFIED: everything visual. The drive was refused (separate note) because the run's own untracked `docs/features/model-chooser-for-review-agent/` made the tree dirty, so I never clicked through Settings → "Advanced — per-step models" → Add override → Review. The acceptance criterion "landed and does what it says" is met at the code level and by tests, but nobody has yet seen the Review row render in the picker.

WORTH KNOWING, adjacent and pre-existing — not filed as findings: `STEP_LABEL` in apps/web/src/lib/settings.ts still has no entry for `revisit` or `project`, so those two rows render their raw config key instead of a name; and the tickets ledger's model chip reads `effectiveStepModel(view, 'implement')` for the whole ledger, so with a review override configured the review row burns on a model the UI never names. Ticket 1 flagged both and deliberately left them.
