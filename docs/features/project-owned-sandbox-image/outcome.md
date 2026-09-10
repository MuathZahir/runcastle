# Outcome — Project-owned sandbox image

A first-class container setup flow: projects ship .runcastle/sandbox/Dockerfile, runcastle detects/builds/tags it and sets sandboxImage itself, Rebuild-image stops clobbering custom images, staleness uses a content hash, and burns preflight the toolchain so "mvn not installed in image X" replaces raw exit-127 failures.

- Shipped: 2026-09-10
- Laps run: 2

## What shipped

29 commits · 41 files

### Lap 1
- 7 tickets landed: #1 sandboxImage becomes a per-project setting; #2 Runcastle-owned chain build with content-hash labels; #3 Doctor probe: hash staleness, new states, custom-tag disarm, auto-clear; #4 Toolchain preflight and fatal exit-127 classification; #5 Prepare skill authors .runcastle/sandbox/Dockerfile; #7 Doctor duplicates sandbox-image resolution outside the single resolver seam; #8 Project Dockerfile masks a user-owned custom image without changing what burns run
- 0 waived
- 0 failed

### Lap 2
- 2 tickets landed: #10 Blank stored sandboxImage normalizes to unset in the unmanagedImage guard; #11 Split project persistence out of the sandbox-image mechanics module
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: d383f8757722436b1c0a0a4277d3e10eb567c4d6
- Landed since: 4
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 5a6ffd39d2f770d2b18b83ecdbde6d36da23e4c1
- Landed since: 2
- Outcome: done

### Lap 2 · verification

- Reviewed commit: c7f5b6466613fcdf6d626dd7dff4c8cfb25607c0
- Landed since: 0
- Outcome: done

- **Blank human-owned value cannot be adopted after the enabled chain build** — open

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. sandboxImage becomes a per-project setting

# Ticket 1 — sandboxImage becomes a per-project setting

## What was done

`projects` gained a nullable `sandbox_image` column (hand-written migration
`packages/server/drizzle/0037_project_sandbox_image.sql` — the drizzle snapshots
are already drifted, so `bun run db:generate` would have re-emitted 0035's column
and broken boot). The settings descriptor for `sandboxImage` gained
`projectColumn: 'sandboxImage'` beside its existing config key and
`RUNCASTLE_SANDBOX_IMAGE`, so the project settings page shows and edits it with
the same Global / This-project chip, ghost value and provenance chip the
`setupCommand` row has. `resolveSandboxImage` now takes an optional project and
resolves project column → env var → global config → `DEFAULT_SANDBOX_IMAGE`,
unit-tested across all four layers.

Two things deviated from the ticket's suggested shape:

1. **The env layer is not a parameter of the resolver.** `loadConfig` already
   folds `RUNCASTLE_SANDBOX_IMAGE` over the config file, so env and file arrive
   as one `config.sandboxImage` with env already winning. Adding an env argument
   would have duplicated that folding and forced `process.env` into IO-free core.
   The four-layer test therefore builds the env and file layers through
   `loadConfig` against a temp `RUNCASTLE_DATA_DIR`, which also proves the
   folding itself.

2. **`sandboxImage` is not a `PREPARED_KEY`** (as the ticket asked), but the
   provenance rails are keyed on `PreparedKey`, so a new
   `PROVENANCE_KEYS = [...PREPARED_KEYS, 'sandboxImage']` in core carries them:
   `recordHuman`, `isOverwritable`, `recordFinding` and `listFindings` widened to
   `ProvenanceKey`, while `keysToPrepare` / `unsetPreparedKeys` / the MCP
   `record_finding` enum stayed on `PREPARED_KEYS` so no prep conversation can
   ask for or write the image. There is a test pinning exactly that.

The project value reaches the burn side: `burnRun`'s image precheck, the probe
memo key, `ensureBurnCacheVolume`, `buildSlotStamp`, the missing-agent-binary
message, and `buildSandboxOptions` / `selectSandbox` (both of which gained
`project` as a second positional parameter — the research lane passes it too;
`burn-cache-probe` passes `null`, being deliberately project-less).

