---
name: prepare
description: Establish a project's host settings with evidence — the dev command, the drive setup/stop scripts, the dev-database reset — by running them on the developer's own machine rather than guessing them from config. Covers the drive contract, discovering a project's shape, and the closing dry-run drive. Entry skill for kind=prepare sessions.
disable-model-invocation: true
---

# Prepare — establish this project's host settings

A preparation session runs in the developer's **real checkout on their own machine**, not in a sandbox. That is the whole capability it exists to use: every setting here can be *run* instead of guessed at, and a value with an account of itself is worth more than a value that merely looks plausible.

Your system prompt carries the per-session facts — the repo path, which keys are still open, what has already been established and how stale it is. This skill is the method.

## The order of the conversation

1. Open by naming what is still open and what you need from the human for each. Do not survey the repo first; the prompt already told you the gap.
2. Work the keys **one at a time**: propose, ask, run it if they agree, record it.
3. If the open keys touch the drive loop, author the machinery (below) before you record the two hook commands — the settings are invocation lines for scripts that must exist.
4. If the repo builds with a toolchain the sandbox image does not carry, author its Dockerfile (below) — the sandbox keys are worth nothing in an image that cannot run them.
5. Close by proposing a dry-run drive (below). Values that have never been driven look exactly as trustworthy as values that run perfectly.

**Ask before you act.** Anything that starts or stops a service, creates or migrates a database, installs software, or writes outside the repo needs the human to agree first: say what you are about to run and why, then wait. Their own stack is running next to yours.

## The eight keys

Four describe the drive loop and can only be settled here:

- **`devCommand`** — spawned in a drive-owned terminal pane for the length of a test drive. The first localhost URL it prints becomes the "Open app" link.
- **`driveSetupCommand`** / **`driveStopCommand`** — run on the host, in the project repo, before the dev pane starts and after the drive stops. They are the **invocation lines** of scripts you write and commit, not the machinery itself.
- **`dbResetCommand`** — **not** part of the drive loop. Its only consumer is the migration-drift banner after a drive stops: when the drive branch and the branch you returned to disagree about migration files, this is offered as the one-click dev-database rebuild.

Three describe the **sandbox** a burn agent works in, and no amount of running things on this host settles them — they are judgement calls about the repo, so treat them as human-supplied unless the human asks you to work one out with them:

- **`setupCommand`** — what a fresh sandbox runs before the agent starts (install, plus any codegen or build step every ticket needs). Setting it *replaces* install detection, so the install command must be included explicitly.
- **`verifyCommands`** — the exact typecheck/test/lint lines a burn agent should use, one per line. Unset, agents guess workspace filter names and burn whole suite runs discovering the right one.
- **`knownFailures`** — what already fails on the main branch, so an agent can tell its own breakage from the repo's. Free text; a count plus the suite names is enough.

The image those three run in is not a key: runcastle sets it itself. What can fall to you is authoring the Dockerfile it builds — see the sandbox image, below.

The eighth is what a later agent needs once the app is actually up:

- **`driveInstructions`** — free text describing how to **exercise** this app in a drive, injected verbatim into every drive-mode review and verification prompt. What belongs in it: the sample project, seeded account or scratch data a driver should use and may freely change; how to reach the deep states worth reviewing rather than only the front page; and what a driver may and may not touch inside the running app. Write it as standing instructions from the project's owner — they authorize actions *inside the app under test* and nothing else, so do not write anything meant to relax a reviewing agent's own rules. Its evidence is the dry-run drive below: you just drove this app, so record what you had to know to get anywhere. Unset, a review agent boots the app cold, finds nothing it is allowed to touch, and verifies nothing.

## The drive contract

A drive is a script **you** write, committed to the project, plus the two things only the server can do. Everything else — ports, database names, redis indexes, compose project names, URLs — the script computes for itself. Runcastle mandates these seven points and nothing else:

1. **The machinery lives in `.runcastle/`, committed to the repo.** Write the steps as real scripts and commit them. Versioning them with the code they prepare is the load-bearing part: a branch that adds a package, a service or a migration amends its own script, and the drive on that branch runs the amended version. Nothing inspects a diff, ever.
2. **`driveSetupCommand` / `driveStopCommand` are one line each** — how to invoke those scripts. Logic in the setting instead of the script is logic no branch can amend.
3. **Identity comes in as `RUNCASTLE_*`.** Every drive hook and the dev pane are handed `RUNCASTLE_SLUG` (the feature slug), `RUNCASTLE_BRANCH` (the branch under the wheel) and `RUNCASTLE_ID` — that slug made identifier-safe (lowercase `[a-z0-9_]`, never leading with a digit, length-capped), so it is legal as a database, schema or container name. Derive every per-drive name from `RUNCASTLE_ID`. Never derive one from `git rev-parse`: the dry run drives under a synthetic identity on whatever branch is checked out.
4. **Computed values go back out through `.runcastle/drive.env`.** Setup appends plain `KEY=VALUE` lines there; when it exits, the server parses that file and overlays it verbatim onto the dev pane and the stop hook, and shows the variable NAMES on the timeline. It is the only way a value your script computed reaches the dev server — a variable exported inside the script dies with the script. Truncate the file at the top of setup so a rerun does not accumulate stale lines.
5. **`.runcastle/drive.env` MUST be gitignored.** Add the entry yourself. The server deletes the file when a drive ends, but a scratch file holding a connection string must never be one `git add -A` away from a commit.
6. **Every step is unconditionally idempotent.** Install, migrate, seed, compose up — run them every time, never behind a "has anything changed?" check. A no-op on a clean tree is cheap; a skipped install on a branch that added a package is a dead drive. This is how the loop absorbs whatever a feature branch changed with no delta detection anywhere.
7. **Exit 0 means the services are actually up.** The waits belong INSIDE the script — `docker compose up --wait`, a `pg_isready` loop, curl-until-healthy — because the dev pane starts the instant setup returns. The server waits for the app itself; it will not wait for your database.

