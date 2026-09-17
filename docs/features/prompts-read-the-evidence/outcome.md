# Outcome — Prompts read the evidence

The lap session reads the previous lap's review evidence and any 'not demonstrable' markers before it plans. In the 2026-09-14 post-mortem a lap session asked 'what are these tickets based on? did you test the app?' answered 'No, I moved too quickly to Burn' and burned one minute later; and the human was shown a lap-1 build whose own plan said 'no UI, nobody should demo this before ticket X'. Today the lap kickoff names carried notes and open defects (review-arrival-is-legible decision 7) but not the review artefacts themselves. Change the revisit/lap skill in packages/skills and the injected feature context so that before planning the session (1) reads the previous lap's review DIGEST.md and screenshots directory (~/.runcastle/reviews/<ticket>/) and the review outcome, (2) greps the spec and tickets for 'not demonstrable' / 'do not demo' / 'later laps' markers and says so to the human before offering a test drive, and (3) applies a 'stand on the failure' rule for every human-reported bug: reproduce it, or trace it to file and line, or declare it unreproduced and make reproduction the ticket's first acceptance criterion. Keep it prompt-side; no new gate. Tests: the rendered kickoff/context for a lap ≥ 2 includes the artefact paths, pinned beside the existing kickoff-registry tests.

- Shipped: 2026-09-15
- Laps run: 1

## What shipped

31 commits · 31 files

### Lap 1
- 7 tickets landed: #1 The lap session reads the previous lap's review evidence and any 'not…; #2 The tickets skill budgets parallelism explicitly. On a real project…; #3 Thin ticket contexts and degenerate imports warn at the Burn card,…; #5 The quick door warns on 100% of quick changes — goal-is-context is its own construction, so the new signal is always on; #6 The oversized docs-digest warning reaches no human: no Burn-card line, and the text is appended to a truncated row inside a collapsed panel; #7 looksLikePastedDocument flags well-formed long contexts — one bullet, three paragraphs, or a missing final period is enough; #8 The door and the Burn card check different ticket sets — the review ticket is excluded at one and included at the other
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 5c4811f898acdbf3d9898ec622299ea4b295bc0e
- Landed since: 4
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 06bd90f1f9b3a0254a635ddfa71c4a0bd66d64f1
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. The lap session reads the previous lap's review evidence and any 'not…

# Ticket 1 — the lap session reads the evidence before it plans

## What was done

A lap ≥ 2 is now handed the previous lap's review evidence by absolute path, in all three
channels that brief it, plus the two rules the post-mortem asked for.

- `packages/server/src/services/carried-work.ts` grew a third thing a lap carries:
  `reviewEvidence`, one entry per review ticket of lap `N-1` whose pass reached a terminal
  status (`done` / `failed`). Each entry states the ticket id and seq, the pass's status
  (the review outcome), `dir` = `~/.runcastle/reviews/<ticketId>/` (screenshots +
  `walkthrough.webm`) and `digestPath` = `<dir>/DIGEST.md`. Paths only — nothing is stat'ed,
  the same contract the existing test-notes / `## Later laps` pointers have.
- `lapKickoff` (`launcher/sessions.ts`) now names those paths in the line typed into the PTY,
  and adds two short clauses: grep `spec.md` and the tickets for "not demonstrable" / "do not
  demo" / "later laps" and say so *before* offering a test drive, and stand on every reported
  failure. Still a single CR/LF-free line (pinned by a test).
- The injected lap prompt (`launcher/artifacts.ts`, new `reviewEvidenceSection`) renders a
  `### Read the evidence before you plan` block: the evidence bullets nested under their
  review ticket, or a plain "left NO review evidence on disk" when the previous lap finished
  no pass, then the not-demonstrable rule and the **Stand on the failure** rule.
- `get_feature_context` carries `reviewEvidence` too (mcp/server.ts), because that is the call
  the lap session makes first and the payload already strips every ticket's `digest` — the
  reason the evidence had no channel at all before.