## Surprises

- **`resetPrep` (dev tool) deleted every finding row for a project.** With
  `sandboxImage` now able to have one, that would have dropped its provenance
  while leaving the column set — an image the human owned would have silently
  become overwritable. Scoped the delete to `PREPARED_KEYS`.
- **The build flow and the doctor probe still resolve machine-wide.**
  `setup.doctor` and `setup.startTerminal` take no `projectId`, and threading one
  through is squarely ticket 2/3's territory ("do not touch the build flow or
  doctor"). I did change `setup.doctor` to call `resolveSandboxImage(ctx.config)`
  instead of reading `ctx.config.sandboxImage` raw — same value today, but it
  makes the seam universal so ticket 2 only has to add the project argument.
  Until then a human-set project image is used by burns and not reflected on the
  AFK card; that is the expected partial state of this slice.
- **`packages/server/test/dev-pane.test.ts > "kills the child process tree so the
  port-holder is not orphaned" fails in this sandbox**, on my branch and
  independently of my diff (it spawns a real `sleep` and asserts the process
  group is reaped; the teardown log says it settled in 1 ms and the group is
  still alive 400 ms later). It is not in the prompt's baseline list. Confirmed
  by running that one test alone, twice. Everything else is green: typecheck 0
  errors, `bun run test` 3455 passed / 1 failed (that one) / 4 skipped.
- The prompt's baseline counts (118 files, 1768 tests) do not match this repo —
  it runs 238 files / 3460 tests.

## Left undone

- **Threading a project through `setup.doctor` / `setup.startTerminal`** — the
  build button and the doctor's image row still describe the global image. Ticket
  2 needs this anyway to build `sandcastle:runcastle-<projectId>`; the resolver
  already accepts the project.
- **`projects.sandbox` (the per-project sandbox *provider* override) is still not
  on the `Project` zod type and is not read by the burner** — pre-existing, found
  while mirroring `setupCommand`'s wiring. A project set to `podman` in settings
  does not burn under podman.
- **The settings UI reports `sandboxImage` as env-locked when
  `RUNCASTLE_SANDBOX_IMAGE` is set, while resolution puts the project column
  above env.** That inconsistency already exists for `model`, `sandbox` and the
  prepared keys (`resolveField` locks on env; `resolvePreparedSettings` puts
  project first); I followed the ticket's stated order rather than changing it.
- Drive machinery: nothing needed. This adds no service, env var, seed or
  process — only a migration, and `.runcastle/drive-setup.ts` already pins
  `RUNCASTLE_MIGRATIONS_DIR` at the checkout's `packages/server/drizzle`, so a
  drive of this branch applies 0037. I verified that pin and that the paths the
  script names exist; I did not run it (no services in this sandbox).

#### 2. Runcastle-owned chain build with content-hash labels

# Ticket 2 — Runcastle-owned chain build with content-hash labels

## What was done

The `sandcastle build-image` shell-out is gone. A new server module,
`packages/server/src/services/sandbox-image.ts`, is the single home for the
`runcastle.dockerfile-hash` label key, the sha256 helpers (`hashDockerfile`,
`hashDockerfileContents`), the image-label reader (`builtDockerfileHash`), the
project paths (`projectSandboxDir` / `projectDockerfilePath` /
`projectImageTag`), the build plan (`planImageBuild`) and the terminal command
(`imageBuildTerminal`) — ticket 3's doctor should import the label and the hash
from here rather than re-deriving them. Stock builds run
`<runtime> build -t sandcastle:runcastle --label runcastle.dockerfile-hash=<sha>
--build-arg AGENT_UID=… --build-arg AGENT_GID=… <context>`; a project carrying
`.runcastle/sandbox/Dockerfile` gets the two-step chain (stock first only when
its label does not match the current stock Dockerfile), tagged
`sandcastle:runcastle-<projectId>` from the repo's `.runcastle/sandbox/`. A
successful chain adopts the project tag into the `sandboxImage` column on the
PTY's own exit, and never over a value the human typed. A resolved tag runcastle
does not manage makes the route refuse outright (`InvalidInputError`) — the
clobber this feature exists to stop.

Three deviations from the ticket's sketch:

1. **`terminalSpec` no longer knows about `build-image` at all.** With the CLI
   shell-out retired, its `imageName`/`sandcastleBin` options had no other
   reader, so it narrowed to `Exclude<TerminalKind, 'build-image'>` and lost its
   options object; the build's (cmd, args, cwd) comes from `imageBuildTerminal`.
   `resolveSandcastleBin` was deleted with its last caller (worth knowing: the
   published tarball *inlines* sandcastle rather than installing it, so that
   resolver was on borrowed time anyway).
2. **A fourth `FindingSource`, `build`.** "Machine provenance, not
   userSupplied" had no honest value in the existing enum — `session` means "an
   agent measured it with you watching", and falling through to the `prep` label
   would have had the settings row claim a preparation run established the image.
   The four label sites in `apps/web` gained a `build` case ("Built by
   runcastle").
3. **The AFK card passes its `projectId` to `startTerminal`.** Ticket 3 owns the
   row's states; without this one prop, though, the chain could never be reached
   from the UI. `projectId` is optional on the route — the first-run wizard,
   which may have no project, still builds the stock image alone.

## Surprises

- **The chain needs a shell, and the repo has two precedents for that**, not
  one: `devSpawnTarget` (node-pty, unquoted line) and `hookSpawnTarget`
  (child_process, `windowsVerbatimArguments`). The build terminal is a PTY, so it
  mirrors the dev pane; each argv entry is shell-quoted only when it needs it, so
  the watched line still reads like a command a human would type.
- **`prepareSandboxBuildContext` returned the wrong dir for the new caller.**
  It returned the *enclosing* dir because `sandcastle build-image` demanded a
  `.sandcastle/` at its cwd; a direct `<runtime> build` wants the dir holding the
  Dockerfile, so it now returns the `.sandcastle/` itself.
- **Stock `Dockerfile` and `Containerfile` are byte-identical**, so one hash
  covers both runtimes. If they ever diverge, the label becomes runtime-dependent
  and this assumption breaks.
- **Build args are passed to the stock step only**, replicating sandcastle
  exactly: it passed the host uid/gid for docker and none for podman (rootless
  podman already maps the agent onto the host user). The project image inherits
  the applied ARGs from its base, and unconsumed args only print a warning.
- **`packages/server/test/dev-pane.test.ts > "kills the child process tree so
  the port-holder is not orphaned"` fails in this sandbox** — the same failure
  ticket 1 reported, not in the prompt's baseline. It spawns a real `sleep` and
  asserts the process group is reaped; my diff touches nothing under `src/pty/`.
  Confirmed by running that file alone. Everything else is green: typecheck 0
  errors, `bun run test` 3488 passed / 1 failed / 4 skipped across 239 files.
  (The prompt's baseline counts — 118 files, 1768 tests — do not match this repo.)

## Left undone

- **The doctor probe is still mtime-vs-`Created`** and still resolves the image
  machine-wide (`setup.doctor` takes no `projectId`). That is ticket 3; it now
  has `builtDockerfileHash` and `projectDockerfilePath` waiting for it, and the
  "project image not built yet" / custom-tag-disarmed states are its call.
- **No test drives the tRPC route itself.** There is no setup-router harness in
  the repo, and building one means faking the PTY registry plus
  `prepareSandboxBuildContext` (which writes into the real data dir). The plan,
  the terminal spec and the column adoption are each unit-tested at their own
  seam; the route only translates between them.
- **A build that fails leaves nothing behind to say so** beyond the terminal's
  own output — the column write is simply skipped. If a "last build failed" state
  is wanted on the card, it is new state nobody has asked for yet.
- **Drive machinery: nothing needed.** This adds no service, env var, seed or
  process — only server code and one migration-free column write path — so
  `.runcastle/drive-setup.ts` is untouched. I did not run it (no services in this
  sandbox).

#### 3. Doctor probe: hash staleness, new states, custom-tag disarm, auto-clear

# Ticket 3 — Doctor probe: hash staleness, new states, custom-tag disarm, auto-clear

## What was done

`sandcastleImageProbe` was rewritten around content hashes. It now takes one
injected input object (`ImageProbeInput`) instead of four positional arguments,
reads the `runcastle.dockerfile-hash` label through ticket 2's module, and
compares it against the sha256 of the Dockerfile on disk — for the stock image
and for a project's `.runcastle/sandbox/Dockerfile` alike. `DoctorEnv.fileMtime`
is gone, replaced by `dockerfileHash: (path) => string | null`; `{{.Created}}` is
never asked for again (there is a test asserting that). Four statuses the row can
now report: `stale` (whose detail names *which* layer drifted — its own Dockerfile
or the stock base it is `FROM`), `not-built-yet`, `custom`, plus the existing
`missing`/`ok`. `setup.doctor` gained an optional `{ projectId }` input, and the
project half of the question reaches the probe through a new injected
`ProjectImageEnv` (`id`, `repoPath`, `stored`, `overwritable`, `clearStored`), so
the doctor library still never touches the database. `EnableAfkCard` passes the
open project's id, disarms the Build button for a `custom` image and prints the
two ways out instead, and says "Build image" (not "Rebuild") for an unbuilt
project Dockerfile.

Three deviations from the ticket's sketch:

1. **`builtDockerfileHash` became `inspectBuiltImage`, returning
   `{ present, hash }`.** The old signature collapsed "image absent" and "image
   present but unlabelled" into the same `null`, and this ticket has to tell
   those apart — one is `not-built-yet`, the other is `stale`. Reshaping the one
   reader beat adding a second one that runs the same `image inspect`. The
   build route's one caller was updated; nothing about the build command
   assembly changed.

2. **`DoctorEnv.imageName` is now the resolution *below* the project column,
   and the probe layers `stored` over it.** The router passes
   `resolveSandboxImage(ctx.config)` — no project — deliberately: when the probe
   auto-clears an orphaned column it has to go on and report on the image
   resolution actually falls back to, which it cannot do if the caller has
   already folded the (now-deleted) column in. The probe's `stored ?? imageName`
   is the same project-first rule `resolveSandboxImage` applies, and is
   documented as such at both ends.

3. **The `custom` state still checks presence.** Decision 5 only asks the row to
   say the image is managed outside runcastle, but reporting *only* that would
   have swallowed the one thing runcastle can still answer about a hand-typed
   tag — whether a burn will find it at all. So `custom` is `info` severity when
   the image is there and `error` when it is not, the detail says which, and the
   button is disarmed either way. The card's readiness therefore follows
   `severity === 'info'` rather than the status name.

A `releaseProjectImage` was added beside ticket 2's `adoptProjectImage` — same
guard (`isOverwritable`), same event — so the auto-clear is a service function
that emits, not a raw column write from inside a query resolver.

## Surprises

- **The doctor now imports `services/sandbox-image`, which drags in `findings` →
  `git` → `pty/dev-pane`.** The ticket warns to keep the doctor off `setup.ts`
  to avoid an import cycle; I traced the runtime graph before doing this and
  there is no cycle (the two edges back to the doctor — from `sandbox-image` and
  from `setup.ts` — are `import type`, so they are erased). But the pre-boot
  `runcastle doctor` CLI now loads about twenty more modules than it used to.
  Nothing there has import-time side effects, and it is green, but if that
  weight ever matters the fix is to split `adoptProjectImage`/`releaseProjectImage`
  (the only db-touching functions in that module) out of it.
- **The card's doctor query now has its own cache key** when a project is open
  (`{projectId}`), separate from the `undefined` key `use-project-nav` and the
  first-run wizard still use. So with the Burns settings page open there are two
  doctor runs, each shelling out to the container runtime. Invalidation still
  works app-wide (React Query matches on the key prefix). It is the unavoidable
  cost of a per-project image row, but it is worth knowing about.
- **`stockBuildArgs`/`planImageBuild` treat a stored tag equal to the project tag
  as "managed" even with the Dockerfile deleted, while the probe clears the
  column in that state first.** The two only disagree in the corner where a
  *human* typed the project tag by hand; there the card disarms and the route
  would have built, so no contradiction is reachable through the UI.
- **`packages/server/test/dev-pane.test.ts > "kills the child process tree so the
  port-holder is not orphaned" fails in this sandbox**, and is not in the
  prompt's baseline list. Tickets 1 and 2 both reported the same failure. It
  spawns a real `sleep` and asserts the process group is reaped; my diff touches
  nothing under `src/pty/`. Confirmed with a single targeted run of that file
  alone. Everything else is green: typecheck 0 errors, `bun run test` 3507
  passed / 1 failed / 4 skipped across 239 files. (The prompt's baseline counts —
  118 files, 1768 tests — do not match this repo, as ticket 1 also noted.)

## Left undone

- **The doctor CLI (`resolveDoctorEnv`) never supplies a project**, so
  `runcastle doctor` reports the machine-wide image even on a machine whose only
  project ships a Dockerfile. It has no project scope at all today and inventing
  one is outside this ticket; the card is where the per-project row lives.
- **A `custom` image's staleness is unanswerable and stays that way** — there is
  no Dockerfile runcastle knows about to hash. The row says presence only.
- **The settings page still reports `sandboxImage` as env-locked when
  `RUNCASTLE_SANDBOX_IMAGE` is set**, while resolution puts the project column
  above env. Ticket 1 flagged this as pre-existing for `model`/`sandbox` too; I
  did not touch it.
- **Drive machinery: nothing needed.** This adds no service, no required env var,
  no seed and no process — only server/web code, no migration. I verified that
  `.runcastle/drive-setup.ts` and `.runcastle/drive-stop.ts` exist and that
  nothing my change touches is named by them; I did not run them (no services in
  this sandbox).

#### 4. Toolchain preflight and fatal exit-127 classification

# ticket 4 — toolchain preflight and fatal exit-127 classification

## What was done

Three things, all in `packages/server/src/workflows/ticket-burner.ts`.

`extractCommandNames(command)` is the new pure heuristic: split a shell string on `&&`, `||`,
`;`, `|` and newlines, strip brackets/quotes, step over `VAR=` prefixes, take the first word of
each segment, keep only plain names (`[A-Za-z0-9][A-Za-z0-9._+-]*`), dedupe. A segment led by a
builtin or a wrapper (`cd`, `env`, `exec`, `sudo`, …) is dropped WHOLE rather than walked past —
walking past `env` in this repo's own `env -u GIT_ASKPASS bun run test` would "find"
`GIT_ASKPASS` and abort a working burn. Paths (`./gradlew`) and expansions (`$TOOL`) are dropped
for the same reason: `command -v` resolves a path against a cwd the probe container does not
have.

The run-level image probe in `burnRun` became a toolchain preflight. It now resolves the burn's
prepared settings (project column over global, via `resolvePreparedSettings`), derives the setup
command exactly as the executor does, and asks the image about the agent binary + setup names +
verify-command names in ONE `sh -c 'for c in …; do command -v "$c" … || echo "$c"; done'` run.
The script always exits 0, so a missing tool comes back as parsed stdout and stays distinguishable
from an image that cannot start a shell at all (which keeps the old stale-image wording). Any
missing name aborts the run through the existing `burn.image_runtime_missing` event; the agent
binary keeps its "rebuild the stock image" message, anything else gets "`mvn` is not installed in
image X — add it to .runcastle/sandbox/Dockerfile and rebuild." `noSandbox` still skips it all.

The classifier backstop: exit 127 in any wording (including sandcastle's own `Command failed
(exit 127): …`) is now checked BEFORE the retryable patterns, so it can never reach the broad
`exited with code \d+` entry that used to retry it. `missingSetupBinaryMessage` names the tool
when a name from the setup command sits next to the missing-command wording in the error text;
`classifyTicketRunError` gained an optional third `setupCommand` parameter and the burn's catch
block passes it, alongside `missingBinary` which now falls back to the setup-command message.

## Surprises

- The probe's memo (`cachedExec` in `resolveBurnDeps`) keyed only on (image, runtime), ignoring
  the args entirely. That was harmless when the probe was one fixed command; with a command list
  in the args it would have handed one toolchain's answer to another. The key now includes the
  command and args.
- `parseMissingCommands` needed the "one exec, parse stdout" shape rather than `&&`-chaining
  `command -v`: chaining tells you something is missing but not which one, and per-name container
  runs would cost one container each.
- Message wording: the ticket goal quotes backticks around the command name, but the incident
  brief and the adjacent `missingImageRuntimeMessage` are plain text, so these are plain too.
- `Command failed (exit 1): …` (sandcastle's non-127 wording) classifies FATAL today — it matches
  no retryable pattern and unknown throws default to fatal. Pre-existing; I did not change it.

## Left undone

- `AGENT_BINARY` (classifier section) and `RUNTIME_BINARY` (top of file) are the same map spelled
  twice. Pre-existing duplication, out of this ticket's scope.
- `packages/server/test/dev-pane.test.ts` > "kills the child process tree so the port-holder is
  not orphaned" FAILS, both in the full suite and on a targeted run of that one file. It is a
  process-group reaping expectation in this sandbox and touches nothing in this diff (my changes
  are confined to ticket-burner.ts and three test files). It is not in the prompt's baseline list.
  Everything else is green: `bun run typecheck` 0 errors; `env -u GIT_ASKPASS bun run test`
  3461 passed / 4 skipped / 1 failed (that one).
- Drive machinery: unchanged and unchanged-needed — this ticket adds no service, env var, seed or
  process, so `.runcastle/drive-*.ts` needed no edit. I did not run them (no services in the
  sandbox).
- The mixed-runtime preflight gap (the probe still only checks the run-default runtime) is
  explicitly out of scope and still open.

#### 5. Prepare skill authors .runcastle/sandbox/Dockerfile

# Ticket 5 — prepare skill authors `.runcastle/sandbox/Dockerfile`

## What was done

Added a `## The sandbox image` section to
`packages/skills/packs/runcastle/skills/prepare/SKILL.md`, placed after the env-loading
audit and before "Recording what you establish" so all the drive-loop guidance stays
contiguous. It teaches the prep agent to probe the checkout's manifests (pom/mvnw → JDK +
Maven, gradle → JDK + Gradle, pyproject/requirements → Python + pip/uv, go.mod → Go,
Cargo.toml → Rust, Gemfile → Ruby, union for mixed repos, plus anything the setup/verify
commands shell out to), and to author `.runcastle/sandbox/Dockerfile` starting
`FROM sandcastle:runcastle` when the stock image cannot build the project. It states the
boundaries — committed project machinery like the drive scripts, toolchain only and never
the project's dependencies, no package caches baked into layers, minimal RUN blocks, read
the stock Dockerfile for its distro/idioms instead of assuming — and says explicitly that a
JavaScript-only repo gets no Dockerfile at all. Ending guidance: prep never builds, edits an
existing Dockerfile conservatively, and closes by telling the human the AFK card now offers
**Build image** and that burns use the project image after that click. Two smaller edits keep
it wired in: a step 4 in "The order of the conversation", and a line after the sandbox key
trio saying the image is not a key because runcastle sets it itself.

