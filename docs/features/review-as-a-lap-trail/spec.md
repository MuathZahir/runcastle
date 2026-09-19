# Review as a lap trail

## Problem

A review pass that verified nothing can currently land looking like a clean bill of health. The orchestrator reads a pass's outcome off whether a digest exists, not off what the pass actually did — so a reviewer that could not attach a browser and wrote "all acceptance criteria remain honestly unverified" still produced a run that said "succeeded, 0 defects found", and the next lap planned on an empty defects list. Verification passes inherit their mode from whether a recording file happens to exist on disk, so a missing ffmpeg silently downgraded browser-found defects to diff reading. And the review page shows only the latest pass, so "lap 2 found six defects, lap 3 verified nothing" is not readable at a glance. The operator cannot see the story of the feature's laps, cannot tell an honest failure from a clean pass, and has no way to ask for another review except one narrow retry that exists only for dirty-drive denials.

## Approach

From the operator's side: the review page gains a **trail** — one entry per lap, all laps visible, newest first — telling what burned, how the review went (including "nothing verified"), what evidence exists, and what was found. A lap whose review produced no evidence arrives **loudly**: "nothing verified this lap" is the page's top line, the run reads succeeded-unverified, and the digest headline is a template runcastle fills, never agent prose. Nothing blocks — auto-advance is untouched. Beside Test drive sits an **Agentic review** button, present in every review-page state, which mints a fresh review ticket for the current lap and burns it.

The shape of it, per the locked decisions:

**Verdict and mode become data the orchestrator records honestly (decisions 2, 3).** The review prompt template mandates a machine-parseable declaration block in the digest: the mode actually run (`drive` | `gates`), verified-or-unverified, and a one-line reason when unverified. The harvester parses it into two new persisted columns on the review ticket row: `reviewMode` and `reviewVerdict` (with reason). Ticket `status` is untouched — an unverified pass is still `done` for scheduling; `couldNotReview`/`failed` still means the pass never ran. Artefacts cross-check the declaration and can only downgrade: Drive declared verified without a walkthrough recording on disk lands `unverified`; a missing or unparseable declaration block is itself `unverified`. Gates has no positive artefact, so its declaration stands.

**Verification passes read the recorded mode (decision 3).** The inherited-mode rule changes from "does the verified pass's webm exist" to "what does the verified pass's `reviewMode` column say". A verification that inherited Drive but finds drive unavailable at spawn follows the prompt's failure branch: the drive failure is recorded as the pass's reason and a full Gates run happens — and a completed Gates run is verified-by-gates under the settled definition, so it lands `verified · gates` with the drive failure reported, not `unverified`.

**Drive availability grows two preconditions (decision 8).** Pre-spawn, Drive is offered only when the browser CLI is on PATH, answers a cheap health invocation (working state, not just presence), and ffmpeg is present. Any missing piece makes drive unavailable with the specific reason named in the availability block and recorded in the pass's outcome. Invariant bought: an offered drive can always record, so the missing-webm cross-check never fires on an honest pass.

**The prompt gets the failure branch (brief point 6).** "Dev URL answers but no browser attaches = drive failure: record it as the pass's outcome via the declaration block, then run Gates mode in full" — explicitly exempt from the never-run-both-modes rule. Verification reviewers are told what happens to their defects.

**The trail (decisions 4, 5).** The evidence stage keeps today's behaviour exactly: it plays the latest recording that exists from whatever lap, identified by lap — the stage is the viewer, never lap-scoped, so a new lap with no recording never blanks it (preserving `flow-redesign-build-review-and-ship` decision 19's rationale). The trail is a new full-width band replacing the "Earlier recordings" disclosure popover. Each entry is a **lap** (a lap can hold several review passes: review, verification, agentic re-reviews): a header with lap number, completion time, and an outcome chip carrying the latest completed pass's verdict (`Verified · drive/gates`, `Unverified`, `Could not run`); the burned ticket count linking to the run view; one compact row per review pass (pass kind, mode, verdict, recording link that stages the recording in the existing player); defect counts (found / fixed / carried) and test-note count. Observations render only in the Full account, as already decided elsewhere. An unverified entry's outcome line is the runcastle-filled template ("Lap 3 · drive mode · DRIVE FAILED · nothing verified") plus the declared reason. The per-pass artifact listing the server already synthesises grows the verdict, mode and reason so the trail renders from one feed. The notes rail and open-work components are untouched.

