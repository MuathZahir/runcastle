# Outcome — Native first-message delivery for session kickoffs

Replace PTY-typed kickoff lines with each CLI's own first-message mechanism (positional prompt at spawn; codex queue), demoting the type-and-confirm loop to a fallback.

- Shipped: 2026-09-15
- Laps run: 1

## What shipped

21 commits · 30 files

### Lap 1
- 7 tickets landed: #1 Deliver kickoffs as the argv positional prompt at spawn; #2 Delete the PTY type-and-confirm machinery, resend endpoint, and Send-briefing UI; #3 Make resume actually restore the conversation (codex rollouts + claude session id); #5 Kickoff telemetry is emitted before spawn and even for no-process launches; #6 The required Windows argv-encoding regression test stops before the real encoding boundary; #7 Live product contracts still require the deleted resend and confirmation system; #8 The surviving kickoff-override map is write-only dead state
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 8e7eed21fe6ed10c8b83db1d5db74ec8a6d28ef0
- Landed since: 4
- Outcome: done

### Lap 1 · verification

- Reviewed commit: b208e48e8d73ec3bad4749e074919f7a24935c6d
- Landed since: 0
- Outcome: done

- **Canonical feature contract still requires the override map deleted by fix #8** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 2. Delete the PTY type-and-confirm machinery, resend endpoint, and Send-briefing UI

# ticket(2) — delete the PTY type-and-confirm machinery

## What was done

