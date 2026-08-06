# runcastle E2E — findings log

Environment: `bun run dev` against `~/.runcastle-dev`, fresh tree (wizard replayed,
git identity cleared). Test repo: `C:\Users\user\Projects\_scratch_\notesapp`
(Bun + Hono + Drizzle + Postgres in Docker `rc-e2e-pg` on :5433). Model: `claude-opus-5`.
Windows 11, Docker Desktop 28.5.2, Claude Code 2.1.220.

## What was actually run

| Step | Result |
|---|---|
| First-run wizard (git identity → AFK token → open repo) | passed, 3 paper cuts |
| Project preparation, 8 facts | all 8 established, 4 dry-run verified |
| Database-per-branch, proposed and proved by prep | **works** |
| Feature 1 "Tags on notes": grill → spec → 4 tickets | passed |
| AFK burn ×4 tickets | 4/4 done, 15 commits, 29 min |
| Test drive on its own database | **works** |
| Merge & ship | passed |
| Feature 2 via Quick change → burn | 1/1 done, 6 min |
| Deliberate merge conflict on the same line | detected correctly |
| "Resolve with agent" | **broken — F18** |
| `Iterate` → lap 2 → re-burn → merge | passed, conflict resolved correctly |

Two features shipped to `main`. Nineteen findings, three high — and **two of the three high ones
are the same one-line defect**: `Bun.serve` is created without an `idleTimeout`, so every
long-lived or slow connection is culled at 10 seconds. That kills the SSE live-update stream 15
seconds before its own keepalive can fire (F14) and drops slow tRPC/MCP calls mid-flight (F11).

Corrections after review: **F14** was originally filed as "session invisible until reload" — wrong,
and re-measuring it is what exposed the `idleTimeout` root cause. **F16** was originally filed as
"shipping a migration breaks your dev database" — withdrawn, that one was my mistake.

---

## F1 — AFK token card contradicts itself after a successful capture (medium)

Wizard → AFK burns → paste token → **Save & verify** returns
`✓ token captured to ~/.runcastle/.env`, but the row above it keeps its amber dot and
`no CLAUDE_CODE_OAUTH_TOKEN — AFK burns cannot authenticate`. It never turns green,
even after `doctor.refetch()` (the card *does* refetch — the probe itself is wrong).

Root cause: `packages/server/src/trpc/routers/setup.ts:29` calls `runDoctor` without an
`env`, so `afkTokenProbe` (`packages/server/src/doctor/doctor.ts:258`) reads the server's
`process.env`, which was snapshotted at boot. `packages/server/src/doctor/cli.ts:22-29`
does merge the data-dir `.env` — the tRPC path doesn't.

Burns themselves are fine (`ticket-burner.ts:2228` reads the file first), so this is
"alarming but harmless" — which is exactly the wrong thing to show a first-run user who
just did the step correctly. Fix: pass the file-merged env into `runDoctor` from the
router (reuse the `cli.ts` merge helper).

## F2 — Token-capture messages hardcode `~/.runcastle/.env` (low)

`packages/server/src/services/setup.ts:299,306,321,327` all say `~/.runcastle/.env`
literally, while the write goes to `envPath()` (the real data dir). In dev it printed
`~/.runcastle/.env` and wrote `~/.runcastle-dev/.env`. Same for
`doctor.ts:270` and `ticket-burner.ts:79`. Anyone with `RUNCASTLE_DATA_DIR` set is told
to edit the wrong file.

## F3 — Git-identity step disables Continue with no reason shown (low)

Typing `not-an-email` leaves **Continue** greyed with no inline error. Classic dead-button
confusion; one line of "that doesn't look like an email" fixes it.

## F4 — AFK token is rendered in plaintext (low)

`#afk-token-input` is a plain text input. Local app, so not severe, but a `type=password`
with a reveal toggle is the norm for a credential.

## F5 — `Run claude setup-token` terminal is never torn down (low)

After **Save & verify** succeeds, the embedded terminal is still sitting in a live OAuth
prompt with no cancel/dismiss affordance, and the wizard moves on around it. Worth
either killing the PTY on a successful capture or giving the terminal a close button.