**Loudness for the current lap (decision 5).** When the current lap's review is unverified, the page arrives with "nothing verified this lap" as the top line — arrival-banner/status-line territory, separate from the trail (the trail is history; the arrival line is now). Merge is not primary on an unverified lap (binding from `review-arrival-is-legible` decision 3); the arrival banner's action slot favours Agentic review. The run header shows succeeded-unverified, and the injected chat context carries the unverified outcome into the next lap.

**Agentic review (decisions 6, 7).** A new mutation mints a fresh `kind: review`, `passKind: review` ticket on the current lap and burns it. Mode is chosen fresh by availability — no inheritance. Its findings join the current lap under existing carry/link/close rules. The button is always visible on the review page; while a run is live it is disabled with a reason, same idiom as the adjacent Test drive button; never queued. The `retryingDeniedReview` special case is deleted — ticket retry returns to failed-tickets-only; a fresh mint supersedes resetting a `done` row and the denied pass stays in the trail as what it was. The dirty-denial banner keeps its notice (denial + dirty files) but its action becomes the Agentic-review mint, and the dirty-tree pre-check moves with it: when the latest run was denied-dirty, the mint refuses first, naming the files.

Schema/migration: two nullable columns on the tickets table (`reviewMode`, `reviewVerdict`) plus the reason text; historical rows stay null and the trail renders pre-feature passes without a verdict chip rather than inventing one.

## Seams

1. **Declaration parsing and verdict resolution (new, pure).** A function from harvested digest text + artefact facts (recording exists, mode offered) to `{ reviewMode, reviewVerdict, reason }`. Lets you test the whole detection matrix — declared-drive-with-webm, declared-drive-without-webm, declared-gates, missing block, unparseable block — with no IO.
2. **Drive availability probe and block builder (existing, extended).** The pure availability builder already takes probe results; it grows the health-check and ffmpeg inputs. Observes: which mode is offered and the exact reason prose when drive is withheld, plus the inherited-mode path now driven by the recorded mode instead of file existence.
3. **Review ticket outcome (existing).** The workflow's returned outcome and the persisted ticket row after completion. Observes: `done` with verdict columns populated, the downgrade cases, `couldNotReview` untouched.
4. **Per-pass review artifacts feed (existing, extended).** The server route the review page already reads per-pass rows from, now carrying verdict/mode/reason. Observes: everything the trail needs, lap-grouped, as one JSON shape — the trail's single data source and the highest UI seam.
5. **Agentic review mutation (new, replaces the retry special case).** Observes: fresh ticket minted on the current lap with the right kind/pass kind, burn started, refusal while a run is live, dirty-tree refusal naming files, and the retry mutation's guard narrowed back to failed-only.
6. **Review page components (existing, component-test tier).** Trail band, arrival banner, disabled-with-reason button states, stage default unchanged across lap flip. Rendered from feed fixtures; no server.
7. **Prompt template render (existing).** The rendered review prompt for given probe/inheritance inputs. Observes: the declaration-block mandate, the failure branch, the both-modes exemption, and the verification reviewer's defect-fate note.

## Out of scope

- The state model, gates, and when auto-advance fires ("Four states and two hard rules" owns them). `unverified` is deliberately not a ticket status.
- Where the feature chat sits on the review page ("One chat per feature"); the trail leaves room.
- Finding kinds, the auto-fix cap, carry/link/close semantics — consumed as they are; no third kind, observations stay lap-local.
- Test drive mechanics (checkout switch, drive setup, `project-level-test-drive`).
- Review/verification scheduling (`failure-aware-scheduling-for-review-and-verification-passes`) — unchanged.
- Queueing burns; the Agentic review button never queues.

## Open questions

None — the eight decisions in `decisions.md` closed the tree; remaining choices (exact column naming, template wording, chip styling) are implementation detail inside the seams above.