- `packages/skills/.../revisit/SKILL.md` Lap mode: context first, then a new move 2, **Read the
  evidence before you plan** (review evidence → what the human wrote down → what the docs mark
  as not demonstrable), and a new `### Stand on the failure` subsection (reproduced / traced /
  unreproduced-and-reproduction-is-the-first-acceptance-criterion) that move 6 now points at.
- Tests: a new describe in `packages/server/test/kickoff.test.ts`, immediately after the
  existing `kickoff registry + override` block, pinning the kickoff line, the injected prompt,
  the no-evidence and lap-1 cases, and that the skill still carries both rules. Two more in
  `carry-channel.test.ts` pin the same paths in the context payload.

No gate, no schema, no UI. Deviation from the ticket's wording: it named only the skill and the
injected context, and I also put the paths in the kickoff line and in `get_feature_context` —
the kickoff is what the acceptance criterion calls "the rendered kickoff", and the context
payload is where the session actually looks first.

## Surprises

- The review DIGEST is genuinely unreachable from a lap session today: `featureContext` strips
  `digest` off every ticket (`stripDigest`), and `get_work_record`, which does return digests,
  is gated shut for feature sessions. So "point at the path" was not a convenience — it was the
  only option, which is why the paths went into the payload as well as the prompt.
- `reviewDir` is *wiped and recreated on every re-burn* of the same review ticket, so the
  evidence is the latest pass's only. Scoping to lap `N-1` (not "any earlier lap") matters for
  the same reason older screenshots would show a UI that has since changed.
- `storeTickets` stamps a ticket with the feature's *current* lap, so the tests have to store
  the review ticket at lap 1 and then move the feature to lap 2 — the shape a Rethink leaves.
- The verify block's baseline is stale: this repo runs **252 test files / 3710 tests**, not the
  "118 files / 1768 passed" it lists.

## Pre-existing failures (not mine)

`bun run typecheck` is clean. `env -u GIT_ASKPASS bun run test` fails 10 tests in 2 files,
identically before and after my diff and unrelated to it:

- `packages/server/test/sandcastle-exec-failure.test.ts` (9) — `node_modules/@ai-hero` does not
  exist in this sandbox, so the patched `formatExecFailureMessage` import has nothing to load.
  An install fault in the environment.
- `packages/server/test/dev-pane.test.ts` (1) — "kills the child process tree": the process
  group is still alive after the kill in this container. Timing/PID-namespace dependent.

Neither file imports anything I touched.

## Drive machinery

Checked, not run. This ticket adds no service, no required env var, no seed and no process, so
`.runcastle/drive-setup.ts` / `drive-stop.ts` needed no edit and I made none. `reviewDir` is
read-only path computation under the existing data dir.

## Left undone

- `test-notes.ts` screenshots live under `~/.runcastle/annotations/` (note-keyed, they outlive a
  re-burn), and those are NOT in `reviewEvidence` — the ticket named the reviews directory, so I
  left them alone. A lap that wants a note's annotated frame still has to follow the
  `(screenshot: …)` suffix in `test-notes.md`.
- Nothing pins the *converge* path's equivalent wording; ticket 2 owns the tickets skill and
  will be the natural place to decide whether skill text gets its own test file rather than
  riding in `packages/server/test`.

#### 5. The quick door warns on 100% of quick changes — goal-is-context is its own construction, so the new signal is always on

# ticket(5) — the quick door stops warning about its own construction

## What was done