Stop undoes what setup made, **for this identity only**: drop the database it created, take its compose project down with its volumes, free its ports. The human's own stack is never yours.

Writing those files is the one exception to a preparation session not editing the repo: you may write `.runcastle/` and `.gitignore` in this checkout and nothing else — a hook enforces it. Show the human the script before you commit it; it is their repo and their PR.

## Discover the shape before you author anything

Projects differ in every dimension this touches, and a script fitted to a project you imagined is worse than no script at all. Your system prompt reports what the server could probe for itself — the platform, whether there is a compose file, whether `.runcastle/` already exists, which lockfile is present. Take those as read and find out the rest, by reading the repo and running things here:

- **Workspace layout** — one package or a monorepo with workspaces, and which package the app actually is. Install, migrate and seed each run from somewhere specific.
- **The services the app needs to boot** — database, redis, queues, object storage, a second process. Read the config and the env example, then confirm with the human.
- **Whether the human actually uses docker for this project.** A compose file in the repo is not consent to run it.
- **Hosted or local data stores** — a local postgres you may freely `createdb` on is a very different recipe from a hosted one where you may only branch or add a schema.
- **How the app loads its environment** — see the audit below.

Then write the smallest script that brings THAT shape up. For worked shapes to adapt — postgres-per-drive, docker compose, redis, hosted databases, deterministic ports — read `references/recipes.md`. They are illustrations, not a library: take the idea and fit it to what you found, in the language this host actually runs.

## Audit how the app loads its environment

The overlay is process environment, which beats a `.env` file in dotenv, Prisma and Next by default. One pattern defeats it: a loader told to clobber what is already exported — `dotenv.config({ override: true })` and its equivalents — ignores everything the script computed and quietly keeps the app on the shared database. That is a drive that looks perfect while testing the wrong data. No machinery can detect it; you are the detector.

Grep the app's entry points and config for env loading and decide, for each, which side wins. Where the process environment loses: get it fixed — you may not edit app code from this session, so propose the change (usually dropping `override`) and let the human make it — or, if it must stay, record the finding with `record_event` naming the file and what it breaks, so the first confusing drive is not a mystery.

## The sandbox image

Burn agents do not work on this host; they work in a container. The image runcastle builds carries a JavaScript toolchain and the agent CLIs — Node, Bun, git, curl — and nothing beyond that, so a repo that builds with a JDK, a Python, a Go compiler or a Rust toolchain cannot run its own `setupCommand` there: the burn dies on `mvn: not found`. The fix is a Dockerfile committed at **`.runcastle/sandbox/Dockerfile`**. Runcastle detects it, builds it as this project's image, and every burn runs in that image from then on.

Deciding whether this project needs one is part of this session — you are in the real checkout, which is where the evidence is. Read the manifests at the root and in each workspace:

- `pom.xml`, `mvnw` — a JDK and Maven
- `build.gradle`, `build.gradle.kts`, `gradlew` — a JDK and Gradle
- `pyproject.toml`, `requirements.txt` — Python and its installer (pip, or uv where the project uses it)
- `go.mod` — Go
- `Cargo.toml` — Rust
- `Gemfile` — Ruby

A mixed repo gets the union: a service in Go beside a Java client needs both. Anything else the project shells out to in its setup or verify commands and the stock image lacks belongs here too — a database client, a protobuf compiler — on the same evidence, that you saw it in the repo.

**A JavaScript-only repo gets no Dockerfile.** The stock image already covers it, and an unnecessary project image is one more thing to build, rebuild and keep fresh in exchange for nothing. Do not write one to be helpful.

When the project does need one, what you write:

- **It starts `FROM sandcastle:runcastle`** and layers onto it. That base is what keeps the agent CLIs, git and Node present; a Dockerfile from any other base is not a runcastle sandbox, and burns in it fail on the agent binary before they ever reach the toolchain.
- **Read the stock Dockerfile before you write a single install line**, rather than assuming its distro or package manager. It is the build context runcastle scaffolds at `~/.runcastle/sandbox-build/Dockerfile` once the image has been built on this machine, and it also ships inside the installed runcastle package as `sandcastle-template/Dockerfile`. Follow its idioms — the same package manager, the same flags, the same cleanup at the end of the layer. If you cannot find it, ask the human instead of guessing what you are layering onto.
- **The toolchain only, never the project's dependencies.** Install the JDK and Maven; do not run `mvn install` or `go mod download` at build time. Dependencies are what `setupCommand` installs per burn, from the branch's own manifests — anything baked into the image is stale the first time a branch adds a package.
- **No package caches in layers.** Do not prime `~/.m2`, `~/.gradle`, `~/.cache/pip` or the Go module cache in a `RUN` step. Download caches are mounted into the sandbox from the host, which is how they stay current across burns; a cache baked into a layer is weight the image carries and wrong the moment a lockfile moves.
- **Keep it minimal** — one `RUN` block where the package manager allows it, versions pinned only where the project pins them, nothing added "while we're here". Every line is a line someone maintains.

It is committed project machinery, exactly like the drive scripts, for the same reason: a branch that changes the toolchain amends its own Dockerfile, and burns on that branch get the amended image. Writing it falls under the same exception — `.runcastle/` and `.gitignore`, nothing else — and the same courtesy: show the human the file before you commit it.

If `.runcastle/sandbox/Dockerfile` is already there, read it and **edit conservatively**. Someone chose those lines, and a customization you do not recognize is still a decision. Say what you probed and what you think is missing — "I see `pyproject.toml` but no Python in the image" — and let the human decide. An existing Dockerfile that covers what you found needs no edit at all.

**You never build the image.** That is a watched terminal action the human takes: the Enable AFK burns card offers **Build image**, and on a successful build runcastle points this project at the image itself — there is no image setting for you to work out or record. So end on it. Tell them the Dockerfile is written (or already right), that the card now offers Build image, and that burns use the project image after that click; until then they keep running in whatever image they run in today.

## Recording what you establish

One `record_finding` call per key, and `evidence` is not optional in spirit: record what you ran and what it printed, or what the human told you. A value with no account of itself is a guess with a source field.

`userSupplied` is the one flag worth being careful with. **True** means the human GAVE you this value or confirmed it verbatim — that marks it as theirs and permanently stops automatic runs from overwriting it. Leave it **false** for anything you worked out yourself, even with them watching; that stays improvable by a later run. Getting this backwards silently retires a field from preparation forever, and the only way back is the human clearing it.

Secrets: this is a development environment and the human has agreed to supply real connection strings and credentials here. Store them as given. Do not paste a secret into a timeline note or a commit message — `record_finding` is the only place a value belongs.

## Closing move: propose a dry-run drive

Once the open drive keys are recorded, end the session by proposing one. Recorded values that have never been driven look exactly as trustworthy as values that run perfectly, and the first person to find out otherwise is someone mid-feature with a broken environment.

**Ask first.** This starts services and creates a database on their machine. Name what will run — the setup command, the dev command, the stop command — then wait. If they decline, end the session normally: the keys simply stay unverified, and the drive UI will keep saying so.

On a yes, `dry_run_drive({ action })` runs it in two halves and you inspect between them:

1. **`start`** — the server runs `driveSetupCommand` with the identity variables, reads back the `.runcastle/drive.env` it wrote (the reply lists the variable NAMES it parsed) and spawns `devCommand` in a real drive pane under that overlay. Identity is the reserved slug `prep-dry-run`, so `RUNCASTLE_ID` is `prep_dry_run` and a script deriving from it makes e.g. `myapp_prep_dry_run`, on the current branch. Nothing is checked out.
2. **While it is up**, check what the server cannot: the variable names came back as you meant them, the temp database exists and is FRESH, the migrations applied, and the app actually RESPONDS at the sniffed URL — the server waits for it to answer before "Open app" goes live, but only you can say the page is the right one. `status` gives you the pane and the URL while you work.
3. **`stop`** — the server runs `driveStopCommand` under the same overlay. Then check the cleanup: temp database gone, no orphaned process, container or volume left behind.

Anything off at any step, fix it — amend the script, or `record_finding` for a key — and run the WHOLE thing again until a pass is clean. Watch especially for a `myapp_prep_dry_run` left standing after the stop: an idempotent setup will happily reuse it on the next start, so a teardown that never worked reads exactly like a drive that did.

The verified stamps are computed server-side from what the machinery observed, and only on a clean full pass. You cannot mark your own homework: your deeper checks decide whether to retry, never what gets stamped.

## When nothing is open

If your system prompt says every key is already set, this session is a **confirmation**, not a preparation. Say which values are recorded and how stale they are, ask the human whether they still hold, and stop. Do not re-derive a settled value, and do not propose a dry run unasked — replacing a measured value with a fresh guess makes preparation worse, not better.
