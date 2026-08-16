# Outcome — Preparation supports multi-service projects

Extend the prepare/drive machinery beyond one database: redis namespacing, docker-compose per-branch project names and ports, health-waits, a {{port}} variable, hosted-DB affordances.

- Shipped: 2026-08-16
- Lap: 1

## 1. Drive contract: RUNCASTLE_* identity in, .runcastle/drive.env out; driveEnv retired

# Ticket 1 — drive contract: `RUNCASTLE_*` in, `.runcastle/drive.env` out

## What was done

The drive's environment contract is now the one decision 6 describes. The server passes
`RUNCASTLE_SLUG` / `RUNCASTLE_BRANCH` / `RUNCASTLE_ID` as plain env vars into the setup hook; after
the hook returns (success or not) it reads `<repo>/.runcastle/drive.env`, parses it leniently, and
overlays identity + file vars onto the dev pane and — re-read at stop time, before the branch switch
— onto the stop hook. The file is deleted after teardown, before the carried-changes capture, so no
untracked artifact rides back to the branch you return to or denies the next start. One
`testdrive.env` event per drive records key names only. `drive-env.ts` keeps `identifierSafe` and the
KEY=VALUE parser (now `parseEnvFile`, no rendering) and gains `driveIdentityEnv`;
`renderTemplate`/`driveVars`/`PLACEHOLDER_RE` are gone.

`driveEnv` is removed end to end: `Project`, `PREPARED_KEYS`, `DRIVE_LOOP_KEYS` (now three), the
`projects.drive_env` column, the settings service, and the web settings lib/UI. Migration 0023 drops
the column and deletes `project_findings` rows with `key='driveEnv'`, which would otherwise fail the
`PreparedKey` parse in the findings listing. The dry run lost `envUnknowns` and the `driveEnv`
observable; `envKeys` now reports what `drive.env` carried.

Deviations from the ticket, both small: `driveIdentityEnv` lives in `drive-env.ts` (it is the direct
replacement for `driveVars`, and `identifierSafe` is already there) rather than being built inline in
`git.ts`; and the dry-run state no longer carries a resolved `env` at all, since both hook phases now
read the file at the moment they run.

## Surprises

- **`DriveCapabilities.env` in the web lib had to go too.** It read `set('driveEnv')`, so leaving it
  would have permanently reported `false` while the review page still promised "the branch gets its
  own database name". That pulled in `vocabulary.ts` and `vocabulary.test.ts`, which the ticket did
  not list.
- **`apps/web` typecheck is green here.** The brief lists three pre-existing errors in
  `EnableAfkCard.tsx` / `SettingsOverlay.tsx`; `bun run --filter '@runcastle/web' typecheck` exits 0
  on this branch, and the root `typecheck` script does filter web. That note looks stale.