## F6 — Preparation double-consents every command (medium, biggest UX friction so far)

The prepare session's generated `settings.json` allows only the runcastle MCP tools and
read-only git. Everything else prompts. So the flow is:

1. runcastle's own question form asks *"Can I run the read-only verify batch now —
   `bun install`, `bun run typecheck`, `bun test`?"* → user picks **Yes, run them**.
2. Claude Code then prompts for permission on **each** of those commands anyway.

I hit 5 tool-permission prompts before reaching for "Yes, and don't ask again", on a repo
with 16 files. The landing copy says *"It runs on your machine, and asks before touching
anything stateful"* — which reads as a promise that non-stateful things won't ask.

The consent the user already gave in the runcastle form should propagate. Options: seed
the prepare session's allowlist with the repo's own scripts once the user says yes, or
instruct the prep agent to request the "don't ask again" variant for its read-only batch.

## F7 — `driveEnv` has no `{{port}}` variable, so drives can't get a port each (medium)

`driveVars()` (`packages/server/src/services/drive-env.ts:59`) exposes only
`slug`, `branch`, `id`. Database-per-branch is fully solved by that; **port**-per-branch
is not. The prep agent hit this directly and had to ask me to choose between
"one drive at a time" and "pin a fixed PORT", because there is no way to express
"give this drive a free port". Any project whose dev server takes a fixed `PORT` can
therefore only ever have one test drive up. README already promises "you test drive the
branch **on its own port**".

## F8 — `dev:tool onboarding git clear` refuses to run before the dev DB exists (low, dev-only)

It aborts with *"no dev database yet … start it once with `bun run dev`"* even though
clearing a host-wide git identity has nothing to do with the DB. Also `dev:tool reset`
deletes `dev-saved-git-identity.json` while leaving the host identity cleared, so a
reset between `git clear` and `git restore` loses the saved values.

## F9 — A live prep session waiting on the user is invisible from the project view (medium)

Once all 8 keys are recorded, `prepRailRow` (`apps/web/src/lib/project-workspace.ts:174`)
flips to **"Re-prepare the project" / "See what was established … or establish it again"** —
purely a function of `prepared/pendingCount/staleCount`. It has no notion of "a preparation
session is live and is asking you a question right now".

