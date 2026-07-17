# Fresh-machine prerequisites — Claude Code + sandcastle + Bun

Research asset for [#17](https://github.com/MuathZahir/runcastle/issues/17), under the publish map
[#12](https://github.com/MuathZahir/runcastle/issues/12). Answers: **what does a fresh Windows /
macOS / Linux machine need before runcastle works end-to-end, what can we detect programmatically,
and what can we automate vs. only document?**

Sources: the runcastle tree at `2571888` (file:line cited inline); Claude Code docs via ctx7
(`/llmstxt/code_claude_llms_txt`, sourced from `code.claude.com/docs/en/*`); Docker/Podman/Bun
official docs (URLs inline); `docs/research/SANDCASTLE-NOTES.md`. Verified **2026-07-17** — the
version and licensing facts below rot; see [Staleness](#staleness).

> Scope note: this is the *prerequisite* surface only — what must be true of the machine before
> runcastle runs. It does not cover distribution (how runcastle itself is installed), which is a
> separate open question on the map.

---

## 1. The headline

**runcastle currently has zero prerequisite detection.** No doctor, no preflight, no probe —
grep for `doctor|preflight|prerequisite|which(|lookpath|command -v` finds only UI server-health
dots (`apps/web/src/components/StatusBar.tsx:23`) that merely reflect whether a tRPC query
succeeded. Six distinct external dependencies all **fail late**, and three fail with a *misleading*
message because their resolvers fall back to a bare binary name instead of erroring:

| Missing thing | How it surfaces today | Honest? |
|---|---|---|
| `claude` | `resolveClaudeExecutable` returns bare `'claude'` (`launcher.ts:203`) → spawn fails → `session.spawn_failed` event (`launcher.ts:660-671`) | Timeline event only |
| `node` (Bun+win32 PTY sidecar) | `resolveNodeExecutable` returns `'node'` (`pty-sidecar.ts:43`) → `child.on('error')` → `fireExit(1)` (`pty-sidecar.ts:153-156`) | Terminal instantly exits — **near-silent** |
| `git` | `assertRepo` reports **"not a git repository"** (`git.ts:86`) | **Misleading** — blames the repo |
| git identity | fails inside `commitDocs` (`git.ts:483`) *after* a session did its work | **Late** — work already done |
| Docker daemon / image | discovered inside sandcastle's `run()` mid-burn → generic `{status:'failed', error}` per ticket (`ticket-burner.ts:643`) | Generic |
| `bun` inside a session | hooks fail; `hook-client.ts:61-66` swallows all errors and exits 0 **by design** → session never registers, never goes `live` | **Silent** |

The single genuine precheck is the docker auth-token gate (`ticket-burner.ts:481-484`,
`research.ts:93-96`) — and it fires *after* the run row is created, checks only token **presence**
(not validity), and is skipped entirely for `noSandbox`.

Against the map's standing preference ("streamline setup as much as possible — absorb every
prerequisite we can into first-run automation"), the gap is not the installs. **It's that nothing
tells the user what's wrong.** Ranked by value: honest detection ≫ automated install.

---

## 2. The prerequisite surface

Two tiers. **Tier 1** is needed to run runcastle at all; **Tier 2** only for Docker-sandboxed AFK
burns (`config.sandbox: 'docker'`, the default — `packages/core/src/config.ts:15`).

| # | Prereq | Tier | Why runcastle needs it | Platforms |
|---|---|---|---|---|
| 1 | **Bun** | 1 | Hard runtime coupling: `Bun.serve` (`index.ts:93`), `bun:sqlite` via `drizzle-orm/bun-sqlite`, `import.meta.main` (`index.ts:120`) — **and** generated hook commands `bun run "<hook-client.ts>"` (`artifacts.ts:285-288`), so `bun` must also be on PATH *inside every spawned session* | all |
| 2 | **Claude Code CLI** | 1 | The product. Spawned per session (`launcher.ts:631-672`) | all |
| 3 | **Claude Code auth** | 1 | Interactive sessions inherit host login; AFK burns need `CLAUDE_CODE_OAUTH_TOKEN` (`ticket-burner.ts:672`) | all |
| 4 | **Claude paid account** | 1 | Pro/Max/Team/Enterprise/Console — **the free Claude.ai plan has no Claude Code access** | all |
| 5 | **Git** | 1 | `simple-git` shells out; worktrees, commits, merges (`git.ts` throughout) | all |
| 6 | **Git identity** | 1 | `commitDocs` (`git.ts:470-484`) relies on ambient `user.name`/`user.email` — never set or checked | all |
| 7 | **`node`** | 1 | PTY sidecar is the **default backend under Bun on win32** (`pty.ts:119-139`) — node-pty v1.1.0's ConPTY input pipe throws `ERR_SOCKET_CLOSED` under Bun, silently dropping keystrokes (`pty.ts:10-19`) | **win32** (+ Linux, see #9) |
| 8 | **Container runtime** | 2 | sandcastle shells out to the `docker`/`podman` CLI on PATH — no npm peer dep, no SDK, no socket (`SANDCASTLE-NOTES.md:10`) | all |
| 9 | **C++ toolchain + python3** | 1 | **Linux only** — node-pty has no linux prebuild; see §7 | **linux** |

---

## 3. Claude Code

### Install — scriptable everywhere

| Platform | Command |
|---|---|
| Windows (PS) | `irm https://claude.ai/install.ps1 \| iex` |
| Windows (CMD) | `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` |
| macOS / Linux / WSL | `curl -fsSL https://claude.ai/install.sh \| bash` |
| Package managers | `winget install Anthropic.ClaudeCode`, `brew install --cask claude-code`, apt/dnf/apk |
| npm | `npm install -g @anthropic-ai/claude-code` (needs Node ≥22 to *install*; no sudo) |

Native install is recommended — self-contained binary, **Node not required at runtime**, auto-updates
in the background. The npm package installs the same native binary; the resulting `claude` does not
itself invoke Node. Source: [code.claude.com/docs/en/setup](https://code.claude.com/docs/en/setup).

**Baseline requirements:** macOS 13.0+ / Windows 10 1809+ (64-bit only — 32-bit Windows unsupported)
/ Ubuntu 20.04+ / Debian 10+ / Alpine 3.19+; 4 GB+ RAM; x64 or ARM64; internet.

### Auth — two paths, and runcastle uses both

- **Interactive sessions:** the launcher passes **no token**. It inherits `process.env`
  (`launcher.ts:641-645`) and relies on the host `claude` already being logged in
  (`claude` → `/login`). It *deletes* 8 CC nesting vars before spawn (`CC_NESTING_ENV`,
  `launcher.ts:620-629`) so a session launched from inside Claude Code doesn't inherit the parent's
  identity.
- **AFK burns:** `claude setup-token` on the **host** prints a long-lived OAuth token (printed, not
  saved — a Claude subscription is required). runcastle reads `CLAUDE_CODE_OAUTH_TOKEN` from
  `~/.runcastle/.env`, falling back to `process.env` (`ticket-burner.ts:662-674`,
  `research.ts:310-322`), and injects it per-run via
  `claudeCode(model, { env: { CLAUDE_CODE_OAUTH_TOKEN: token } })` (`ticket-burner.ts:567`).

`ANTHROPIC_API_KEY` is **never referenced in runcastle code** — it exists only as a sandcastle-level
fallback (`SANDCASTLE-NOTES.md:136-138`). The in-container `claude` picks up whichever is present.

> **Env-resolver gotcha** (`SANDCASTLE-NOTES.md:137`): sandcastle only resolves keys *literally
> declared as lines* in `<hostRepoDir>/.sandcastle/.env`; a key in `process.env` with no line there
> is never picked up. Injecting via `claudeCode(model, {env})` **bypasses that gate** — which is
> exactly why `ticket-burner.ts:567` does it. Don't "fix" this into `.env` declaration.

> **Legal note worth a README line:** Anthropic's usage policy states OAuth tokens are for
> subscription plans and API keys for Agent-SDK/Console developers, and that *"third-party
> developers are prohibited from offering Claude.ai login or routing requests through consumer plan
> credentials"* ([legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)).
> runcastle is fine — each user runs `setup-token` on their own machine against their own
> subscription, and nothing routes through us. Worth stating plainly so a stranger doesn't wonder.

### Windows: Git Bash is effectively a hard requirement

Per [setup](https://code.claude.com/docs/en/setup): *"Git for Windows is recommended on native
Windows so Claude Code can use the Bash tool. If Git for Windows is not installed, Claude Code uses
PowerShell as the shell tool instead."*

For runcastle this is **not** a nice-to-have. We inject skill packs and system prompts into every
session (`--plugin-dir`, `--append-system-prompt-file`, `launcher.ts:139-158`); any injected content
assuming POSIX shell will silently behave differently under PowerShell. Escape hatch if Git Bash
isn't auto-found: `CLAUDE_CODE_GIT_BASH_PATH` in settings.json — and note we already write session
`settings.json` (`artifacts.ts`), so **runcastle can set this itself** once it detects Git Bash.

Also: native Windows Claude Code has **no sandboxing support** — only WSL2 does.

---

## 4. Container runtime (Tier 2)

### What sandcastle actually calls

Verified against `node_modules/.bun/@ai-hero+sandcastle@0.12.0/.../dist/*.js`: it spawns the literal
binary `docker` / `podman` — **PATH lookup only, no configurable path, no SDK, no socket**.
Subcommands: `build -t`, `run` (`-d --name -v -w`), `exec`, `stop`, `rm`, `rmi`, `image inspect`.

**sandcastle has no daemon preflight** — no `docker info`, no "is the daemon running" branch. It
spawns and surfaces the raw failure. **runcastle must do its own probe** or users get a cryptic
spawn error mid-burn.

**Nothing builds the image.** `run()` pre-flight-`docker image inspect`s and throws *"Image not
found locally. Build it first with `sandcastle docker build-image`"* — *"it never builds for you"*
(`SANDCASTLE-NOTES.md:122`, restated `:186`). Our server or a setup step must build before the first
`run()` and rebuild on Dockerfile change. Default image name `sandcastle:<repo-dir-name>`
(`:121`); runcastle's `sandboxImage` is optional (`config.ts:22`). Default Dockerfile base
`node:22-bookworm` (`:123`), with Claude Code installed *inside* via `install.sh` at
`/home/agent/.local/bin` (`:128`) — **no bun in the container** (`:129`), which is fine, the
container never runs our hooks.

### Docker

| Platform | Reality |
|---|---|
| **Linux** | **Docker Engine is enough — Desktop is NOT needed.** Recommended: apt repo method. The `get.docker.com` convenience script exists but Docker says *"only recommended for testing and development"*. **Mandatory post-install:** `usermod -aG docker $USER` + re-login, else every call needs sudo and our spawn fails with a *permission* error, not "not found". |
| **Windows** | Docker Desktop required (no native Engine). Win10 22H2 (19045) / Win11 23H2 (22631+), 64-bit, SLAT, 8 GB RAM, virtualization enabled in BIOS/UEFI. WSL2 is the default backend (WSL 2.1.5+). Silent install: `"Docker Desktop Installer.exe" install --quiet --accept-license --backend=wsl-2`. |
| **macOS** | Docker Desktop. Current + two previous major macOS releases. Silent install via `hdiutil attach` + `/Volumes/Docker/Docker.app/Contents/MacOS/install --accept-license --user=<u>`. |

Sources: [engine/install/ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[desktop/setup/install/windows-install](https://docs.docker.com/desktop/setup/install/windows-install/),
[desktop/setup/install/mac-install](https://docs.docker.com/desktop/setup/install/mac-install/).

**Verdict: guided manual step, silent flags for the brave.** Every platform is *technically*
scriptable, but Windows/macOS need a downloaded installer first — Docker documents **no**
first-class package-manager path (no winget, no brew on their own pages). Only Linux is cleanly
scriptable. Auto-installing a hypervisor-backed VM on someone's machine is also a trust ask an OSS
tool shouldn't make unprompted.

### Docker Desktop licensing — the reason Podman matters

Docker Desktop is **free** for personal use, education, non-commercial open source, and small
businesses (**<250 employees AND <$10M annual revenue**). A **paid subscription is required** for
larger organizations (250+ employees **OR** $10M+ revenue — either trigger) and for **government
entities regardless of size**.
([subscription/desktop-license](https://docs.docker.com/subscription/desktop-license/))

This binds **the entity running Docker Desktop, not the tool recommending it** — runcastle being OSS
grants its users nothing. A user at a 5,000-person company running runcastle *for work* is not
covered, even on a personal Docker account. So: **document it plainly and offer Podman**, rather
than burying it. Link [docker.com/pricing](https://www.docker.com/pricing/); don't hardcode prices.

### Podman — the free alternative, not yet wired

Apache-2.0, no employee/revenue threshold, no commercial-use restriction. Podman Desktop (GUI) is
optional — **CLI alone is sufficient** for sandcastle.

- **Linux:** `dnf/apt/pacman install podman`. **No VM** — native, rootless by default.
- **Windows:** `winget install -e --id RedHat.Podman`, then `podman machine init && podman machine start`. The installer **no longer auto-installs WSL** — users run `wsl --install` themselves.
- **macOS:** official installer / GitHub release binaries, then `podman machine init && start`. Podman's docs **explicitly discourage Homebrew** (*"we cannot guarantee the stability"*).

Source: [podman.io/docs/installation](https://podman.io/docs/installation).

**Compatibility for our narrow surface is low-risk.** Podman is ~90-95% flag-compatible with docker,
and the documented gaps sit in areas sandcastle doesn't touch: `docker-compose` (unused), socket/API
emulation (we shell out to the CLI). The one that *could* bite is **rootless volume permissions**
(`:Z` SELinux labels / `keep-id` userns) since sandcastle leans on `-v` bind mounts.

⚠️ **Windows bind-mount gap:** paths inside a user's *own WSL distro* aren't visible to the Podman
Machine (a separate WSL distro). Windows drive paths work (mounted at `/mnt/c`). Since our data dir
is `~/.runcastle/` — a Windows path on Windows — the common case should work, but running runcastle
*inside* WSL against a podman machine will fail mounts. Open issues:
[podman#24928](https://github.com/containers/podman/issues/24928),
[discussion#25127](https://github.com/containers/podman/discussions/25127).

**Blocker:** `config.sandbox` is `'docker' | 'noSandbox'` (`config.ts:15`) — **podman has no enum
member and `sandboxes/podman` is never imported**, though sandcastle exports it. Wiring podman is a
small, well-defined change and is the honest answer to the licensing question. *(Not ticketed here —
this is a research note; see §9.)*

### Windows UID/GID — a non-problem, documented

`process.getuid/getgid` are `undefined` on Windows → sandcastle defaults to hardcoded `1000`,
matching the Dockerfile's `ARG AGENT_UID=1000`, so *"out of the box this generally just works on
Windows"* (`SANDCASTLE-NOTES.md:132`). A mismatch throws a clear pre-flight error, not a silent
EACCES.

---

## 5. Bun

**Current stable: v1.3.14** (2026-05-13, [releases](https://github.com/oven-sh/bun/releases)).

| Platform | Command |
|---|---|
| Windows | `powershell -c "irm bun.sh/install.ps1 \| iex"` |
| macOS / Linux | `curl -fsSL https://bun.sh/install \| bash` |
| Also | npm, Homebrew, Scoop, Docker |

**winget is NOT a documented Bun install method** — don't put it in the README. The irm/curl
one-liners are non-interactive by design, so **Bun is genuinely automatable**.
Source: [bun.com/docs/installation](https://bun.com/docs/installation).

**Caveats worth a troubleshooting section:**
- **Windows:** requires Windows 10 **1809+**. PATH is the #1 post-install complaint — if `bun --version` isn't found, add `%USERPROFILE%\.bun\bin`.
- **Linux:** the installer **requires `unzip`** (`sudo apt install unzip`) — a fresh Ubuntu VM/container often lacks it. Kernel 5.6+ recommended.
- **All platforms:** standard x64 binaries **require AVX2**. An `Illegal Instruction` crash on an older CPU means the user needs an `x64-baseline` build.

### Bun is pinned nowhere — the sharpest own-goal

The single hardest runtime requirement has **no `engines`, no `packageManager`, no `.tool-versions`,
no CI** (there is no `.github/` directory at all). Confirmed by grep across the tree. The only
Bun statements are prose (`README.md:21`, `CLAUDE.md` Conventions) and `bun-types 1.3.14` — the
*types* package, not the runtime (`packages/server/package.json:28`).

Observed drift already: this machine runs **bun 1.3.4** while `bun-types` pins **1.3.14**. Harmless
today, but nothing would catch a real divergence.

---

## 6. Git + identity

`git` is assumed on PATH **unconditionally and unchecked**; `simple-git` shells out to the binary
(`git.ts:6,56`). The nearest thing to a check is `assertRepo` (`git.ts:78-89`), which is scoped to a
user-supplied *path*, not the binary — so a missing `git` is misreported as **"not a git
repository"**.

**Identity is never set or checked.** `commitDocs` (`git.ts:470-484`) relies entirely on ambient
host config, so a machine without identity fails **late — inside the commit, after a session did its
work**. This is the most user-hostile failure on the list and the cheapest to preflight:

```sh
git config --get user.email   # exit 0 + value; exit 1 if unset at every level
git config --get user.name
```

`--get` "returns error code 1" if the key is not present
([git-config](https://git-scm.com/docs/git-config)) — and resolves local > global > system, so exit 1
means genuinely unset everywhere. Exactly the semantics we want. Run it **inside the target repo** so
repo-local overrides are honored.

---

## 7. `node` and the Linux toolchain gap (new finding)

**node-pty 1.1.0 ships prebuilds for `darwin-arm64`, `darwin-x64`, `win32-arm64`, `win32-x64` —
and no linux build at all.** Verified by listing
`node_modules/.bun/node-pty@1.1.0/node_modules/node-pty/prebuilds/`.

Its install hook is `"install": "node scripts/prebuild.js || node-gyp rebuild"`. `prebuild.js` exits
0 if `prebuilds/<platform>-<arch>` exists, else 1 → **`node-gyp rebuild` compiles from source**.

So on **Linux**, `bun install` of runcastle requires **`node`, `python3`, and a C++ toolchain
(`build-essential`)** — and node-gyp itself needs `node`. This is an **install-time** break on the
very platform the map commits to at publish ("Cross-platform at publish: Windows + macOS + Linux"),
and it is *not* covered by any existing note. On Windows/macOS the prebuild short-circuits the
compile, which is why nobody has hit it.

Independently, `node` is **also a runtime requirement on Windows**: the PTY sidecar is the default
backend under Bun on win32 (`pty.ts:119-139`) because node-pty's ConPTY input pipe throws
`ERR_SOCKET_CLOSED` under Bun, silently dropping keystrokes (`pty.ts:10-19`). Non-obvious for a
project that bills itself "Bun everywhere".

> Options exist (vendor a linux prebuild, ship the sidecar differently, drop node-pty on linux) —
> but choosing among them is a **decision**, not research. See §9.

---

## 8. Detectability — presence vs. health

The distinction that matters: **presence** = binary resolvable on PATH; **health** = the thing
behind the binary actually responds. For container runtimes these are very different; for
bun/git/node they're nearly identical.

| Tool | Presence probe | Health probe | Distinct? |
|---|---|---|---|
| **docker** | `docker --version` | `docker info` | **Yes — critical** |
| **podman** | `podman --version` | `podman info` / `podman machine inspect` | **Yes** (Win/macOS: CLI up, machine stopped) |
| **claude** | `claude --version` | `claude doctor` | Yes |
| **bun** | `bun --version` | `bun --version` | No — self-contained |
| **git** | `git --version` | `git --version` + identity (§6) | Identity is separate |
| **node** | `node --version` | `node --version` | No |

### docker `--version` vs `info`

- **`docker --version`** prints the **CLI** version only. **It succeeds when the daemon is dead** — it tells you nothing about usability.
- **`docker info`** queries the **daemon**. Docker's own guidance: *"The operating-system independent way to check whether Docker is running is to ask Docker, using the `docker info` command."* Exits **0** when the daemon responds, **non-zero** when not. ([daemon/troubleshoot](https://docs.docker.com/engine/daemon/troubleshoot/))

**Cheapest reliable probe** — collapses both into one call:
```sh
docker info > /dev/null 2>&1     # exit 0 = CLI present AND daemon healthy
```
But **split it into two probes for honest errors** — that's the whole point of §1:
1. `docker --version` fails ⇒ *"Install Docker or Podman"*
2. `docker info` fails ⇒ *"Docker is installed but not running — start Docker Desktop"*

Don't depend on the exact non-zero value; the 0/non-zero contract is the safe part.

### `claude doctor` exists — use it

*"Prints read-only installation and settings diagnostics without starting a session, including
install health, settings-file validation errors, and any warnings with suggested fixes."* That's a
ready-made health probe we get for free, and `claude --version` is the cheap presence check.

### Windows detection notes

- **`where.exe`, not `which`.** PowerShell's `where` is an alias for `Where-Object` — call `where.exe` explicitly, or `(Get-Command docker).Source`. Better: since our server is Bun, **spawn the probe directly and catch ENOENT** rather than shelling out to a lookup tool.
- **PATHEXT is not applied by non-shell spawn.** `spawn("docker")` can ENOENT on Windows even though `docker` works in a terminal, because `.cmd`/`.ps1` shims aren't resolved without a shell. **We already know this** — `resolveClaudeExecutable` hand-scans PATH for `claude` with `['.exe','.cmd','.bat','']` (`launcher.ts:193-202`) and re-routes `.cmd`/`.bat` through `cmd.exe /c` (`launcher.ts:212-218`), and sandcastle's 0.11.0 Windows `noSandbox` fix routes through `cmd.exe /d /s /c` with `shell:true` for the same reason (`SANDCASTLE-NOTES.md:172`). **Any probe we write must reuse this resolution, not naively `spawn(name)`.** (Docker Desktop installs a real `docker.exe`, so sandcastle's literal `spawn("docker")` is fine — it's the shim-prone tools that bite.)

### Summary: detectable, automatable, or guide-only

| Prereq | Detectable? | Install automatable? | Verdict |
|---|---|---|---|
| Bun | ✅ `bun --version` | ✅ irm/curl one-liner, non-interactive | **Automate** (though: if the server runs, Bun is self-evidently present — this matters for the *installer*, not the doctor) |
| Claude Code | ✅ `claude --version` + `claude doctor` | ✅ install.ps1/install.sh/winget/brew | **Automate**, prompt first |
| Claude auth | ⚠️ token *presence* only — validity needs a live call | ❌ `setup-token` is an interactive browser flow | **Guide** — detect + link |
| Claude account tier | ❌ not locally detectable | ❌ | **Guide** — state it in README |
| Git | ✅ `git --version` | ✅ winget/brew/apt | **Automate** or guide |
| Git identity | ✅ `git config --get user.email` exit code | ⚠️ we *could* set it, but naming a user's commits for them is presumptuous | **Detect + prompt** |
| `node` | ✅ `node --version` | ✅ | **Automate** (Windows/Linux) |
| Docker/Podman | ✅ `--version` + `info` | ⚠️ silent flags exist; Linux clean, Win/macOS need a downloaded installer + hypervisor | **Guide** — detect precisely, install manually |
| Sandcastle image | ✅ `docker image inspect` | ✅ `sandcastle docker build-image` | **Automate** — nothing builds it today |
| Linux toolchain | ✅ `python3 --version`, compiler probe | ✅ apt install | **Fix upstream instead** (§7) |
| Virtualization in BIOS | ⚠️ indirectly (docker/podman fail) | ❌ | **Guide** — common fresh-machine miss |

The shape that falls out: **a `doctor` that detects everything precisely, automates the cheap
non-interactive installs (Bun, Claude Code, git, the sandcastle image), and hands the user a precise,
copy-pasteable instruction for the rest (Docker, `setup-token`, git identity).** That satisfies
"streamline setup as much as possible" without an OSS tool silently installing a hypervisor.

---

## 9. What this opens (for the map, not decided here)

Research surfaces questions; it doesn't answer them. Flagging, not ticketing:

1. **Podman as a first-class sandbox** — `config.sandbox` has no podman member (`config.ts:15`) though sandcastle exports one. This is the honest answer to Docker Desktop licensing for commercial users. Small, well-defined.
2. **The Linux node-pty gap** (§7) — a publish blocker for a platform the destination commits to. Vendor a prebuild / ship the sidecar differently / drop node-pty on linux?
3. **Doctor scope + placement** — CLI (`bunx runcastle doctor`), first-run UI gate, or both? What blocks vs. warns? Tier 2 (Docker) shouldn't block a user who only wants interactive sessions.
4. **Pin Bun** — `engines` / `packageManager` / `.tool-versions`, and a CI that would catch drift. Mechanical; a `wayfinder:task` at most.
5. **Auth validity vs. presence** — the current gate checks only that a token *string exists* (`ticket-burner.ts:481-484`). Worth a real probe?
6. **Image build automation** — nothing builds `sandcastle:<name>` today; first run of a Docker burn fails on a fresh machine, by construction.

---

## Staleness

Verified **2026-07-17**. Rot risks, sharpest first:

- **Bun 1.3.14** is ~2 months old and will move. **Require a minimum; don't pin in docs.**
- **Docker licensing thresholds** (250 employees / $10M) have changed twice before (2021, 2024). Verified today — **link, don't hardcode**.
- `STACK-NOTES.md:3-6` self-dates to **2026-07-14** and says "re-check versions before a fresh scaffold months from now" — 3 days old, fine.
- Claude Code doc facts are from `code.claude.com` via ctx7 today; CC ships weekly.

### Unverified — do not state as fact without checking

1. **winget ID for Docker Desktop** (`Docker.DockerDesktop`) — *not* in official Docker docs; only `Docker.DockerCLI` surfaced.
2. **Homebrew casks for Docker Desktop** — not on Docker's own pages; community-maintained.
3. **Podman on Windows 10** — the official tutorial says "Windows 11 or later"; conflicts with other guidance.
4. **Docker Desktop on Windows Home** — the requirements page is self-contradictory (Pro/Ent/Edu required, yet Home "restricted to Linux containers"). We only need Linux containers, so Home is *probably* fine — **verify, it's a big audience.**
5. **Exact `docker info` non-zero exit code** — community-sourced. The 0/non-zero contract is safe; the value isn't.
6. **Windows long-path / Developer Mode symlinks** for Bun + git worktrees — plausible (we nest `.claude/worktrees/<name>/packages/...`), unconfirmed.
7. **Bun's `spawn` PATHEXT semantics** — Bun may differ from Node. Our launcher already hand-resolves (§8), so we're insulated, but a naive probe wouldn't be.

### Corrections to existing notes

- `CONTEXT.md:51` says the `wt.exe` window mode is *removed* and terminals are "cross-platform embedded PTYs". **The code still ships it fully** (`launcher.ts:399-400`, `168-183`, `682-720`), and `RUNCASTLE_LAUNCH_MODE` still selects it (`config-load.ts:36`, `config.ts:29`). Consistent with the map's "deleted, not ported" decision — the deletion just hasn't landed. Noted, not filed in `CORRECTIONS.md`: that file is for research-vs-spec *format* conflicts, and this is known pending work.
