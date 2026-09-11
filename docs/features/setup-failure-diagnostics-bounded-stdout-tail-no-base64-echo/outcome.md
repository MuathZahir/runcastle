# Outcome — Setup-failure diagnostics: bounded stdout tail, no base64 echo

The burn exec error helper appends only result.stderr to setup/verify failure messages. Maven, Gradle and most JVM build tools log their errors to stdout, so a failed setup surfaces as a blank 'exit 1' with no diagnostic. Append a bounded stdout tail as well, reusing the existing maxOutputTailChars cap (apply it to the combined tail so messages stay bounded). While in that helper: stop echoing the full base64-encoded setup script into the error message — it is noise that dwarfs the actual diagnostic. Add/extend unit tests: a failure with empty stderr but populated stdout must show the stdout tail; the base64 script body must not appear in the rendered error.

- Shipped: 2026-09-09
- Laps run: 1

## What shipped

15 commits · 8 files

### Lap 1
- 5 tickets landed: #1 The burn exec error helper appends only result.stderr to setup/verify…; #3 Configured maxOutputTailChars is ignored by the combined failure tail; #4 Payload redaction also hides unrelated long command arguments; #5 Feature commits do not follow the repository’s conventional subject format; #6 Permanent dependency patch duplicates its source-map directive
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 6ae640b878c8624569f6b1bb288a8fd44e25bca9
- Landed since: 4
- Outcome: done

### Lap 1 · verification

- Reviewed commit: da8e6ccd109948e64a6d349a8ce4d33e1cfe4eba
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: fb5facfc47fa8c6891e50fda1884a2dba4530109
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. The burn exec error helper appends only result.stderr to setup/verify…

# ticket 1 — setup-failure diagnostics: bounded stdout tail, no base64 echo

## What was done

The "burn exec error helper" the brief describes is not runcastle code — it is
`execOk2` inside `@ai-hero/sandcastle` 0.12.0's bundled `dist/chunk-VOG34SRF.js`,
the helper that every sandbox git-setup command and every `onSandboxReady` hook
goes through. It rendered `Command failed (exit N): <command>\n<stderr>`. So the
work landed as new hunks on the permanent sandcastle patch (ADR-0011), which is
this repo's sanctioned mechanism for changing that package.

A new `formatExecFailureMessage` lives in `dist/chunk-NGBM7T3E.js`, next to
`MAX_TAIL_CHARS` (the default behind sandcastle's own `maxOutputTailChars`
option). It joins stdout and stderr — stdout first, so the tail-slice keeps
stderr's last word — trims each, drops the empty one, and caps the combined tail
at `MAX_TAIL_CHARS`. It also renders the command with any run of 120+
non-whitespace characters replaced by an ellipsis, which removes the base64
payloads `buildGuardInstallCommand` delivers while leaving the readable shell
around them (`printf %s … | base64 -d > "$HOME/.claude/hooks/burn-guard.sh"`)
intact — a truncating prefix would not have worked, because the guard prelude
puts the payload near the *start* of the setup command.

`formatExecFailureMessage` is re-exported from `index.js`/`index.d.ts` so
`packages/server/test/sandcastle-exec-failure.test.ts` can drive the compiled
function itself rather than a re-implementation — the same rationale
`sandcastle-volume-mount.test.ts` gives for its half of the patch contract. Five
tests: stdout-only failure shows the stdout tail; stderr still shows and shows
last; command and exit code still named; the real guard install command's base64
body is absent while its tail is intact; the combined tail is capped exactly.

Two follow-ons the patch obliged, both committed separately: a sixth build
marker in `BUNDLED_DEPENDENCIES` (ADR-0011 item 3 fails the release build when a
published bundle lost the patch, and without a marker this hunk could have
vanished silently), and ADR-0011 item 2's hunk list, which named only the
named-volume work and would have had a future version bump drop this.

## Surprises

- The brief's `maxOutputTailChars` is a sandcastle *provider option*, not
  anything in this repo — grepping for it here finds only the research note.
  That, plus the exact `result.stderr` phrasing, is what identified the target.
