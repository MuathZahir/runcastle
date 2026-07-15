# TASK

Implement issue **#{{ISSUE_NUMBER}} — {{ISSUE_TITLE}}** on branch `{{BRANCH}}`.

Work on this issue ONLY. The full issue (body + comments) is below — you do **not** have
GitHub access, so everything you need is here:

<issue>
{{ISSUE_JSON}}
</issue>
{{RETRY_NOTE}}

# GROUND RULES

- You are on branch `{{BRANCH}}` in an isolated container. Commit your code changes here.
- Do **not** push, do **not** comment on or close the issue, do **not** touch the remote.
  The host handles merge, asset upload, comment, and close after you finish.
- The `.afk/` directory is scratch for this run — **never commit it** (it's gitignored).
- **Never commit `package-lock.json` / lockfile changes or `node_modules`.** The container
  installs platform-specific binaries; that churn must not reach the branch. Commit only the
  source changes your issue actually requires (`git add` specific paths, not `git add -A`).
- When everything below is done, output `<promise>COMPLETE</promise>`.

# SKILLS — use the right one for the job

- **tdd** — always, for the implementation. Red → green → refactor.
- **find-docs** (context7) — whenever you touch a library/SDK/API you're not 100% current on. Don't guess API shapes.
- **frontend-design** — any UI/visual change. Match the existing design system; keep it accessible.
- **diagnose** — if the issue is a bug, reproduce it first before fixing.

(Any other skill installed in the image is fair game — use what the task needs.)

# STEPS

> **You implement and commit. You do NOT take screenshots or run the app end-to-end** — a dedicated
> **Verifier** brings the whole feature up from the branch's stack and proves it in the browser once
> all of the feature's issues have landed. That removes the single biggest budget-waste (an agent
> chasing screenshots before committing). Your one job that makes work land is **committing**. Do the
> merge-critical steps; leave visual proof to the Verifier.

1. **Explore** the repo to understand the code paths this issue touches. Read the relevant
   tests and the surrounding modules. Use the project's own conventions.

2. **Implement** the acceptance criteria using **tdd**. Keep the change a thin vertical slice —
   exactly what the issue asks, no scope creep.

3. **Self-review** your diff: remove dead code, tighten names, drop redundant comments, make sure
   you didn't break adjacent behavior. Preserve functionality.

   **Typecheck YOUR code only — do NOT touch the baseline.** Many repos have a pre-existing red
   full-typecheck baseline (unrelated errors that are red on a clean checkout of the base branch,
   before you change anything). That baseline is **not yours to fix**. So:
   - ✅ Do typecheck the package/app you changed, scoped and fast (e.g. `cd <your-package> && npx
     tsc --noEmit`, or `npx tsc -p <your-app>/tsconfig.json`) and make sure **your** files are clean.
   - ❌ Do **NOT** run the full-monorepo typecheck. Do **NOT** `git stash` and re-count total errors
     to "prove" they're pre-existing. Do **NOT** fix baseline errors in files you didn't touch.
     Nothing re-runs the full typecheck after you, so don't sink time into the baseline.

4. **Write `.afk/summary.md`** — 4–8 lines for a human who will NOT read the code:
   what you built, key decisions/trade-offs, and the files you touched.

5. **Self-check YOUR OWN tests, then COMMIT.** Run only the tests you wrote or that cover your
   change — scoped and fast (e.g. `node --test --import tsx path/to/your.test.ts`, or your
   package's `npm test` if it's quick). Make them green. **There is no host gate** — the branch you
   commit is merged into the feature branch as-is, and the only check after you is a human reviewing
   the feature PR. So *your own tests are the safety net*: make your change genuinely work. **Do NOT
   run the full `npm run test --workspaces` suite** — it's slow and inherits the repo's pre-existing
   red baseline; just run your own scoped tests.

6. **Commit** your code changes with a clear message — specific paths only, **never** `.afk/`,
   `node_modules`, or lockfiles. Prefer a Conventional-Commit subject (`feat(scope): …`,
   `fix(scope): …`) — the changelog is generated from these. **Commit the moment your own tests
   pass — this is the most important step; never end your turn with uncommitted work.** The host
   merges from your commit; uncommitted work cannot be merged.

