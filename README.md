# runcastle

**runcastle is an opinionated programming system layered on Claude Code — the IDE
to Claude Code's text editor.** Every feature you build gets a persistent session
that moves through phases (ideation → spec → tickets → implementation → review →
shipped). You get grilled on an idea until a spec and a set of tickets fall out;
sandboxed AFK agents burn those tickets on a branch; you test-drive the result and
merge. Human-in-the-loop only at the two ends. It runs as a local web app — a Bun
server on your machine plus a browser UI at `http://localhost:4512`.

New here? Read [`CONTEXT.md`](CONTEXT.md) for the vision and the locked decisions.

---

## Install (users)

runcastle is a global command you install once and run.

```sh
bun add -g runcastle       # install
runcastle doctor           # check prerequisites (see below)
runcastle                  # boot the server + open the app on http://localhost:4512
```

`runcastle --version` prints the installed version. When a newer release is
published an update banner appears in-app naming the exact
`bun add -g runcastle@latest` command — runcastle never installs anything for you.

### Prerequisites

runcastle drives real tools on your machine, so a few things must already be
present. Run `runcastle doctor` any time — it probes each one and prints a
copy-pasteable fix for whatever is missing (`runcastle doctor --gate` is the
stricter pre-boot gate that stops only on the must-haves).

**Required to run runcastle at all:**

