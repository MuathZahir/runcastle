# Test notes

## Lap 1

- [ ] [Spec axis] Host-side worktree removal is not gated on workspace mode, so `mounted` mode now loses its agent working tree.

What I did: read `packages/server/src/workflows/ticket-burner.ts` on the feature branch. `discardWorktree` (defined ~3544) wraps `cleanupBurnWorktree(project.repoPath, branch)` and is called at 3623, 3645, 3863, 3895 and 3979 with no `workspaceMode` check — `workspaceMode` is already in scope (resolved at 3280).

What happens: `burnWorktreePath()` is the sandcastle worktree for every mode, and in `mounted` mode that worktree IS the agent's working directory (the setup command at 3400-3406 falls through to plain `setupCommand` — no clone, no hook). So on a mounted-mode burn the burner now force-removes (`worktree remove --force`, then `rmSync`) the directory the agent worked in, on every exit path including the success path, where nothing removed it before. Any uncommitted work sandcastle deliberately preserved there is deleted after the BLOCKED.md/DIGEST.md harvest.

What I expected: the change to be confined to the modes whose hook changed. spec.md says: "The `mounted` and `noSandbox` workspace modes install no sync hook and are untouched." decisions.md scopes the removal to the consequence of the push-only hook — "The mounted worktree is therefore always dirty at sandcastle's end-of-run check, so sandcastle preserves it ... the burner removes it host-side" — which is only true for isolated/slot.

Note `mounted` is what `auto` resolves to on a Linux host (`resolveBurnWorkspaceMode`), so this is a live configuration, not a dead branch.
- [ ] [Standards axis] Cancelling a run now waits on the worktree retry loop before the cancel propagates.

What I did: read the two `catch` blocks changed on the branch. Both put the new removal *before* the abort check:

```
} catch (err) {
  await clearAttachmentsFor(tempBranch)
  await discardWorktree(tempBranch)          // line 3863
  if (ctx.signal.aborted) throw err          // line 3864
```
and the same shape in `runResolver` at 3623/3624.

What happens: when the human hits Cancel (or Stop ticket), the agent's error surfaces into this catch and we now `await cleanupBurnWorktree` before rethrowing. That helper retries `worktree remove --force` up to 3 times with a 750ms sleep between, then falls back to `rmSync`, then `worktree prune` — so a cancel on a locked worktree (the Windows `Directory not empty` case this feature is routing around) stalls for ~2.3s plus two git invocations per attempt before the runner can mark the run cancelled.

What I expected: either the abort check first — the run is being torn down anyway — or a line in spec.md / decisions.md accepting the delay. Neither document mentions ordering against the abort check; decisions.md only fixes the removal's position relative to the harvest ("after the BLOCKED.md / DIGEST.md harvest and attachment clearing ... and before landing"). Cited against CLAUDE.md's event/UI-responsiveness contract only loosely, so treat this as a judgement call, not a hard violation — but it is a behaviour change nobody wrote down.
- [ ] [Spec axis] The inverted reset assertion — the core regression guard of this lap — never runs on Windows.

What I did: ran the full suite on both branches with the inherited `RUNCASTLE_*` vars unset. `main`: 2439 passed, 19 skipped. `feature/post-commit-sync-once`: 2443 passed, 20 skipped. Five tests were added but only four of them run here; the skip count went up by one.

What happens: the two real-git tests in `packages/server/test/burn-slot-workspace.test.ts` sit inside `describe.skipIf(process.platform === 'win32')` (line ~365). That block holds both the inverted assertion this lap turns on —

```
// ...and did NOT check the commit out into the mounted working tree.
expect(existsSync(join(workspace, 'WORK.md'))).toBe(false)
```

— and the new "retries a failed push, then tells the agent once" test, which is the only executable proof that the failure line actually reaches stderr. On Windows neither runs; the hook is covered only by string matching on the setup command.

What I expected: AC6 asks that "the two updated test files assert the new hook shape and invert the old reset assertion". They do — but on this repo's own primary host (Windows 11, and the platform where `resolveBurnWorkspaceMode`'s `auto` actually chooses `isolated`) the inversion is skipped, so a regression that reintroduced the reset would go green locally and only fail on a Linux CI run. The pre-existing `skipIf` is not this lap's doing; placing the lap's load-bearing new assertions inside it is.
- [ ] [Spec axis] ADR-0008 was amended but carries no dated amendment line.

What I did: read `git diff main...feature/post-commit-sync-once -- docs/adr/`.

What happens: ADR-0005 gained the line

```
- **Amended:** 2026-08-28 — post-commit hook is push-only; the mounted worktree
  is removed host-side after the run (feature post-commit-sync-once)
```

ADR-0008's header is untouched — still `- **Status:** accepted (2026-07-27)` — even though its consequence paragraph was rewritten to describe the new mechanism. A reader scanning ADR-0008's header cannot tell it was revised.