I hit exactly that: prep had recorded all 8 keys and was mid-question ("Run the dry-run drive
now?"), and the workspace showed the generic *"Select a feature to begin"* empty state with a
rail row that reads *done*. Nothing on screen said a session was waiting. A user would walk away
believing preparation had finished.

## F10 — runcastle's own db-per-branch recipe is POSIX-only and breaks on Windows (high)

The prep prompt hands the agent this template verbatim
(`packages/server/src/launcher/artifacts.ts:420-421`):

```
driveSetupCommand:  createdb "$DB_NAME" && npm run migrate
driveStopCommand:   dropdb --if-exists "$DB_NAME"
```

But drive hooks run through `hookSpawnTarget` (`packages/server/src/services/drive-hooks.ts:77`),
which on Windows is `cmd.exe /d /s /c`. `cmd.exe` does not expand `$VAR` — it passes it through
literally. Hook command strings are **not** `{{}}`-rendered either (only `driveEnv` *values* are,
`drive-env.ts:123`), so there is no portable way to write this.

Observed end to end: the agent proposed the documented shape, the dry run ran it, and Postgres
ended up with a database **literally named `$DB_NAME`**:

```
$ docker exec rc-e2e-pg psql -U postgres -Atc "select datname from pg_database"
$DB_NAME
notesapp
postgres
```

…while the real per-drive database was never created, so every `/api/notes` request 500'd.
Database-per-branch is therefore broken out of the box for every Windows user who follows
runcastle's own example. Fix options: make the prompt's example platform-aware (`%DB_NAME%` on
Windows), render `{{id}}`/`{{slug}}` into hook commands too, or host hooks in a shell with
consistent expansion.

Credit where due: **the dry run is what caught this.** "Preparation proves its findings" did
exactly its job — the keys were left unverified rather than recorded as working.

## F11 — `Bun.serve` has no `idleTimeout`, so any request over 10s is dropped (high)

`packages/server/src/index.ts:105` calls `Bun.serve({ port, fetch, websocket })` with no
`idleTimeout`, so Bun's 10-second default applies to every HTTP request — `/api/trpc` and
`/mcp` alike. Meanwhile `DRIVE_HOOK_TIMEOUT_MS` is deliberately **10 minutes**
(`drive-hooks.ts:24`), i.e. the transport budget is 1/60th of the work budget it has to carry.

Proven with a minimal probe (`Bun.serve` + a 15s handler, no `idleTimeout`):

```
$ curl -m 30 -w "HTTP=%{http_code} time=%{time_total}" http://localhost:4599/
HTTP=000 time=12.008742
[Bun.serve]: request timed out after 10 seconds. Pass `idleTimeout` to configure.
handler finished (still running after 15s)
```

The client's connection is killed at 10s; the handler keeps going. That is the worst shape —
the caller reports failure while the side effects still land. The same warning line appears in
runcastle's own dev log at boot.

Observed symptom, reproduced twice: the prep agent's `dry_run_drive` `stop` call reported
**"Stop timed out and the pane is still live"**, the drive banner stayed on *"Preparation dry-run
in progress"*, and the dev server kept port 3000. Clicking **Stop** in the UI afterwards tore
everything down in ~1s and stamped four keys verified — so the drive machinery is fine and the
call path is what broke. The prep agent reached the same conclusion independently:

> *"Clean baseline: no orphan process, port 3000 free, only notesapp remains. **The earlier
> timeouts were on the tool call; the teardown did complete behind them.**"*

**Update — narrowed to the in-session MCP client.** I called the identical tool myself:

```
$ curl -X POST http://localhost:4512/mcp -d '{"method":"tools/call",
    "params":{"name":"dry_run_drive","arguments":{"action":"stop"}}}'
{"result":... "teardown":{"ok":true,"exitCode":0} ...
 "verified":["devCommand","driveSetupCommand","driveStopCommand","driveEnv"]}
[HTTP=200 time=0.178618]
```

**178 ms**, clean teardown, all four keys stamped. So the server, the handler and the drive
machinery are all fine — the call from the session's own Claude Code MCP client never arrives.
The agent proved the same from its side: *"the stop hook never ran at all — the stop is hanging
before it"*, having checked that the temp DB was still present and its `--force` stop hook would
have dropped it regardless of open sessions. Reproduced 3× in one session; the UI Stop and a raw
curl both work every time. The missing `idleTimeout` is the most likely culprit (a dropped
keep-alive socket the client then hangs on) but I did not instrument the client to confirm.

"Client reports failure, side effects land anyway" is exactly the shape the probe above produces,
and it drove the agent to re-run work it had already done. Caveat on attribution: my harness was
auto-answering permission prompts in that terminal, so I can't rule it out as a confounder for
the two timeouts specifically — but the missing `idleTimeout` is proven independently and is
worth fixing regardless. Any project whose `driveSetupCommand` takes over 10 seconds
(`docker compose up`, a cold migration) hits the same ceiling on an ordinary test drive.

## F12 — The word "verified" means two different things, on the same row (medium)

`PreparationWorkspace.tsx:386` renders the **source** badge as the literal word `verified` when
`source === 'session'` ("established in a conversation on your own machine"). `VerificationBadge`
(`:326`) separately renders `verified` / `unverified` for the four drive-loop keys, meaning "a dry
run actually ran this and it worked".

So the UI shows **"Setup command · VERIFIED"** for a key whose `verified_at` is `NULL` and which
no dry run can ever prove. I read that badge as proof, and had to go to the database to find out
it wasn't:

```
setupCommand   | session | verified: no      <- UI says VERIFIED
driveSetupCommand | session | verified: yes  <- UI says verified, and means it
```

Rename the source badge (`measured here`, `on your machine`) so the one word that means "proven"
only ever means that.

## F13 — Re-recording a key silently drops its verification stamp (low)

`driveStopCommand` was stamped verified at 23:47:52, then the agent adjusted the command at
23:48:02 and the stamp went back to unverified with nothing said about it. That is arguably
correct behaviour (the new string is unproven), but from the UI it reads as a badge that
mysteriously vanished. Worth an explicit note in the prep view: *"changed since it was
proven — re-run the dry run"*.

## F14 — The live-update stream is killed by its own server before its heartbeat can fire (HIGH)

**Corrected.** My first write-up of this said "a launched session is invisible until you reload".
That was wrong — it does appear on its own. Re-measured cleanly, polling the DOM every 2s with no
reload:

```
+0s … +28s   "No session yet"
+31s         card visible, terminal rendering
```

Against the server's own event log for the same click:

```
12:36:39.391  session.launched   (embedded terminal spawned)   +1s
12:36:40.689  session.started    (session live)                +2s
12:36:42.562  session.kickoff    (briefing sent)               +4s
```

So the session was live in **2 seconds** and the UI showed it at **31**. That 31 is not spawn time
and it is not a coincidence: it is `LIVE_SAFETY_POLL_MS = 30_000` (`apps/web/src/lib/live.ts:62`),
the fallback tick queries back off to *while the SSE stream is believed to be up*. Push delivered
nothing; the safety poll did all the work.

**Root cause, and it is the same defect as F11.** `packages/server/src/routes/stream.ts:30` sets
`HEARTBEAT_MS = 25_000` — an idle `ping` "to keep proxies from reaping the connection". But
`Bun.serve` in `index.ts:105` sets no `idleTimeout`, so Bun's own 10-second default reaps the
stream first. Measured:

```
$ curl -sN http://localhost:4512/api/stream -w "[closed after %{time_total}s]"
event: ready
data: {}
[closed after 9.873622s]
```

The keepalive can never fire — it is 15 seconds too late. So `/api/stream` runs a permanent
~13-second cycle of connect → `ready` → reaped → EventSource reconnects, and **every signal
published during a gap is lost**. Because `ready` triggers a full invalidate, the UI does converge
— which is exactly why this reads as "slow" rather than "broken", and why it survived to release.

One line fixes this and F11 together: give `Bun.serve` an `idleTimeout` above the heartbeat (and,
for the drive hooks, above their 10-minute budget). Everything downstream — session cards, run
progress, the drive banner, MCP tool calls — gets its realtime back.

Related, unaffected by the above: every feature gets a fresh worktree path, so **a feature's first
session can stop on Claude Code's folder-trust prompt**. runcastle handles it well once visible
(a banner explaining it plus a **Send briefing** button), but pre-registering worktree paths as
trusted would remove one blocking step.

## F15 — Burn agents get no database; one spent minutes building its own Postgres (medium)

`driveEnv` / `driveSetupCommand` are host-only — the burn sandbox never sees them. notesapp's
verify commands don't need a database, but the burn agent decided to prove the migration anyway,
and with no Postgres and no root in the container it went and did this:

> *"No local Postgres, no root. Let me fetch a self-contained Postgres binary into /tmp (tooling
> only, not a repo dependency) so I can genuinely verify the migration"* — then downloaded
> `@embedded-postgres`, symlinked its shared libraries by hand, booted **Postgres 18.4** in the
> sandbox, and simulated the pre-tags → post-tags upgrade.