- **[Bun](https://bun.sh) 1.3.14+** — the runtime. Install:
  `curl -fsSL https://bun.sh/install | bash` (Windows:
  `irm bun.sh/install.ps1 | iex`).
- **[Claude Code](https://claude.com/claude-code)** — the engine runcastle drives.
  Install: `curl -fsSL https://claude.ai/install.sh | bash` (Windows:
  `irm https://claude.ai/install.ps1 | iex`), then log in with `claude`. **This
  needs a paid Claude plan** (Pro, Max, Team, Enterprise, or Console) — the free
  Claude.ai plan has no Claude Code access.
- **[Git](https://git-scm.com)** — runcastle branches, worktrees, commits, and
  merges on your behalf. It also needs an identity to commit under; the first-run
  wizard collects one, or set it yourself:
  `git config --global user.name "…" && git config --global user.email "…"`.
- **[Node.js](https://nodejs.org) 22+ — on Windows.** Even though runcastle is a
  Bun app, the embedded terminal uses a `node`-hosted PTY sidecar on Windows
  (node-pty's ConPTY pipe misbehaves under Bun). Windows without `node` on PATH
  gets terminals that instantly exit. On Linux `node` is only needed to build
  node-pty from source if the vendored prebuild doesn't apply (see
  [Troubleshooting](#troubleshooting)); on macOS it isn't needed.

Platform baselines: macOS 13+, Windows 10 1809+ (64-bit), or a modern Linux.

**Only for AFK (sandboxed) burns** — skip these if you just want interactive
sessions:

- A **container runtime** — Docker or Podman. See
  [The AFK sandbox](#the-afk-sandbox-docker-first) below.
- An **AFK auth token.** Run `claude setup-token` on this machine (it prints a
  long-lived OAuth token — a Claude subscription is required) and put
  `CLAUDE_CODE_OAUTH_TOKEN=…` in `~/.runcastle/.env`. Each user authenticates
  against their own subscription; nothing routes through runcastle.

### First run

1. Run `runcastle` and open `http://localhost:4512`.
2. On a fresh machine a short **first-run wizard** appears:
   - **Git identity** — the one hard step; runcastle commits docs and merges for
     you, so it writes your name/email to `git config --global`. (Skipped
     automatically if you already have one.)
   - **Enable AFK burns** — an optional card to set up the sandbox and auth token
     now, or skip and do it later.
   - **Open your first project** — point runcastle at a git repo.
3. Inside a project you drive the loop: **create a feature** → a Claude Code
   terminal opens with the feature's context and skills pre-injected and grills
   you → a **spec + tickets** land in the review card → click **burn** and AFK
   agents implement each ticket on the feature branch → **test-drive** the branch →
   **merge**.

That's nothing-to-first-session. AFK burns need the sandbox below; interactive
grilling and spec work do not.

---

## The AFK sandbox (Docker-first)

AFK ticket burns run inside a container via
[sandcastle](https://github.com/mattpocock/sandcastle) (`@ai-hero/sandcastle`).
Docker is the default and
the smoothest path; Podman is a fully supported free alternative (see the
licensing note). After installing a runtime, build the image once —
`sandcastle docker build-image` — because nothing builds it for you; `runcastle
doctor` reports when the image is missing.

### Docker

| Platform | What you need |
|---|---|
| **Linux** | **Docker Engine is enough — Desktop is not required.** After installing, run `sudo usermod -aG docker $USER` and re-login, or every call needs `sudo`. |
| **Windows** | **Docker Desktop.** Floor: **Windows 10 22H2** (build 19045) or Windows 11, 64-bit, with **WSL2** (the default backend) or Hyper-V, virtualization enabled in BIOS/UEFI, 8 GB RAM. |
| **macOS** | **Docker Desktop**, current or one of the two previous major macOS releases. |

Start the daemon (Docker Desktop, or `sudo systemctl start docker` on Linux)
before a burn — `runcastle doctor` tells you if the CLI is installed but the
daemon isn't responding.

> ### ⚠️ Docker Desktop licensing — read this before using it at work
>
> **Docker Desktop is free** for personal use, education, non-commercial open
> source, and small businesses — but a **paid subscription is required** for
> larger organizations and for government entities. This binds *the organization
> running Docker Desktop*, not the tool recommending it: runcastle being open
> source grants you nothing here, and using it for work at a large company means
> Docker Desktop needs a license even on a personal account.
>
> The exact thresholds change — check the current terms at
> **[docker.com/pricing](https://www.docker.com/pricing/)**. If you're not covered,
> use **Podman** instead — it has no such restriction.

### Podman (free alternative)

[Podman](https://podman.io) is Apache-2.0 with no employee/revenue threshold and
no commercial-use restriction. The CLI alone is enough — Podman Desktop is
optional. sandcastle drives whichever runtime is on your PATH.

- **Linux:** `dnf install podman` / `apt install podman` / `pacman -S podman`.
  Native and rootless — no VM.
- **Windows:** `winget install -e --id RedHat.Podman`, then
  `podman machine init && podman machine start`. Install WSL first with
  `wsl --install` if you haven't.
- **macOS:** the official installer, then `podman machine init && podman machine
  start`. (Podman's docs discourage the Homebrew build.)

---

## Contributing / hacking on runcastle

The steps above install the published command. To work on runcastle itself, run it
from source:

```sh
git clone https://github.com/MuathZahir/runcastle
cd runcastle
bun install            # install the workspace (never npm/pnpm/yarn)
bun run dev            # server (4512) + web dev server (4513), concurrently
```

Other dev commands:

- `bun run typecheck` — `tsc --noEmit` across the typed packages.
- `bun run test` — the Vitest suite (core contracts + server services/git/hooks/
  mcp/burner).
- `bun run scripts/smoke.ts` — a scripted end-to-end run against a throwaway repo
  and a real host `claude`.

The packages (Bun workspaces, TypeScript strict, ESM only):

| Package | Name | Role |
|---|---|---|
| `packages/core` | `@runcastle/core` | IO-free contracts: zod schemas, drizzle schema, pipeline/gates, paths, workflow types, config. |
| `packages/server` | `@runcastle/server` | Hono + tRPC + services + launcher + MCP + workflows. Runs TS directly with Bun, no build step. |
| `packages/skills` | `@runcastle/skills` | Vendored/forked Claude Code skill packs + the ticket-burner prompt template. |
| `apps/web` | `@runcastle/web` | Vite + React + tRPC client + TanStack Query. |

Read [`CLAUDE.md`](CLAUDE.md) for conventions and [`docs/SPEC.md`](docs/SPEC.md)
for the contracts before implementing anything.

---

## Troubleshooting

Start with `runcastle doctor` — it names the exact failing prerequisite and the
fix. Beyond that:

- **`bun`/`runcastle` not found on Windows after install.** Add
  `%USERPROFILE%\.bun\bin` to your PATH.
- **Bun install fails on a fresh Linux box.** The installer needs `unzip`
  (`sudo apt install unzip`). An `Illegal Instruction` crash means your CPU lacks
  AVX2 — use Bun's `x64-baseline` build.
- **The embedded terminal won't start / instantly exits.** node-pty's native
  binary (`pty.node`) is missing. runcastle's postinstall bridge copies a vendored
  Linux prebuild into place, and doctor / first-run assert the binary is actually
  on disk (a repeat `bun install` exits `0` even when it's still missing, so the
  disk check is what catches it). Re-run `bun install`; if it still fails you're
  either without a C++ toolchain or on musl (below).
- **musl / Alpine Linux.** The vendored prebuild is glibc-only and can't load
  under musl, so node-pty must be built from source:
  `apk add build-base python3` then `bun install`.
- **Podman on Windows can't mount your files (WSL bind-mount gap).** A Podman
  machine is its own WSL distro and can't see paths inside *your* WSL distro;
  Windows drive paths (mounted at `/mnt/c`) do work. runcastle's data dir is
  `~/.runcastle/`, so the common Windows case is fine — but running runcastle
  *inside* WSL against a Podman machine will fail its bind mounts.
- **AFK burns fail with an auth error.** Make sure `CLAUDE_CODE_OAUTH_TOKEN` is in
  `~/.runcastle/.env` (from `claude setup-token`); doctor checks for it.