The kickoff-typing apparatus is gone from `packages/server/src/launcher/sessions.ts`:
`writeKickoffSequence`, the `KickoffDelivery` record and its `deliveries` map,
`kickoffDeliveryFor`, `attemptKickoff`, `armConfirmation`, the undelivered announcer,
`noteKickoffPrompt`, `resendKickoff`, `scheduleKickoff`, the delay/confirm-window
constants, `CLEAR_INPUT`, and the `stopTimers`/`track` helpers. `forgetKickoff` now only
drops the session's override; `ptyIo` shrank to a `ptyAlive` predicate, which is all the
surviving `session.not_ready` watchdog needs. `resendKickoff` also came out of the
launcher re-export, the `feature.resendKickoff` tRPC procedure, and (as the "Send
briefing" button plus its mutation) `apps/web/src/components/SessionPanel.tsx`; the hook
receiver no longer calls `noteKickoffPrompt`, so both `UserPromptSubmit` handlers lost
their now-unused `payload`/`sessionId` parameters.

`promptMatchesKickoff` and its `MATCH_PREFIX` moved into `services/conversations.ts`, its
one live caller — an argv-delivered kickoff is still recorded as a `user` turn, so
transcripts and derived titles still strip it. Its unit tests stayed in
`packages/server/test/kickoff.test.ts` (which is now only the kickoff-line registry plus
the matcher) and import it from its new home; the transcript-stripping tests in
`project-conversations.test.ts` were untouched and still pass.

On the web, `kickoffTrouble`/`KickoffTrouble` had two arms and only one survives, so they
became `sessionNotReady(events, sessionId): boolean` over `session.not_ready`, cleared by
`session.ended`. The banner it feeds stays — renamed `NotReadyBanner` — saying what is
wrong without offering a re-send.

## Deviations and surprises

- **`packages/core` needed no change.** The ticket said to remove
  `session.kickoff_undelivered` from the core event-type schema, but core has no event-type
  enumeration at all — `type` is a plain string on the event row. Repo-wide grep for
  `kickoff_undelivered` and `resendKickoff` is now clean across `packages/` and `apps/`.
- **Three messages referenced the deleted button** and were reworded rather than left
  dangling: the `session.not_ready` event text ("…then send the briefing"), the
  `CheckInHint` doc comment, and the long Codex-adapter note that named `scheduleKickoff`
  by hand. `apps/web/test/pinned-body.test.tsx` also asserted a frozen view shows no "Send
  briefing" — a vacuous assertion now, so that entry left the list.
- **Two server tests asserted on delivery state** and were rewritten at the argv seam
  instead of deleted: "does not send a kickoff to a resumed preparation"
  (`prepare-session.test.ts`) and the resumed-terminal kickoff test
  (`session-lifecycle.test.ts`) now read the launch command and the `session.kickoff`
  events. The second needed scoping to the resumed session — the *first* launch in that
  test is fresh and does emit a kickoff.
- **`setKickoffOverride` is now a write-only map.** Ticket 1 passes the resolved line
  straight into the argv builder rather than reading the override back, so nothing consumes
  `pendingKickoffOverrides` any more. Acceptance criterion 1 explicitly keeps the map and
  `forgetKickoff`, so it stays — but it is dead weight and worth a look.
- **Verification:** `bun run typecheck` clean. `env -u GIT_ASKPASS bun run test` —
  3665 passed, 10 failed, all 10 in `sandcastle-exec-failure.test.ts` (9, the
  `@ai-hero/sandcastle` patch is not applied in this sandbox) and `dev-pane.test.ts` (1,
  process-tree kill timing). Neither file imports anything this diff touches, and ticket 1
  reported the same environment failures. The stated baseline in the prompt (118 files /
  1768 tests) does not match this repo either way — the suite is 252 files / 3679 tests.
- **Drive machinery:** unchanged and unchecked-by-running, correctly — this ticket adds no
  service, no boot env var, no seed and no companion process, so none of the `.runcastle/`
  hooks have anything new to do.

## Left undone

- **The docs still describe the deleted machinery.** `docs/SPEC.md` §4 lists
  `feature.resendKickoff` in the tRPC map, `docs/UI-SPEC.md` §72 describes the whole
  type-and-confirm loop plus the Send-briefing bar, and ADR-0009 (kickoff delivery) is
  still live. Ticket 1 touched no docs either, so I followed that precedent and stayed in
  code; someone has to supersede ADR-0009 and amend both specs for this feature.
- No render test was added for the surviving `NotReadyBanner` — it is module-private and
  exporting it just for a test seemed worse than the `sessionNotReady` unit tests that
  decide when it shows.

#### 5. Kickoff telemetry is emitted before spawn and even for no-process launches

# ticket(5) — kickoff telemetry is emitted at spawn, not before

## What was done

`session.kickoff` now only exists once a CLI process actually received the briefing.
`spawnEmbeddedPty` in `packages/server/src/launcher/launcher.ts` returns a boolean — `true` when
`ptyRegistry().create` produced a process, `false` on the caught spawn failure — and each of the
four fresh-launch paths (`launchSession`, `launchPrepareSession`, `launchDriveFixSession`,
`launchProjectSession`) moved its `session.kickoff` emit from just after `writeArtifacts` to just
after that call, gated on `spawned && kickoffLine`. The `spawn:false` smoke branch returns before
the spawn, so it now emits `session.launched` and nothing else. Messages, event data shape
(`{ sessionId, kind, line, mechanism: 'argv' }`) and emitters are unchanged; only the moment moved.

I kept the emit at the four call sites rather than centralising it inside `spawnEmbeddedPty`,
because centralising would have collapsed the four per-path message wordings ("opening preparation
session…", "opening drive-fix session…") into one derived from `session.kind` — a user-visible
wording change the ticket did not ask for.

New `packages/server/test/kickoff-telemetry.test.ts` pins all three cases at the events seam:
a spawned launch records exactly one kickoff carrying the argv line; a `spawn:false` launch records
none; a launch whose `ptyRegistry().create` throws records `session.spawn_failed` and no kickoff.
It uses the `stubSpawn` pattern already established in `docs-watch.test.ts` (stub
`claudeRuntime.checkReady`, spy on `ptyRegistry().create`).

**Repro re-run, as required.** Both halves of the reviewer's repro were re-run as the two negative
tests in that file, and both no longer reproduce: the `spawn:false` fresh launch's event list
contains `session.launched` and zero `session.kickoff`; the forced-`create`-throw launch emits
`session.spawn_failed` with zero `session.kickoff` before it (previously one).

## Surprises

- Three existing tests pinned the old behaviour *through* `spawn: false`, so they could not simply
  be kept: `lap-kickoff.test.ts` (kickoff event count + `mechanism: 'argv'`), `prepare-session.test.ts`
  (read the confirm-and-stop line off the kickoff event), `session-lifecycle.test.ts` (fresh-launch
  kickoff event, resumed one absent). Each was re-pointed at the argv seam the same launch already
  renders into `session.launched.data.command`, which is the observable that survives `spawn:false`
  and is arguably the truer seam for "what line did this session open with".
- The verify baseline in the burn prompt is stale: it claims 118 files / 1768 tests fully green,
  but this branch's suite is 253 files / 3684 tests. Two files fail here and neither touches my diff:
  `sandcastle-exec-failure.test.ts` (9 failures — `formatExecFailureMessage`/`maxOutputTailChars`
  come back undefined, i.e. the `@ai-hero/sandcastle` patch from ADR-0011 is not applied in this
  sandbox's `node_modules`, exactly the failure mode that file's own docblock warns about) and
  `dev-pane.test.ts` "kills the child process tree" (1 failure, process-tree/environment). Both are
  environment faults, not regressions from this change. `bun run typecheck` is 0 errors.
- Drive machinery: this change adds no service, env var, seed, or long-running process, so
  `.runcastle/drive-setup.ts` / `drive-stop.ts` needed no edit. I checked that both files still exist
  and that nothing in my diff reads a new env var; I did not run them (no services in this sandbox).

## Left undone

- Contract drift flagged by the lap review is still open and is not this ticket's: `docs/UI-SPEC.md`
  §72 and `docs/adr/0009-kickoff-delivery.md` still describe the typed-and-confirmed kickoff, the
  retry loop, `session.kickoff_undelivered`, and the **Send briefing** button, all of which the
  branch has deleted.
- `setKickoffOverride(session.id, kickoffLine)` is still called on all four fresh paths and, as the
  review noted, nothing consumes the map any more — write-only lifecycle state. Untouched here.

#### 6. The required Windows argv-encoding regression test stops before the real encoding boundary

# ticket(6) — the Windows argv-encoding test now reaches the real boundary

## What was done

The two kickoff regression tests in `packages/server/test/launch-artifacts.test.ts`
(`puts a fresh kickoff last verbatim…` and `keeps the trust flag…`) previously
stopped at the JavaScript arrays `buildClaudeArgs` / `buildCodexArgs` return, so a
kickoff line containing double quotes and an apostrophe was never actually pushed
through the encoding the requirement names. Both tests now round-trip their argv:
`spawnTargetFor` picks the spawn target, node-pty's own `argsToCommandLine` (deep
imported from `node-pty/lib/windowsPtyAgent.js` via `createRequire`, the same way
`src/pty/pty.ts` loads the addon) flattens it to the single Win32 command-line
string ConPTY hands `CreateProcessW`, and a `commandLineToArgv` helper written to
the documented `CommandLineToArgvW` rules splits it back. Each test asserts the
full decoded argv for a native `.exe` and that the kickoff line is still the final
argument through the npm `.cmd` shim — the only branch of `spawnTargetFor` that
does anything. I verified the assertions bite by temporarily mutating one expected
value and watching it go red, then reverted. One commit, `ticket(6)`.

## Re-running the reviewer's repro step

Ran it after the fix: `vitest run packages/server/test/launch-artifacts.test.ts -t
"puts a fresh kickoff last verbatim"` and `… -t "keeps the trust flag"` — both pass
(1 passed, 63 skipped each), and inspecting them now shows assertions that go
through `spawnTargetFor` and node-pty's encoder rather than ending at the argv
arrays. The repro no longer reproduces.

## Surprises

- `node-pty` exports `argsToCommandLine` only from `lib/windowsPtyAgent.js` (no
  `exports` map, no `.d.ts` beside it), so the test deep-imports it. It loads and
  runs fine on Linux — nothing native is required until a PTY is actually spawned.
  Note for a future node-pty 1.2 bump: this import is one more thing to re-point.
- `packages/server/tsconfig.json` has `include: ["src"]`, so the test directory is
  not covered by `bun run typecheck`. The cast on the required module is still
  written to a precise function type rather than `any`.
- node-pty's encoder has a genuine hole: an argument that both starts and ends
  with a double quote *and* contains a space is emitted unquoted with its spaces
  bare, so it would split into several arguments. Runcastle's kickoff lines never
  have that shape, so I did not pin it (a test would have been red, and fixing a
  vendored encoder is not this ticket).

## Left undone

- The `.cmd` shim assertion checks node-pty's encoding only. `cmd.exe /c` applies
  its *own* parsing on top (`%`, `&`, `^` are live there), which no test covers;
  today's kickoff lines contain none of those characters.
- Full verify: `bun run typecheck` is clean. `env -u GIT_ASKPASS bun run test` ran
  252 files / 3681 tests with 2 failures, neither touched by this diff (which edits
  exactly one test file): `apps/web/test/settings-dialog.test.tsx > reaches every
  page from every other` passes in isolation and fails only under full-suite load,
  and `packages/server/test/dev-pane.test.ts > kills the child process tree…` fails
  in isolation too — it asserts a process group is reaped, which this container
  does not do. The baseline in the prompt (118 files / 1768 tests) no longer
  matches this branch's suite size, so I could not match failures against it by
  count.
- No drive-machinery change was needed: this ticket adds no service, env var, seed,
  or process. I did not run `.runcastle/drive-setup.ts` or `drive-stop.ts` (the
  sandbox has no app or services); nothing in the diff touches them.

#### 9. Verify the fixes that landed

Gates verification pass

No verify commands are configured, so there were no gates to run; the pass was spent on the four landed fix diffs as required.

## Fixes verified

- **#5 held.** All four fresh-launch paths now emit `session.kickoff` only after `spawnEmbeddedPty` returns `true`. The `spawn: false` path returns before that emission, and a caught PTY creation failure returns `false`; the added event-seam tests pin both negative cases and the one successful-spawn case.
- **#6 held.** The Claude and Codex quote/apostrophe regressions no longer stop at their JavaScript argv arrays. They route native `.exe` and npm `.cmd` targets through `spawnTargetFor`, node-pty's `argsToCommandLine`, and an independent `CommandLineToArgvW`-rules decoder before asserting the kickoff survives as the final argument.
- **#7 held.** The specified live contracts (`docs/SPEC.md`, `docs/UI-SPEC.md`, and ADR-0009) now describe native argv delivery and contain none of the retired `kickoff_undelivered`, `resendKickoff`, `Send briefing`, or `noteKickoffPrompt` vocabulary.
- **#8 held.** `pendingKickoffOverrides`, `setKickoffOverride`, `forgetKickoff`, and all launcher call sites are absent. Fresh kickoff lines continue to flow directly into `writeArtifacts`.

## Finding

- **Low — canonical feature contract still requires the override map deleted by #8** (`finding_Y3dGnKNlWVFS`). The feature's own `decisions.md` decision 4 and `spec.md` fresh-launch paragraph still say the pre-spawn override map survives and is consumed at argv construction, while the landed fix deletes it completely. The direct `launchSession` `kickoffLine` seam works, but those canonical feature documents need reconciliation.

No unrelated defects were investigated, and Gates mode did not start a drive or recorder.
