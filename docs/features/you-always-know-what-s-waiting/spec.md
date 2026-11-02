# You always know what's waiting

## Problem

Coming back to runcastle, the human cannot tell what a feature needs from them.

- The sidebar row and the status line say only "Waiting on you" (or the agent's free-text reason), so a plan yes, an answer, a drive and a merge all look alike, and a feature ready to merge reads "In progress".
- The agent's question is often invisible: it writes the question, calls `wait_for_you`, writes a closing line, and the chat folds the question into "Worked for 1m 50s", closed by default. The human sees "The feature is waiting on your answer to that question" with no question.
- The header has no button for the state they are in. Merge & ship is always behind "⋯" (nothing ever offers it), and New thread hides behind a hover-only "+" on a sidebar row.
- Nothing pings at the moments that matter. The one desktop ping is a round finishing, the one moment they are not needed. A permission prompt waits forever with no sign. A round cut off by a server restart is marked failed and nobody hears, so an unattended feature just stops: "I come back the next day thinking it is done, and it stalled."

## Approach

### What the human sees

**One need, named, with its button** (decisions 1, 17). A feature that waits on the human shows exactly one need from a fixed set, the most pressing first:

| Order | Need | Words | Button |
|---|---|---|---|
| 1 | permission | Needs permission · *call title* | Show request |
| 2 | conflict | Merge conflict | Resolve conflict |
| 3 | answer | Needs your answer · *reason* | Reply |
| 4 | plan | Plan to approve | Open plan |
| 5 | design | Design to approve | Open design |
| 6 | stopped | Stopped · *why* | Chat |
| 7 | test | Ready to test · *scenario* | Start test drive |
| 8 | merge | Ready to merge | Merge & ship |

The same words appear on the sidebar row, the status line, the palette's feature row, the chat's waiting line and the desktop ping. "Working", "Planning by itself" and "Talking with you" are unchanged. Every need files the feature under Needs you, except a held one (below).

- **answer** — the lead's `wait_for_you` with kind `answer` (the default), or the lead replied and the human has not answered (today's `leadAwaitsHuman`), or an open question ask (an elicitation) in the main chat. *Reason* is the waiting reason when there is one.
- **plan / design** — `wait_for_you` with kind `plan` / `design`. Open plan opens the panel's plan view; Open design opens the design view on the feature's recorded design server (decision 15). The sibling "Designs and the plan get their own place" later points Open design at its list.
- **stopped** — the human's Stop (`stopped`), the provider's limit, a self-planning run that stopped short, a failed lead wake, or the lead's `wait_for_you` with kind `stuck`. "Stopped · you stopped it" never pings (decision 11).
- **permission** — any of the feature's threads (main or side) has an open approval ask. Show request brings that thread to the front; its answer box is already in the chat's ask dock (decision 9).
- **conflict** — the newest `merge.conflict` is newer than the newest landing or resolution (decision 19).
- **test / merge** — the newest ready declaration is newer than the newest round and the agent is idle. It is **merge** once a human (not review) test drive of the feature has ended since that declaration and no human message reached the lead since the drive ended, or at once when the project has no test drive set up; otherwise **test** (decision 5).

**Held features** (decision 18). When an orchestrator thread holds the feature, the needs it can handle (answer, plan, stopped, conflict, test, merge) read "With the orchestrator · *words*". The feature sits in the working group, does not ping and is not counted. Permission and design still need the human and behave as on an unheld feature. The header keeps its button: holding never binds the human.

**The header** (decisions 6, 7). On a started, unshipped feature: the status line; the need's button as the primary (or today's primary — Stop, Stop drive — when something runs); Merge & ship always, quiet, unless it is already the primary; a New thread "+" icon button; then "⋯" and the panel toggle. A shipped feature keeps today's header.

**The chat** (decisions 3, 4).
- A turn's answer is every word after its last piece of real work. Calls that only talk to the human — `wait_for_you`, `declare_ready`, `notify_human`, `show_file` (any runtime's spelling of these runcastle MCP tools) — no longer end the answer, and the answer's text pieces render in order as one answer. Thoughts and real tool calls still fold.
- While the feature needs the human, the main chat ends with one waiting line under the last message: a warning dot, the need's words, and its button (none for an answer, whose message box is right below). It goes as soon as the need clears.

**The palette and shortcut** (decisions 7, 8). With a feature open, Ctrl+K (⌘K) lists first: the need's button (or the header primary), New thread, Merge & ship, Start test drive, each disabled with its reason exactly where the header would be. Ctrl+Shift+O (⌘⇧O) opens a new side thread on the open feature from anywhere on its page, including while typing in the message box. The palette's feature rows show the new words.

**Pings** (decisions 11, 12, 13).
- Desktop (when the human turned notifications on, tab hidden or unfocused): one ping each time a feature *enters* a need, across every project, titled with the need's words and the feature's name; clicking it opens the feature. No ping for a held feature's handled needs, for "you stopped it", or for rounds finishing or failing (that ping is removed).
- Phone: runcastle itself sends a push only for stalls no agent can report — a permission prompt opening, a lead wake failing — whether or not the feature is held. Every other phone ping stays an agent's `notify_human` call.
- The tab title reads "(N) runcastle" with N the features under Needs you across all projects (held handled ones excluded), and plain "runcastle" at zero.

**A round cut off by a restart** (decision 10). At boot, after marking the round failed, the server wakes the lead as a finished round does, with a message saying the round was interrupted, how many tickets landed and how many are pending, and that it may run the round again once. A round interrupted a second time tells the lead to wait for the human with kind `stuck` instead. The holder hears a news line for it.

