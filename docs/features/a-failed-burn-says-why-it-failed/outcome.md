# Outcome — A failed burn says why it failed

When a burn run fails, the feature page's next-step bar says only 'Resume the burn. The run failed — resume the burn to retry.' (apps/web/src/lib/feature-ui/next-step/building.ts ~line 130, the `why` for run.status === 'failed'), even when the run recorded an exact reason and a retry can't succeed. Seen 2026-09-25 on 'Planning shows the tickets it already has': three runs failed in 6–10s, before any ticket started, each with the summary 'sandcastle:runcastle has Claude Code 2.1.280, the host has 2.1.282 — Rebuild from Settings → Burns (only the CLI layer rebuilds).' The human never saw it (it isn't in the bar, the run header ('Failed · 9s · 0 of 2 landed') or the ticket rows, which stay 'Pending') and clicked Resume burn three times. Expected: when the failed run has a summary, the next-step bar's description shows it verbatim in place of the generic line. When the run failed before any ticket started (a setup or preflight failure: zero tickets attempted), don't offer 'Resume burn' as the primary action as if a retry would help. Make the fix the primary action where the reason names one (for the sandbox-CLI mismatch, a button that opens Settings → Burns, or triggers the CLI-layer rebuild directly if an existing mutation does that), and keep Resume burn as a secondary action for after the fix. A run that failed partway through tickets keeps today's Resume flow, plus the summary. Also show the summary on the Run section's header next to 'Failed'. Don't change the version check itself (shipped in sandbox-agent-clis-track-the-host-version). The flow map row this amends is docs/features/flow-redesign-build-review-and-ship/flow-map.md line 83. Leave that doc alone, but make the new copy fit its vocabulary. Add next-step tests for: a failed preflight with a summary; a failed run partway through tickets; a failed run with no summary (keeps today's copy).

- Shipped: 2026-09-26
- Laps run: 1

## What shipped

6 commits · 10 files

### Lap 1
- 3 tickets landed: #1 When a burn run fails, the feature page's next-step bar says only…; #3 Run header's failure summary is a single truncated MetaLine fact, so the "Settings → Burns" fix at its end is ellipsized away, with no tooltip; #4 The runner's placeholder summary 'run failed' now replaces the generic line and, before any ticket starts, heads a bar with no primary action
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 25808e61b594359153783244c05058f443886e6f
- Landed since: 2
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 76a10ef99de6e2f1aa3a6e19d4476e8190a55693
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. When a burn run fails, the feature page's next-step bar says only…

# Digest — ticket 1: a failed burn says why it failed

## What was done
- `next-step/building.ts`: a failed run with a `summary` shows it verbatim as the bar's desc. If no ticket was taken up by that run (none burning, none completed at/after `run.startedAt`), the bar reads "NEXT STEP / The burn could not start". Its primary is "Open Settings → Burns" (new action kind `openBurnSettings`) when the summary points at Settings → Burns (via the existing `settingsLocationFromMessage`), and there is no primary when the summary names no fix. Resume burn moves to the first secondary. A run that failed partway through keeps "Resume the burn" with the summary in place of the generic line. A failed run with no summary keeps today's copy.
- `Workspace.tsx` handles `openBurnSettings` by opening settings at the location the summary names (burns page, sandcastle-image row, where the CLI-layer rebuild lives). This uses a new `useOpenSettings()` hook exported from `MessageWithSettingsLink.tsx`. I opened settings instead of calling the rebuild mutation directly, which was the smaller option the brief allowed.
- `RunHeader` shows the summary next to the Failed chip (only when status is failed), rendered via `MessageWithSettingsLink` so the "Settings → Burns" phrase is a link.
- Tests: four new next-step cases in `feature-ui.test.ts` (preflight with a fix, preflight with no fix, partway failure, no summary) and one RunHeader case in `run-lanes.test.ts`.

## Surprises
- A previous iteration had already committed all the work. This iteration only verified it.
- The prompt's baseline numbers are out of date: the suite now runs 289 files and 4174 tests. The full run had 2 failures, both outside this diff. `apps/web/test/settings-dialog.test.tsx` "reaches every page…" timed out under full-suite load and passes on its own. `packages/server/test/dev-pane.test.ts` "kills the child process tree…" fails even when run alone. This diff touches no server code, so that failure comes from the sandbox's process handling.

## Left undone
- The flow-map doc (line 83) was left untouched as instructed. It doesn't yet list the "The burn could not start" row.
- Ticket rows still say "Pending" after a preflight failure. The brief didn't ask for that to change.
- No drive-machinery changes were needed (web-only UI change, no new service, env var or seed).

#### 3. Run header's failure summary is a single truncated MetaLine fact, so the "Settings → Burns" fix at its end is ellipsized away, with no tooltip

## What was done
The failed run's summary on the Run header (RunHeader.tsx) is no longer a MetaLine item. Before, it was a `min-w-0 truncate` span, so the "Settings → Burns" link at the end of the CLI-mismatch sentence got cut off with an ellipsis. It now renders as its own `<p className="m-0 text-sm text-pretty text-text-secondary">` under the chip/MetaLine row, still through MessageWithSettingsLink, so the link survives. This follows DESIGN.md §5: a sentence is prose, not a fact. The component docstring and the `summary` prop doc were updated to match. A new test in apps/web/test/run-lanes.test.ts checks that the full motivating summary is the whole text of a `<p>` whose class has no `truncate`. It fails against the old code.

## Repro re-run
I re-read list.tsx:503-508 next to the new RunHeader. The summary no longer goes through MetaLine's truncating span, and the `<p>` wraps, so the whole sentence and its Settings → Burns link are visible at any pane width. I couldn't run the app in the sandbox. The markup-level test above stands in for the visual check.

## Surprises
- Full suite: typecheck is green; the test run had 2 failures, both outside this diff (this diff only touches apps/web).
  - apps/web/test/settings-dialog.test.tsx timed out at 5s under full-suite load and passes on its own (18/18).
  - packages/server/test/dev-pane.test.ts ("kills the child process tree…") also fails when run alone. It is a server process-kill test that this web-only change doesn't reach. It looks like a sandbox environment issue.
- The suite has grown past the baseline figure: 289 files and about 4175 tests, not 118 files.

## Left undone
Nothing adjacent. Drive machinery doesn't need changes: no new service, env var, seed or process.

#### 4. The runner's placeholder summary 'run failed' now replaces the generic line and, before any ticket starts, heads a bar with no primary action

## What was done
In `apps/web/src/lib/feature-ui/next-step/building.ts`, the runner's placeholder summaries (`'run failed'`, and `'run cancelled'` to match) now count as "no reason recorded". A new private helper, `isRunnerPlaceholder`, does this. With a placeholder summary, a failed run keeps today's bar: title "Resume the burn", the line "The run failed — resume the burn to retry.", and Resume burn as the primary action. This holds even when no ticket had started. The reviewer's repro step is now a test in the 'after a failed run' block of `apps/web/test/feature-ui.test.ts`. I ran it before the fix and it failed (title was 'The burn could not start'). After the fix it passes, along with the rest of that file (318 passed).

## Surprises
- `packages/server/test/dev-pane.test.ts` fails in this sandbox ("kills the child process tree", `pidAlive(-pgid)` stays true). It also fails when run alone, and this change touches no server code, so it looks like a sandbox limit on reaping process groups. It is not in the baseline. Everything else is green: typecheck has 0 errors, and the full suite is 4139 passed with only that 1 failure.
- The placeholder strings are copied as literals from `packages/server/src/workflows/runner.ts`. There is no shared constant in core, so if runner.ts changes its wording, this check stops working without any error.

## Left undone
- The Run header (`RunHeader.tsx`, from ticket 1) still shows a placeholder summary next to Failed ("Failed · run failed"). It repeats the chip but isn't wrong, and it's outside this ticket.
- A shared placeholder constant in `@runcastle/core`, which runner.ts would also use, would remove the copied literals. I didn't add it because it would change server code.
- Drive machinery: this change adds no service, env var, seed or process, so no edit was needed.

#### 5. Verify the fixes that landed

Gates verification pass — verifies pass #2 on `feature/a-failed-burn-says-why-it-failed`

No verify commands are configured for this project, so no gates ran. The whole mode went on reading the fix diffs against their findings (`git diff main...feature/a-failed-burn-says-why-it-failed`, commits b6120d74 and 2a31c89d).

## Fixes

- **#3 Run header's failure summary was truncated. HELD.** `RunHeader.tsx` drops the summary from the `MetaLine` items. It now renders as its own `<p className="m-0 text-sm text-pretty text-text-secondary">` under the chip/MetaLine row, still wrapped in `MessageWithSettingsLink`. That `<p>` sits outside MetaLine's `min-w-0 truncate` span and has no truncation, and it is a direct child of the `flex-col` header, so it wraps at any width. The whole CLI-mismatch sentence stays visible, including its "Settings → Burns" link. The new test in `run-lanes.test.ts` checks that the full summary is the entire text of a non-truncating `<p>`. The finding asked for the whole summary to be visible, and it is.
- **#4 The placeholder 'run failed' headed a bar with no primary action. HELD.** In `building.ts`, `failure` now excludes `isRunnerPlaceholder(run.summary)`, which matches `'run failed'` and `'run cancelled'` exactly. A failed run with the placeholder summary therefore skips the "could not start" branch. It gets title "Resume the burn", the desc "The run failed — resume the burn to retry. …" and primary `{ label: 'Resume burn', kind: 'burn' }`, which is exactly what the repro asked for. The repro step was added as a test in the 'after a failed run' block. The literals match `packages/server/src/workflows/runner.ts:243/258/261`.

## Residual notes (not defects)

- The placeholder literals are copied from runner.ts, and no shared constant ties them together. If the runner's wording changes, the check silently stops matching. The ticket 4 digest already records this.
- The Run header still renders "run failed" as the prose line under a Failed chip. It is redundant but not wrong, and ticket 4 already records it as left undone.

I did not re-run the test files: I can't check out the branch here, and no gates are configured. The verdict comes from reading the diffs, which directly satisfy each finding's pass condition.

Nothing plainly broken.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: both landed fixes (#3, #4) satisfy their findings' pass conditions on diff reading; no gates configured
