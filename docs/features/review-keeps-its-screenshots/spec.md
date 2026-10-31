# Review keeps its screenshots

## Problem

The human wants to accept a finished feature from their phone by looking at it, and phones get no drives. A review pass walks the app in a browser, but all it leaves is a video and a digest. Nobody asks it for screenshots, nothing records which scenarios it ran, and the responses to the calls it tries with `try_call` are thrown away. So the human has to start a drive, watch a whole video, or take the digest's word for it, and the orchestrator has nothing to show.

## Approach

### What the human gets

An opened review ticket in the Work view has a **What the review saw** part, directly under its action buttons. Each scenario the pass ran is a group: its name, whether it landed, its pictures with captions, and its calls, folded. Pictures taken outside any scenario sit in **Other checks**, and a pass with no scenarios simply lists its pictures. A click opens the same viewer as files in chat. The ticket's collapsed row says what it holds: `Reviewed · 6 screenshots · 2 calls · 7m`. When there is nothing, one quiet line says why.

When the orchestrator asks the human to accept a feature, it shows the same pictures in chat, and says so if they predate later work.

### The record

Each pass's folder (`reviewDir`, keyed by ticket, already holding `DIGEST.md` and `walkthrough.webm`, and wiped on re-burn) gains a `saw/` folder: a manifest, `saw.json`, and the PNGs it names. The file on disk is the record, as with the walkthrough, so there is no database row. The manifest is created empty when the pass prepares its folder, so "no manifest" means a pass from before this feature, which shows no part at all. Entries are appended in order, each write replacing the file atomically, and a failed write never fails a tool call. Its shape, pinned because the tool, the route and the screen must agree (adapted from the older plan):

```ts
type SawEntry =
  | { kind: 'scenario'; at: number; file: string; name: string; ok: true; entryUrl: string }
  | { kind: 'scenario'; at: number; file: string; name: string; ok: false; failure: ScenarioFailure }
  | { kind: 'shot'; at: number; caption: string; image: string /* file name in saw/ */;
      by: 'runcastle' | 'agent'; scenario?: string /* scenario file; absent = Other checks */ }
  | { kind: 'shot-failed'; at: number; scenario: string; reason: string }
  | { kind: 'call'; at: number; scenario: string; request: FilledHttpRequest; result: DriveCallResult }
```

`request` and `result` have the values of `Authorization`, `Cookie` and `Set-Cookie` masked when they are written, so a credential is never on disk here. Bodies keep the existing 256 KB cap.

### Taking pictures

A new small module beside `recorder-reap.ts` talks to the pass's browser. The session name is already fixed (`review-<ticketId>`), and `reapRecorder` already reaches it from a second process. Tested on agent-browser 0.26 on this machine: a second process opened a page in a session that was recording and screenshotted it in about 400 ms, and the walkthrough still saved.

- **Spawn with stdio ignored**, as `runCommand` does, and with a deadline. The daemon inherits any pipe it is given, and a pipe that never closes hung this probe.
- **Never start a browser.** `session list` says whether the agent's session exists. Without that check, runcastle would launch a browser nobody closes, because the reaper only acts when a walkthrough file exists.

`review_drive({ action: 'scenario', file })` records the `scenario` entry. If it landed and the agent's browser is up, runcastle opens `entryUrl` in that browser, waits for the load with a short bound (an app holding a live stream never reaches network idle, so the picture is taken anyway), and takes the picture, captioned "Entry page". The result gains `browser: 'on-entry-page' | 'not-open'`, so the agent knows to re-snapshot, or to open the page itself and capture. A picture that fails adds a `shot-failed` entry and the scenario still returns its landing.

`review_drive({ action: 'capture', caption, outside? })` is new. Runcastle screenshots the agent's browser, picks the file name, and appends the entry. The picture belongs to the latest scenario that landed in this pass, unless `outside: true` or none has. It is refused, in a sentence the agent can act on, when no review drive of this feature is up, the browser is not open, or the pass reached 60 pictures. The pass's ticket is found the way `report_finding` finds it: the burning review ticket on the run's feature.

`try_call` appends its `call` entry by itself, with no new step for the agent.

### The prompts

`review-ticket.md`, `verify-fixes.md` and `buildScenarioBlock` change together:

- Open the app in the browser before the first scenario. After a scenario, runcastle has already put the browser on its entry page, so re-snapshot.
- At each acceptance criterion a screen can show, once the screen shows it, call `capture` with the criterion in one line as the caption. A scenario's entry picture does not count as a check.
- If the feature's criteria name a phone layout, resize the browser and capture that.
- Delete the step that opens `entryUrl` by hand, except when the result says `not-open`.

