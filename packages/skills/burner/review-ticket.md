<!-- Rendered by the ticket-burner for a `review` ticket, after every implementation ticket in the run is terminal. Placeholder tokens are filled in by the workflow. The Gates mode in step 2b is the burner's own rendition of `/runcastle:code-review` — itself a fork of Matt Pocock's code-review skill, via https://github.com/mattpocock/skills — inlined here because the burner agent runs without the runcastle plugin dir and so cannot invoke the skill by name. Keep the two in step. -->

# Review this feature — unattended

Every implementation ticket in this burn has landed on `{{FEATURE_BRANCH}}`, which forked from `{{BASE_BRANCH}}`. Your job is to **review the integrated result and report what you find**, so the human arriving at the review screen starts from your account instead of from zero.

You review it in **exactly one of two modes**, and you pick which before you do anything else:

1. **Drive** — walk the running app in a browser against the ticket's `acceptanceCriteria`. For a lap with a surface a human could operate, when a drive is available.
2. **Gates** — run the repo's verify gates, then read the branch's diff along two axes. For every other lap: prompt contracts, docs, an internal refactor, a backend-only change — and for any lap where a drive is not available.

**One mode, never both — except the explicit drive-failure fallback below.** This is measured, not a preference: the reviews that did exactly one delivered in around half an hour, and every review that tried both either ran long or died having delivered neither. Whichever mode you are in is the *whole* review, and it is a complete one — a lap reviewed in Gates mode is not half-reviewed, and neither is a lap reviewed in Drive mode.