Deviation from the ticket: none in substance. Two additions of my own judgement — the
"anything else the setup/verify commands shell out to" clause (a protobuf compiler, a
database client), and the note that the image is not a recordable key, which exists to stop a
prep agent reaching for `record_finding` when there is no key to record.

## Surprises

- The stock Dockerfile has two live locations, not one: the installed package ships it as
  `sandcastle-template/Dockerfile`, but on a contributor machine the resolver falls back to
  the source tree and the copy a prep agent can actually reach is the scaffolded build
  context at `~/.runcastle/sandbox-build/Dockerfile` — which only exists after the image has
  been built once here. The section names both and tells the agent to ask rather than guess
  the distro if neither is there.
- ADR-0004's mechanism is host dirs bind-mounted at each package manager's cache path, and
  the map today covers bun/yarn/npm only — `~/.m2` riding it is a sibling change, not
  shipped. The first draft asserted a "cache volume mounted into every sandbox"; I softened
  it to what is true now so the skill does not promise a mount that is not there yet.
- The file's paragraphs and bullets are unwrapped single lines throughout. My first draft
  hard-wrapped at ~90 columns and read as a foreign section; the second commit unwraps it.

## Left undone

- The baseline in the burn prompt (118 files / 1768 tests) is stale for this branch: the
  suite is 238 files / 3448 tests. One test fails and it is not mine —
  `packages/server/test/dev-pane.test.ts > kills the child process tree so the port-holder is
  not orphaned` (`expect(pidAlive(-pgid)).toBe(false)`), a real process-group kill that a
  markdown-only diff cannot touch; it fails identically on a targeted single-file run.
  Typecheck is clean (0 errors).
