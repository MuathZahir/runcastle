# Outcome — You always know what's waiting

Coming back to runcastle, you can tell at a glance which feature needs you and for what, the button to do it is right there, and you get pinged when you're needed.

- Shipped: 2026-11-02

## What shipped

23 commits · 83 files

- 4 tickets landed: #1 Needs: work out what each feature needs, once, on the server; #2 Header, sidebar and palette: name the need and put its button there; #3 Pings: desktop and phone whenever you're needed, a counted tab title, and an interrupted round wakes the lead; #4 Chat: no question folds away, the chat says what it waits for, and the skills ask clearly
- 0 waived
- 0 failed

## Review record

### Ticket 5 · review

- Reviewed commit: 0bc11910d33ab4da7fce7f0d203de19e9dcf89ba
- Landed since: 0
- Outcome: done

- **Test gate is red on 0bc1191: 3 failures in the move round-trip and terminal tree-kill tests, outside the declared all-green baseline** — dismissed
- **Status line rebuilds its label and reason by splitting the server's words at " · " instead of reading the need's own fields** — open
- **Desktop-ping feed reads every needs_you event ever on each enable/page load; the query has no test** — open
- **During a round or self-plan, a permission prompt reads "Needs permission" in the sidebar but "Working"/"Planning by itself" in the header, and no Show request button exists anywhere on the page** — fixed
- **A question asked in a side thread makes the feature read "Needs your answer", but Reply brings forward the main chat, where there is no question** — fixed
- **Every ordinary chat reply from an unheld lead pushes to the phone, even while the human is at the desk chatting** — fixed
- **"Interrupted a second time" is detected as "the previous round number was also interrupted", not as a rerun of the same round** — open
- **No drive this pass: the on-screen criteria (header buttons, sidebar words, chat fold, waiting line, palette, shortcut, pings, tab title) are verified only by reading code and its tests** — open

## Notes record

- No human notes

## Per-ticket digests

### 1. Needs: work out what each feature needs, once, on the server

# Ticket 1 — Needs, worked out once on the server

## What was done
- **Core** `packages/core/src/feature-need.ts`: `featureNeed(facts, now)`, `NeedFacts`, `FeatureNeed`, `NeedKind`, `WaitingKind` (a zod enum), `HELD_NEED_GRACE_MS`, and the shared strings `STOPPED`, `PLANNING_STOPPED`, `PROVIDER_LIMIT`, `READY_TO_TEST`, `YOU_STOPPED_IT` and `wakeFailedWhy`, which moved here. The web's `status-line.ts` and `sidebar.ts` now re-export them, and the server's `lifecycle.ts` and `runner.ts` import them. The order is permission > conflict > answer > plan > design > stopped > test > merge. While the agent works, only an open ask or a standing conflict counts. A lead that replied after declaring ready reads as Ready, not as an answer, the same way the status line already does.
- **Storage**: a `waiting_kind` column (migration 0057). `setWaiting(ctx, id, why, kind?)` stores the kind, or `answer` when none is given, and clears it with the reason. Dispatch, Stop and `declareReady` clear it too. `feature.waiting` data now carries `kind`. A halted round and a self-plan that stopped short now set kind `stuck`.
- **MCP**: `wait_for_you` takes an optional `kind`, with when-to-use text in its description. Its result and `get_feature_context`'s header both carry `waitingKind`.
- **Facts** `packages/server/src/services/feature-need.ts`: `needFacts` / `needOf`. The list reads every need event for the whole project in one query (`needEventsByProject`). `leadState` gained `working` and `since`. The new `openAskOf` in `threads/read.ts` reads open approval/question asks from the chat and side thread logs, but only for threads whose process runs. "Drive set up" means `project.devCommand` is set.
- **Wire**: `need: FeatureNeed | null` on `FeatureListItem` and `FeatureFull`.
- **Event** `services/need-watch.ts`: `startNeedWatch` runs at boot in `index.ts`. It listens for `event` signals and for `turn` signals (an ask opening or closing already pushes a `turn` signal through `logAwaits`, so the host needed no new event). Changes settle for 50 ms before it reads the need. It emits `feature.needs_you {kind, words, held, why}` when a feature enters a need, and again when a held need becomes unheld. A sweep re-reads held needs once a minute. Its starting state is filled in at boot without emitting.
- **Tests**: core `feature-need.test.ts` (each need, the order, the held hour, test vs merge). Server `feature-need.test.ts` (`need` through the tRPC `feature.list`/`feature.get` calls, including a permission need from a side thread). `need-watch.test.ts` (one ping on entering a need, none for re-reads or boot, one more at the held hour). `lead-mcp-tools.test.ts` covers the `kind`. `read-tool-ceiling.test.ts`'s list of header keys gained `waitingKind`.