- **One test fails and it is not this ticket's.** `dev-pane.test.ts > kills the child process tree so
  the port-holder is not orphaned` fails on a full run AND alone. My diff touches no file under
  `src/pty/`, `services/events.ts` or `test/helpers/` — the code path it exercises is byte-identical
  to the branch base — so this reads as the sandbox not reaping the process group (`kill -0 -pgid`
  still succeeding on zombies). Everything else: 1660 passed.

## Left undone

- The prep prompt in `launcher/artifacts.ts` still teaches `driveEnv`, `{{slug}}/{{branch}}/{{id}}`
  and the "five host keys" framing — ticket 3's territory, deliberately untouched. Two tests in
  `prepare-session.test.ts` still assert that wording; they will need rewriting with the prompt.
  I only changed the `remainingKeys` arrays there, which no longer typecheck with `driveEnv`.
- Nothing writes a `.gitignore` entry for `.runcastle/drive.env` in a prepared project; deletion at
  stop covers the dirty-tree case, but a drive killed mid-flight (server crash) leaves the file. The
  prep prompt telling agents to gitignore it is ticket 3's.
- The dev pane's copy of the overlay is untested at the seam because those tests are PTY-gated; it
  receives the identical env object the stop hook is verified against.

## 2. Open app waits for the app: readiness poll and starting state

# Ticket 2 — Open app waits for the app

## What was done

The server now polls a sniffed dev URL before it will call the app openable. A new
`packages/server/src/services/app-readiness.ts` holds `pollAppReady(url, opts)`: a
plain-`fetch` loop (1s interval, 120s budget, 5s per-attempt timeout) where any HTTP
response — 404 and 503 included — means ready, a transport failure means keep going,
and an `AbortSignal` cancels it. It is shaped like the neighbouring `drive-hooks.ts`:
exported timing constants plus injectable `fetchFn`/`now` seams.

`git.ts` wires it in at both places a URL is sniffed. `recordDriveUrl` and
`recordDryRunUrl` now fire-and-forget a poll through a shared `watchAppReadiness`,
holding one `DevReadiness` value (`starting`/`ready`/`timedOut`) plus an
`AbortController` on `testDriveState`. `DriveInfo` gained `devReady: boolean` and an
optional `devReadyTimedOut`; `DryRunResult`/`liveFields` gained `devReady` so the prep
agent sees it through `dry_run_drive` `status` (whose description now names the field).
Both stop paths and `__resetTestDriveState` abort an in-flight poll, and the `.then`
bails if the drive it was watching is gone — so no late event lands on a dead drive's
timeline. The two `*.url` event messages were reworded: they used to say "ready", which
is exactly the lie this ticket removes.

On the web, a pure `openApp(drive)` + `openAppWaitingLabel` pair in `lib/feature-ui.ts`
turns the polled `DriveInfo` into `null | starting | ready | timedOut`; `ReviewBody`'s
`DrivePane` and `PreparationWorkspace`'s `DryRunRow` both render a muted, un-clickable
pill with the URL as text until `ready`, then the real link.

Deviation from the ticket: it suggested one `devReady` field, but the UI cannot tell
"still polling" from "gave up" with one boolean, so the wire carries the timed-out hint
as a second optional flag (state-side it is a single three-value union, not two
booleans). Compressed poll timing for the timeout test is reached through a documented
test-only `__setAppReadinessTiming`, mirroring the existing `__resetTestDriveState`.

## Surprises

`packages/server/test/dev-pane.test.ts` "kills the child process tree so the port-holder
is not orphaned" fails in this sandbox — on the full suite and in isolation. It is not
in the prompt's baseline, but it imports only `pty/*` and `services/events`, none of
which this ticket touches; it is a PTY process-reaping timing property of the container.
Everything else is green (1669 passed). The three baseline `@runcastle/web` typecheck
errors are also gone — ticket 1's settings-surface work appears to have taken them with
it; web typecheck now exits 0.

## Left undone

Readiness is deliberately NOT part of the dry-run verdict: `observableFailure` still
stamps `devCommand` on "printed a URL", not on "answered". Making the stamp require a
live app would be a stronger proof and a contract change nobody asked for. Also, the
timed-out hint is state-driven rather than event-driven — if a future surface wants the
warning in the timeline UI, `testdrive.ready_timeout` / `prep.dryrun.ready_timeout` are
already emitted and unread by the web.

## 3. Prep prompt: shape discovery, script authoring, recipe pack

# Ticket 3 — prep prompt: contract, shape discovery, recipe pack

## What was done

`renderPreparePrompt` (packages/server/src/launcher/artifacts.ts) lost its drive-loop
section — the `driveEnv` key explanation, the `{{slug}}/{{branch}}/{{id}}` templating and the
single worked postgres example — and gained four in its place: **The drive contract** (seven
numbered points: committed `.runcastle/` scripts, settings as invocation lines, `RUNCASTLE_*`
identity in, `.runcastle/drive.env` out, that file gitignored by the agent, unconditionally
idempotent steps, exit 0 meaning services are up with the waits inside the script);
**Discover the shape before you author anything** (package manager/workspace layout, OS and
shell, docker, services, hosted-vs-local stores, env loading); **Recipes — adapt them, never
copy them** (per-drive postgres, compose with `COMPOSE_PROJECT_NAME` + script-chosen ports +
`--wait`, redis by index/prefix with db 0 left to the human, hosted DBs by vendor branch or
schema-per-drive, deterministic slug-hashed ports with a bind-probe walk); and **Audit how
the app loads its environment** (the `dotenv override: true` class, fix-or-record).

The host-key list is now four, not five, and `driveSetupCommand`/`driveStopCommand` are
described as invocation lines. The dry-run closing move now describes what the machinery
observes post-ticket-1: setup exits 0 and hands back a parseable `drive.env` whose variable
names come back in the reply, the dev pane serves at a URL the server waits on, stop exits 0.

`evaluateEditGuard` (edit-guard.ts) gained a narrow path exception: a `prepare` session may
write `.runcastle/**` and the root `.gitignore` in the human's checkout — previously every
edit was denied, which would have denied the session the exact files the contract asks it for.
Tests in prepare-session.test.ts cover all of it (contract terms, discovery, each recipe, the
audit, the dry-run observables, and the guard's allow/deny pairs).

## Surprises

- The prompt's old fix-and-retry line said a leftover `myapp_prep_dry_run` making the retry's
  `createdb` fail loudly *was* the freshness check. That directly contradicts contract point 6
  (idempotent `createdb ... || true`), so it was rewritten: an idempotent setup will happily
  reuse a stale database, which makes a teardown that never worked look like a clean drive.
  That is now the thing the agent is told to watch for.
- The env-loading audit could not simply say "fix it in the repo": the edit guard (and the
  session's own framing) forbids a prepare session from touching app code. The prompt therefore
  routes the fix through the human and records the alternative with `record_event` — the only
  free-form recording tool a project-scoped session has, since `record_finding`'s key is the
  `PreparedKey` enum and there is no key that means "warning".
- Ticket 2's app-readiness polling had not landed on this branch when this was written; the
  prompt states it as the server's job (decision 5) on the assumption the lap ships together.

## Left undone

- `packages/server/src/services/git.ts` (~line 1434) still illustrates teardown with the old
  `dropdb "$DB_NAME"` / `createdb "$DB_NAME"` comment. It is still true under the new contract
  (the script writes `DB_NAME` into `drive.env`), so it was left alone as another ticket's file.
- The guard's `.gitignore` exception is the ROOT one only; a monorepo agent wanting a nested
  `.gitignore` would still be denied. Nothing needs it today.
- One pre-existing, environment-caused failure: `packages/server/test/dev-pane.test.ts`
  ("the process group must be gone") fails in this sandbox on its own as well as in the full
  run — a process-group kill this container does not honour. Untouched by this diff, which is
  three files: the two above plus prepare-session.test.ts.

## 4. Burner keeps drive scripts true: maintenance instruction + hermetic checks

# Ticket 4 — Burner keeps drive scripts true

**What was done.** Added one additive section, "Keep the drive scripts true", to the burner prompt
template (`packages/skills/burner/implement-ticket.md`), placed between "How to work" and "Hard rules".
It carries the standing instruction (a ticket that adds a service, a required env var, a seed
requirement, or a process must update the `.runcastle/` drive scripts in the same branch), the four
contract facts an agent needs to edit those scripts correctly (they are committed source, steps stay
idempotent, `drive-setup` writes `.runcastle/drive.env`, `RUNCASTLE_SLUG`/`RUNCASTLE_BRANCH`/`RUNCASTLE_ID`
come from the server, exit 0 means ready), and a subsection forbidding any attempt to run the scripts in
the hermetic sandbox while listing the four checks that *are* offline-possible — syntax, referenced files
exist, compose parses, new env vars actually written to `drive.env`. No placeholder was added, so
`ticket-burner.ts` needed no change at all; the section is static template prose. A test in
`packages/server/test/ticket-burner-units.test.ts` renders the real template through `renderTicketPrompt`
and asserts the instruction, the triggers, the contract facts and the hermetic checks are present.

**Surprises.** Two. First, the baseline in the ticket says `bun run --filter '@runcastle/web' typecheck`
has three pre-existing errors in `EnableAfkCard.tsx` and `SettingsOverlay.tsx` — it does not; that command
now exits 0 with zero errors, so the recorded baseline is stale and the fix appears to have landed already.
Second, the full suite has one failure that is *not* in the baseline: `packages/server/test/dev-pane.test.ts:183`
(`expect(pidAlive(-pgid)).toBe(false)`), a process-group teardown assertion. It reproduces on a single
targeted run of that file alone and cannot be reached by this diff, which touches only a markdown template
and a different test file — it is the container's process reaping, an environment fault. Everything else is
green: root typecheck, web typecheck, and 1662 passing tests.

**Left undone.** The section describes a contract whose server side does not exist on this branch yet —
nothing in the repo writes or reads `.runcastle/drive.env`, and no `.runcastle/` scripts exist, so the
sibling tickets in this lap have to land for the prompt to describe a real world. I could not exercise the
hermetic checks the section prescribes for the same reason: there is no drive script here to run `bash -n`
against. I also left `docs/SPEC.md` untouched; §8 and §193 describe the template by its placeholders and its
forked implement+tdd+code-review rules, neither of which this addition invalidates. If the open question in
the spec ("where the burner's hermetic script checks run — prompt instruction vs. mechanical harness step")
is later resolved toward a harness step, this section becomes the floor it wraps, not a thing to delete.

## 5. Drive-fix session: one-click recovery from a failed drive

# Ticket 5 — drive-fix session

## What was done

Added the `drive-fix` session kind end to end. Core gained the enum member;
`launchDriveFixSession` (modelled on `launchPrepareSession`, but feature-scoped)
opens a terminal in the developer's real checkout beside the failed drive, with a
fitted prompt (`renderDriveFixPrompt`) carrying the hook failure in full, the
`drive.env` key names, the `git diff --stat base...branch` delta computed at
launch, and pointers to the feature's docs. The edit guard lets that kind write
`.runcastle/` and `.gitignore` and nothing else. `retry_drive` is a new MCP tool
gated to the kind: it stops the held drive (tolerating an already-free slot),
starts a fresh one, and returns the drive's own `DriveInfo` — setup failure, env
key names, dev pane, URL and readiness. The web review panel gets a
setup-failure card (command, outcome, output tail) with a **Fix drive** button
calling a new `feature.fixDrive` mutation.

Two deviations from the ticket's sketch. The failure had nowhere to live — it
existed only in the `testDrive` start result and was surfaced as a one-shot
toast — so `DriveInfo` now carries `hookFailure` and `envKeys` on the feature
drive; that is what makes both the panel and the launch context possible, and it
is what the launcher reads to refuse a fix session when there is no failure to
work from. And `drive-fix` reuses prepare's model step rather than adding one:
`MODEL_STEPS` drives the settings UI and a core test's exact list, so a new step
would have been a settings field nobody asked for.

## Surprises

`launchSession` takes `kind: SessionKind` straight off the wire, so adding a kind
silently opened a wrong door — a client could have asked for a `drive-fix` talk
session in a docs worktree with a feature brief. It now refuses that kind and
names the right door. `SessionPanel`'s Resume had the same shape of problem: it
relaunches `session.kind` through `launchSession`, so an ended drive-fix session
would have offered a button that can only be refused; it is excluded, like
`waypoint`.

The web typecheck baseline in the ticket prompt is stale — the three
`EnableAfkCard`/`SettingsOverlay` errors are already fixed on this branch
(`lib/api.ts` has the `inferRouterOutputs` treatment), and
`bun run --filter '@runcastle/web' typecheck` is green.

`packages/server/test/dev-pane.test.ts > kills the child process tree` fails in
this container (`kill -0 -pgid` still finds the group after the kill). It is an
environment fault, not mine: nothing in the diff touches `pty/dev-pane.ts`,
`pty/kill-tree.ts` or that test. Everything else is green — 1694 passing.

## Left undone

The `DriveStatus` card still says "driving now" over a drive whose setup failed
(the new card above it says otherwise, loudly, but the two disagree in the same
viewport). `retry_drive` has no `status` action, so an agent that wants to watch
`devReady` flip has to retry rather than poll; the ticket asked for one tool and
one loop. And the root `CLAUDE.md` still says the MCP server registers 14 tools —
it now registers 15.