- No drive-machinery change was needed: this ticket adds no service, no required env var, no
  seed and no process, so `.runcastle/drive-setup.ts` / `drive-stop.ts` are untouched. I did
  not run them (no services in this sandbox); I only confirmed they are unmodified by this
  diff.
- The prepare skill's `references/recipes.md` holds worked drive-script shapes; worked
  Dockerfile shapes per toolchain (a JDK+Maven layer, a Python layer) could live beside them
  if the inline mapping proves too thin in real prep sessions. Deliberately not added — the
  ticket asked for the mapping, not a recipe library.

#### 7. Doctor duplicates sandbox-image resolution outside the single resolver seam

# ticket(7) — the doctor stops re-deciding which image it is about

## What was done

The doctor's image probe had its own copy of the project-first rule:
`const imageName = stored ?? input.imageName`. That made the doctor a second
place where sandbox-image resolution order is written down, which is exactly
what the lap's spec forbids ("one resolver, five consumers"). It now calls the
shared `resolveSandboxImage` instead, handing it the project column and the
already-folded lower layers, so the ordering lives in exactly one function.

I took the small shape rather than the large one. The alternative was to stop
the setup router pre-resolving at all — pass `ctx.config` down and let the probe
resolve once — but that means renaming `DoctorEnv.imageName` and churning the
doctor's public seam plus ~9 test call sites, for the same behaviour. The router
keeps passing the below-project value (the probe genuinely needs it: when it
clears an orphaned column under decision 8, that value is what resolution falls
back to), and the probe now asks the resolver to order the two.