- The patch regeneration route in ADR-0011 works verbatim and is worth trusting:
  copying the pristine package out of the bun store, committing it, applying the
  existing patch and re-running `git diff --cached --full-index` reproduced the
  old patch **byte for byte** before I added anything. Doing that check first is
  cheap and proves the route before you rely on it.
- The marker is keyed on the `/\S{120,}/g` regex literal, not on a function
  name: `publish-manifest.ts` already warns that the bundler renames bindings,
  and a regex literal is the one thing it will not rewrite.
- `bun install` re-applied the changed patch offline with no `--force` and
  without disturbing git's `core.hooksPath` or node-pty. ADR-0011 warns a plain
  install "does not always" re-apply; on Bun 1.3.14 here it did.

## Left undone

- `packages/server/test/dev-pane.test.ts > "kills the child process tree so the
  port-holder is not orphaned"` fails in this sandbox — `pidAlive(-pgid)` is
  still true after `stopDevPane`. It fails identically on three consecutive
  targeted runs, is not in the prompt's baseline, and cannot be caused by this
  diff: that test's import graph is `pty/*` + `services/events` + the db helpers,
  with no sandcastle in it, and node-pty's install was untouched. Read as an
  environment fault (process-group reaping in this container). Everything else
  is green: 237 files, 3448 tests.
- `execOk` and `execOk3` — sandcastle's two *other* copies of the same helper,
  used by sync-in/sync-out commit collection — still render stderr only. They
  are not on the setup/verify path the ticket names, so I left them; if a commit
  collection failure ever comes back blank, they are the next two hunks.
- Nothing in the drive machinery needed a change: this ticket adds no service,
  env var, seed or process. `.runcastle/drive-setup.ts` already runs
  `bun install`, which is what re-applies the patch, so a drive of this branch
  picks the change up with no edit. I did not run the drive scripts (no services
  in this sandbox); I read `drive-setup.ts` to confirm the install step is there.

#### 3. Configured maxOutputTailChars is ignored by the combined failure tail

# ticket(3) — Configured maxOutputTailChars is ignored by the combined failure tail

## What was done