What I expected: acceptance criterion 5 says "ADR-0005 **and ADR-0008** are amended in place, **dated 2026-08-28**". Worth flagging that the spec is narrower than the criterion — decisions.md decision 3 only asks for "ADR-0005 gets a dated *Amended (2026-08-28)* status line" and for ADR-0008 says only that "ADR-0008's consequence paragraph ... is replaced". So the implementation matches decisions.md and misses the acceptance criterion as written. Low severity; a one-line header addition closes it either way.
- [ ] [Standards axis] A host-side worktree removal that fails is now silent on four of its five call sites.

What I did: traced `discardWorktree`'s return value. It is typed `Promise<boolean>` — `cleanupBurnWorktree`'s honest "is the directory actually gone" answer — and it is consumed at exactly one of five call sites:

- 3623 (`runResolver` catch) — dropped
- 3645 (`runResolver`, after the BLOCKED.md read) — dropped
- 3863 (attempt catch) — dropped
- 3895 (`isWorktreeTeardownError` branch) — `const removed = await discardWorktree(tempBranch)`, used for the `burn.worktree.teardown-failed` event
- 3979 (success path, before `landChain`) — dropped

What happens: on the happy path — now the *main* path, since this lap moves removal there — a worktree that stays locked leaves no trace at all. The pile-up under `.sandcastle/worktrees/` that decisions.md names as a benefit ("the currently-unbounded pile-up of DIGEST-dirty preserved worktrees ... gets cleaned") would silently keep growing with nothing in the event stream to say so.

What I expected: CLAUDE.md's convention — "Every service function that mutates emits an event — events are the UI's lifeblood" — points at emitting on the failure, and the machinery already exists one branch away (`burn.worktree.teardown-failed`). This is a judgement call rather than a hard violation: the rule is written about service functions, and `cleanupBurnWorktree` is documented as best-effort. But the branch deliberately kept a boolean it then throws away in the case that matters most.
- [ ] [Standards axis] Speculative Generality — a per-branch memo Map where a single promise would do.

What I did: read the new helper in `packages/server/src/workflows/ticket-burner.ts` (~3541):

```
const discards = new Map<string, Promise<boolean>>()
const discardWorktree = (branch: string): Promise<boolean> => {
  const pending = discards.get(branch) ?? cleanupBurnWorktree(project.repoPath, branch)
  discards.set(branch, pending)
  return pending
}
```

Its doc comment gives the reason: "Memoized per branch — the teardown-error path wants the removal's outcome for its event and must not pay the retry loop a second time to get it."

What happens: the memo is correct (`??` short-circuits, so the second call reuses the in-flight promise). But only one pair of call sites can ever double-call, and both members of that pair name the same known branch — the catch at 3863 and the teardown-error branch at 3895, both `tempBranch`. The resolver's two calls are both `resolveBranch`, likewise a single value. A `Map` keyed by branch generalises over a multi-branch case that does not exist; a single `let pending: Promise<boolean> | undefined` per site expresses the same "don't pay twice" guarantee.

What I expected: the smell is Speculative Generality from the review baseline; no repo standard endorses the Map, and CLAUDE.md is silent here. Judgement call, no correctness impact — the map also never grows beyond two entries, so there is no leak. Flagged because the comment justifies memoization but not the keying.
- [ ] [Standards axis] Test helper's doc comment claims the opposite of what its implementation does.

What I did: read the new file `packages/server/test/helpers/setup-hook.ts` (20 lines, the only file added outside `docs/`). Its comment ends: "This reverses that delivery ... so tests can assert on the hook's behaviour **rather than on its packaging**." The body:

```
const open = `printf '#!/bin/sh`
const start = setupCommand.indexOf(open)
if (start === -1) throw new Error('setup command writes no post-commit hook')
const from = start + `printf '`.length
const end = setupCommand.indexOf(`' '${branch}'`, from)
```

What happens: the helper is *entirely* packaging-coupled — it hard-codes that the hook is written by a `printf` whose format string opens with `#!/bin/sh` and is terminated by the literal `' '<branch>'`. Change the hook to a heredoc, add a third `%s` arg, or pass the branch any other way and both `throw` sites fire, failing the four tests that use it for a reason unrelated to what they assert. That is a reasonable trade for a test helper, but the comment tells the next reader the opposite, which is the Mysterious Name / misleading-comment shape.

What I expected: either a comment that says what it is ("reads the hook back out of the printf packaging — update this if the delivery changes"), or the packaging exported from the builder so the helper does not have to re-derive it.

Verified separately that the helper is faithful today: I extracted the hook independently for both builders and got byte-identical output, which parses clean under `sh -n`. Cosmetic finding only.
- [ ] [Standards axis] Shotgun Surgery — the same unmeasured cost figure is now restated in six places.