### Serving and the screen

The review routes gain `GET /api/reviews/ticket/:ticketId/saw.json` and `GET /api/reviews/ticket/:ticketId/saw/:file`. As with the gate-log route, the file name is checked against what the store writes, and the path is computed from the looked-up row's id. PNG only, `nosniff`, `?download=<name>` honoured because the shared viewer's download button sends it. `ReviewTicketArtifacts` gains `shots` and `calls` counts, and has a `saw` flag saying a manifest exists.

The screen is designed. `ReviewSawPart` is a real component taking groups or one empty line, and it reuses the chat's `ShownFiles` and the drive's `CallResponse`, which this design exported from `ApiView`. `apps/web/preview/review-saw.html?state=` holds the states. Wiring adds: the query for one ticket's manifest, under the same query key as the listing so the stream refreshes it; a pure function that turns entries into groups and gives each picture a readable name; the part in `TicketDetail`, for a review that finished, failed or was stopped and has a manifest; and the counts in the row's words. A `shot-failed` entry reads as a quiet line in its group. The empty lines come from the pass's recorded mode: `gates` gives "This review read the code, so it has no screenshots."; `drive` with no pictures gives "The review took no screenshots."

### Reaching the lead and the orchestrator

One function builds `reviewShots`: every review ticket of the feature with at least one picture, newest first, keeping the newest three passes so the reply stays small. Each carries `seq`, `passKind`, `reviewedCommit`, `commitsSince` and its pictures as `{ path, caption, scenario }`. `commitsSince` is the count of commits from `reviewedCommit` to the feature branch, or null when the branch is gone or no commit was recorded. `read_feature_chat` returns it beside `shown`, and `get_feature_context` returns it beside `reviewEvidence`. `show_file` already accepts anything under the reviews folder, and it copies the file, so a shown picture survives a re-burn.

- The project skill's "Let them see it" paragraph: show the newest pass's pictures, add an earlier pass's where they cover a screen the newest does not, say so when `commitsSince` is above zero, and fall back to `shown` when there are none.
- The feature skill's ready section: when a review drove, show its pictures in chat with `show_file` when you say ready.

## Seams

- **`review_drive` tool, through `toolReviewScenario` (existing, new action `capture`).** Observes manifest entries for each action, each refusal, the cap, that a failed picture does not fail a scenario, and masking on a recorded call. The browser is injected, so no browser is needed.
- **The browser module (new).** With injected commands, observes that nothing runs when `session list` lacks the session, that a slow network wait still takes the picture, and that a hung command is abandoned at its deadline.
- **`/api/reviews` routes (existing).** Observes the manifest and image served, a name the store would not write refused, traversal refused, a non-review ticket refused, `?download=`, and the counts on the listing.
- **`sawGroups` (new, pure).** Feed entries, read groups: grouping, Other checks, no scenarios, a failed scenario, a failed picture, and the empty lines.
- **`read_feature_chat` and `get_feature_context` (existing).** Observes `reviewShots`: order, a Gates pass skipped, the three-pass limit, `commitsSince`, and null for a deleted branch. The read-ceiling test lists the new field.
- **Review prompts (existing templates).** The existing prompt-render tests: the `capture` instruction is in both prompts and the scenario block.
- **`ReviewSawPart` (new, designed).** Tier 1 static markup for each state.

One check goes beyond the tests, and I will run it by hand: the browser module against real agent-browser and a recording session, with a page that holds a stream open. Live review passes run the installed runcastle, so a real pass cannot use this code until it is published. The first real review after the release is the true test, and the first thing to look at is whether agents capture at each check.

## Out of scope

- Keeping the review's drive running and handing it to the human. That stays in "Review hands you a running drive with what it saw", whose plan still describes this half. Its tickets 2 and 5 are done by this feature, so its lead must drop them when it starts.
- Comparison of any kind: no diffs, no base captures, no masking of screens.
- Requiring a review, or holding anything for a missing picture.
- A way to make pictures for a feature with no review.
- Frames pulled from the walkthrough video.
- Pictures appearing live while a review runs.
- Capturing at a second width.
- A phone-friendly viewer: "Runcastle on your phone" owns it. That feature's access control must cover the new routes, as it must every other route.
- Scrubbing secrets from bodies or URLs.
- Cleaning up old review folders.

## Open questions

None block the work. The plan preview's Check first group lists the decisions the human may want to change. One choice is open in the design: pictures two across on a wide screen, or one to a line as in chat. Two across is the default on the preview page.
