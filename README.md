<p align="center">
  <img src="site/assets/readme-banner.png" alt="runcastle. Stop babysitting your coding agents. Talk an idea through once, get back a branch to test drive. Claude Code or Codex builds it unattended. The stages of a feature stand on top of the runcastle workspace." width="100%" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/runcastle"><img alt="npm version" src="https://img.shields.io/npm/v/runcastle?color=4f8ef7&labelColor=0a0c11&logo=npm&logoColor=white" /></a>
  <a href="LICENSE"><img alt="License: FSL-1.1-ALv2" src="https://img.shields.io/badge/license-FSL--1.1--ALv2-4f8ef7?labelColor=0a0c11" /></a>
  <img alt="Platforms: macOS, Windows, Linux" src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-0a0c11?labelColor=0a0c11&color=262b36" />
  <img alt="Runs on Claude Code or Codex" src="https://img.shields.io/badge/runs%20on-Claude%20Code%20%7C%20Codex-4f8ef7?labelColor=0a0c11" />
</p>

<p align="center">
  <b>Idea in, merged branch out. On your machine, in your repo.</b>
</p>

<p align="center">
  <a href="https://runcastle.dev">Website</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#install">Install</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#the-loop">The loop</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#on-your-phone">On your phone</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#claude-code-or-codex">Claude Code or Codex</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#contributing">Contributing</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#troubleshooting">Troubleshooting</a>
</p>

---

Every feature you build gets its own chat, its own branch and its own memory,
and moves through four stages: **Planning, Build, Review, Shipped**. You talk
the idea through with its agent until there is a plan and a set of tickets.
Once you say yes to the plan, rounds of sandboxed workers build those tickets on
the feature's branch while you are elsewhere. You test drive the result and
merge.

Everything between your yes and the merge runs without you, so several features
move at once and the sidebar only flags the ones actually waiting on you.

It runs entirely on your machine: a Bun server plus a browser UI at
`http://localhost:4512`. There is no runcastle account and no hosted backend.

<p align="center">
  <img src="site/assets/screens/tickets.png" alt="A feature in Planning with ten tickets in dependency order, each after the ones it needs, and a button to start the first round as the one next step" width="100%" />
</p>