The change came with one new test at the `runDoctor` seam: a blank project
column is unset and the layers below it answer. That test is red on the old code
in a way worth naming — the old `??` reported a custom image literally named
`"  "` — and green now, because delegating hands the probe the resolver's
trim-empty-to-unset reading for free.

## Surprises

- The verify baseline quoted in my prompt is stale for this branch: it says 118
  files / 1768 tests, and the suite is now 239 files / 3513 tests.
- One test fails, and it is not mine: `packages/server/test/dev-pane.test.ts:183`
  asserts a PTY process group is reaped (`kill -0 -pgid` must throw ESRCH) and
  gets a live group in this container. I confirmed it on a single targeted run
  rather than a whole-suite re-run. My diff is two files, neither imported by
  that test, so it is environmental/pre-existing. Everything else is green:
  3508 passed, and the doctor suite is 38/38.
- The reviewer's repro step names `feature/project-owned-sandbox-image`, which is
  not a ref in this clone. I ran it against `d383f87`, my fork point, which is
  that branch's content: both cited sites reproduce there verbatim, and on my
  branch `stored ?? input.imageName` is gone while `resolveSandboxImage` is what
  the probe calls.

## Drive machinery

Untouched, and it needed to be: this adds no service, no required env var, no
seed and no process — only a call-site change inside an existing module. Nothing
under `.runcastle/` names anything I moved.

