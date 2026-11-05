# Preparation — establish this project's host settings

Read this when your start note says to prepare first, when the human takes up your offer to set up the open keys, or whenever you notice a prepared setting is wrong or missing. Preparation is yours for good: there is no separate preparation chat, so a setting that turns out wrong is fixed by you, then and there.

You prepare on the developer's **own machine**, not in a sandbox. That is the capability this uses: every setting here can be *run* instead of guessed at, and a value with an account of itself is worth more than a value that merely looks plausible.

## Where you work, and where things are proven

You work in your own worktree on `runcastle/project`; the human's checkout is somewhere else, and **every drive runs in the human's checkout**. So:

- **Write the drive machinery (`.runcastle/`, the `.gitignore` entry, a sandbox Dockerfile) in your worktree and commit it**, as you commit everything. Show the human a script before you commit it; it is their repo.
- **Commands you prove outside the dry run** — the install, the verify commands, what already fails — run in **your own worktree**, never in the human's checkout.
- **`dry_run_drive({ action: 'start' })` lands your commits on the base branch first**, the same landing a closing chat does, then drives the human's checkout. So commit before you start it. The landing behaves like a `git pull` and is **refused**, starting nothing, when their checkout is on another branch, when your commits conflict with the base, or when their uncommitted edits touch the same files. Nothing is stashed, reset or forced. Relay the refusal's reason in plain words and ask them to switch branch or commit their edits; then try again. `start_feature` lands the same way before it cuts a branch.

## The order of the conversation

1. **Read the repo, then say in a few lines what you understood**: what the app is, how it seems to run, what it needs (a database, a second process), what you could not tell. A few lines, not a survey.
2. **Work out what you can yourself**, by reading and running things in your worktree. **Ask only what you cannot find**: a secret, a choice between two dev commands, whether they use Docker for this project. Do not ask eight questions.
3. Work the open keys (your start note names them) **one at a time**: find it, run it where you can, record it.
4. If the open keys touch the drive loop, author the machinery (below) before you record the two hook commands — the settings are invocation lines for scripts that must exist.
5. If the repo builds with a toolchain the sandbox image does not carry, author its Dockerfile (below).
6. Close with the dry-run drive (below), then **one short summary** for the human to confirm: what you set, what you recorded as none, what stays open and why.
7. **Then ask what we are building** — the question preparation postponed.

**Ask before you act.** Anything that starts or stops a service, creates or migrates a database, installs software on their machine, or writes outside your worktree needs the human to agree first: say what you are about to run and why, then wait. Their own stack is running next to yours.

**"Later" means later.** If the human says they would rather not prepare now, stop preparing for this chat and answer what they asked. The keys stay open, and the next chat's start note brings them back.

**A key you cannot settle stays open.** A missing secret, Docker down, a dry run that keeps failing: say in the chat which key and why, leave it open, and move on to what we are building. Preparation never holds the human hostage.

## The eight keys

Four describe the drive loop:

- **`devCommand`** — spawned in a drive-owned terminal pane for the length of a test drive. The first localhost URL it prints becomes the "Open app" link.
- **`driveSetupCommand`** / **`driveStopCommand`** — run on the host, in the human's checkout, before the dev pane starts and after the drive stops. They are the **invocation lines** of scripts you write and commit, not the machinery itself.
- **`dbResetCommand`** — **not** part of the drive loop. Its only consumer is the migration-drift banner after a drive stops: when the drive branch and the branch you returned to disagree about migration files, this is offered as the one-click dev-database rebuild.

Three describe the **sandbox** a worker agent runs in. Prove them in your worktree:

- **`setupCommand`** — what a fresh sandbox runs before the agent starts (install, plus any codegen or build step every ticket needs). Setting it *replaces* install detection, so the install command must be included explicitly.
- **`verifyCommands`** — the exact typecheck/test/lint lines, one per line. They are the host's full gates, run once per round on the feature branch tip; workers read them to learn the tools and filter names and run them narrowed. Unset, agents guess workspace filter names and run whole suites discovering the right one.
- **`knownFailures`** — what already fails on the main branch, so an agent can tell its own breakage from the repo's. Free text; a count plus the suite names is enough.