> New here? [runcastle.dev](https://runcastle.dev) has the sixty-second film,
> and [`CONTEXT.md`](CONTEXT.md) has the vision and the locked decisions.

---

## Install

```sh
curl -fsSL https://runcastle.dev/install.sh | bash     # macOS and Linux
```

```powershell
irm https://runcastle.dev/install.ps1 | iex            # Windows
```

It installs Bun and runcastle, then shows one list: what is already there, what
it will install (each line saying if it needs `sudo`), and what you do
afterwards. One yes installs the lot; `--yes` answers for you on a server. It
only lists what is missing, so it is safe to run again. On Windows and macOS it
guides you through Docker Desktop instead of installing it, and sign-ins always
stay yours. Both scripts can be read at those addresses before you run them.
Then run `runcastle` and open the address it prints (`http://localhost:4512`);
it does not open a browser by itself.

By default runcastle sends an anonymous usage ping at boot, and tells you in the
first-run wizard before it sends anything. Turn it off in Settings → General or
with `DO_NOT_TRACK=1`; [the Usage signal section](#usage-signal) has the details.

On a VPS, [the VPS guide](https://runcastle.dev/docs/vps/) goes from a fresh
login to a running, reachable runcastle.

### Install by hand

```sh
bun add -g runcastle       # install
runcastle doctor           # check prerequisites
runcastle move user@host   # move runcastle to another machine (add --dry-run to look first;
                           # --with-env, --with-claude-setup and --also carry more)
runcastle                  # boot the server and print its address, http://localhost:4512
```

`runcastle --version` prints the installed version. When a newer release is
published an in-app banner names the exact `bun add -g runcastle@latest`
command.

### Prerequisites

The install handles these for you. Run `runcastle doctor` at any time: it
probes each one and prints a copy-pasteable fix for whatever is missing.
(`runcastle doctor --gate` is the stricter pre-boot gate that stops only on the
must-haves.)

| Needed | Requirement | Why runcastle needs it |
|---|---|---|
| **To run runcastle** | **[Bun](https://bun.sh) 1.3.14+** | The runtime. `curl -fsSL https://bun.sh/install \| bash`, or `irm bun.sh/install.ps1 \| iex` on Windows. |
| **To run runcastle** | **A coding agent: [Claude Code](https://claude.com/claude-code), [Codex](https://developers.openai.com/codex), or both** | The engines runcastle drives. You need at least one, signed in. **Claude Code** needs a paid Claude plan (Pro, Max, Team, Enterprise, or Console); install it, then log in with `claude`. **Codex** installs with `curl -fsSL https://chatgpt.com/codex/install.sh \| sh`, or `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 \| iex"` on Windows; log in with `codex login`, on a ChatGPT plan or an API key. Use these standalone installers rather than npm: an agent installed through npm or `bun add -g` is a Node script and needs Node, which runcastle itself does not. |
| **To run runcastle** | **[Git](https://git-scm.com)** | runcastle branches, worktrees, commits, and merges on your behalf. It also needs a commit identity: the first-run wizard collects one, or set it yourself. |
| **Before your first round** | **A container runtime: Docker or Podman, running** | Workers build tickets inside a container. See [The unattended sandbox](#the-unattended-sandbox). |
| **Before your first round** | **Agent credentials** | For **Claude Code**, run `runcastle token`: it has you run `claude setup-token` and saves the token to `~/.runcastle/.env` (`--stdin` reads it from a pipe). For **Codex**, run `codex login`; workers borrow the credentials the login wrote. |

Platform baselines: macOS 13+, Windows 10 1809+ (64-bit), or a modern Linux.

You can install and talk a feature through without the last two rows, but the
first round of workers cannot build anything until both are in place. Either
way you authenticate against your own subscription; nothing routes through
runcastle. (A `CODEX_API_KEY` you put in `~/.runcastle/.env` by hand still wins
over the borrowed login, if you would rather bill an OpenAI API key.)

### First run

1. Run `runcastle` and open the address it prints, `http://localhost:4512`.
2. On a fresh machine a short **first-run wizard** appears:
   - **Welcome.** Says what runcastle is, and what the usage ping sends, with a
     checkbox (ticked by default) before anything is sent.
   - **Git identity.** The one hard step. runcastle commits docs and merges for
     you, so it writes your name and email to `git config --global`. Skipped
     automatically if you already have one.
   - **Coding agents.** Claude Code and Codex side by side: which are
     installed, which are signed in, and a button that runs the login for the
     ones that are not. One is enough.
   - **Unattended workers.** Skippable: set up the sandbox and credentials now,
     or later. You need them before your first round can build anything.
   - **First project.** Point runcastle at a git repo.
3. **Prepare the project.** One chat, once, that records how your repo
   installs, verifies, and runs, so no agent has to guess.
4. Start something from the sidebar's **+** menu: **New chat** opens a chat
   with the orchestrator, **Add to backlog** parks a feature for later, and
   **Jot a note** takes a note. A new chat is the place to bring an idea or a
   complaint; the orchestrator turns it into a feature.

Terms like *round*, *worker* and *test drive* are explained in the app: the
**?** icon in the sidebar's bottom row opens the Glossary (so does Ctrl+K), and
a dotted underline on a word explains it where you first meet it.

---

## The loop

A feature moves through four stages, and the app always names the one next
step. You are asked twice: say yes to the plan, then merge.

| Stage | What happens |
|---|---|
| **Planning** | You talk the idea through with the feature's agent, a real agent terminal with the brief, the rules and runcastle's skill pack pre-injected. The decisions and the plan are written into your repo under `docs/features/<slug>/`, split into small tickets in dependency order, each with a model picked for it. **You say yes to the plan in the chat.** |
| **Build** | Rounds of workers build the tickets inside containers, in parallel, committing to the feature's branch. You can close the tab. |
| **Review** | A review round checks the result: it test drives the running app, records a walkthrough, runs your checks, and fixes what it finds. It leaves a review package of the verdict, the checks and the walkthrough. Then you test drive the branch yourself. **You merge.** |
| **Shipped** | The branch is merged. The plan, decisions and round history stay queryable. |

### Build: workers build tickets in parallel

Every unblocked ticket starts at once, each with its own sandboxed worker, each
on its own model. Workers land their commits on the feature branch, and a ticket
that fails says why, with retry, retry on another model, and waive one click
away.

<p align="center">
  <img src="site/assets/screens/build.png" alt="A round in progress: two tickets done, three being built in parallel on gpt-6-sol, claude-sonnet-5-5 and gpt-6-sol, the rest queued, with a cancel action" width="100%" />
</p>

### Review: the agent test drives it first

Before you look, a review round runs the app, clicks through the feature, and
records it. Defects it finds become fix tickets and are built in the same round;
a second pass verifies the fixes. You get a verdict, the checks, and the
walkthrough, and the one next step is **Merge & ship**.

<p align="center">
  <img src="site/assets/screens/review.png" alt="A feature in Review: verified by a test drive with checks 2 of 2 passed, 3 of 3 tickets landed, Merge and ship as the primary action, and the review round's recorded walkthrough of the app below" width="100%" />
</p>

---

## Beyond one feature

### The orchestrator

Every feature has its own chat; the orchestrator is the one that does not. It
is the project-level agent, for the part that happens *before* a feature
exists. Bring it a complaint, a screenshot, a paragraph from a customer. It
checks the idea against what is already built and in flight, talks through what
is left, and cuts the rest into features, backlog items, or a quick change.

<p align="center">
  <img src="site/assets/screens/project-chat.png" alt="An orchestrator chat in a real Claude Code terminal. Given an idea for a shared team feed with a Friday recap email, the agent reports that two-thirds of it is already in flight in two existing features, lists what neither covers, and asks the first deciding question" width="100%" />
</p>

It runs in a worktree runcastle owns, on `runcastle/project`, never in your
checkout. It is also where `CONTEXT.md`, the project's standing decisions, gets
written.

The **backlog** holds features you parked: a title, a one-liner and an optional
brief, with no branch cut and nothing committed. You add to it from the **+**
menu, and feature chats park the scope they find that does not belong to them.
**Start** cuts the branch and opens Planning.

### Test drive, and jot what you notice

**Test drive** runs the app inside runcastle, with the app on the left and your
notes on the right. Drive a feature's branch before you merge it, or what has
shipped on `main`. A note can take a pasted screenshot, and it remembers the
branch and commit it was written against.

<p align="center">
  <img src="site/assets/screens/drive.png" alt="A test drive of main: the shiplog demo app running inside runcastle, with a Notes panel listing the note just taken on this drive above three notes already open" width="100%" />
</p>

You do not have to be driving to take one. **Ctrl+J** (**⌘J** on a Mac) opens
a note anywhere in the app, even with focus in a terminal:

<p align="center">
  <img src="site/assets/screens/note.png" alt="The Ctrl+J note popover open over a feature page, with a typed note, Paste a screenshot, and save, new line and close shortcuts" width="100%" />
</p>

Notes collect in the project's inbox. **Triage** opens an orchestrator chat that
clusters them into themes, goes through them one theme at a time, and routes
each one: a new feature, a batch of quick changes, another round on an existing
feature, or nothing.

<p align="center">
  <img src="site/assets/screens/project.png" alt="The orchestrator: the project's chats, and the Notes panel with three open notes and a Triage 3 button" width="100%" />
</p>

---

## Claude Code or Codex

runcastle drives either agent, and you can mix them. The runtime is a property
of the *model*, so you choose models, not vendors:

- **Per step.** A default model, then one each for planning chats, the
  orchestrator, implementation, and review. Plan with Claude and build on Codex,
  or the other way round.
- **Per ticket.** Give a model a use-case note in Settings and the planning
  agent may assign it to the tickets that fit. Reassign any queued ticket
  yourself, even mid-round.
- **Per project.** A project can pin its own model and override the machine
  default.

Both runtimes get the same treatment: the same phase rules and skill pack, the
same lifecycle hooks, the same runcastle MCP server, the same sandbox. The model
roster refreshes itself from each CLI, so a new model shows up without a
runcastle release.

---

## The unattended sandbox

Rounds of workers run inside a container via
[sandcastle](https://github.com/mattpocock/sandcastle) (`@ai-hero/sandcastle`).
Docker is the default and smoothest path; Podman is a fully supported free
alternative. The first round builds the image if it is missing, which takes a
few minutes. To build it ahead of time, run `runcastle build-image`, or click
Build image in Settings → Workers.

<details>
<summary><b>Docker setup, per platform</b></summary>

<br />

| Platform | What you need |
|---|---|
| **Linux** | **Docker Engine is enough, Desktop is not required.** After installing, run `sudo usermod -aG docker $USER` and re-login, or every call needs `sudo`. |
| **Windows** | **Docker Desktop.** Floor: **Windows 10 22H2** (build 19045) or Windows 11, 64-bit, with **WSL2** (the default backend) or Hyper-V, virtualization enabled in BIOS/UEFI, 8 GB RAM. |
| **macOS** | **Docker Desktop**, current or one of the two previous major macOS releases. |

Start the daemon (Docker Desktop, or `sudo systemctl start docker` on Linux)
before a round. `runcastle doctor` tells you if the CLI is installed but the
daemon is not responding.

</details>

> [!IMPORTANT]
> **Docker Desktop licensing, if you are using this at work.**
> Docker Desktop is free for personal use, education, non-commercial open
> source, and small businesses, but a **paid subscription is required** for
> larger organizations and government entities. This binds *the organization
> running Docker Desktop*, not the tool recommending it: runcastle being open
> source grants you nothing here. The exact thresholds change, so check
> [docker.com/pricing](https://www.docker.com/pricing/). If you are not
> covered, use **Podman**, which has no such restriction.

<details>
<summary><b>Podman setup (free alternative)</b></summary>

<br />

[Podman](https://podman.io) is Apache-2.0 with no employee or revenue threshold
and no commercial-use restriction. The CLI alone is enough; Podman Desktop is
optional. sandcastle drives whichever runtime is on your PATH.

- **Linux:** `dnf install podman` / `apt install podman` / `pacman -S podman`.
  Native and rootless, no VM.
- **Windows:** `winget install -e --id RedHat.Podman`, then
  `podman machine init && podman machine start`. Install WSL first with
  `wsl --install` if you have not.
- **macOS:** the official installer, then
  `podman machine init && podman machine start`. Podman's docs discourage the
  Homebrew build.

</details>

---

## How it works

runcastle is the orchestration, memory, and observation layer. It never rebuilds
the chat UX.

- **Chats** run in **real agent terminals** that runcastle launches with
  context pre-injected. For Claude Code that is a generated brief via
  `--append-system-prompt-file`, per-chat hooks via inline `--settings`,
  stage-scoped skill packs via `--plugin-dir`, and runcastle's own MCP server
  via `--mcp-config`. Codex takes no per-launch flags, so each chat gets its
  own `CODEX_HOME` holding the same things as files: `config.toml`, `hooks.json`,
  `AGENTS.md`, and a copy of your `auth.json`. Terminals are server-owned PTYs
  streamed to an in-app xterm view.
- **Unattended work** runs headless through sandcastle, in a Docker or Podman
  container, committing back to the feature branch.
- **Knowledge lives in your repo** at `docs/features/<slug>/`: spec, decisions,
  research, notes. Versioned and agent-readable, and it outlives the tool.
- **Machinery lives in the app's SQLite** at `~/.runcastle/`: stage state,
  chat links, round history, notes, transcript index.
- **Git topology:** one branch per feature; chats get instant docs-only
  worktrees so several features can be planned in parallel; the
  orchestrator gets its own worktree on `runcastle/project`; the main
  checkout stays reserved for you, with a guarded test-drive switch that stashes
  and restores your work.

### Packages

Bun workspaces, TypeScript strict, ESM only.

| Package | Name | Role |
|---|---|---|
| `packages/core` | `@runcastle/core` | IO-free contracts: zod schemas, drizzle schema, pipeline and gates, paths, workflow types, config. |
| `packages/server` | `@runcastle/server` | Hono + tRPC + services + launcher + MCP + workflows. Runs TS directly with Bun, no build step. |
| `packages/skills` | `@runcastle/skills` | Vendored and forked skill packs, plus the worker prompt template. |
| `apps/web` | `@runcastle/web` | Vite + React + tRPC client + TanStack Query. |
| `site/` | | The static landing page and docs at [runcastle.dev](https://runcastle.dev). No build step. |

The UI follows the **Runcastle Design System**: cool slate neutrals, one blue
accent, Geist and Geist Mono, a hue per phase. `apps/web/DESIGN.md` is the
contract; the tokens live in a Tailwind `@theme` block at
`apps/web/src/theme.css` and the primitives in `apps/web/src/ui.tsx`. See
`apps/web/STYLE.md` for how it is styled.

---

## On another machine

runcastle listens on `127.0.0.1` only, and needs two ports: **4512** for the app
and **4514** for designs (the server port plus two). To use a runcastle running
on a VPS or another computer, forward both over SSH:

```sh
ssh -L 4512:localhost:4512 -L 4514:localhost:4514 user@host
```

then open `http://localhost:4512` on your own machine. Without 4514 the app
loads but the Design view stays empty. Or reach it over Tailscale: the phone
link below serves both ports for you. [The VPS guide](https://runcastle.dev/docs/vps/)
goes from a fresh login to a running, reachable runcastle.

## On your phone

runcastle works from a phone, over a private Tailscale link: nothing is exposed
to the internet.

1. Install [Tailscale](https://tailscale.com/download) on the machine running
   runcastle and on your phone, and sign in to the same account on both.
2. In runcastle open Settings → General → **On your phone**, or use the help
   menu's **Use runcastle on your phone** (or Ctrl+K). Turn the link on.
3. On a tailnet that is new, Tailscale needs HTTPS turned on once. runcastle
   says so and links you to the page; then press Try again.
4. Scan the QR code with your phone, and add the page to your home screen.

On an iPhone, notifications only work from the home-screen app.

---

## Usage signal

On boot, runcastle checks whether a newer version is published and, in the same
request, counts your install as active. That request goes to
`https://ping.runcastle.dev/ping` and carries exactly three things:

| Field | Value |
|---|---|
| `installId` | A random UUID generated on first check. Nothing derived from your machine. |
| `version` | The runcastle version you are running. |
| `platform` | `process.platform` — `darwin`, `linux`, or `win32`. |

Nothing else is sent: no project names, no repo paths, no file contents, no
usage of any feature. The ID lives in plain text at `~/.runcastle/install-id`
(`~/.runcastle-dev/install-id` for `bun run dev`) — delete it and the next boot
generates a new one. The response is the latest published version, which is what
the update banner reads.

The first-run wizard tells you this before anything is sent: a fresh install
sends nothing until you have passed that step, and its checkbox is ticked by
default. An install from before the switch is asked once, in the update banner's
place. To opt out, turn off **Usage ping** in Settings → General, or set
`DO_NOT_TRACK` to any non-empty value other than `0` (that wins over the
switch):

```sh
export DO_NOT_TRACK=1
```

runcastle then skips the ping entirely and asks `registry.npmjs.org` for the
latest version directly — you keep your update notifications. If the endpoint is
unreachable, the check falls back to npm too, and if that fails it stays silent.

---

## Feedback

Found a bug, or something confusing? Report it in the repository's
[GitHub Issues](https://github.com/MuathZahir/runcastle/issues).

---

## Contributing

The steps above install the published command. To work on runcastle itself:

```sh
git clone https://github.com/MuathZahir/runcastle
cd runcastle
bun install            # install the workspace (never npm/pnpm/yarn)
bun run dev            # server (4512) + web dev server (4513)
```

| Command | What it does |
|---|---|
| `bun run typecheck` | `tsc --noEmit` across the typed packages. |
| `bun run test` | The Vitest suite: core contracts plus server services, git, hooks, MCP, and workers. |
| `bun run dev:tool` | Dev-only test-state surgery (see below). |
| `bun run scripts/smoke.ts` | A scripted end-to-end run against a throwaway repo and a real host `claude`. |

Read [`CLAUDE.md`](CLAUDE.md) for conventions and [`docs/SPEC.md`](docs/SPEC.md)
for the contracts before implementing anything. Styling `apps/web`? Read
[`apps/web/DESIGN.md`](apps/web/DESIGN.md) and
[`apps/web/STYLE.md`](apps/web/STYLE.md) first.

`docs/features/` is runcastle's own build record: the plans and decisions for
each feature, made with runcastle.

### The dev data dir

`bun run dev` runs against **`~/.runcastle-dev/`** — its own database, config,
`.env`, logs and worktrees. An installed `runcastle` keeps using `~/.runcastle/`.
The two never see each other, so wiping projects while testing cannot touch your
real work. Both listen on 4512, so run one at a time; the boot line names the
tree it opened. Set `RUNCASTLE_DATA_DIR` to point dev at any other scratch tree.

### `bun run dev:tool`

Test-state surgery the product deliberately refuses to do — hard-delete a
project, force a phase past its gate, replay onboarding. It only ever touches
the dev data dir, and refuses to start if that resolves to `~/.runcastle/`.

```sh
bun run dev:tool status                        # which tree, and what is in it
bun run dev:tool project ls
bun run dev:tool project rm myapp              # by id, name, or `all` (+ --yes)
bun run dev:tool project rm all --yes --branches   # also delete feature/* branches

bun run dev:tool feature ls
bun run dev:tool feature phase my-feature tickets  # phase names are the database's; nothing is checked
bun run dev:tool feature status my-feature archived
bun run dev:tool feature rm my-feature

bun run dev:tool prep reset myapp              # re-test project preparation
bun run dev:tool onboarding reset --yes        # re-test the first-run wizard
bun run dev:tool onboarding git clear          # ...including its git step
bun run dev:tool onboarding git restore        # exact inverse of `git clear`

bun run dev:tool reset --yes                   # delete the whole dev tree
```

Two notes. `onboarding git clear` is the one command that reaches outside the
dev tree — git identity is host-wide, so there is nowhere else it can live; it
saves your values first and `restore` puts them back. And after a destructive
change, restart `bun run dev`: `bun --hot` preserves in-memory chat and round
state that the db no longer backs.

---

## Troubleshooting

Start with `runcastle doctor`. It names the exact failing prerequisite and the
fix. Beyond that:

<details>
<summary><b><code>bun</code> or <code>runcastle</code> not found on Windows after install</b></summary>

<br />

Add `%USERPROFILE%\.bun\bin` to your PATH.

</details>

<details>
<summary><b>Bun install fails on a fresh Linux box</b></summary>

<br />

The installer needs `unzip` (`sudo apt install unzip`). An `Illegal Instruction`
crash means your CPU lacks AVX2; use Bun's `x64-baseline` build.

</details>

<details>
<summary><b>The embedded terminal will not start, or instantly exits</b></summary>

<br />

The terminal is Bun's own, so nothing separate can be missing. When its program
cannot start, the terminal says why.

If terminals stopped working right after a Bun upgrade, go back to the last Bun
that worked: `curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.14"`, or
`iex "& {$(irm https://bun.sh/install.ps1)} -Version 1.3.14"` on Windows.

</details>

<details>
<summary><b>Podman on Windows cannot mount your files</b></summary>

<br />

A Podman machine is its own WSL distro and cannot see paths inside *your* WSL
distro. Windows drive paths (mounted at `/mnt/c`) do work. runcastle's data dir
is `~/.runcastle/`, so the common Windows case is fine, but running runcastle
*inside* WSL against a Podman machine will fail its bind mounts.

</details>

<details>
<summary><b>Rounds fail with an auth error</b></summary>

<br />

It depends which runtime the ticket is built on. For Claude Code, make sure
`CLAUDE_CODE_OAUTH_TOKEN` is in `~/.runcastle/.env`, generated by
`claude setup-token`. For Codex, run `codex login` on this machine — a worker
copies the credentials that login wrote into the sandbox, so a lapsed login is
the usual cause. Doctor checks for both.

</details>

---

## License

[FSL-1.1-ALv2](LICENSE) © Muath Zahir

Runcastle is source-available under the [Functional Source License](https://fsl.software):
free to use, copy, modify, and redistribute for any purpose except offering a
competing commercial product or service. Each release automatically becomes
[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) two years after publication.

Built with runcastle, on Claude Code. Methodology forked and adapted from
[Matt Pocock](https://github.com/mattpocock)'s skills; the sandbox engine by
[sandcastle](https://github.com/mattpocock/sandcastle).
