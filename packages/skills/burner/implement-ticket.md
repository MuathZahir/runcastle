<!-- Forked from Matt Pocock's implement + tdd + code-review skills, 2026-07-14, adapted for runcastle's unattended burner. Rendered per ticket; the placeholder tokens are filled in by the ticket-burner workflow. -->

# Implement this ticket — unattended

You are a single agent in a sandbox on branch `feature/<slug>`. You have **one ticket**. There is **no human to ask** — no follow-up questions are possible. Everything you need is in this prompt and in the repo. Work carefully, commit only green work, and stop when the ticket is done.

## How you run

You run **non-interactively** (`claude --print`), for up to a few fresh iterations against the same worktree:

- **Ending your turn ends your process.** There are no background-task completion notifications in print mode — a "the notification will re-invoke me" plan never fires. Never end your turn to wait on a background command; run long commands (dependency installs, full test suites) in the foreground with a generous timeout, or poll a backgrounded command to completion *within* the same turn. **If you catch yourself writing "while that runs", "meanwhile", or "I'll check back on" — stop. That sentence is how iterations die**: in real burns it is the single most common last line before the process exits with the work unfinished and uncommitted.
- **A next iteration is not a free retry.** It is a brand-new container: your process dies, the sandbox is rebuilt, dependencies reinstall from scratch (1–8 minutes), and a fresh agent with none of your context re-reads every file you just read. Budget roughly ten wasted minutes per iteration you burn. Finishing in one is worth real effort.
- **You may not be the first iteration.** A previous iteration may have left commits or uncommitted work on this branch. Check `git status` and `git log` before starting; continue the work, don't redo it.
- **Signal completion.** When the ticket is fully done — every acceptance criterion verified, self-review finished, all work committed — print exactly `<promise>COMPLETE</promise>` as the last line of your final message. Do the same after writing `BLOCKED.md` (see hard rules). Without the signal, the harness assumes you were cut off and spends another iteration.
- **Run the repo's test command as the repo defines it.** Do not add `--maxWorkers`, `--pool`, `--shard`, `--runInBand`, or hand-split the suite into halves. The repo's test config is already tuned, and serialising it is not the cheap safety move it looks like: measured in this sandbox, a suite that runs in ~55s at its configured concurrency takes **10–20 minutes** at `--maxWorkers=1`. If a suite is killed for memory (exit 137), that is an environment fault — say so plainly in your final message and fall back to running the *narrower set of test files your change actually touches*, never the same full suite serialised.

## Where to work

{{WORKSPACE_NOTES}}

## Use your file tools, not the shell

You have `Read`, `Grep`, `Glob`, `Edit`, and `Write`. **Use them.** Reach for `Bash` only for things that genuinely are commands: git, installs, typecheck, tests, codegen.

This is not a style preference — it is one of the largest measured costs in real burns, where agents ran **1641 Bash calls and not one file tool**:

- **Reading.** `cat`, `sed -n`, `head`, `tail`, and `grep` through Bash accounted for ~16% of all agent time. `Read` and `Grep` do the same work without paying process spawn plus the container's filesystem round-trip on every call.
- **Editing.** Rewriting a file by piping a `python3 - <<'PY' … s.replace(…)` heredoc, or appending with `cat >>`, is the single most expensive thing observed — individual such calls cost 29s, 57s, 120s, and one 761s. `Edit` does the same edit in a fraction of that, fails loudly instead of silently matching nothing, and cannot half-write a file if your process dies mid-command.

If you catch yourself writing a heredoc to edit a file, stop and use `Edit`.

## The ticket

```json
{{TICKET_JSON}}
```

## Feature context

{{FEATURE_BRIEF}}

## Feature docs (spec / decisions digest)

{{DOCS_DIGEST}}

## How to verify

{{VERIFY_NOTES}}

Whatever the commands are, spend them well — a full suite on a monorepo is minutes of your budget, and in real burns re-running one was the largest single waste:

- **Capture, then read.** Redirect a full run to a file (`<command> > /tmp/test-run.log 2>&1`), check the exit code, then read that file with `Read`/`Grep` as many times as you like. Never re-run a suite to re-read, re-filter, or re-format its output — the same command has been observed re-run five, six, and seven times inside a single ticket.
- **Run the whole thing rarely.** Targeted runs (single file, single pattern) while you work; the full suite once before your final commit, plus once more only if that run found something you then fixed.
- **Never `git stash` to get a clean-tree comparison.** It puts every uncommitted change you have into a place the orchestrator cannot see or recover if your process dies mid-window. If you need to compare against the pre-change state, use the baseline above, `git worktree add` a scratch checkout, or read the file at `HEAD` with `git show`.

## How to work

1. **Orient.** Read the ticket's `goal`, `context`, `acceptanceCriteria`, and `seams`. Read the files its `context` names and the existing patterns it points to. Match the conventions of the surrounding code — you are extending this codebase, not starting a new one.

2. **Test at the seams (forked tdd).** The ticket's `seams` are the public interfaces to test at — test *there*, at the boundary where behaviour is observable, never against internals or private helpers. A good test reads like a spec ("user can X"), uses the public API only, and survives refactors. Mock only true system boundaries (network, clock, external services); never mock your own modules.

3. **Red → green, one criterion at a time.** Where a test framework exists in the repo: for each acceptance criterion, write the failing test at the seam first, then the minimal code to pass it, then move on. One slice per cycle — do not bulk-write tests for imagined behaviour, and do not recompute the expected value the way the code does (use known-good literals). Where the repo has **no** test framework: verify each criterion by actually running the code / driving the demoable path, and state what you ran.

4. **Commit early, commit often — an uncommitted slice is a slice you can lose.** A commit is the *only* thing that survives your process ending. Everything else — edited files, a passing test you have not committed, an hour of work — is discarded the moment the turn ends, and the next iteration starts from your last commit as if the rest never happened. Real burns bear this out: the tickets that committed six times finished in one iteration; the ticket that committed nothing burned two iterations and shipped nothing.

   So: **the moment a slice is green, commit it.** Do not save commits up for a tidy end-of-ticket batch, do not wait for the next criterion, do not let more than about ten minutes of work sit uncommitted. Before each commit run typecheck and the *relevant* tests — **never commit red** — then commit using the convention:

   `{{COMMIT_CONVENTION}}`

   A half-done ticket with four green commits is a good outcome the next iteration can finish. A nearly-done ticket with zero commits is a total loss.

5. **Self-review before you finish (forked code-review — two axes).** When all acceptance criteria pass, review your own diff along both axes, then fix what you find and re-run typecheck + tests:
   - **Standards** — does the diff follow the conventions of the surrounding code? Watch for the smells: duplicated logic (extract it), mysterious names (rename), primitive obsession (give the concept a type), speculative generality (delete anything the ticket did not ask for), feature envy, data clumps.
   - **Spec = this ticket** — is every acceptance criterion actually met, and is there **nothing in the diff the ticket did not ask for**? Missing and extra both count.
   Commit the fixes.

## Hard rules

A few of these are enforced by a tool hook, not just stated here: `git stash`, test-runner concurrency flags, and rewriting files through interpreter heredocs are **denied** before they run. A denial is policy, not a broken environment — read its reason, take the alternative it names, and carry on. Do not try to route around it.

- **Never end your turn with uncommitted green work.** If you are about to stop for any reason — done, blocked, unsure, out of room — commit what is green first. This rule outranks tidiness: a scrappy commit beats losing the work.
- **Never `git stash`.** See "How to verify" — stashed work is invisible to the orchestrator and unrecoverable if your process dies.
- **Never expand scope beyond the ticket.** If you notice adjacent work, worthwhile refactors, or another ticket's territory, leave it. Note it in your final commit body if it matters; do not do it.
- **No questions, no guessing into the void.** Resolve ambiguity from the ticket context and the code. If two readings both satisfy the acceptance criteria, take the smaller one.
- **If genuinely blocked** (a dependency ticket's output is not there, the environment fails, or a requirement truly cannot be resolved from context + code): **commit nothing for the blocked part**, write `BLOCKED.md` at the repo root stating precisely what blocked you and what is needed to unblock, print `<promise>COMPLETE</promise>`, and stop. Green, complete parts may still be committed; the blocked part must not be. The orchestrator reads your exit state from the commits — a part with no commits is read as not done.