## Surprises
- After `declare_ready`, the lead's turn ends, so `leadAwaitsHuman` is always true. If an "answer" won there, a feature would never read as Ready. So `leadAwaitsHuman` with no stored reason counts as an answer only when there is no fresh declaration.
- `unresolvedMergeConflict` now accepts `Pick<EventRow,'type'|'ts'|'data'>[]` so it can be reused here. It already treats `burn.started` as clearing a conflict.

## Left undone
- The web still works out its status line and sidebar words itself. Switching them to `need` is for later tickets. Skill text (telling the lead which kind to use) and the pings are not done either.
- A held need's `since` comes from the newest `feature.waiting`/`feature.stopped`/`feature.ready_declared` event. Calling `setWaiting` again with the same reason restarts the hour.
- Drive machinery: this ticket only adds a migration (applied at boot), so nothing under `.runcastle/` needed changing. I checked this by reading the ticket's triggers; I ran no drive script.

### 2. Header, sidebar and palette: name the need and put its button there

# Ticket 2 — the header, sidebar and palette name the need and put its button there

## What was done
- **Status line** (`lib/feature-ui/status-line.ts`): `featureStatus` now takes the server's `need`. It no longer takes `declarations`, `leadAwaitsHuman` or `waitingReason`, because the need covers all three. A need's words are split at the first " · " into the label and `why`, so "With the orchestrator · Plan to approve" reads label "With the orchestrator", why "Plan to approve". The test and merge needs read as kind `ready`; every other need reads as `waiting`. A held need gets `held: true`, and the dot (desktop and phone) is quiet for it. A running round, a self-planning run, or Merged still win over a need. While the main chat is mid-turn, only a permission prompt or a conflict shows. Working and Talking keep their old evidence logic.
- **Header**: `headerActions` returns `{ action, merge, overflow }`. The primary is Stop / Stop drive / Stop self-plan when something runs, otherwise the need's button. Merge & ship is always present, as a quiet button, and appears only once when it is the primary. When the feature is ready to merge, Start test drive moves into "⋯". `HeaderAction` gained a `quiet` prop. A New thread "+" `IconButton` (with its kbd hint) sits before "⋯" on active features.
- **Dispatcher**: the new kinds `reply`, `openPlan`, `openDesign`, `showRequest` and `newThread` are in `ACTION_KINDS`, `ACTION_ICON` and `runAction`. Reply and Show request bring the thread to the front, and close a panel or drive that covers the whole chat. Reply also focuses `textarea[aria-label="Message"]`.
- **Shortcut**: Ctrl+Shift+O / ⌘⇧O is a capture-phase window listener in `Workspace`, so it also works while typing in the composer. `shiftShortcut()` was added to `lib/platform.ts`.
- **Palette**: the new `lib/feature-commands.tsx` provides a provider plus a publish/read context, mounted in `ProjectShell`. `Workspace` publishes its primary, New thread, Merge & ship and Start test drive. The palette lists them first, under the feature's title. A disabled entry shows its reason and does nothing.
- **Sidebar**: `needsMe` reads `f.need`; a held need returns null. `triageOf` checks needs *before* `activeRun`, so a permission prompt during a round lands in Needs you. Held needs go to Agent working. `featureStateWords` shows the need's words; a held one shows its "With the orchestrator · …" words, without the shimmer. The portfolio count follows the same rule through `needsMe`.
- **Tests**: I rewrote `status-line.test.ts` for the new inputs. I added tier-2 cases in `feature-page.test.ts`: the need button plus Merge, Open plan opening the plan view, Merge shown once, the "+" button and Ctrl+Shift+O from a textarea firing `thread.new`, nothing on a shipped feature, and the published palette commands. Other new tests:
  - `command-palette.test.tsx`: the feature group comes first, and a disabled entry is inert.
  - `sidebar-inbox.test.tsx`: a held need sits on the Working shelf, and a permission prompt shows under Needs you.
  - `sidebar-lanes`, `sidebar-row`, `feature-ui`, `projects` and `portfolio-home`: I moved these from `waitingReason` to `need`.
  - `test/fixtures.ts` gained `need()`.