`formatExecFailureMessage` now takes the bound as a third argument
(`maxTailChars`, defaulting to the same 64 KiB `MAX_TAIL_CHARS` it hard-coded
before) and slices the combined stdout/stderr tail with it. Carrying a
provider's configured value there took a chain, because nothing between the two
knew about it: every provider (`noSandbox`, `docker`, `podman`, `vercel`,
`daytona`) now publishes its already-resolved `maxOutputTailChars` on the handle
it creates, `makeSandboxFromHandle` — the one place every provider's handle
becomes a `Sandbox` — carries it across, and `execOk2` passes it to the
formatter. The three handle interfaces in `SandboxProvider-EkSMuBp8.d.ts` and
the formatter's `index.d.ts` declaration were updated to match, and
`patches/@ai-hero%2Fsandcastle@0.12.0.patch` was regenerated from the pristine
package by ADR-0011's own procedure (which reproduced the existing patch
byte-for-byte first, so the new hunks are the only delta). `docs/adr/0011`'s
regeneration recipe now names that chain, since dropping any one link reverts
the bound to 64 KiB silently. Tests: the formatter honours an explicit cap of
100 (the reviewer's assertion), and a provider carries a configured 100 — and
the default — onto its handle.

I re-ran the reviewer's repro step and it no longer reproduces. It could not be
run through `createSandbox`'s `onSandboxReady` as literally written: that path
calls `sandbox.exec` directly and does not treat a non-zero exit as an error at
all, so the setup command "failed" without producing any message. `execOk2` —
the code the finding is about — is on the `run()`/`interactive()` lifecycle
instead. So I drove the real chain end to end in a throwaway script:
`noSandbox({ maxOutputTailChars: 100 })` → its handle → `makeSandboxFromHandle`
→ a genuinely failing shell command streamed with `onLine` (77 chars retained on
stdout, 41 on stderr, 118 combined) → `formatExecFailureMessage(command, result,
sandbox.maxOutputTailChars)`, exactly `execOk2`'s call. The tail came back at
exactly 100 characters and still ended with `FAILURE: Build failed with an
exception.`; before the fix it would have been all 118.

## Surprises

- `createSandbox` and `run()` disagree about what a failing setup hook is. Only
  the `run()`/`interactive()` lifecycle routes hooks through `execOk2`; a hook
  that fails under `createSandbox` is not an error. Worth knowing before writing
  another test against "a failing setup command".
- `execOk2` is not exported from any entrypoint and `makeSandboxFromHandle` only
  from an internal chunk, so the last link of the chain is not reachable from a
  committed test. The two halves are pinned separately (formatter honours a cap;
  provider publishes one); the join itself I verified by running it and by
  matching the shipped chunk's source in the repro script.
- Test files are not typechecked (`packages/server/tsconfig.json` has
  `include: ["src"]`), which is why the existing volume-mount test can call
  `provider.create(...)` even though the public `SandboxProvider` type declares
  no `create`.
- `bun run typecheck` is green. `env -u GIT_ASKPASS bun run test` is 3451 passed
  / 1 failed: `dev-pane.test.ts > kills the child process tree so the
  port-holder is not orphaned`. That test is a PTY process-group reaping
  assertion with no sandcastle involvement, it fails identically when run alone,
  and it is untouched by this diff — it is not listed in the prompt's baseline,
  but the baseline's own counts (118 files / 1768 tests) are stale against this
  branch's 239 files / 3456 tests.
- No drive-machinery change was needed: this ticket adds no service, no required
  env var, no seed and no extra process. I did not run `.runcastle/drive-*`
  (there are no services in this sandbox) and did not need to check its paths,
  since nothing in the diff touches it.

## Left undone

- I did NOT add a new `publish-manifest.ts` marker for the threading hunks.
  `chunk-VOG34SRF.js` (the join and the funnel) already carries two markers from
  the named-volume patch, and the provider chunks carry their own, so a bundle
  that lost this patch already fails the build. A marker would only catch the
  narrower case of the threading hunks being dropped while the rest survived —
  possible only through a hand-error during a sandcastle bump.
- The review of this lap also flagged that `elidePayloadTokens` redacts *any*
  120+ character token, not just base64, and that the patched bundle carries a
  duplicated `//# sourceMappingURL` line. Both are outside this ticket; the
  duplicated directive is in the pristine 0.12.0 bundle, not something the patch
  introduced, so regenerating the patch cannot remove it.

#### 4. Payload redaction also hides unrelated long command arguments

# ticket(4) — payload redaction no longer hides unrelated long arguments

## What was done

The `elidePayloadTokens` helper in the sandcastle patch
(`patches/@ai-hero%2Fsandcastle@0.12.0.patch`, `dist/chunk-NGBM7T3E.js` hunk)
replaced every run of 120+ non-whitespace characters in the echoed command with
an ellipsis. It now replaces only the body of a long **single-quoted base64
literal** — `/'[A-Za-z0-9+\/=]{120,}'/g` → `'…'` — which is exactly the shape
`buildGuardInstallCommand` emits (`printf %s '<blob>' | base64 -d > <file>`).
Restricting the match to the quotes plus the base64 alphabet is what keeps a
long URL, JSON argument, certificate or generated id in a failure message; the
old length-only rule ate all of them.

Two follow-on edits were required, not optional extras: the published-bundle
marker in `packages/server/scripts/publish-manifest.ts` pins the regex literal
verbatim (the build fails when a marker stops matching), and the `PATCHED_BUNDLE`
fixture in `publish-manifest.test.ts` mirrors it. A new test in
`sandcastle-exec-failure.test.ts` pins the narrowing with the reviewer's exact
repro command.

I re-ran the reviewer's repro step directly against the patched build, not only
through the test: `formatExecFailureMessage('tool --url ' + 'x'.repeat(120),
{exitCode: 1, stdout: '', stderr: 'failed'})` now renders the 120-character
argument in full, and the same run against `buildGuardInstallCommand()` still
renders `printf %s '…' | base64 -d > "$HOME/.claude/hooks/burn-guard.sh"`. The
repro no longer reproduces.

## Surprises

- `'x'.repeat(120)` — the reviewer's repro token — is *itself* valid base64
  alphabet, so narrowing the character class alone would not have fixed it. The
  quoting is what separates a payload from an argument, so the fix keys on that.
- The patch is a diff, so changing the comment above the helper meant fixing the
  hunk header's added-line count (`@@ -71,6 +71,38 @@` → `+71,41`). I verified
  the edited patch really applies by following ADR-0011's procedure:
  `rm -rf node_modules/.bun/@ai-hero+sandcastle@0.12.0 && bun install --force`,
  then reading the installed chunk. It applied clean and `bun.lock` was unchanged.
- `bun run typecheck` is clean. `env -u GIT_ASKPASS bun run test` is 3449 passed
  / 1 failed, and the one failure is **environmental, not mine**:
  `packages/server/test/dev-pane.test.ts` → "kills the child process tree so the
  port-holder is not orphaned" asserts `kill -0 -pgid` throws ESRCH after a stop.
  PID 1 in this container is a `sleep`, which never reaps orphans — `ps` shows a
  long list of zombie `sleep`/`sh`/`node` entries — so a killed grandchild stays
  a zombie and `kill -0` keeps succeeding. It fails identically in isolation on
  three runs and touches nothing in my diff. The prompt's stated baseline (118
  files / 1768 tests) is stale; the suite is 239 files / 3454 tests today.

