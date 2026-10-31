# Review keeps its screenshots

## Problem

The human wants to accept a finished feature from their phone by looking at it, and phones get no drives. A review pass walks the app in a browser, but all it leaves is a video and a digest. Nobody asks it for screenshots, nothing records which scenarios it ran, and the responses to the calls it tries with `try_call` are thrown away. So the human has to start a drive, watch a whole video, or take the digest's word for it, and the orchestrator has nothing to show.

## Approach

### What the human gets

When a review pass ends, a **Review Package** appears in the feature's chat: one attachment with the review's conclusion, a contact sheet of what it holds, and a line such as `6 screenshots · walkthrough · 2 calls · 1 defect`. A click opens a full-window page. One thing sits large on its stage, a list of everything sits beside it (below it on a phone), and the human steps through with the arrows. The list starts with one **Findings** row, whose page holds every finding in full. Each scenario follows with its pictures and calls, then **Other checks**, then the review's full account. A pass with no scenarios simply lists its pictures. When there are no pictures, one quiet line says why.

The review ticket keeps its goal and criteria and gains one **Open review package** button. The walkthrough button, findings and digest leave it.

When the orchestrator asks the human to accept a feature, it shows the same package in its chat. The card says "This build", or how many commits the branch has moved on since.

### The record

Each pass's folder (`reviewDir`, keyed by ticket, already holding `DIGEST.md` and `walkthrough.webm`, and wiped on re-burn) gains a `saw/` folder: a manifest, `saw.json`, and the PNGs it names. The file on disk is the record, as with the walkthrough, so there is no database row. The manifest is created empty when the pass prepares its folder, so "no manifest" means a pass from before this feature, which shows no part at all. Entries are appended in order, each write replacing the file atomically, and a failed write never fails a tool call. Its shape, pinned because the tool, the route and the screen must agree (adapted from the older plan):

```ts
type SawEntry =
  | { kind: 'scenario'; at: number; file: string; name: string; ok: true; entryUrl: string }
  | { kind: 'scenario'; at: number; file: string; name: string; ok: false; failure: ScenarioFailure }
  | { kind: 'shot'; at: number; caption: string; image: string /* file name in saw/ */;
      scenario?: string /* scenario file; absent = Other checks */ }
  | { kind: 'call'; at: number; scenario: string; request: FilledHttpRequest; result: DriveCallResult }
```

`request` and `result` have the values of `Authorization`, `Cookie` and `Set-Cookie` masked when they are written, so a credential is never on disk here. Bodies keep the existing 256 KB cap.

### Taking pictures

The agent takes every picture. `review_drive({ action: 'capture', caption, outside? })` is new: runcastle screenshots the agent's browser, picks the file name, and appends the entry. The session name is already fixed (`review-<ticketId>`), and `reapRecorder` already reaches it from a second process. Tested on agent-browser 0.26 on this machine: a second process screenshotted a session that was recording in about 400 ms, and the walkthrough still saved.

- **Spawn with stdio ignored**, as `runCommand` does, and with a deadline. The daemon inherits any pipe it is given, and a pipe that never closes hung this probe.
- **Never start a browser.** Check `session list` first. Without that, a capture before the agent opened its browser would launch one nobody closes, because the reaper only acts when a walkthrough file exists.

The picture belongs to the latest scenario that landed in this pass, unless `outside: true` or none has. `capture` is refused, in a sentence the agent can act on, when no review drive of this feature is up, the browser is not open, or the pass reached 60 pictures. The pass's ticket is found the way `report_finding` finds it: the burning review ticket on the run's feature.

`review_drive({ action: 'scenario', file })` and `try_call` append their entries by themselves, with no new step for the agent.

### The prompts

`review-ticket.md`, `verify-fixes.md` and `buildScenarioBlock` change together:

- At each scenario's entry page and at each acceptance criterion a screen can show, once the screen shows it, call `capture` with what it shows in one line as the caption.
- If the feature's criteria name a phone layout, resize the browser and capture that.

### Serving and the screen

