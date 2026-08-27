# Test notes

## Lap 1

- [ ] [Gates mode runs no gates on this very project] Spec axis. Ticket 3 asked for "the verify gates + diff review" as the non-drive mode. `packages/server/src/workflows/review-ticket.ts:368` renders it with `GATE_NOTES: buildGateNotes(deps.config)` — the raw machine-wide config. But `verifyCommands`/`knownFailures` are per-PROJECT columns (`packages/core/src/db-schema.ts:56-57`), and the implementation path resolves them project-first: `packages/server/src/workflows/ticket-burner.ts:2750` does `resolvePreparedSettings(config, project)` before `buildVerifyNotes(prepared)`. `review-ticket.ts` never imports `resolvePreparedSettings`, though `project` is already in scope at line 338.

What I did: read `~/.runcastle/config.json` and the `projects` table on this machine. Global config has NO `verifyCommands` and NO `knownFailures` at all; the `runcastle` project row has both set (`bun run typecheck` / `env -u GIT_ASKPASS bun run test`, plus a full known-failure baseline).

What happens: the next Gates-mode review of this repo is handed "This project has no verify commands configured, so there are no gates to run. Do not go hunting for them — say so in one line of your summary note and spend the whole mode on the diff." The gates half of the mode ticket 3 created is dead on arrival for any project whose commands came from a preparation run — i.e. the normal case.

What I expected: `buildGateNotes(resolvePreparedSettings(deps.config, project))`, matching the burner.

Note the unit test that should have caught this is named for it but does not exercise it: `packages/server/test/review-ticket.test.ts` — `it('hands Gates mode the project commands, or tells it to run none')` calls `buildGateNotes({ verifyCommands: ..., knownFailures: ... })` with a literal object, never a project row, so project-first resolution is untested.
- [ ] [The brief is committed to the base branch, not the feature branch] Spec axis. Ticket 1 asked to "make sure the FEATURE BRANCH is clean of runcastle-owned artifacts before a review ticket is dispatched — commit the brief with a `runcastle:` message".

What landed instead: `commitPipelineDocs(project.repoPath)` is called inside `testDrive` in `packages/server/src/services/git.ts`, on the `action === 'start'` path immediately before the `status --porcelain` dirty check — and therefore before `await g.checkout(branch)`, which happens ~30 lines later. So the commit lands on whatever branch the human's checkout was already on: the base (`main`), not the feature branch.

The branch's own regression test asserts exactly this and treats it as correct — `packages/server/test/review-wires.test.ts`, `it('starts when the only dirt is a brief runcastle staged and never committed')`:
    const subject = (await simpleGit(repo).raw(['log', '-1', '--pretty=%s', 'main'])).trim()
    expect(subject).toMatch(/^runcastle: /)

What I expected: the artifact committed on the feature branch, per the ticket. What actually happens: the feature branch never receives it, and `main` silently gains a commit the human did not make, as a side effect of starting a drive.