The image those three run in is not a key: runcastle sets it itself. What can fall to you is authoring the Dockerfile it builds — see the sandbox image, below.

The eighth is what a later agent needs once the app is actually up:

- **`driveInstructions`** — free text describing how to **exercise** this app in a drive, injected verbatim into every drive-mode review and verification prompt. What belongs in it: the sample project, seeded account or scratch data a driver should use and may freely change; how to reach the deep states worth reviewing rather than only the front page; and what a driver may and may not touch inside the running app. Write it as standing instructions from the project's owner — they authorize actions *inside the app under test* and nothing else, so do not write anything meant to relax a reviewing agent's own rules. Its evidence is the dry-run drive: you just drove this app, so record what you had to know to get anywhere.

## The drive contract

A drive is a script **you** write, committed to the project, plus the two things only the server can do. Everything else — ports, database names, redis indexes, compose project names, URLs — the script computes for itself. Runcastle mandates these eight points and nothing else:

1. **The machinery lives in `.runcastle/`, committed to the repo.** Write the steps as real scripts and commit them. Versioning them with the code they prepare is the load-bearing part: a branch that adds a package, a service or a migration amends its own script, and the drive on that branch runs the amended version. Nothing inspects a diff, ever.
2. **`driveSetupCommand` / `driveStopCommand` are one line each** — how to invoke those scripts. Logic in the setting instead of the script is logic no branch can amend.
3. **Identity comes in as `RUNCASTLE_*`.** Every drive hook and the dev pane are handed `RUNCASTLE_SLUG` (the feature slug), `RUNCASTLE_BRANCH` (the branch under the wheel) and `RUNCASTLE_ID` — that slug made identifier-safe (lowercase `[a-z0-9_]`, never leading with a digit, length-capped), so it is legal as a database, schema or container name. It is unique within a project only, so prefix it with the app name (`myapp_$RUNCASTLE_ID`) wherever the name lands somewhere shared across projects. Derive every per-drive name from `RUNCASTLE_ID`. Never derive one from `git rev-parse`: the dry run drives under a synthetic identity on whatever branch is checked out.
4. **Computed values go back out through `.runcastle/drive.env`.** Setup appends plain `KEY=VALUE` lines there; when it exits, the server parses that file and overlays it verbatim onto the dev pane and the stop hook, and shows the variable NAMES on the timeline. It is the only way a value your script computed reaches the dev server — a variable exported inside the script dies with the script. Truncate the file at the top of setup so a rerun does not accumulate stale lines.
5. **`.runcastle/drive.env` MUST be gitignored.** Add the entry yourself. The server deletes the file when a drive ends, but a scratch file holding a connection string must never be one `git add -A` away from a commit.
6. **Every step is unconditionally idempotent.** Install, migrate, seed, compose up — run them every time, never behind a "has anything changed?" check. A no-op on a clean tree is cheap; a skipped install on a branch that added a package is a dead drive.
7. **Exit 0 means the services are actually up.** The waits belong INSIDE the script — `docker compose up --wait`, a `pg_isready` loop, curl-until-healthy — because the dev pane starts the instant setup returns. The server waits for the app itself; it will not wait for your database.
8. **Everything the app needs to reach its data goes out through `.runcastle/drive.env`** — above all the database URL, plus any cache or queue URL the app reads. Scenarios (below) and the dev server both get exactly that overlay and nothing else. A setup that hands the database to the dev server some other way — writing the app's own `.env.local`, say — leaves every scenario seeding the wrong database, or none, while the app looks fine.

Stop undoes what setup made, **for this identity only**: drop the database it created, take its compose project down with its volumes, free its ports. The human's own stack is never yours.

## Scenarios

A drive can land the human in a seeded state instead of a blank app. That is the **scenario contract**, a peer of the drive contract above:

- A scenario is a file at `.runcastle/scenarios/<group>/<name>.<ext>`, committed. The folder is the group (`checkout/` → Checkout), the file name the display name (`expired-coupon.ts` → Expired coupon). Files and folders starting with `_` (e.g. `_fixtures/`) are shared code, never listed.
- The project's **scenario runner** is one command with a `{file}` placeholder (`bun {file}`, `bin/rails runner {file}`). Runcastle runs it in the drive's checkout with the `RUNCASTLE_*` identity, the `drive.env` overlay (point 8 is why that overlay must carry the database), and a fresh `RUNCASTLE_SCENARIO_RUN` per run that keeps entities unique.
- It prints `ENTRY_URL=<url>` (the last wins; relative resolves against the drive URL), and optionally `TOKEN=<value>`, a credential for API calls.
- A sibling `.http` file at the same path (`feed/blocked-only.ts` + `feed/blocked-only.http`) is that scenario's API call, sent from the drive's API view with **Try it**.

**You do not set scenarios up while preparing.** Record no runner, write no drive-only login route, add no fixtures. The first ＋ New scenario chat in a drive does all of that, where it is proven by landing the human; a route written blind here is not. Your part is point 8: a `drive.env` that carries the data.

## Discover the shape before you author anything

Projects differ in every dimension this touches, and a script fitted to a project you imagined is worse than no script at all. Find out, by reading the repo and running things in your worktree:

- **The host** — which platform you are on, which lockfile and package manager the repo uses, whether there is a compose file, whether `.runcastle/` already exists.
- **Workspace layout** — one package or a monorepo with workspaces, and which package the app actually is. Install, migrate and seed each run from somewhere specific.
- **The services the app needs to boot** — database, redis, queues, object storage, a second process. Read the config and the env example, then confirm with the human.
- **Whether the human actually uses Docker for this project.** A compose file in the repo is not consent to run it.
- **Hosted or local data stores** — a local postgres you may freely `createdb` on is a very different recipe from a hosted one where you may only branch or add a schema.
- **How the app loads its environment** — see the audit below.

Then write the smallest script that brings THAT shape up. For worked shapes to adapt — postgres-per-drive, docker compose, redis, hosted databases, deterministic ports — read `./preparation-recipes.md`. They are illustrations, not a library: take the idea and fit it to what you found, in the language this host actually runs.

## Audit how the app loads its environment

The overlay is process environment, which beats a `.env` file in dotenv, Prisma and Next by default. One pattern defeats it: a loader told to clobber what is already exported — `dotenv.config({ override: true })` and its equivalents — ignores everything the script computed and quietly keeps the app on the shared database. That is a drive that looks perfect while testing the wrong data. No machinery can detect it; you are the detector.

Grep the app's entry points and config for env loading and decide, for each, which side wins. Where the process environment loses: propose the fix (usually dropping `override`) and, with the human's agreement, make it in your worktree and commit it — or, if it must stay, record it with `record_event` naming the file and what it breaks, so the first confusing drive is not a mystery.

## The sandbox image

Worker agents do not run on this host; they run in a container. The image runcastle builds carries a JavaScript toolchain and the agent CLIs — Node, Bun, git, curl — and nothing beyond that, so a repo that builds with a JDK, a Python, a Go compiler or a Rust toolchain cannot run its own `setupCommand` there: the round dies on `mvn: not found`. The fix is a Dockerfile committed at **`.runcastle/sandbox/Dockerfile`**. Runcastle detects it, builds it as this project's image, and every round runs in that image from then on.

Read the manifests at the root and in each workspace:

- `pom.xml`, `mvnw` — a JDK and Maven
- `build.gradle`, `build.gradle.kts`, `gradlew` — a JDK and Gradle
- `pyproject.toml`, `requirements.txt` — Python and its installer (pip, or uv where the project uses it)
- `go.mod` — the Go toolchain
- `Cargo.toml` — Rust
- `Gemfile` — Ruby

A mixed repo gets the union. Anything else the project shells out to in its setup or verify commands and the stock image lacks belongs here too — a database client, a protobuf compiler — on the same evidence, that you saw it in the repo.

**A JavaScript-only repo gets no Dockerfile.** The stock image already covers it, and an unnecessary project image is one more thing to build, rebuild and keep fresh in exchange for nothing.

When the project does need one, what you write:

- **It starts `FROM sandcastle:runcastle`** and layers onto it. That base is what keeps the agent CLIs, git and Node present; a Dockerfile from any other base is not a runcastle sandbox.
- **Read the stock Dockerfile before you write a single install line**, rather than assuming its distro or package manager. It is the build context runcastle scaffolds at `~/.runcastle/sandbox-build/Dockerfile` once the image has been built on this machine, and it also ships inside the installed runcastle package as `sandcastle-template/Dockerfile`. Follow its idioms. If you cannot find it, ask the human instead of guessing.
- **The toolchain only, never the project's dependencies.** Dependencies are what `setupCommand` installs per round, from the branch's own manifests.
- **No package caches in layers.** Download caches are mounted into the sandbox from the host.
- **Keep it minimal** — one `RUN` block where the package manager allows it, versions pinned only where the project pins them.

If `.runcastle/sandbox/Dockerfile` is already there, read it and **edit conservatively**. Say what you probed and what you think is missing, and let the human decide.

**You never build the image.** The Workers page in Settings offers **Build image**, and on a successful build runcastle points this project at the image itself. Tell the human the Dockerfile is written (or already right) and that the card now offers Build image.

## Recording what you establish

One `record_finding` call per key, and `evidence` is not optional in spirit: record what you ran and what it printed, or what the human told you. A value with no account of itself is a guess with a source field.

**A key with no value for good is recorded as a "none"**: `record_finding` with an empty `value` and `evidence` saying why ("no database: no driver in package.json, no migrations, no compose file"). That closes the key without a value, so it is not asked about again. Never leave a key open just because its honest answer is "nothing" — and never record a none for a key you merely could not settle; that one stays open, with the reason said in the chat.

`userSupplied` is the one flag worth being careful with. **True** means the human GAVE you this value or confirmed it verbatim — that marks it as theirs and permanently stops automatic runs from overwriting it. Leave it **false** for anything you worked out yourself, even with them watching. Getting this backwards silently retires a field from preparation forever, and the only way back is the human clearing it.

Secrets: this is a development environment and the human has agreed to supply real connection strings and credentials here. Store them as given. Do not paste a secret into a timeline note or a commit message — `record_finding` is the only place a value belongs.

## Closing: the dry-run drive

Once the open drive keys are recorded, run one. Recorded values that have never been driven look exactly as trustworthy as values that run perfectly, and the first person to find out otherwise is someone mid-feature with a broken environment.

**Commit first, then ask.** Commit the scripts in your worktree — `start` lands your commits before it drives. Then ask: this starts services and creates a database on their machine. Name what will run — the setup command, the dev command, the stop command — then wait. If they decline, move on: the keys simply stay unverified.

On a yes, `dry_run_drive({ action })` runs it in two halves and you inspect between them:

1. **`start`** — lands your commits (or refuses, with the reason — see *Where you work*), then the server runs `driveSetupCommand` with the identity variables in the human's checkout, reads back the `.runcastle/drive.env` it wrote (the reply lists the variable NAMES it parsed) and spawns `devCommand` in a real drive pane under that overlay. Identity is the reserved slug `prep-dry-run`, so `RUNCASTLE_ID` is `prep_dry_run` and a script deriving from it makes e.g. `myapp_prep_dry_run`, on the checkout's current branch. Nothing is checked out.
2. **While it is up**, check what the server cannot: the variable names came back as you meant them — and they include the database URL, or whatever the app reaches its data by (point 8). Then: the temp database exists and is FRESH, the migrations applied, and the app actually RESPONDS at the sniffed URL. `status` gives you the pane and the URL while you work.
3. **`stop`** — the server runs `driveStopCommand` under the same overlay. Then check the cleanup: temp database gone, no orphaned process, container or volume left behind.

Anything off at any step, fix it — amend the script in your worktree and commit, or `record_finding` for a key — and run the WHOLE thing again until a pass is clean. Watch especially for a `myapp_prep_dry_run` left standing after the stop: an idempotent setup will happily reuse it on the next start, so a teardown that never worked reads exactly like a drive that did. A dry run that keeps failing is a key you cannot settle: say so and move on.

The verified stamps are computed server-side from what the machinery observed, and only on a clean full pass. You cannot mark your own homework.

Then the summary, one line telling the human that ＋ New scenario in their next test drive sets up scenarios, and the question preparation postponed: what are we building?

## When nothing is open

If your start note says no key is open, there is nothing to prepare. Do not re-derive a settled value unasked — replacing a measured value with a fresh guess makes preparation worse, not better. When you do notice a value is wrong, fix that one key, with evidence.
