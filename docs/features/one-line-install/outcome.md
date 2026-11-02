# Outcome — One-line install

One command from runcastle.dev checks what's missing, shows the list, asks one yes, and installs everything it can.

- Shipped: 2026-11-01

## What shipped

25 commits · 38 files

- 4 tickets landed: #1 Install: `runcastle setup` lists what's missing and installs it; #2 Install: the two scripts that start everything; #3 Server: `runcastle token` and `runcastle service`; #4 Words: landing page, README and the VPS guide tell the new story
- 0 waived
- 0 failed

## Review record

### Ticket 5 · review

- Reviewed commit: 9cc79f6301c2ca28b0800000fcc1813810c711cb
- Landed since: 0
- Outcome: done

- **Test gate failed: the Bun terminal kill-tree test left the grandchild alive** — dismissed
- **Token card saves a token with a space inside it and reports it captured** — fixed
- **Token card: short values refused with the cut-off message; a valid token saved twice leaves one line** — open
- **Nine of ten criteria are about scripts and the CLI and were not verified in this drive** — open

## Notes record

- No human notes

## Per-ticket digests

### 1. Install: `runcastle setup` lists what's missing and installs it

# Ticket 1 — `runcastle setup`

**What was done.** `doctor.ts` now exports `StandaloneInstaller`, `BUN_INSTALLER`, `AGENT_INSTALLERS` (claude-code, codex), `powershellInstall(url)` and `noNodeDetail(bin)`. The Bun, Claude Code and Codex `installFix` strings are built from these and are byte-identical to before (checked directly, and all doctor tests pass). A new `packages/server/src/setup/` holds:
- `plan.ts`: the pure `buildInstallPlan(report, facts, choice)` → `{ present, install: PlanItem[], afterwards, needsAgentChoice }`, plus `MIN_BUN_VERSION`, `DOCKER_SCRIPT_DISTROS`, `MachineFacts`, and `SetupCommand` (`{file,args}`, with unix pipelines wrapped as `sh -c`).
- `runner.ts`: `runPlan` (runs every item; an item stops at its first failing command, the plan carries on) and the plain-text formatting from preview.html, coloured only when stdout is a TTY.
- `system.ts`: the real machine facts (os-release `ID=`, package managers on PATH, DISPLAY/WAYLAND_DISPLAY, `SERVICE_FILE = /etc/systemd/system/runcastle.service`), a step runner with inherited stdio and no timeout (it uses `resolveSpawnTarget`), the PATH extension, and a raw-mode one-keypress prompt.

`bin/setup.ts` replaces the stub and follows build-image.ts: it exports `SETUP_USAGE` and takes an injected `SetupDeps`. It uses the gate-mode doctor, so there is no live token call.

**Tests.** `setup-plan.test.ts` covers a fresh Ubuntu VPS, a Mac with and without Homebrew, Windows with and without winget, Arch, a second run, and a fully installed machine. It also checks Docker on the 8 distro IDs versus others, that a working Docker or Podman adds nothing, a dead daemon, the agent choice, a Node-script reinstall, stale agents and Bun, and that a tool new enough but not the latest is left alone. `setup-runner.test.ts` covers the whole flow: prompts, `--yes`, `--agent`, no terminal, a failed item not stopping the others, the doctor running again, refusing root on Linux and macOS, and bad flags.

**Choices and deviations.** The Mac preview ends its afterwards list with "Run runcastle doctor to check it". I left that out because the ticket's afterwards list doesn't include it. The afterwards order follows the ticket, so Docker Desktop comes before sign-in, which differs from the Windows preview. "Open a new terminal" is triggered only by Windows installs and by installing Bun itself. That matches the VPS preview, which doesn't show it. A missing Bun row becomes a "Bun" install item using Bun's installer. Answering "n" at the yes returns 1. After the install, the afterwards steps come from the first plan, so "log out" still shows even when Docker's group isn't active yet. Versions in stale-agent labels are read from the adapter-version row's detail text.

**Surprises.** None in the code. A real run here (Debian, no TTY) printed stale Claude Code and Codex updates plus Docker, then exited 1 as designed.

**Left undone.** Ticket 3's `runcastle service install` should reuse `SERVICE_FILE` from `setup/system.ts`. The doctor's own Git fix line ("winget install Git.Git / brew install git / apt install git") is still prose and separate from setup's Git commands, because the ticket only asked for the agent installers to be extracted. Drive machinery needs no change, since this adds no service, env var, seed or process. I didn't run any drive scripts.