## Surprises / deviations
- Whether to show the need while driving was ambiguous. I kept the need's words on the status line during a drive (with Stop drive as the button), rather than falling back to "Talking with you".
- The palette's Start test drive is never refused by the resolver. Its disabled reasons are my own: "Nothing declared ready yet", and "This feature is on its drive already" while driving.
- When the feature is ready to merge, Start test drive is always put in "⋯". That includes the "no drive configured" case, which the client cannot tell apart.

## Left undone
- `FeatureListItem.waitingReason` / `leadAwaitsHuman` are still on the wire and read elsewhere: `FeatureChat` reads `READY_TO_TEST`. I removed nothing from the server.
- The chat's waiting line, pings and tab title belong to other tickets.
- Drive machinery: this ticket is web-only, with no new service, env var, seed or process, so nothing under `.runcastle/` changed. I checked that by reading the triggers; I ran no drive script.

### 3. Pings: desktop and phone whenever you're needed, a counted tab title, and an interrupted round wakes the lead

# Ticket 3 — Pings, the tab title, and an interrupted round wakes the lead

## What was done
- **Core**: `needPings(data)` in `feature-need.ts`. It returns true for a need that is not held, except a stop whose why is "you stopped it". Malformed data returns false. It is a type guard to `NeedsYouData`. `FEATURE_NEEDS_YOU` moved into core, and `need-watch.ts` re-exports it. Test: core `feature-need.test.ts` › `needPings`.
- **Phone**: the new `services/need-push.ts` holds `pushNeed`, `startNeedPush` (started at boot after the need watch) and `needPushBody` (one sentence per need). It calls `sendPushToAll` with title = feature title and url = `/p/<project>/f/<slug>/chat`. When a phone receives it, it emits one `notification.sent` event. With no phones it does nothing. I rewrote the doc comments in `push.ts` and `notify-tool.ts`. Test: `need-push.test.ts` covers a pinged need, the wording, held and you-stopped-it (no push), no phone, and the bus listener.
- **Desktop**: `eventToNotification` now maps only pinging `feature.needs_you` events to `{ title: words, body: feature title }`. The `run.finished` mapping is gone. A new tRPC `events.needsYou({ afterId })` (`needsYouAfter` in services/events.ts) returns every project's needs_you events together with their feature. `use-notifications.ts` is now a `NotificationsProvider` mounted in `Shell.tsx`. The sidebar's toggle reads it through `useDesktopNotifications()`, so pings keep coming across project switches and on the portfolio. Clicking a ping focuses the window and calls the new `goToPath(path)` in `use-history-sync.ts`, which does pushState plus a synthetic popstate, so the existing nav listeners open the feature. `NOTIFY_OFFER` now reads "Notify me when a feature needs me".
- **Tab title**: `tabTitle(lists)` in `projects.ts` counts with `featureNeedsYou`, which is ticket 2's `needsMe`. `useNeedsYouTitle` in the Shell sets `document.title`. Tests are in `notifications.test.ts`.
- **Interrupted round**: `reconcileStaleRuns` itself is unchanged. The new `wakeInterruptedRounds(ctx, runs)` + `composeInterruptedWake` in `reconcile-runs.ts` deliver the lead message. If the previous round, by `listRounds` number N-1, was also reconciled, the message says "second time … wait_for_you with kind stuck" instead. The function also calls `notifyOrchestrator` (now exported) for the `run.reconciled` event. `orchestratorLineFor` has a `run.reconciled` END line, for ticket-burner only, and the table entry. Tests: `reconcile-runs.test.ts` › `wakeInterruptedRounds` (fake ACP host), and `orchestrator-notify.test.ts`.
- **Skill**: the project SKILL.md news list gained the interrupted-round line and the held-need-hour sentence.