## Left undone

- The other review finding on this lap — that `formatExecFailureMessage` bounds
  the tail with a fixed 64 KiB `MAX_TAIL_CHARS` instead of honouring a provider's
  configured `maxOutputTailChars` — is untouched here; it is someone else's ticket.
- The helper is still named `elidePayloadTokens` though it now elides quoted
  literals rather than bare tokens. Renaming is safe (the bundle marker keys on
  the regex literal, not the name) but is pure churn for this ticket.
- No drive-machinery change was needed: this ticket adds no service, env var,
  seed or process. Nothing under `.runcastle/` was touched, so nothing there was
  run or checked.

#### 7. Verify the fixes that landed

Gates verification pass

Verified pass #2 against `main` by reading each landed fix diff and tracing its stated repro.

- #3 held: `maxOutputTailChars` is published by all five provider handles, carried through `makeSandboxFromHandle`, and passed by `execOk2` to `formatExecFailureMessage`. The formatter applies that value to the combined stdout/stderr tail, and the 100-character regression test pins the original repro.
- #4 held: payload elision now targets only long single-quoted base64 literals. The exact `tool --url ${'x'.repeat(120)}` repro remains visible in full, while the guard-install command's quoted base64 body is still replaced.
- #5 held: `CLAUDE.md` and `docs/SPEC.md` now document `ticket(<seq>): <summary>` and `runcastle: <what>` as the machinery-owned conventional subjects on burn branches, matching the prompt generator and orchestrator behavior. Comparing the feature history with the amended convention no longer produces the finding.

No verify commands are configured, so there were no automated gates to run. No verification findings were reported, and no plainly broken touched surface was found.

<promise>COMPLETE</promise>

#### 8. Verify the fixes that landed

Gates verification pass

- Fix #6 held. Comparing `main...feature/setup-failure-diagnostics-bounded-stdout-tail-no-base64-echo` at `patches/@ai-hero%2Fsandcastle@0.12.0.patch`, the `dist/chunk-NGBM7T3E.js` export hunk now has exactly one `//# sourceMappingURL=chunk-NGBM7T3E.js.map` directive; the reported consecutive duplication no longer reproduces. The corrective commit trims duplicate trailing context without changing the intended patched bundle output.
- No landed fix failed verification, and no plainly broken behavior was found within this bounded diff review.
- No verify commands are configured for this project, so there were no gates to run.

<promise>COMPLETE</promise>