## Left undone

`resolveSandboxImage` is now applied twice along the doctor path (once in the
setup router over the config, once in the probe over the column). It is the same
function both times and it is idempotent in the lower slot, so the result is
correct — but if someone later wants the doctor to resolve exactly once, the
move is to give `DoctorEnv` the config instead of a pre-resolved tag. I judged
that beyond this fix ticket.

#### 9. Verify the fixes that landed

Gates verification pass

Verified the two fixes landed after pass #6 against their original findings on `feature/project-owned-sandbox-image`.

- #7 held for its original repro. `sandcastleImageProbe` no longer spells project-first selection as `stored ?? input.imageName`; it calls the shared `resolveSandboxImage` seam, inheriting its trim-empty-to-unset behavior.
- #8 held for its original repro. With a project Dockerfile plus human-owned `acme/custom:v1`, the doctor checks and reports the custom image without inspecting the generated project tag, and `planImageBuild` returns `kind: 'refused'` before the chain branch.

One verification defect remains open as finding `finding_bQdNMvQbt-rd`: ticket #8's new `unmanagedImage` helper does not trim the stored project value. With `stored: '  '`, `overwritable: false`, and a project Dockerfile, burns resolve the blank as unset, but the doctor skips the project-image branch and the build plan refuses an image literally named whitespace. This regresses the blank-value semantics ticket #7 established and makes the card/build path disagree with burns in that edge case.