The review routes gain `GET /api/reviews/ticket/:ticketId/package.json` and `GET /api/reviews/ticket/:ticketId/saw/:file`. The first returns the whole package: the verdict (the digest's first line), the account, how far the branch has moved since, the groups built from the manifest, the findings, and why there are no pictures. As with the gate-log route, the file name is checked against what the store writes, and the path is computed from the looked-up row's id. PNG only, `nosniff`, and `?download=<name>` for the viewer's habit of saving a file under its own name.

**The package in a thread.** One new thread event, `review_package`, carries the review ticket's id and nothing else, and folds as its own item, as a `file_shown` does outside a turn. The card and page read the pass through the route above, so they always show the pass as it stands. A re-burn replaces what they show. The burner asks the runner to post it to the feature's main chat when a review pass ends, whatever its mode. `show_review_package({ slug })` appends the same event to the calling thread, for the newest pass that took pictures, or the newest pass when none did. It is registered for the thread kinds.

**The screens.** `ReviewPackageCard` and `ReviewPackagePage` in `apps/web/src/components/review/`, previewed at `/preview/review-package.html`. The walkthrough on the page is the existing `EvidenceStage`, so it plays as it does today. A chat item and the ticket's button both open the same dialog. The empty lines come from the pass's recorded mode: `gates` gives "This review read the code, so it has no screenshots."; `drive` with no pictures gives "The review took no screenshots."

### Reaching the lead and the orchestrator

One function builds `reviewShots`: every review ticket of the feature with at least one picture, newest first, keeping the newest three passes so the reply stays small. Each carries `seq`, `passKind`, `reviewedCommit`, `commitsSince` and its pictures as `{ path, caption, scenario }`. `commitsSince` is the count of commits from `reviewedCommit` to the feature branch, or null when the branch is gone or no commit was recorded. It is returned by `get_feature_context` and `read_feature_chat`, so an agent can read the pictures and quote them.

The project skill's "Let them see it" paragraph: call `show_review_package` above your question, say so when the pictures predate later work, and fall back to `shown` when there is no package.

### Review rounds

The feature skill's "Review is your call" section becomes the default in decision 14, and the tickets reference follows it: every feature plans one final review round, unless the human does not want one. The lead emits a single `kind: "review"` ticket and dispatches it. The server gains no rule: a lead can skip it, and nothing refuses a merge. A review round on work the lead built has no implementer digests, and the burner already says so to the agent.

## Seams

- **`review_drive` tool, through `toolReviewScenario` (existing, new action `capture`).** Observes manifest entries for each action, each refusal, the cap, and masking on a recorded call. The browser is injected, so no browser is needed.
- **The capture module (new).** With injected commands, observes that nothing runs when `session list` lacks the session, and that a hung command is abandoned at its deadline.
- **`foldThread` (existing).** Observes the `review_package` item's place, in and out of a turn.
- **`show_review_package` tool (new).** Observes the event, which pass it picks, and that it refuses a feature with no review.
- **`/api/reviews` routes (existing).** Observes the manifest and image served, a name the store would not write refused, traversal refused, a non-review ticket refused, and the counts on the listing.
- **`reviewPackage` (new).** Feed manifest entries and a ticket, read the package: grouping, Other checks, no scenarios, a failed scenario, the empty lines, and findings with defects first.
- **`read_feature_chat` and `get_feature_context` (existing).** Observes `reviewShots`: order, a Gates pass skipped, the three-pass limit, `commitsSince`, and null for a deleted branch. The read-ceiling test lists the new field.
- **Review prompts (existing templates).** The existing prompt-render tests: the `capture` instruction is in both prompts and the scenario block.
- **The package card and page (new, designed).** Tier 1 static markup for each state; tier 2 for stepping through the page.
- **Feature skill (existing).** The existing skill tests: the review-round default is present.

One check goes beyond the tests, and I will run it by hand: the capture module against real agent-browser and a recording session. Live review passes run the installed runcastle, so a real pass cannot use this code until it is published. The first real review after the release is the true test, and the first thing to look at is whether agents capture at each check.

## Out of scope

- Keeping the review's drive running and handing it to the human. That stays in "Review hands you a running drive with what it saw", whose plan still describes this half. Its tickets 2 and 5 are done by this feature, so its lead must drop them when it starts.
- Comparison of any kind: no diffs, no base captures, no masking of screens.
- Requiring a review, or holding anything for a missing picture.
- A way to make pictures for a feature with no review.
- Any server rule requiring a review round.
- Frames pulled from the walkthrough video.
- Pictures appearing live while a review runs.
- Capturing at a second width.
- A phone-friendly viewer: "Runcastle on your phone" owns it. That feature's access control must cover the new routes, as it must every other route.
- Scrubbing secrets from bodies or URLs.
- Cleaning up old review folders.

## Open questions

None.