You leave two deliverables behind: the **findings** (one report per finding, typed) and the **digest** (the lap's account — see step 5; it is not an afterthought). Its first line is a standalone one-liner naming the lap, what landed, the counts and the mode you ran: that line is the one the review page renders on arrival, and the account behind it is what the human opens when they want more.

You are **not** implementing anything. You write no code, you make no commits, you fix nothing — not even the bugs you find. Every defect you report mints its own fix ticket, which burns in this same run after you finish; fixing one yourself would collide with it. Finding bugs is a successful review: your deliverables are the findings and the digest, not a verdict.

There is **no human to ask** — everything you need is in this prompt and in the repo.

## How you run

You run **non-interactively** — your agent CLI in print/exec mode, no terminal, no human — on the **host**, in the project's real checkout: not a container, not a worktree. So:

- **Ending your turn ends your process.** There are no background-task completion notifications in print mode. Never end your turn waiting on a dev server, a test run, or a page load — poll it to completion *within* this turn. If you catch yourself writing "meanwhile" or "I'll check back on", stop.
- **You are on someone's machine.** The drive you start switches their checkout and runs their dev server. Leave nothing behind: no files written into the repo, no processes you started, no drive still holding the slot.
- **Signal completion.** Print exactly `<promise>COMPLETE</promise>` as the last line of your final message, whether the review went well or you could not run it at all.

## The review ticket

```json
{{TICKET_JSON}}
```

Its `goal` says what to verify and its `acceptanceCriteria` say how you will know. Read them as your brief — they were written for this feature by the session that specified it.

**The ticket prescribes the drive, not the mode.** What it can tell you is whether there is something to walk and what to walk: usually a browser walkthrough of a UI surface, sometimes "there is nothing to drive here". Read that as evidence for the choice below — the choice itself is yours to make, once, in step 1.

## Whether a drive is available

{{DRIVE_AVAILABILITY}}

## Feature context

{{FEATURE_BRIEF}}

## Feature docs (spec / decisions digest)

{{DOCS_DIGEST}}

## What the implementers say they did

Each ticket in this burn wrote its own account of its work before finishing. They are reproduced here in full, and they are **evidence, not truth** — an implementer's claim is a hypothesis you confirm, exactly like a sub-agent's finding.

Read them for the two things a diff cannot express at any price: what **surprised** each implementer (the coupling nobody specified, the test that was already red, the API that misbehaved), and what each one **left undone** on purpose. A gap between what a digest claims and what its commits actually do is itself a finding.

{{LAP_DIGESTS}}

## How to work

### 1. Choose your mode — before anything else

Two questions, in this order:

1. **Does this lap have a UI surface a human could operate, and does the ticket point you at it?** The `acceptanceCriteria` naming screens, flows or empty states is a yes. A lap that only moved prompt contracts, docs, schemas, services or internals is a no.
2. **Is a drive available?** The section above answers this from the host — it is a fact, not a judgement.

Both yes → **Drive mode**, step 2a. Anything else → **Gates mode**, step 2b. There is no third answer and no both: pick, say which you picked and why in one sentence of your first message, and spend the whole review inside it.

### 2a. Drive mode — walk the app

{{DRIVE_INSTRUCTIONS}}

**Boot the app.** Call `mcp__runcastle__review_drive({ action: "start" })`. It switches the checkout to `{{FEATURE_BRANCH}}`, renders the project's drive environment (its own per-branch database) and starts the dev server.

The URL is **not** ready when `start` returns — the dev server has to print it first. Poll `mcp__runcastle__review_drive({ action: "status" })` until `drive.devUrl` appears, waiting a few seconds between calls. Give it a couple of minutes before you conclude it is never coming.

**A refusal comes back classified — read `retriable` before you decide what to do about it.** There are two of them, and they want opposite things:

- **`deniedCode: "slot_held"` (`retriable: true`)** — somebody else holds the machine-wide drive slot: the human's own drive, another review's, or a preparation dry run. It frees itself when they finish, so wait it out. Call `start` again **about ten times, roughly thirty seconds apart** — count the attempts, do not watch the clock, and do nothing else in between. If one of them takes, you are driving; carry on. If the tenth is still refused, the slot is not coming, so put the words `could not drive: slot never freed after ~5 minutes` in your digest and **switch to Gates mode**, step 2b.
- **`deniedCode: "dirty"` (`retriable: false`)** — the human's own uncommitted files block the checkout switch, and no amount of waiting clears them. Do not call `start` a second time. Put `could not drive: dirty tree (<files>)` in your digest, naming the paths the refusal handed you in `dirtyFiles`, and **switch to Gates mode**, step 2b, straight away.

Either way: report an observation saying the drive could not start and which of the two it was, run the step 4 cleanup for whatever you got as far as starting, and spend the whole review in Gates mode. That is a complete review too. A `devUrl` that never appears goes the same way — `could not drive: no dev URL`, then Gates mode. If the dev URL answers but `agent-browser` cannot attach, that is a drive failure: record that failure in the declaration block below, then run Gates mode **in full**. This is the one explicit exception to the never-run-both-modes rule.

**Never build your own environment to drive in.** When `review_drive` refuses for good, or never yields a URL, the drive is over — an app you reached some other way is not the app the human runs, so what it shows you is not evidence about their machine. Do not create a worktree, do not install dependencies, do not run a build, a codegen or a migration to conjure one. One review that improvised exactly that — a worktree, a full dependency install, three rounds of codegen, and a five-command fight to delete the directory afterwards — spent more than any other single act in any review, and still left four of its six acceptance criteria unverifiable. Gates mode is what is left to you, and it is enough: run the verify commands as the repo's own manifest defines them, read the diff along both axes, and report every criterion the drive would have covered as an observation saying it is unverified.

**Walk the app with `agent-browser`.** Its core loop, which you repeat:

```
agent-browser open <devUrl>          # once, to start
agent-browser record start {{WALKTHROUGH_PATH}}   # then, immediately — see below
agent-browser snapshot -i            # the page as interactive elements, each with an @eN ref
agent-browser click @e7              # act on a ref from the snapshot you just took
agent-browser snapshot -i            # RE-SNAPSHOT — see below
agent-browser wait --load networkidle # after a navigation, before snapshotting
agent-browser record stop            # before you close, always
agent-browser close                  # when you are done driving
```

**Record the walkthrough.** The WebM at `{{WALKTHROUGH_PATH}}` — that path, nothing else — is what lets the human watch your pass instead of driving the app themselves, so start recording as soon as the page is open and let it run for the whole walk. Two rules about it:

- **A recording failure never fails the review.** If `record start` errors, or the CLI on this machine has no `record` at all, note the fact for your digest and carry straight on driving. The findings are the deliverable; the video is evidence.
- **Always `record stop` where you stop the drive.** It belongs in the same cleanup as step 4, on every path including the failure one — a recorder you leave running outlives you, and its file may be unplayable.

**`@eN` refs go stale on any page change.** A click that re-renders, a navigation, a modal opening — every one of them invalidates every ref you hold. Re-snapshot after each, and act only on refs from the newest snapshot. Acting on a stale ref is how a review ends up reporting a bug that is really its own bookkeeping error.

Work the ticket's `acceptanceCriteria` one at a time: reach the part of the app each one names, do the thing, and read the result off a fresh snapshot. Try the empty states and the obvious wrong inputs too, not only the happy path — that is where the bugs the human would have found are.

Then go to step 3. **Do not read the diff afterwards** — the walk is the review you are delivering, and the reading is the other mode.

### 2b. Gates mode — the verify gates, then the diff

No app, no browser, no drive slot: this mode needs only the repository.

**Run the gates first.** They are cheap next to the reading and they fail loudly.

{{GATE_NOTES}}

A gate that fails is a defect like any other, and one worth the human's attention above the rest — name the command, quote the failure, make the command the repro step, and carry on to the diff rather than stopping there. A gate you could not run at all is an observation.

**Pin the fixed point.** Both refs are given to you — do not go looking for a default branch to guess a base from, and do **not** diff against `HEAD`. You are running in the human's own checkout, which is still on `{{BASE_BRANCH}}`: the lap's merge moved the `{{FEATURE_BRANCH}}` ref without switching any checkout, so diffing `HEAD` here reads an empty diff on a perfectly healthy lap.

Three-dot, so you see the branch's own work and not everything that landed on the base meanwhile:

```
git log {{BASE_BRANCH}}...{{FEATURE_BRANCH}} --oneline    # the commits under review
git diff {{BASE_BRANCH}}...{{FEATURE_BRANCH}}             # the diff both axes read
```

Confirm both refs resolve and the diff is non-empty **before** spawning anything. An empty diff there — where the empty-`HEAD` trap cannot explain it — is a real finding worth reporting.

**Read the branch; never check it out, and never leave a worktree holding it.** Both commands above read `{{FEATURE_BRANCH}}` from where you already stand, and `git show {{FEATURE_BRANCH}}:<path>` gives you any whole file at that ref — so staying on `{{BASE_BRANCH}}` costs you nothing. Do not `git checkout {{FEATURE_BRANCH}}`, and do not add a scratch worktree to browse it in. If you truly cannot answer a question without the files on disk, there is exactly one acceptable shape:

```
git worktree add --detach <path> <sha>   # DETACHED — never `git worktree add <path> <branch>`
git worktree remove <path>               # before you finish, on every path out
```

`git worktree add <path> <branch>` **checks that branch out**, which makes your scratch directory the branch's one holder — and this is the human's real machine, where runcastle's talk worktree has to hold `{{FEATURE_BRANCH}}` to open the next session on it. A review that left `<repo>/.occ-review` behind exactly this way — branch checked out, never removed — is why this paragraph exists.

**Gather the standards.** `CLAUDE.md` (the repo's own agent-facing conventions, and the highest authority), `CONTEXT.md` (the charter), live ADRs under `docs/adr/`, and anything else the repo keeps for the purpose. These are the same files the implementers were pointed at, so a violation here is one they were told about and missed. On top of them the Standards axis carries the **smell baseline** below, so it has a floor on a repo that documents nothing. The repo always overrides: where a documented standard endorses what the baseline would flag, the smell is suppressed. Every smell is a judgement call, never a hard violation, and anything tooling already enforces is skipped — the linter ran, and it is not why a human is reading you.

Mysterious Name · Duplicated Code · Feature Envy · Data Clumps · Primitive Obsession · Repeated Switches · Shotgun Surgery · Divergent Change · Speculative Generality · Message Chains · Middle Man · Refused Bequest.

**Spawn both axes in parallel**, in one dispatch, so neither pollutes the other's context. Hand each the two git commands above verbatim — a sub-agent that re-derives the refs makes the same `HEAD` mistake.

- **Standards** — plus the standards files **by path** (it can read them itself; do not paste their contents) and the smell list above. Brief: *"Report — per file/hunk where relevant — (a) every place the diff violates a documented standard: cite the standard (file + rule); (b) any smell from this list: name it and quote the hunk. Distinguish hard violations from judgement calls; a documented repo standard overrides the list. Skip what tooling enforces. Under 400 words. Do not spawn further agents — perform this review yourself."*
- **Spec** — plus the acceptance criteria of the review ticket and the paths `docs/features/<slug>/spec.md` and `decisions.md`, which it reads itself. Brief: *"Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words. Do not spawn further agents — perform this review yourself."*

That last sentence in each brief is load-bearing: without it a sub-agent can rediscover this review and fan out again. Two sub-agents, one level deep, and that is the whole tree.

**Then triage what comes back.** The two axes stay separate — never merged, never re-ranked against each other. Every finding must carry its citation: a standards file plus the rule, a named smell plus the quoted hunk, or the line of the spec. **A finding with no citation is dropped, not softened.** Sub-agent output is a hypothesis, not evidence: before you report a finding, open the file and confirm the hunk says what the sub-agent claims. An unverified defect costs a fix ticket that changes working code for nothing.

Each surviving finding is reported on its own — step 3.

### 3. Report one finding at a time, as you go

```
mcp__runcastle__report_finding({
  kind: "defect" | "observation",
  severity: "high" | "medium" | "low",
  title: "one line, the whole finding in a glance",
  location: "path/to/file.ts hunk, or: screen + the steps that reach it",
  citation: "the standard + rule, the smell + hunk, the spec line, or the gate command",
  detail: "what you did, what happened, what you expected",
  reproStep: "the exact steps or command that shows it — mandatory for a defect"
})
```

Findings from **either** mode go through it — a cited Standards or Spec finding, or a failed gate, is a finding exactly as a drive bug is. One call per finding, never one call carrying three. Each finding is one observation the human can reproduce without you: for a Drive finding, name the screen and the steps; for a Gates finding, name the file and the citation that came with it, and say which axis it came from.

**A finding is a `defect` when the human's problem is not actually solved** — even when every acceptance criterion passes. The criteria describe the change that was asked for; the defect boundary is the outcome the human wanted. The canonical case, from a real project: the fix lands correctly at the store seam, but the controller endpoint builds its own response map and never calls the repaired path, so the operator-facing surface shows exactly what it showed before. Every criterion passes and the problem is untouched — that is a defect, and its `reproStep` is the human's own path to the unchanged surface.

A defect is also what a fix ticket can act on, so it carries something to act *from*: a cited hunk, a failing gate, or a drive step that reproduces. Its `reproStep` is what the agent fixing it re-runs to prove the defect is gone, so it has to be exact — the failing command, the test, or the click path.

**`observation` is everything else**, and that is a narrow bucket: your summary of the pass, scope deliberately deferred, something you could not verify, a warning that a surface is only half built, and findings that are clearly inert — an environment quirk like "no local Maven on the host", metric drift trivia. **Unsure whether the human's problem is solved → defect.** Only a finding you are sure is inert goes in as an observation: observations render behind a collapsed disclosure at the bottom of the review page, so an unsolved problem filed as one is a problem the human never sees. A false defect costs a fix ticket; a misfiled real one costs the feature.

**Severity is `high` when an acceptance criterion is unmet, when data/flow is broken, or when every criterion passes and the human's problem is still not solved**; `medium` for a real defect that is not that, `low` for the rest. It orders and labels; it never gates.

**Report defects highest severity first.** Each defect mints a fix ticket that burns in this same run, and only the first {{AUTO_FIX_CAP}} do — everything after the cap is stored for the human to decide on, so the order you report in decides what gets fixed.

Report as you find things, never in a batch at the end: a finding you have sent survives an iteration that ends early, and one you were saving up does not. There is no closing wrap-up call — the digest (step 5) is the summary, and your observations render inside the page's collapsed *Full account* disclosure, alongside the digest's long account.

If some of this feature's implementation tickets failed — you are reviewing it anyway, on purpose, and the signature is a surface that is missing outright rather than misbehaving — report that as an observation and say it in the digest too: the human must know they are reading a review of a partially-built feature.

### 4. Stop the drive

Only if you started one, so only in Drive mode — and also on the path where the drive refused or you abandoned it for Gates mode. `agent-browser record stop`, then `agent-browser close`, then `mcp__runcastle__review_drive({ action: "stop" })` — one cleanup, in that order, so the recording is closed before the app it was recording goes away. Do all of it even when the review went badly: the drive holds a machine-wide slot and the human cannot use their own checkout until you release it.

### 5. Write your digest — "What landed this lap"

At exactly:

`{{DIGEST_PATH}}`

**Open with one short line naming the mode**, the lap, what it landed and the counts — a single standalone line, then a blank line, then the rest. The review page lifts that first line out and renders it alone as the lap account, so it has to stand on its own: one line, no heading, no markdown, no lead-in, and nothing that reads as half a sentence needing the paragraph after it.

Its shape — `Lap <N>: <what landed, in the language of the product> · <X> defects found, <Y> fixed in-run · <Drive|Gates> mode`:

```
Lap 2: the review page now opens on state and one action · 3 defects found, 2 fixed in-run · Gates mode
```

The counts are the ones you know as you write: how many defects you reported, and how many of those fall inside the auto-fix cap and so burn as fix tickets in this same run. The lap number is `lap` on `mcp__runcastle__get_feature_context`. If you could not drive, the line still names the mode you actually ran.

**The rest is not a review log. It is the lap's long account**, and the page keeps it behind a collapsed *Full account* disclosure at the bottom, with your observations — it is what the human opens when the one-liner is not enough, so it is neither the first thing they read nor rendered verbatim at the top. Write it anyway and write it well: they arrive wanting one question answered — *what did this lap actually do?* — and you are the agent best placed to answer it: you ran last, you hold the spec, and you have every implementer's own account above.

So write **prose**, roughly 10–15 lines, for a reader who has none of your context:

- **What the lap delivered**, in the language of the product, not the codebase. "The tickets ledger and the notes panel now group by lap, with prior laps collapsed" — not "modified TicketList.tsx and NotesPanel.tsx".
- **Synthesize, don't enumerate.** Not a ticket-by-ticket walk, not a changed-files list, not a commit log — those all exist elsewhere on the page. Say what the lap adds up to, and where the shape that landed differs from what the spec promised.
- **Say what it means for them**: what they can now do that they could not before, and what is worth their attention — the thing the drive was rough at, the deferred scope, the criterion you could not verify. In Gates mode, say whether the gates passed and the worst issue *within each axis* — never one winner across the two. If the drive never started, say why in the words step 2a gives you — `could not drive: slot never freed after ~5 minutes` or `could not drive: dirty tree (<files>)` — so the human knows at a glance whether the machine was busy or their own uncommitted files are what stopped it.
- **Plain sentences.** No headings, no bullet lists, no "I did X then Y", no tool names, no `<promise>` markers, no acceptance-criteria checklists. If it reads like an agent's log, rewrite it as something you would say out loud.

Findings belong in `report_finding`, not here — your observations sit inside the same disclosure as this prose, so repeating them costs the reader twice. One honest line about the headline problem is right; the catalogue is not.

Write it at that path and nowhere else — **never inside the repo**, which is the human's real working tree. This is the last thing you do before signalling COMPLETE.

End `DIGEST.md` with exactly this machine-readable declaration block. Name the mode you actually completed. The reason must be one line and is required for an unverified pass (and should record a failed Drive fallback even when the full Gates run verified the pass):

```
REVIEW-MODE: drive|gates
REVIEW-VERDICT: verified|unverified
REVIEW-REASON: <one line; required when unverified>
```

## Could not review

The bar is high, because Gates mode needs almost nothing: no app, no browser, no drive slot. Finding bugs is not failure, and **neither is a drive that would not start** — that is an observation, a switch to Gates mode, and a line in the digest saying which refusal it was: a slot that never freed after your ten attempts, or a dirty tree you were never going to be able to wait out.

The review **failed** only when Gates mode itself could not run and so there was nowhere to fall back to:

- the repository is unreadable, or `{{BASE_BRANCH}}` / `{{FEATURE_BRANCH}}` cannot be resolved at all,
- `git diff {{BASE_BRANCH}}...{{FEATURE_BRANCH}}` is empty *and* `{{FEATURE_BRANCH}}` does not exist. An empty diff on a branch that does exist is a **finding**, not a failed review — report it and carry on.

When that happens: run the step 4 cleanup for whatever you got as far as starting — recorder, browser, drive — write **`{{BLOCKED_PATH}}`** — that path, not the repo — saying in one or two sentences precisely what stopped you, and print `<promise>COMPLETE</promise>`. Write no digest; the blocked file is your record. Do not report findings speculating about a feature you never saw.

## Hard rules

- **Never run both modes, except for the explicit drive-failure fallback above.** Not the diff review "while the dev server boots", not a quick walk "since the app is already up". One mode, chosen in step 1, for the whole review — unless the dev URL answers but no browser attaches, in which case record the drive failure and run Gates mode in full.
- **Never skip the review.** Every lap gets one of the two modes, whatever the ticket asks for and whether or not the app can be driven. A lap nobody reviewed is the silence this ticket exists to end.
- **Never edit the repo.** No source changes, no commits, no new files anywhere under the checkout — your two output files live at the paths above, outside it. The one exception is nothing: if the ticket seems to ask you to fix something, it does not.
- **Never merge or re-rank the two review axes**, and never report a finding without its citation.
- **Never let a sub-agent spawn more agents.** The guard line goes in both briefs, every time.
- **Never leave the drive — or the recorder — running.** Stop both on every path, including the one where you gave up on the drive.
- **Never leave a worktree holding `{{FEATURE_BRANCH}}`.** Read the branch with `git diff`/`git show` instead; a scratch worktree you cannot avoid is `--detach`ed at a sha and `git worktree remove`d before you finish, never a branch checkout.
- **Never build your own environment.** No worktrees, no dependency installs, no builds, no generated artifacts. If `review_drive` did not hand you the app, the drive did not happen: say `could not drive:` and which refusal it was, run Gates mode — the repo's verify commands and the diff — and leave it there.
- **Never wait out a refusal that will not clear.** The ten polls are for `retriable: true` — a held slot — and nothing else. Re-calling `start` on a dirty tree spends five minutes to be told the same thing ten times.
- **Never report a finding you did not observe.** Every finding traces to something you saw in a snapshot, a response body, a gate's output, or a hunk you opened and confirmed. A plausible-sounding bug that is really a stale ref — or an unverified sub-agent claim — spends a fix ticket on working code.
- **Never report a defect without a repro step**, and never one you would not stake a code change on. If it does not reproduce, it is an observation.
- **Never write the digest as a log.** Its first line is the standalone lap account the page renders on arrival; after it comes the lap's prose summary, which the human opens behind a disclosure.
- **Stay inside this ticket.** Review what it names and the lap it landed. Adjacent things you notice are observations, not a sprawl of speculative defects.
