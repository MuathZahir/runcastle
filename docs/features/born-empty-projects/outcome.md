# Outcome — Born-empty projects

Opening a non-git folder offers to run git init (and makes the initial commit), a zero-commit repo survives project chat and feature creation, and the preparation CTA stops being pushed at repos with nothing to prepare.

- Shipped: 2026-09-24
- Laps run: 1

## What shipped

16 commits · 25 files

### Lap 1
- 5 tickets landed: #1 Initial-commit primitive + unborn-HEAD auto-heal at every branch-cut seam; #2 Initialize-repository offer on the open-project screen; #3 Empty repos: prep view gains an empty signal and the prepare CTA yields; #5 Project files under docs never make the repository non-empty; #6 Non-repository error state displays two solid primary buttons
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 4f9b96329b844b1cd8c41b3511e7532954bf9baf
- Landed since: 2
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 49dd4acb1e87fb316bfaff3fbfedac81f082621d
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 2. Initialize-repository offer on the open-project screen

# ticket(2) — Initialize-repository offer on the open-project screen

## What was done

The open screen's "Not a git repository" refusal now carries a remedy instead of an instruction.
Server side, `git.initRepository` (services/git.ts, beside ticket 1's `makeInitialCommit`) refuses a
missing path and a folder that is already a repository, runs `git init` — passing `-b main` only when
`git config --get init.defaultBranch` is unset, so a user's configured name survives — and then makes
ticket 1's empty `runcastle: initial commit`. `initProjectRepo` in services/projects.ts wraps it with
`openProject`'s own `expandPath` normalization and hands the normalized path back; `project.initRepo`
on the project router is the seam. It emits no event: nothing is a project yet, so there is no
timeline to emit on — the retried `open` is what puts the path on one.

Web side, `repoOpenFailure` gained an optional `offer: 'init-repo'` on the non-repo failure (its hint
no longer tells the human to go and run `git init`), `FailureNote` gained an optional `action` slot
next to its hint, and `OpenProject` renders one `Initialize repository` button there that calls
`initRepo` and, on success, re-submits `open` with the returned path — one click, no dialog. A
refused init (unset git identity) replaces the failure that offered it, so the note then shows the
server's identity message with both `git config` commands verbatim and the now-pointless offer is
gone. `DirectoryPicker` is untouched.

Deviation from the ticket's sketch: the git work lives in `services/git.ts` rather than inside
`services/projects.ts`, because `git()` (simple-git) is private to that service and the ownership
table puts real git there; the projects service keeps the path normalization and is what the router
calls, as the ticket asked.

## Surprises

- `apps/web/test/first-run-wizard.test.tsx` stubs the whole tRPC client by hand and renders
  `OpenProject`, so adding a mutation to the component broke two of its tests with
  `Cannot read properties of undefined (reading 'useMutation')`. Fixed by adding `initRepo` to that
  file's stub — worth knowing that stub exists before touching this component again.
- `init.defaultBranch` is a fact about the machine, not the repo, so the new server test pins
  `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` to temp files (identity included — a folder that is not a
  repository yet has nowhere to carry local config). Safe because vitest 4 runs each file in its own
  process.
- `packages/server/test/dev-pane.test.ts > kills the child process tree…` fails in this sandbox both
  before and after this diff (the process group survives the kill). It is the PTY-teardown
  environment failure ticket 1 also reported; nothing in this diff is reachable from it. Everything
  else is green: typecheck 0 errors, 3809 passed / 1 failed / 35 skipped.
- The stated baseline ("118 files, 1768 passed, 0 failed") no longer matches this repo — the suite is
  266 files / 3845 tests.

## Left undone

- The picker still lists non-repo folders without hinting that they can be initialized; the offer
  deliberately lives only in the open error state (out of scope: no chooser redesign).
- Drive machinery unchanged, and rightly: this ticket adds no service, no boot-time env var, no seed
  and no companion process — only a tRPC mutation. I did not run the drive scripts (no services in
  this sandbox) and did not need to edit them.

#### 5. Project files under docs never make the repository non-empty

# ticket(5) — project files under docs never made the repo non-empty

## What was done

`prepView`'s emptiness check used to compare only the *names* of the repository's
root entries against `.git` and `docs`, so a repo whose whole content lived below
`docs/` — a documentation site's sources, or plain code someone put there — stayed
`empty: true` and kept the full-body prepare CTA away for good. The check now lives
in a small `isEmptyRepo(repoPath)` helper in `packages/server/src/services/prep.ts`:
it keeps the root-entry rule and, when `docs/` exists, descends one level and accepts
only runcastle's own scaffolding directories (`docs/adr`, `docs/features`). Anything
else under `docs/` ends emptiness exactly like a file at the root. Still computed live
per request, never stored.

Two tests were added to `packages/server/test/prep-empty.test.ts` at the same seam the
existing ones use: `docs/index.ts` makes the repo non-empty (the reviewer's repro), and
a `docs/adr/0001-*.md` still reads as empty so the scaffolding half stays pinned.

I re-ran the reviewer's repro step exactly. Before the change it reproduced — an inited
repo plus `docs/index.ts` still reported `empty: true` (the new test failed red on that
assertion). After the change it does not: `empty` is `false` and, through the web
selector in `apps/web/src/lib/project-workspace.ts`, that routes the project home back
to the prepare workspace. I also ran the repro through the real wire — a throwaway test
driving `project.prep` via the tRPC caller against a temp repo — which passed both
assertions; that scratch file was deleted and never committed.

## Surprises

- The full suite has one failure that is not mine and not in the prompt's baseline:
  `packages/server/test/dev-pane.test.ts > kills the child process tree so the
  port-holder is not orphaned`. It spawns a PTY shell with a backgrounded `sleep` and
  asserts the process group is reaped within 400 ms; it fails the same way on a
  targeted run, touches nothing this branch or this feature changed, and is a
  container process-reaping artifact. Everything else: 3811 passed, 35 skipped.
  `bun run typecheck` is clean.
- The prompt's baseline numbers (118 files / 1768 tests) no longer describe this repo,
  which now runs 266 files / 3847 tests — worth knowing before someone treats an
  unlisted failure as theirs.
- The commit-sync hook's push was rejected once with "stale info"; a `git fetch origin`
  followed by the same `--force-with-lease` push landed it. The mirror at
  `/home/agent/workspace` has `receive.denyCurrentBranch=ignore`, so its worktree and
  index lag the ref by design — the branch ref there is at my commit.

## Left undone

- The descent stops one level deep: a file placed *inside* `docs/features/` or
  `docs/adr/` (say `docs/features/app.ts`) is still counted as scaffolding. Matching
  the scaffold's real shape (feature slug dirs of `.md` files, numbered ADR files)
  would need a deeper walk than this fix was asked for; I took the smaller reading.
- There is no shared constant for the repo-relative `docs` directory name — the two
  owners are `featureDocsRel` in `@runcastle/core/paths` and `ADR_DIR_REL` in
  `services/knowledge.ts`. The new list names them in its doc comment rather than
  importing them, to keep the read-side `prep` module free of `knowledge`'s dependency
  chain; a future tidy could hoist one constant into core and let both sides use it.
- No drive machinery change was needed: this ticket adds no service, env var, seed, or
  process. I did not run `.runcastle/drive-setup.ts` (the sandbox has no app); nothing
  in the diff touches `.runcastle/`.

#### 6. Non-repository error state displays two solid primary buttons

# ticket(6) — Non-repository error state displayed two solid primary buttons

## What was done

The "Initialize repository" action inside the open screen's non-git failure note was
rendered with `variant="solid"`, so while that note was up the screen showed two solid
buttons — Open and the offer — against `apps/web/STYLE.md`'s "exactly one `solid` button
is visible per view". The offer now takes the default `ghost` variant, which is what every
other `size="xs"` in-row action in the app already uses (NextStepBar, ReviewTrail,
FeaturePanes). Open keeps its primacy; nothing about the offer's behaviour, copy, label,
pending state or disabled logic changed.

A tier-2 component test in `apps/web/test/open-project.test.tsx` pins the rule at the seam:
after submitting a non-git folder it collects every rendered button whose class list carries
the solid variant's `bg-accent` and asserts the list is exactly `['Open']`. It was red
before the one-line change (`['Open', 'Initialize repository']`) and green after — that is
the reviewer's repro step, re-run exactly: open the picker, submit a non-git folder, inspect
the failure state's button variants. The solid/ghost split is now observable in a test
rather than only by eye.

The other reading of the finding — demote Open to ghost and make the offer the primary —
was deliberately not taken: it is the larger change (Open's variant would become dynamic,
flickering as failures appear and clear), and STYLE.md's own guidance is that a view needing
a second primary is a view to rethink, which is out of this fix ticket's scope.

## Surprises

- `bun run test` has one failure unrelated to this diff:
  `packages/server/test/dev-pane.test.ts > kills the child process tree so the port-holder
  is not orphaned` — `expect(pidAlive(-pgid)).toBe(false)` gets `true`. It fails identically
  when run alone with `-t`, i.e. it is not suite-interaction flake, and a className change in
  a React component cannot reach a pty process-group kill. It reads as a sandbox fault
  (process-group reaping in this container), not a listed baseline failure. Everything else
  is green: 264 files passed, 3810 tests passed, 35 skipped; `bun run typecheck` 0 errors.
- The stated baseline counts in the prompt (118 files / 1768 tests) are stale — the suite is
  266 files / 3846 tests on this branch.
- The first post-commit sync push failed with `stale info` because the clone had no
  remote-tracking ref for this ticket branch yet. `git fetch origin` then a
  `--force-with-lease` push landed it; the mirror is at `ed97c02a`. No merge was used.

## Left undone

- No `.runcastle/` drive-machinery edit: this ticket adds no service, env var, seed or
  process, so the existing idempotent steps already cover it. Nothing was run there (the
  sandbox has no app); nothing needed checking.
- The review's other two observations from the Standards axis — that `project.initRepo`
  emits no timeline event despite the mutation-event convention, and that the healed-head
  event payload is duplicated across callers — are untouched here; they were recorded as
  observations, not defects, and are outside this ticket.

#### 7. Verify the fixes that landed

Gates verification pass

Verified both landed fixes against their recorded findings and repro steps by reading the integration-branch diffs and final file state.

- Ticket #5 holds: `prepView` now checks entries immediately beneath `docs/`; `docs/index.ts` makes `empty` false, while the recognized `docs/adr` and `docs/features` scaffolding remains exempt. Focused server tests cover the reported repro and the retained scaffolding behavior.
- Ticket #6 holds: the non-repository failure state's Initialize repository action now uses the Button default ghost variant, while Open remains the sole solid action. A focused component test asserts that Open is the only button carrying the solid variant styling.
- No plainly broken behavior was found in the reviewed fixes.
- This project has no verification commands configured, so no automated gates were run.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: Both landed fixes resolve their recorded repros, with focused regression coverage and no breakage found in the touched surfaces.