## Surprises / deviations
- I split the wake out of `reconcileStaleRuns` on purpose. Boot reconciles before the server listens and before the orchestrator notifier subscribes. A lead woken there would start an agent that cannot reach `/mcp` yet, and the holder would never hear the boot-time `run.reconciled`. So `index.ts` calls `void wakeInterruptedRounds(ctx, staleRuns)` after the notifier and the push are up. Each run is wrapped in try/catch.
- "The same round interrupted twice" is read as "the round right before this one was also cut off", because every rerun is a new run with a new round number.
- `doctor-failure.test.tsx` mocks trpc by hand, so I added `events.needsYou` to that mock.

## Left undone
- `apps/web/test/sidebar-foot.test.ts` still passes the old offer sentence as a fixture prop. It is only an input, not an assertion.
- The `/p/…/chat` path helper is duplicated between `notify-tool.ts` and `need-push.ts`.
- Drive machinery: no new service, env var, seed or process. Nothing under `.runcastle/` needed changing, and I ran no drive script.

### 4. Chat: no question folds away, the chat says what it waits for, and the skills ask clearly

# Ticket 4: no question folds away, the chat says what it waits for, and the skills ask clearly

## What was done
- **Fold rule** (`packages/core/src/thread.ts`, `foldThread`'s `render`):
  - A turn's answer is now every non-blank text segment after the turn's last segment that is neither text nor a run of talk-only calls. A run of talk-only calls means `TALK_ONLY_TOOLS`: `wait_for_you`, `declare_ready`, `notify_human` and `show_file`. They are matched only after a `__` or `.` prefix, so `mcp__runcastle__x` and `runcastle.x` both match. A bare `show_file` title, as the old tests use, does not.
  - The answer's segments are joined with a blank line into one `agent` item, keyed by the first segment's id. Talk-only calls inside the answer show nothing.
  - Text segments in the work that match `ENDS_ASKING` leave the fold. They become one `agent` item with id `asked:<turnId>`, joined in the order written, placed after the work and before the answer.
  - The slot bookkeeping became `place()` plus `shiftSlots()` over work, asked, answer and shown, with `askedIndex` reset everywhere the others are.
  - An `answered` segment (a shown file or an answered ask) still ends the answer.
  - A mixed run of tool calls, such as Bash followed at once by wait_for_you, counts as real work.
- **Waiting line**:
  - `FeatureChat` takes `needAction`, `actionsBusy` and `onAction` from `Workspace`.
  - `Workspace` passes `needButton(full.need, headerRow)`, a new helper in `status-line.ts`. It returns the header's primary only when that is the need's own button, so never Stop, and nothing for an answer.
  - The line renders through a new `tail` slot on `ChatThread`/`ThreadColumn`, under the last item, and only on the main thread when the need is not held. It holds a warning `StatusDot`, the need's words and a `HeaderAction`.
- **Skills**:
  - `SKILL.md` gained two bullets: which wait kind to use, and putting the question last without ever pointing at unseen words. The phone bullet was rewritten, and the runaway guard now passes `kind: "stuck"`.
  - `rounds.md`, `design.md` and `planning-alone.md` pass the right kind and end on the question.
  - `packages/server/test/feature-skill.test.ts` was updated to the new quoted calls.
- **Tests**:
  - 6 new `foldThread` cases in `packages/core/test/thread.test.ts`: text → wait_for_you → text; a Codex spelling; a mid-turn question followed by Bash and "Done."; plain narration still folding; a live turn keeping work above a question; show_file keeping its place.
  - New tier-2 `apps/web/test/feature-chat-waiting-line.test.tsx`: the button fires the dispatcher and the line goes when the need clears; an answer has no button; a held need shows no line; a side thread shows no line.

## Surprises
- The test fake must serve `thread.events`, not `thread.view`: the web folds the log itself.
- The server's `wait_for_you` already accepted `kind` (an earlier ticket), so no server change was needed.

## Left undone
- The waiting line shows whenever `full.need` is set and not held, even if the main chat is mid-turn. The status line instead hides non-urgent needs while the agent works. Hiding the line mid-turn may be worth doing if it reads oddly in the drive.
- During a test drive the header's primary is Stop drive, so a "Ready to test" line shows no button.
- Drive machinery: nothing new is needed (no service, env var, seed or process). This was checked by reading the triggers only; no drive script was run.
