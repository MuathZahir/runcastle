<!-- Rendered by the ticket-burner for a `review` ticket, after every implementation ticket in the run is terminal. Placeholder tokens are filled in by the workflow. The code review in step 1 is the burner's own rendition of `/runcastle:code-review` — itself a fork of Matt Pocock's code-review skill, via https://github.com/mattpocock/skills — inlined here because the burner agent runs without the runcastle plugin dir and so cannot invoke the skill by name. Keep the two in step. -->

# Review this feature — unattended

Every implementation ticket in this burn has landed on `{{FEATURE_BRANCH}}`. Your job is to **review the integrated result and report what you find**, so the human arriving at the review screen starts from your account instead of from zero.

You do two things, in this order:

1. **A code review — always.** Every lap gets one. It reads the branch's diff against its base along two axes, and it needs no app, no browser and no drive slot.
2. **A drive of the app — additionally, when there is something to drive.** Most laps have one; a lap that only changed prompt contracts, docs or internals does not, and that is a normal shape, not a failed review.

And you leave two deliverables behind: the **notes** (one per finding) and the **digest** (the lap's prose summary, which the human reads first — see step 6; it is not an afterthought).

You are **not** implementing anything. You write no code, you make no commits, you fix nothing — not even the bugs you find. Finding bugs is a successful review: your deliverables are the notes and the digest, not a verdict.

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

**The ticket prescribes the drive, not the code review.** The code review in step 1 is unconditional and the ticket does not need to ask for it. What the ticket tells you is what to *exercise*: usually a browser walkthrough, and the sections below assume that. If it instead asks you to run the test suite, curl endpoints, or inspect a CLI, just do that: skip the browser and the recording entirely, and keep everything else the same. If it says there is nothing to drive — or if the diff plainly touches nothing a human could operate — the code review stands alone and you skip step 2 entirely.

## Feature context

{{FEATURE_BRIEF}}

## Feature docs (spec / decisions digest)

{{DOCS_DIGEST}}

## How to work

### 1. Code review — always, and first

First, because it is the part that always runs and the part that needs nothing booted. It also gives you the material for step 6: after this you will have read every commit and every hunk of the lap.

**Pin the fixed point.** Resolve the base the branch forked from — the feature's `baseBranch` if you were handed one, else the repo's default branch (`git symbolic-ref --quiet --short refs/remotes/origin/HEAD`, else `main`, else `master`). Then, three-dot, so you see the branch's own work and not everything that landed on base meanwhile:

```
git log <base>...HEAD --oneline    # the commits under review
git diff <base>...HEAD             # the diff both axes read
```

Confirm the ref resolves and the diff is non-empty **before** spawning anything. An empty diff on a lap that supposedly landed work is itself a finding worth a note. Three-dot excludes uncommitted work; say so if the tree is dirty rather than quietly reviewing something else.

**Gather the standards.** `CLAUDE.md` (the repo's own agent-facing conventions, and the highest authority), `CONTEXT.md` (the charter), live ADRs under `docs/adr/`, and anything else the repo keeps for the purpose. On top of those the Standards axis carries the **smell baseline** below, so it has a floor on a repo that documents nothing. The repo always overrides: where a documented standard endorses what the baseline would flag, the smell is suppressed. Every smell is a judgement call, never a hard violation, and anything tooling already enforces is skipped — the linter ran, and it is not why a human is reading you.

- **Mysterious Name** — a name that doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code** — the same logic shape in more than one hunk or file. → extract it, call it from both.
- **Feature Envy** — a method that reaches into another object's data more than its own. → move it onto the data it envies.
- **Data Clumps** — the same few fields or params keep travelling together. → bundle them into one type.
- **Primitive Obsession** — a primitive standing in for a domain concept. → give the concept its own small type.
- **Repeated Switches** — the same switch/if-cascade on the same type recurs. → polymorphism, or one shared map.
- **Shotgun Surgery** — one logical change forces scattered edits across many files. → gather what changes together.
- **Divergent Change** — one file edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality** — abstraction or hooks for needs the spec doesn't have. → delete it.
- **Message Chains** — long `a.b().c().d()` navigation. → hide the walk behind one method.
- **Middle Man** — a function that mostly just delegates onward. → cut it, call the real target.
- **Refused Bequest** — an implementer that ignores most of what it inherits. → composition, not inheritance.

**Spawn both axes in parallel**, in one dispatch, so neither pollutes the other's context:

- **Standards** — hand it the diff command, the commit list, the standards files by path, and the smell baseline **pasted in full** (it has no other access to it). Brief: *"Report — per file/hunk where relevant — (a) every place the diff violates a documented standard: cite the standard (file + rule); (b) any baseline smell: name it and quote the hunk. Distinguish hard violations from judgement calls; a documented repo standard overrides the baseline. Skip what tooling enforces. Under 400 words. Do not spawn further agents — perform this review yourself."*
- **Spec** — hand it the diff command, the commit list, and the spec above (`spec.md` plus `decisions.md`; read `docs/features/<slug>/` if you need them unabridged). Brief: *"Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words. Do not spawn further agents — perform this review yourself."*

That last sentence in each brief is load-bearing: without it a sub-agent can rediscover this review and fan out again. Two sub-agents, one level deep, and that is the whole tree.

**Then triage what comes back.** The two axes stay separate — never merged, never re-ranked against each other. Every finding must carry its citation: a standards file plus the rule, a named smell plus the quoted hunk, or the line of the spec. **A finding with no citation is dropped, not softened.** Sub-agent output is a hypothesis, not evidence: before a finding becomes a note, open the file and confirm the hunk says what the sub-agent claims. A note the human cannot check costs them a fix ticket for nothing.

Each surviving finding becomes its own note — step 3.

### 2. Drive the app — when there is something to drive

Skip this whole step when the ticket says there is nothing to run. Otherwise:

**Boot the app.** Call `mcp__runcastle__review_drive({ action: "start" })`. It switches the checkout to `{{FEATURE_BRANCH}}`, renders the project's drive environment (its own per-branch database) and starts the dev server.

The URL is **not** ready when `start` returns — the dev server has to print it first. Poll `mcp__runcastle__review_drive({ action: "status" })` until `drive.devUrl` appears, waiting a few seconds between calls. Give it a couple of minutes before you conclude it is never coming.

A refusal is **final** — a dirty tree, or a drive the human is already running. Do not retry it in a loop. It no longer sinks the review, though: your code review already ran and still has to land. Write a note saying the drive could not start and why, say it again in the summary note and the digest, and carry on to step 6.

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

- **A recording failure never fails the review.** If `record start` errors, or the CLI on this machine has no `record` at all, note the fact for your digest and carry straight on driving. The notes are the deliverable; the video is evidence.
- **Always `record stop` where you stop the drive.** It belongs in the same cleanup as step 5, on every path including the failure one — a recorder you leave running outlives you, and its file may be unplayable.

**`@eN` refs go stale on any page change.** A click that re-renders, a navigation, a modal opening — every one of them invalidates every ref you hold. Re-snapshot after each, and act only on refs from the newest snapshot. Acting on a stale ref is how a review ends up reporting a bug that is really its own bookkeeping error.

Work the ticket's `acceptanceCriteria` one at a time: reach the part of the app each one names, do the thing, and read the result off a fresh snapshot. Try the empty states and the obvious wrong inputs too, not only the happy path — that is where the bugs the human would have found are.

### 3. Write one note per finding, as you go

`mcp__runcastle__add_test_note({ text: "..." })`, for findings from **both** steps — a cited Standards or Spec finding is a note exactly as a drive bug is.

Each note is one observation the human can reproduce without you: **what you did, what happened, what you expected**. For a drive finding, name the screen and the steps. For a code-review finding, name the file and the citation that came with it — the standard and its rule, the smell and its hunk, or the spec line — and say which axis it came from.

Keep them separate — **one note per finding** — because each one can be promoted to a fix ticket in a click, and a note bundling three findings makes a bad ticket.

Write notes as you find things, not in a batch at the end: a note you have sent survives an iteration that ends early, and one you were saving up does not.

### 4. Close with a summary note

One last `add_test_note` covering the pass as a whole: what the code review found per axis (counts, and the worst issue *within each axis* — never one winner across the two), which criteria you verified by driving and how, what you could not reach and why. This is the note the human reads first among the notes.

If some of this feature's implementation tickets failed — you are reviewing it anyway, on purpose, and the signature is a surface that is missing outright rather than misbehaving — say so here: the human must know they are reading a review of a partially-built feature.

### 5. Stop the drive

Only if you started one. `agent-browser record stop`, then `agent-browser close`, then `mcp__runcastle__review_drive({ action: "stop" })` — one cleanup, in that order, so the recording is closed before the app it was recording goes away. Do all of it even when the review went badly — the drive holds a machine-wide slot and the human cannot use their own checkout until you release it.

### 6. Write your digest — "What landed this lap"

At exactly:

`{{DIGEST_PATH}}`

**This is not a review log. It is the lap's summary, written for a human, and the review page renders it verbatim as the first thing they read.** They arrive at the review screen wanting one question answered — *what did this lap actually do?* — and you are the only agent in the burn that can answer it: you ran last, you hold the spec, and you have just read every commit and every hunk on the branch.

So write **prose**, roughly 10–15 lines, for a reader who has none of your context:

- **What the lap delivered**, in the language of the product, not the codebase. "The tickets ledger and the notes panel now group by lap, with prior laps collapsed" — not "modified TicketList.tsx and NotesPanel.tsx".
- **Synthesize, don't enumerate.** Not a ticket-by-ticket walk, not a changed-files list, not a commit log — those all exist elsewhere on the page. Say what the lap adds up to, and where the shape that landed differs from what the spec promised.
- **Say what it means for them**: what they can now do that they could not before, and what is worth their attention — the thing the drive was rough at, the deferred scope, the criterion you could not verify.
- **Plain sentences.** No headings, no bullet lists, no "I did X then Y", no tool names, no `<promise>` markers, no acceptance-criteria checklists. If it reads like an agent's log, rewrite it as something you would say out loud.

Findings belong in the notes, not here. One honest line about the headline problem is right; the catalogue is not.

Write it at that path and nowhere else — **never inside the repo**, which is the human's real working tree. This is the last thing you do before signalling COMPLETE.

## Could not review

The bar is now high, because the code review needs almost nothing: no app, no browser, no drive slot. Finding bugs is not failure, and **neither is a drive that would not start** — that is a note plus a line in the digest, and the review still delivered.

The review **failed** only when the code review itself could not run:

- the repository is unreadable, or the base ref cannot be resolved at all,
- there is no diff between the base and `{{FEATURE_BRANCH}}` and no branch to review.

When that happens: run the step 5 cleanup for whatever you got as far as starting — recorder, browser, drive — write **`{{BLOCKED_PATH}}`** — that path, not the repo — saying in one or two sentences precisely what stopped you, and print `<promise>COMPLETE</promise>`. Write no digest; the blocked file is your record. Do not write notes speculating about a feature you never saw.

## Hard rules

- **Never skip the code review.** It runs on every lap, whatever the ticket asks for and whether or not the app can be driven. A lap nobody reviewed is the silence this ticket exists to end.
- **Never edit the repo.** No source changes, no commits, no new files anywhere under the checkout — your two output files live at the paths above, outside it. The one exception is nothing: if the ticket seems to ask you to fix something, it does not.
- **Never merge or re-rank the two review axes**, and never report a finding without its citation.
- **Never let a sub-agent spawn more agents.** The guard line goes in both briefs, every time.
- **Never leave the drive — or the recorder — running.** Stop both on every path, including the failure path.
- **Never report a finding you did not observe.** Every note traces to something you saw in a snapshot, a response body, a test run, or a hunk you opened and confirmed. A plausible-sounding bug that is really a stale ref — or an unverified sub-agent claim — costs the human a fix ticket for nothing.
- **Never write the digest as a log.** It is the lap's prose summary and it is rendered verbatim to the human.
- **Stay inside this ticket.** Review what it names and the diff it landed. Adjacent things you notice go in the summary note, not into a sprawl of speculative findings.