Impressive, and it worked, but it is minutes of unbilled detour per ticket that touches schema —
and a project whose `verifyCommands` genuinely need a database has no supported answer at all.
Worth deciding explicitly: either give the sandbox a disposable database the same way drives get
one, or say in the burner prompt that database-backed verification is out of scope in the sandbox.

## F16 — WITHDRAWN as a bug; one real inaccuracy next door (low)

**My original claim was wrong.** I wrote that "shipping a migration leaves your own dev database
broken, silently" and framed it as runcastle's fault. It isn't. With `driveEnv` set, migrations
only ever run against the per-drive temp database; the dev database is never touched. It is stale
after shipping for the same reason it is stale after any `git pull` — main moved — and running
`bun run db:migrate` is the developer's job. Nothing silently broke; I merged, then ran the app
without migrating, and blamed the tool for it.

What survives is a nicety, not a defect: at the moment of **Merge & ship** runcastle knows a
migration just landed (it is the same migration-path diff `detectDbDrift` already computes, against
pre-merge main) and it is holding a `dbResetCommand` it collected for exactly this shape of repair.
Offering *"main just gained 1 migration — rebuild your dev database?"* would be a cheap courtesy.
Optional, and reasonable to decline.

**The real thing, which is the inverse of what I claimed.** `detectDbDrift`
(`packages/server/src/services/git.ts:1983`) has no `driveEnv` condition — it fires purely on
"do these two branches differ by migration files" — and its message asserts:

> *"anything you migrated during the drive **is still applied to your dev database**, so the next
> migrate on `main` may report drift."*

That sentence is true for a project with no `driveEnv`, where the drive shares the dev database by
design (`pty/dev-pane.ts:80` — *"Defaults to this process's [env], which is what makes a drive
share the developer's dev database"*). It is **false** for a db-per-branch project: the drive used
a temp database that the stop hook then dropped, so nothing was applied to the dev database. So
the warning fires with a claim that is the opposite of what happened, and points at
`dbResetCommand` — a destructive rebuild — to fix a problem that does not exist.

Caveat on evidence: this is from reading the code, not from observation. I merged while the drive
was still live, so I never saw a drive-stop drift banner in this run. Worth either gating the
check on `driveEnv` being unset, or rewording it to describe the branch difference rather than
asserting what happened to the database.

## F17 — Nothing tells you a 29-minute burn has finished (medium)

The burn ran 00:13 → 00:42 (4/4 tickets, 15 commits) and then parked at the review gate — which is
correct. But `notify off` is the default in the status bar, so a burn you deliberately walked away
from ("AFK burns are a burn you walk away from", per the wizard's own copy) ends in silence. The
product's whole premise is that you leave; the one moment it needs to reach you is unarmed by
default. Notifications should be on by default, or the first burn should offer to turn them on.

## F18 — "Resolve with agent" cannot resolve anything: its own hook denies the write (HIGH)

This is the headline bug. Agent-assisted conflict resolution is on the README's front page, and
it is structurally impossible to complete.

**What happens.** `Merge & ship` hits a conflict → the card offers **Resolve with agent** → a
`revisit` session launches in the talk worktree with this briefing
(`apps/web/src/lib/feature-ui.ts:459`):

> *"Run `git merge main`, then resolve every conflict using this feature's spec.md and
> decisions.md for intent, **and commit the merge**."*

But every session except `project` carries the talk-session edit guard
(`packages/server/src/launcher/edit-guard.ts:36` — `guardsEdits(kind) { return kind !== 'project' }`),
which **denies** `Edit`/`Write` to anything outside `docs/features/<slug>/`. `revisit` is not
exempt. So the session is ordered to edit `public/index.html` and then forbidden from doing it.

The agent's own account:

> *"Resolving that means editing `public/index.html`, and **a hook denied the write: talk sessions
> may only write this feature's docs.** That's enforced, not advisory, so I aborted the merge
> rather than reach for git plumbing to do the same edit — a merge commit assembled that way would
> be the identical prohibited change wearing a different hat."*

It behaved impeccably — refused to route around the guard, left no half-merged state, wrote the
reasoning into `decisions.md`, and emitted a ticket to carry the merge instead. But the feature
as designed never works.

**And then the user is stuck.** After that, the review screen offers: `Merge & ship` (disabled),
`Start test drive`, `Iterate`, and `Resolve with agent` (which will fail identically). The pending
ticket the agent just wrote — *"#2 Merge main and resolve the h1 conflict"* — **has no Burn button
anywhere on the screen**, even though the summary reads `tickets 1/2 done`. The only way forward
is `Iterate`, which restarts the whole feature at lap 2.

The same defect hits the other conflict path: `ticketConflictKickoff`
(`feature-ui.ts:493`), the "Resolve in terminal" escape hatch for a failed ticket landing, gives
a `revisit` session the same instructions and the same guard.

**Fix shape:** let the guard allow writes to paths git reports as conflicted
(`git diff --name-only --diff-filter=U`) for the duration of a conflict-resolution revisit, or
exempt revisit sessions launched with a conflict kickoff. Also give the review screen a Burn
affordance whenever the feature has pending tickets.

## F19 — `.sandcastle/worktrees/` is written into your repo and is not gitignored (medium)

A burn creates `.sandcastle/worktrees/runcastle-ticket-<slug>-N-<id>/` **inside the project repo**
and nothing adds it to `.gitignore`. I ran an ordinary `git add -A && git commit` on main while a
burn was running and git swept a nested repository into the commit:

```
warning: adding embedded git repository: .sandcastle/worktrees/runcastle-ticket-note-count-in-th-1-tVG6pcRG
$ git show --stat --name-only HEAD
.sandcastle/worktrees/runcastle-ticket-note-count-in-th-1-tVG6pcRG
public/index.html
```

`git add -A` is not exotic — it is what the burn agents themselves run every ticket. runcastle
should append `.sandcastle/` to the project's `.gitignore` when it first burns, or place the
worktrees outside the repo (it already owns `~/.runcastle/worktrees/`).

## Minor paper cuts

- The session chip keeps reading `ideation` while the phase advances to `spec` and `tickets` in
  the same window. It labels how the session was launched, not what it is doing.
- **"Burn 3 tickets"** when one of the three is already `done` — the label counts all tickets, the
  run only burns the 2 pending ones. Same for "Burn 4 tickets" wording generally.
- The yellow *"This terminal has not reported ready"* banner stays up after the terminal is
  visibly working through its briefing.
- The wizard's step rail (`Git identity · AFK burns · First project`) disappears on the last step,
  so the one step with no progress indicator is the one where you are picking a repo.
- The prep session's `Established` list vanishes from the workspace the moment prep ends — there
  is no "here is what I learned" moment; you have to go back in through the rail row to see it.

---

## Things that worked notably well

- Welcome → git identity → AFK → first project reads cleanly; each step explains *why*.
- The AFK card's live probes (Docker version, image present) are exactly right.
- Repo picker marks git repos with a `GIT` badge and the "not a git repository" error
  names the folder and hands you `git init`.
- Preparation is genuinely impressive: it read the repo, ran `docker ps`, noticed
  `createdb`/`dropdb` weren't on PATH, and proposed `docker exec rc-e2e-pg createdb …`
  plus `DATABASE_URL=…/notesapp_{{id}}` — i.e. it derived database-per-branch unprompted.
- **Database-per-branch works, end to end.** Starting the test drive created
  `notesapp_tags_on_notes`, ran the migrations into it, pointed the dev server at it, and left the
  real `notesapp` untouched. Stopping the drive dropped it. This is the part I expected to be
  fragile and it was the most solid thing in the run.
- **The burns produced correct, spec-conformant code.** 4/4 tickets in 29 min and 3/3 in 6 min,
  no failed tickets, no manual intervention. I clicked through the shipped feature: chip bar with
  unconditional counts, per-row inline tag editing, multi-select AND filtering, `#tag=work` in the
  URL, add-form pre-filled from the active filter, `clear` link — every acceptance criterion the
  spec named, working.
- The merge dialog's **"what lands"** panel (commits / run / test drive taken) is the right three
  facts before an irreversible click.
- A failed merge leaves the user's checkout **completely clean** — no half-merged state to dig out
  of, and the guarded switch put me back on `main` with a clean tree after every drive.
- **Laps (`Iterate`) are excellent.** Lap 2 read what lap 1 had actually left on the branch,
  noticed the pending merge ticket from lap 1 was still real work, and did *ticket surgery* —
  updating that ticket's acceptance criteria rather than emitting a duplicate.
- The **burn** path resolves merge conflicts correctly (2 min, 4 commits) and produced exactly the
  resolution the earlier session had reasoned out in `decisions.md`:
  `<h1>notesapp <span id="note-count"></span> <small class="subtitle">your notes, tagged</small></h1>`
  — both sides surviving, count first.
- Grilling quality was high throughout. It read the codebase before asking anything, and its first
  question was the one that mattered: *"there is currently no way to change an existing note, so
  'tag a note' implies either tagging at creation time only, or building an edit path that doesn't
  exist yet."*
- It refused to record `driveEnv` until it had *proved* that a process-env `DATABASE_URL`
  beats a `.env` file under Bun, and it caught its own `$?`-captures-`tail`'s-exit-code
  mistake without being told.
- The multi-question form (tabs + review-before-submit) is a good pattern.