The per-ticket `goal-is-context` warning is gone. `quickChange` builds every typed
ticket as `{ goal: prose, context: prose }`, so `goalRepeatsContext()` was true for
every ticket that door has ever produced — the warning fired on 100% of quick
changes, including a careful one-sentence one, and the edit it prescribed ("write a
context that says where in the codebase the work is…") named a field the
quick-change overlay does not offer. That shape is now counted per *batch* only, by
the existing `degenerate-batch` line at >5, which is the part the human actually
chose and can act on.

One thing the ticket did not spell out but the criterion required: simply deleting
the warning would have handed the same repro to `thin-context`, because a
well-formed one-sentence prose is well under the 300-character floor. So a ticket
whose context *is* its goal is now skipped by the thin check too — it has no second
field to be thin, which is the door's construction rather than a thing to fix.
`pasted-document` still applies to every ticket regardless, since an oversized prose
is something the human typed.

Tests moved with the rule: the core suite pins that a lone goal-is-context ticket and
a batch inside the door budget both yield nothing; the quick-change suite pins the
repro (a one-sentence change now emits no `tickets.shape_warning` at all, and its
timeline is `feature.created / docs.scaffolded / tickets.stored /
feature.quick_change`); the web suite pins that the Burn card's note is `undefined`
for the same shape. The "spell out three, then count the rest" truncation coverage
was demonstrated on degenerate batches, which now produce a single line, so it moved
to thin contexts — the only per-ticket warning that can still repeat.

## Re-running the repro

Re-ran, and it no longer reproduces. The repro is executed literally by
`packages/server/test/quick-change.test.ts` — it calls `features.quickChange` against
a real sqlite DB and a real git repo with one well-formed sentence, and the assertion
now enumerates the full event stream with no `tickets.shape_warning` in it. Both doors
the repro names reach the same function: the MCP `create_feature({ tickets })` shape
calls `quickChange` at `mcp/server.ts:1321`, and the overlay calls it through
`trpc/routers/feature.ts:66`, so one fix covers both. The card half is
`resolveImplementation`, pinned in `apps/web/test/feature-ui.test.ts`.

## Surprises

- `bun run test` has one failure, `packages/server/test/dev-pane.test.ts > kills the
  child process tree so the port-holder is not orphaned`. It is **not** mine and not
  in the prompt's baseline: I confirmed it by restoring the base
  `packages/core/src/ticket-shape.ts` and running that one file, which fails
  identically. It spawns real PTYs and asserts a process group has been reaped —
  environmental in this sandbox. Everything else is green (3740 passed, 1 failed,
  4 skipped across 254 files). Note the prompt's baseline counts (118 files, 1768
  passed) are stale by several laps.
- The quick door's own review ticket was never at risk: it carries a long context
  distinct from its goal, so it produced no warning before or after.

## Left undone

- The `pasted-document` rule is still too eager in the other direction (one bullet,
  three paragraphs, or a context that merely ends without a full stop past 1500
  chars). That is a separate fix ticket from this same review, not mine.
- The docs-digest warning still has no Burn-card line. Also carded separately.
- Drive machinery: nothing to update — this change adds no service, env var, seed or
  process. I checked that `.runcastle/drive-setup.ts` and `.runcastle/drive-stop.ts`
  both exist as the server's commands name them; I did not run them (no services in
  this sandbox, as instructed).

#### 9. Verify the fixes that landed

Gates verification pass

Verified the four fixes landed after pass #4 by reading their focused diffs against the original findings on `feature/prompts-read-the-evidence`.

- #5 held: quick-change tickets whose goal and context are identical by construction no longer produce per-ticket `goal-is-context` or `thin-context` warnings. Batches over the quick-change budget still produce the actionable batch warning, and the timeline/card tests pin silence for a well-formed one-liner.
- #6 held: the pre-burn tickets and implementation bars now read the burner's digest byte count and surface the shared oversized-digest warning without disabling Burn. The timeline consumes `data.oversized`, opens when such a warning exists, and renders that message wrapped and warning-colored instead of truncating it.
- #7 held: after the 1,500-character guard, pasted-document detection now requires a Markdown heading. A bullet, numbered step, three paragraphs, or a final letter no longer triggers the warning; focused tests cover the reported repro shapes and preserve the heading-positive case.
- #8 held: core now centrally excludes review tickets from shape checking. The quick door passes the complete stored batch through that rule, and the Burn-card paths use the same warning function, so both surfaces inspect the same effective ticket set.

No verification findings were found, and nothing plainly broken appeared in the reviewed fix paths. This was the inherited Gates mode, so no Drive session or recording was started. The project has no configured verify commands; no gates were run.