**The skills** (decisions 2, 3, 12). The feature skill tells the lead: call `wait_for_you` with the right kind (`plan` before round 1 and any round the plan did not settle, `design` for designs, `stuck` for the runaway guard); write the question as the last thing in the turn; never point at words the human may not see ("that question", "my reply above"); call `notify_human` whenever it waits for the human after working unattended. The orchestrator's skill learns the interrupted-round news line.

### The shape of it

**One answer, worked out on the server** (decision 14). A pure function in core, `featureNeed(facts) → FeatureNeed | null`, holds the table above: precedence, words, the held rule. Its input is a plain facts record the server gathers:

```ts
// The decision-rich part of the contract; field names are the builder's call.
interface NeedFacts {
  status: FeatureStatus            // started / shipped / archived / draft
  waitingReason: string | null
  waitingKind: 'answer' | 'plan' | 'design' | 'stuck' | null
  leadAwaitsHuman: boolean
  agentWorking: boolean            // a round runs, or the lead is mid-turn
  openAsk: { kind: 'approval' | 'question'; title: string; threadId: string; main: boolean } | null
  conflictOpen: boolean
  latestDeclaration: { scenario: string; at: number } | null
  latestRoundStartedAt: number | null
  humanDriveEndedSinceDeclaration: boolean
  humanMessageSinceDrive: boolean
  driveConfigured: boolean
  wakeFailed: { exitCode: number | null } | null   // newer than the last round and wake
  held: boolean
}

interface FeatureNeed {
  kind: 'permission' | 'conflict' | 'answer' | 'plan' | 'design' | 'stopped' | 'test' | 'merge'
  words: string        // "Plan to approve", "Needs permission · Bash: git push"
  why?: string         // the reason / scenario / call title, for the words after "·"
  held: boolean        // "With the orchestrator · …"; never Needs you, never pings
  threadId?: string    // permission/answer asks: the thread to bring forward
  scenario?: string    // test: the drive to start
}
```

- **Storage.** The feature row gains the waiting kind beside `waitingReason` (one migration). It is set with the reason and cleared with it everywhere the reason is cleared. `wait_for_you` gains an optional `kind` input; a reason with no kind stores `answer`.
- **Wire.** `FeatureListItem` and `FeatureFull` carry `need: FeatureNeed | null`. The sidebar's `needsMe` / `triageOf` / `featureStateWords`, the portfolio's needs-you count and the status line (`featureStatus`) read it rather than working it out again. The status line keeps its own Working / Planning by itself / Talking with you logic for the moments no need applies.
- **Change event.** A watcher on the event bus recomputes a feature's need after any event that can change it, and emits `feature.needs_you` `{ kind, words, held }` when the feature enters a need it was not in (kind changed from none or another kind). Desktop pings, the phone's stall pings and the tab title's refresh all hang off this one event. The last-seen kind is kept in memory and re-derived at boot without emitting.
- **Header actions.** `headerActions` gains the need: its button is the primary when nothing runs, and Merge is always in the row. Action kinds added: `reply`, `openPlan`, `openDesign`, `showRequest`, `newThread`. `resolveConflict`, `testDriveStart`, `merge` and `chat` exist. The kinds list in `next-step/types.ts` is checked against the Workspace dispatcher by an existing test, so each new kind needs a case.
- **Chat.** The fold rule lives in core's `foldThread`; the talk-only tool list sits beside it. The waiting line is a new item the feature chat renders at the end of the main thread from `full.need`, not a thread-log item.

## Seams

- **`featureNeed(facts)`** (new, core) — every row of the table, the precedence, the held rule and the ready-to-test vs ready-to-merge split are unit-testable here with plain records.
- **The server's facts gathering, via `feature.list` / `feature.get`** (existing tRPC queries) — the `need` field on a seeded database: a waiting reason with each kind, an open approval in a side thread, a conflict event, a declaration followed by a drive.
- **`wait_for_you` MCP tool** (existing) — the `kind` input is stored and read back through `get_feature_context`.
- **`feature.needs_you` event** (new) — emitted once on entering a need, not on re-reads; observable in the event log.
- **`reconcileStaleRuns`** (existing) — an interrupted round queues a lead message and a holder news line; a second interruption of the same round says "stuck".
- **`foldThread(log)`** (existing, core) — a turn of text, `wait_for_you`, text keeps both texts as the answer; a turn of text then a real tool call still folds the text.
- **`featureStatus` / `headerActions`** (existing, web) — the label, primary and Merge placement per need.
- **`eventToNotification`** (existing, web) — `feature.needs_you` maps to a ping; `run.finished` no longer does.
- **Component tests (tier 2)** — the sidebar row words, the header row's buttons, the chat's waiting line, the palette's feature actions.

## Out of scope

- The designs list, design and plan cards in the chat, the design badge — the sibling "Designs and the plan get their own place", which plugs into the `design` need and its Open design button.
- Renaming vocabulary across the app (round/burn, chat/thread) — "Ready to publish".
- Drive and merge error messages, drive restart recovery, which session kinds run in bypass mode, usage-limit Resume — the small-fixes sibling.
- Checking ahead of time whether a feature would conflict with its base (decision 19). Worth a feature of its own if conflicts start surprising the human.
- A lead chat cut off mid-turn by a server restart (not a round). It reads "Talking with you" afterwards rather than a need. Not in the brief; worth checking during the drive whether it happens often enough to matter.
- Live design pages for these screens: they are drawn in the plan preview (decision 16).

## Open questions

- None that block building. Decisions 12 (automatic phone pings for stalls only) and 18 (held features wait on the orchestrator) are the ones most likely to change once the human reads them; both change only which needs ping and where held rows sit, not the shape above.