7. Output `<promise>COMPLETE</promise>`. (No screenshots, no dev-server, no end-to-end run — the
   Verifier owns all of that once the feature is complete. If your change is visual, just make sure
   the acceptance criteria in the issue are implemented; the Verifier will exercise them.)

# KEEP YOUR CHECKS SMALL AND IN THE FOREGROUND — NEVER POLL IN THE BACKGROUND

The single most common way a worker throws away good work: it launches a **slow** command (the full
test suite) as a **background** job, then burns its entire turn budget polling with `sleep` or
`until grep ... /tmp/*.out` loops — and the run ends BEFORE it commits. The work is done but
uncommitted, and **uncommitted work is lost.** This is why you run only your own scoped tests —
never the full suite.

- Run only **your own, scoped, fast** tests — synchronously, in the foreground, with a `timeout`.
  Wait for them to return; read the output directly.
- Do **NOT** start anything as a background task and poll a `/tmp/*.out` file. Do **NOT** `sleep` in
  a loop. Do **NOT** run the full `npm run test --workspaces` — nobody needs it; just your scoped tests.
- **Commit the instant your own tests pass (step 6).** Never end your turn with uncommitted changes.
  A committed imperfect change survives; an uncommitted perfect one does not.

# BAIL FAST ON ENVIRONMENT PROBLEMS — DO NOT RABBIT-HOLE

Your job is **this one issue**, not repairing the toolchain. The single biggest way you waste
time and tokens is grinding on infrastructure that isn't your fault. Don't.

**Tell the two apart:**
- **Caused by your change** (a test you broke, a type error in your code, your feature not
  working) → fix it. That's the job.
- **Pre-existing / environmental** — missing native binaries, the app won't install or boot, a
  broken dependency, a failure that exists on a clean checkout of the base branch too → **NOT
  yours to fix.** Quick sanity check: would `git stash` (dropping your changes) make the error go
  away? If yes, it's environmental.

**Scope:** bail is for when the environment blocks the **core work** — you can't install, can't run
your tests, the repo won't build at all. If you can run your own tests and they pass, you are NOT
blocked — commit and finish normally.

**When the core work is environmentally blocked, bail after AT MOST one or two quick attempts**
(a few minutes, not an hour). To bail:

1. Commit whatever real progress you made (specific paths only — never `node_modules`/lockfiles).
2. Write `.afk/blocked.json` with **`"category": "env"`** — this tells the host it's an environment
   problem, not your code, so it routes straight to a human and does **not** waste a retry on it:
   ```json
   { "category": "env", "reason": "one line — what's broken", "detail": "what you saw + what you tried" }
   ```
3. Write the same into `.afk/summary.md`.
4. Output `<promise>COMPLETE</promise>`.

The host will **push your branch and tag the issue for a human** — your partial work is kept, not
thrown away. Bailing early on a tooling problem is the **correct, expected** outcome. Spending an
hour and a chunk of the token budget fixing someone else's broken install is a failure, even if it
eventually works.

# IF YOU NEED A PRODUCT DECISION — ASK, DON'T GUESS

If the issue is **genuinely ambiguous about what to build** (a real product/UX/data decision the
acceptance criteria don't settle), don't guess and don't escalate the whole issue. Ask one crisp
question:

1. Commit any safe partial work (specific paths only).
2. Write `.afk/question.json`: `{ "question": "the one decision you need", "detail": "the options you see + your recommendation" }`.
3. Output `<promise>COMPLETE</promise>`.

The host posts your question to the issue and pauses it; when a human answers, AFK re-runs this
issue with their answer already in the issue comments. **Only for genuine decisions** — never for
something you can resolve by reading the code, and never for environment/tooling problems (those are
the bail path below). One question, not a conversation.

# IF YOU'RE STUCK ON YOUR OWN CODE

If the bug *is* yours but you genuinely can't get your tests green (hard or underspecified issue),
write what blocked you into `.afk/summary.md` **and `.afk/blocked.json` with `"category": "code"`**
(so the host gives the work one more automatic attempt with your notes as context, then routes it to
a human instead of merging it), commit what you have, and output `<promise>COMPLETE</promise>`. That
is a fine outcome — far better than committing code you know is broken as if it were done.