This project has no configured verify commands, so there were no gates to run.

<promise>COMPLETE</promise>

### Lap 2

#### 12. Verify the lap 2 fixes

Gates verification pass

## Summary

- No verify commands are configured, so there were no gates to run.
- Fix for `finding_bQdNMvQbt-rd` holds at the shared `unmanagedImage` guard: null, empty, and whitespace-only stored values normalize to unset before provenance/custom-tag reasoning; non-blank human-owned values still refuse; managed stock/project tags remain buildable. The added doctor and planner tests cover the original whitespace repro with a project Dockerfile present.
- A surviving post-build divergence remains for the required `stored: '  '`, `overwritable: false`, Dockerfile-present edge. `planImageBuild` permits the chain, but successful completion calls `adoptProjectImage`, whose unchanged provenance guard refuses the write. Burn resolution therefore keeps using the global/stock fallback, while the doctor can report the freshly built project image as `ok`. Reported as `finding_cO2zTsN2cgLF`.
- Fix for `finding_a9XxnwnZ5smC` holds. `adoptProjectImage` and `releaseProjectImage` moved verbatim to `services/project-image.ts`; their caller import and tests moved with them. `services/sandbox-image.ts` has no DB, findings, or event/SSE imports, and the doctor's runtime dependency path through it reaches only image mechanics/core and Node built-ins (its remaining doctor/setup imports are type-only).
- The persistence refactor changes no observable function behavior in its diff: guards, finding writes, emitted `settings.updated` payloads, return values, and the sole caller's invocation points are unchanged.

## Finding

### `finding_cO2zTsN2cgLF` — Blank human-owned value cannot be adopted after the enabled chain build

Repro: project Dockerfile present; stored `sandboxImage` is whitespace; provenance makes it non-overwritable. The planner returns `chain`. On exit 0, adoption returns false and leaves whitespace stored. The doctor can then inspect matching project/stock hashes and report the project tag healthy, while `resolveSandboxImage` still trims the stored value and sends burns to the fallback image.

<promise>COMPLETE</promise>