(The stated regression criterion — "a feature whose brief.md is staged-but-uncommitted can start a review drive" — does pass. It is the branch the commit lands on that diverges from the ticket.)
- [ ] [Starting any drive now sweeps the human's own uncommitted docs into a `runcastle:` commit] Spec axis. Ticket 1 scoped the fix to "runcastle-owned artifacts" — "commit the brief". The implementation cannot tell them apart.

`commitPipelineDocs` delegates to `commitDocs`, which stages the whole pathspec: `const DOCS_PATHSPEC = 'docs/features'` (`packages/server/src/services/git.ts:165`), then `await g.add([DOCS_PATHSPEC])` and a pathspec commit. Every uncommitted or untracked file anywhere under `docs/features/**` — a human's own hand-edited `spec.md`, `decisions.md` or notes — is committed with the message "runcastle: docs the pipeline left uncommitted".

Reproducible right now, no drive needed: this checkout has exactly one dirty entry, `?? docs/features/burn-concurrency-default-by-core-count/test-notes.md` — an untracked file a human wrote, not a pipeline artifact. Under this change, the next `testDrive` start commits it to `main` under a `runcastle:` message.

What I expected: only runcastle-authored artifacts committed (or, per the ticket's alternative, those paths excluded from the dirty check while the human's real edits still deny). What happens: the guard that exists to catch the human's real dirt now silently commits it instead.

Related but distinct from the branch-placement note: this one is about *which files*, that one about *which branch*.
- [ ] [The new commit fires on the human's own test drive, not just review drives] Standards axis. Citation: CONTEXT.md decision 6 — "Main checkout reserved for the human"; and docs/SPEC.md §7 line 169 — "`start`: deny (with reason) if: main checkout dirty (`status --porcelain` non-empty) | another test drive active | feature has an active run."

`testDrive` already takes the discriminator: `purpose: DrivePurpose = 'human'` (`packages/server/src/services/git.ts:1859`), and the review path passes it explicitly (`git.ts:2136`, `testDrive(ctx, project, feature, 'start', 'review')`). The human path does not: `packages/server/src/trpc/routers/feature.ts:207` calls `git.testDrive(ctx, project, feature, input.action)` with no purpose, so it defaults to `'human'`.

But `await commitPipelineDocs(project.repoPath)` is placed before the purpose is consulted and is not guarded by it, so it runs for the human's Test drive click too. The function's own doc comment scopes the change to review drives ("before a guard reads the tree", "that is how three of four review drives were refused") — the code does not.

What I expected: the commit gated on `purpose === 'review'`, or the deny condition left intact for a human's own click. What happens: a human pressing Test drive with their own docs edits in progress gets them committed to their current branch without being asked, and SPEC §7's documented dirty condition is no longer evaluated against the tree they left.
- [ ] [A commit is made and a failure swallowed, with no event emitted] Standards axis. Citation: CLAUDE.md § Conventions — "Every service function that mutates emits an event — events are the UI's lifeblood: each one is pushed over the SSE stream (`GET /api/stream`) and invalidates the affected queries at once."

The hunk, in `packages/server/src/services/git.ts`:

    async function commitPipelineDocs(repoPath: string): Promise<void> {
      try {
        await commitDocs(repoPath, 'runcastle: docs the pipeline left uncommitted')
      } catch {
        // best-effort — the dirty check still denies, and now names a real edit
      }
    }

This creates a git commit on the human's checkout and emits nothing. Every other mutation on this path does emit — `testdrive.started` is emitted a few lines below it, and `ctx` is in scope at the call site (`await commitPipelineDocs(project.repoPath)` sits inside `testDrive`, which has `ctx: AppCtx`).

What I expected: an event naming the commit, so the UI shows what changed and the human can see a commit they did not make. What happens: the commit is invisible to the stream, and the bare `catch` also discards the reason a best-effort commit failed — the same silent-failure mode the doc comment itself blames for the original bug ("a commit that does not land — an unset git identity, a hook that refused — leaves the brief STAGED").
- [ ] [Duplicated Code: `buildGateNotes` reproduces `buildVerifyNotes`'s structure over the same two fields] Standards axis, smell — judgement call, not a hard violation.

`packages/server/src/workflows/review-ticket.ts:188` declares:

    export function buildGateNotes(
      config: Pick<RuncastleConfig, 'verifyCommands' | 'knownFailures'>,
    ): string {
      const commands = config.verifyCommands?.trim()
      const failures = config.knownFailures?.trim()
      const out: string[] = []
      if (commands) { out.push(..., '```', commands, '```') } else { out.push(...) }
      out.push('')
      if (failures) { out.push(..., '```', failures, '```', ...) } else { out.push(...) }
      return out.join('\n')
    }

`buildVerifyNotes` (`packages/server/src/workflows/ticket-burner.ts:1198`) has the same signature shape over the same `Pick<RuncastleConfig, 'verifyCommands' | 'knownFailures'>`, the same two-field / four-branch control flow and the same fenced-block assembly. The function's own doc comment defends the divergent *voice* ("theirs says which failures are 'yours to fix', and a reviewer fixes nothing") — which is a good reason for two prose bodies, but not for two copies of the branching.

Why it matters here rather than being cosmetic: the copy dropped the caller-side `resolvePreparedSettings` step the original had, which is the root of the "Gates mode runs no gates" note. A shared shell parameterised by voice would not have.
- [ ] [`ticket.timing` on the review's refusal path is claimed but untested] Standards axis, coverage.

The module doc added to `packages/server/src/workflows/review-ticket.ts` claims: "Run one review ticket to a terminal outcome, and put its `ticket.timing` on the event log however it ends — including the two refusals below, which end the ticket before an agent ever starts."

There is exactly one test that calls `executeReviewTicket` on the branch — `packages/server/test/review-ticket.test.ts:504`, `it('refuses a feature with no recorded base instead of diffing against a main line')` — and it asserts only the outcome:

    expect(outcome.status).toBe('failed')
    expect(outcome.error).toContain('no recorded base branch')

It never inspects emitted events, so nothing checks that the `finally` block actually emitted `ticket.timing` on that path. `buildTicketTiming` / `formatTicketTiming` / `emitTicketTiming` are well covered as pure units in `packages/server/test/ticket-burner-units.test.ts`, and `ticketDurations` is well covered in `apps/web/test/feature-ui.test.ts` — the untested seam is the wiring in between, which is precisely what ticket 4 asked for ("Emit `ticket.timing` on every exit path of executeReviewTicket").

What I expected: the existing refusal test extended by a couple of lines asserting a `ticket.timing` event with a `wallMs`. What happens: the every-exit-path guarantee rests on the try/finally being read correctly by eye.

(Also note the doc says "the two refusals below" but only one refusal now remains in that function — the `agent-browser`-missing one was removed by ticket 3's mode split.)
- [ ] [New cross-package wire shape `wallMs` declared outside `@runcastle/core`] Standards axis — judgement call, with a caveat below.

Citation: CLAUDE.md § Package map — `packages/core` is "IO-free contracts: schemas, drizzle schema, pipeline/gates, paths, workflow types, config", and "`@runcastle/core` is the only package with no IO ... Everything else depends on it for wire types."

The producer declares the shape in the server: `export interface TicketTiming extends ToolTimingSummary { startedAt: number; endedAt: number; wallMs: number }` in `packages/server/src/workflows/ticket-burner.ts`. The consumer re-derives it structurally in the web app, `apps/web/src/lib/feature-ui.ts`:

    function timingWallMs(data: unknown): number | undefined {
      if (typeof data !== 'object' || data === null) return undefined
      const ms = (data as { wallMs?: unknown }).wallMs
      return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : undefined
    }

Producer and consumer now agree on the field name `wallMs` only by convention; nothing in core binds them, so a rename on the server side typechecks clean and silently degrades every run lane to the fallback span.

Caveat that keeps this a judgement call rather than a hard violation: `ToolTimingSummary` already lived in `ticket-burner.ts` rather than core before this lap, so `TicketTiming` follows the existing precedent rather than breaking a new one — and the reader is deliberately tolerant of a missing field. The change worth considering is moving the pair into core, not just this one interface.
- [ ] [Could not drive: the review drive was refused, over a human-written file] Drive attempt.

What I did: `mcp__runcastle__review_drive({ action: "start" })`, once. What happened:

    {"ok":false,"action":"start","deniedReason":"Working tree has uncommitted changes — commit or stash first","drive":null}

The sole dirty entry in the checkout is `?? docs/features/burn-concurrency-default-by-core-count/test-notes.md`. Per the prompt a refusal is final, so I did not retry; no browser was opened and no recorder was started, so there was nothing to clean up.

Two things worth the human's attention, and I want to be exact about which is which:

1. This refusal does NOT test the fix. The runcastle server serving this MCP call runs `packages/server/src/bin/runcastle.ts` from this checkout, which is on `main` — the pre-fix code, with no `commitPipelineDocs`. So what I hit is the original bug, still live on `main`, not a regression in the branch. Confirming the fix end-to-end needs a server restarted on `feature/review-fixes`.

2. It is nonetheless a useful data point about the fix's shape. The blocking file is untracked and human-written — a `test-notes.md` under a *different* feature's docs directory, not a `brief.md` runcastle scaffolded. Under the branch's code this drive would have started, because `commitPipelineDocs` would have committed that human file to `main` under "runcastle: docs the pipeline left uncommitted". So the same fix that unblocks the drive is what makes the over-broad-sweep note reproducible.

Consequence for this review: acceptance criterion 4's UI half — that run lanes and ticket cards report a ticket's duration from `ticket.timing` events rather than a log-file span — is UNVERIFIED by driving. I confirmed it by reading (`apps/web/src/lib/feature-ui.ts` `ticketDurations`, its call site in `RunBody.tsx`, and its unit tests in `apps/web/test/feature-ui.test.ts`), but I never saw it render.
- [ ] [Summary of this review pass]

Scope: the code review ran in full, on `git diff main...feature/review-fixes` — 13 files, +626/−137, 10 commits. The drive was attempted once and refused (see its own note); nothing was left running. Both refs resolved and the diff was non-empty.

STANDARDS axis — 5 findings. Worst within this axis: `commitPipelineDocs` fires on the human's own Test drive as well as review drives (`packages/server/src/services/git.ts`, placed above the `purpose` check that already exists at line 1859 and is passed `'review'` at line 2136), so a human clicking Test drive with docs edits in progress has them committed without being asked — against CONTEXT.md decision 6 and docs/SPEC.md §7 line 169. The rest: no event emitted for that commit (CLAUDE.md's "every service function that mutates emits an event") plus a bare `catch` that swallows why it failed; Duplicated Code between `buildGateNotes` and `buildVerifyNotes`; the new `wallMs` wire shape declared outside `@runcastle/core` (judgement call — it follows existing precedent); and the untested seam for `ticket.timing` on `executeReviewTicket`'s refusal path.

SPEC axis — 3 findings. Worst within this axis, and the one I would fix first: Gates mode runs no gates. `review-ticket.ts:368` renders `GATE_NOTES: buildGateNotes(deps.config)` from machine-wide config, but verify commands are per-project columns and the burner resolves them project-first via `resolvePreparedSettings`. On this machine `~/.runcastle/config.json` has no `verifyCommands` at all while the `runcastle` project row has them, so the very next Gates-mode review of this repo will be told there are no gates to run. The other two are the placement and breadth of the new commit: it lands on the base branch rather than the feature branch the ticket named, and it stages `docs/features` wholesale rather than just runcastle's own artifacts.

What I verified and how: criteria 2, 3 and 4 by reading — the prompt asset's prohibitions on improvising an environment, the one-mode split and its `DRIVE_AVAILABILITY`/`GATE_NOTES` host inputs, the try/finally emit in `executeReviewTicket` and the `wallMs`-first `ticketDurations` with its unit tests. Every sub-agent claim in the notes above was re-opened in the file and confirmed before I wrote it; two claims I could not confirm were dropped.

What I could not reach: criterion 1's regression end-to-end (needs a server running the branch's code, not this checkout's), and criterion 4's UI half rendered in a browser. Criterion 1's unit-level regression test does exist and does pass on its own terms — my finding is about which branch it commits to, not whether it unblocks the drive.

No implementation ticket in this burn failed, and none left a digest, so I had the diff and the brief only — nothing here is a review of a partially-built feature.

One thing that is not a defect but the human should know they chose: with the mode split, a lap reviewed in Drive mode no longer gets a code review at all — the new prompt says "Do not read the diff afterwards". That is exactly what ticket 3 asked for, and it replaces the old template's "Never skip the code review. It runs on every lap." Worth confirming that trade is the one intended, because it is the standing behaviour from now on.
- [ ] [Observed live: the note-writing path leaves a second untracked runcastle artifact, after the drive guard has already run]

What I did: checked `git status --porcelain` before the review started, and again after writing my notes.

Before: one entry, `?? docs/features/burn-concurrency-default-by-core-count/test-notes.md`.
After: two, the new one being `?? docs/features/review-fixes/test-notes.md` — written by `add_test_note` itself, i.e. by runcastle, during this review. I made no repo edits; the checkout is still on `main`.

Why this matters for the fix under review: `commitPipelineDocs` was placed at the top of `testDrive`'s start path, which fixes artifacts that exist *before* a drive is requested — the scaffolded `brief.md` the ticket named. But a review's own notes file is written *after* that guard has run, and in the ordinary case after the drive has already started. So the pipeline still ends every review having added an uncommitted runcastle-owned file to the checkout, and it is exactly the kind of dirt that refuses the next drive.

What I expected, given ticket 1's goal ("make sure the feature branch is clean of runcastle-owned artifacts"): the notes file committed on the same terms as the brief, or the drive teardown landing it. What happens: it accumulates, and the next review or Test drive is refused over it — with the caveat that under this branch's code it would instead be committed to whatever branch the checkout is on, alongside any human file sharing that directory.

This is an observation about coverage of the fix, not a claim that the fix regressed anything.