What I did: `git grep -n "15–90" feature/post-commit-sync-once -- docs packages`. Six hits:

- `docs/adr/0005-burner-isolated-workspace.md:85`
- `docs/adr/0008-burn-performance.md:138`
- `docs/features/post-commit-sync-once/spec.md:5`
- `packages/server/src/workflows/ticket-burner.ts:1097` (the `buildRepoSetupSteps` doc comment)
- `packages/server/test/burn-slot-workspace.test.ts:372`
- `packages/server/test/ticket-burner-units.test.ts:1523`

What happens: "15–90s per commit, ~19–25 min over a feature" is load-bearing prose that spec.md's own Open questions section says was **not** measured — "The split of cost between push and reset was inferred from the operations' shapes ... not measured in isolation; the timing telemetry on the first real burn after this lands is the confirmation." When that telemetry arrives and the figure moves, correcting it means editing six files across `docs/adr/`, `docs/features/`, `src/` and two test files.

What I expected: the ADRs are the right home for the number (that is what an ADR is for), and the feature docs restating it is normal. The three copies in `src/` and `test/` are the avoidable ones — a pointer to ADR-0005 carries the same weight and cannot drift.

Judgement call from the smell baseline, not a documented-standard violation; CLAUDE.md says nothing about comment duplication. Raised because this specific number is flagged as provisional by its own spec.
- [ ] [Review summary — lap 1, code review only]

No drive: the ticket states this lap has no UI, and the diff (one shell hook string, one host-side cleanup call, two ADRs, three test files) bears that out. No drive slot was taken and no recording exists. Both review axes ran; 7 findings, filed separately.

**What I verified directly.** The generated hook, extracted from `buildIsolatedSetupCommand` and `buildSlotSetupCommand` outside the repo and written to disk: both builders emit a byte-identical 7-line script, it parses under `sh -n`, `printf` produced real newlines, and it contains exactly two pushes (`git push --quiet origin HEAD:<branch> && exit 0` / `sleep 2` / same push), the exact failure line, a trailing `exit 0`, no `reset`, no `/home/agent/workspace`, no `timeout`. AC1 fully met. AC2 met by reading: all five `discardWorktree` call sites (3623, 3645, 3863, 3895, 3979) cover landed, failed, stopped, merge-conflict, missing-binary, retryable-continue, teardown-error and both resolver paths. AC3 met — the success-path removal sits after `readAgentFile`/`harvestDigest` and before `landChain`, and the resolver's after its BLOCKED.md read. AC4 met: `cleanupBurnWorktree` does only `worktree remove --force` / `rmSync` / `prune`, touches no refs, and the new `git.test.ts` case pins that the branch and its commits survive.

**Spec axis — 4 findings. Worst: the host-side removal is not gated on workspace mode**, so in `mounted` mode (what `auto` picks on a Linux host) the burner now force-deletes the directory the agent actually worked in, on every exit path including success, against spec.md's "the `mounted` and `noSandbox` workspace modes ... are untouched". Also: the lap's inverted reset assertion sits inside a `skipIf(win32)` block and so never runs on this machine; ADR-0008 carries no dated amendment line; ADR-0005 gained a Consequences bullet slightly beyond what decision 3 asked for (accurate, not filed).

**Standards axis — 3 findings, no hard violations of a documented standard. Worst: both `catch` blocks removal happens before the `ctx.signal.aborted` rethrow**, so Cancel now waits out `cleanupBurnWorktree`'s 3×750ms retry per attempt — undocumented in spec.md or decisions.md. Also a dropped boolean that silences a failed removal on 4 of 5 sites, a memo `Map` keyed by a branch that is always a single known value, a test-helper comment that claims the opposite of what the helper does, and the provisional "15–90s" figure copied into six files. Checks that pass: no `any`, ESM, `node:path`, no sandcastle or `patches/` change (ADR-0011 honoured), no new ADR, docs in the right place.

**Correcting the ticket-1 digest on AC6.** It reports "1 failed: dev-pane.test.ts:183 (pidAlive)" and calls the stated baseline stale. What I measured on this host: `main` — 144 files, 2439 passed, 19 skipped, **exit 0, no error**. `feature/post-commit-sync-once` first run — 2443 passed, 20 skipped, 0 failures but **exit 1** from an unhandled `EPIPE` in `pty-sidecar.ts:178` via `dev-pane.test.ts`; second run of the same branch — **exit 0**, all green. So the EPIPE is a flaky teardown race in the pty sidecar, unrelated to this diff, and the `pidAlive` failure the digest reports did not reproduce on either branch. AC6 is met: `bun run typecheck` and `bun run test` both pass on the branch. Worth knowing separately that the suite can exit non-zero with zero failing tests — that would confuse any gate reading the exit code.

Note for reproduction: the suite needs the inherited `RUNCASTLE_*` asset env vars unset, or it reads a globally-installed migrations dir.
