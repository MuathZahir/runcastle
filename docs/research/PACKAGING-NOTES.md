# PACKAGING-NOTES — shipping runcastle to strangers

Research asset for wayfinder ticket
[Research: packaging a Bun monorepo local app for distribution](https://github.com/MuathZahir/runcastle/issues/19),
under the map
[Wayfinder map: publish runcastle (open-source local release)](https://github.com/MuathZahir/runcastle/issues/12).

Dated 2026-07-17. Facts about the repo are cited `file:line` against that commit;
Bun facts are from `ctx7` docs (`/oven-sh/bun`, `docs/bundler/executables.mdx`).

This note is **research, not a decision** — it maps the option space and prices each
option. The choice is a separate ticket.

## 1. The constraint that shapes everything: Bun is not optional

The server is Bun-native in three independent places:

- `Bun.serve` + its `websocket` handler — `packages/server/src/index.ts:93-100`
- `bun:sqlite` — `packages/server/src/db/client.ts:1` (the only import site; tests use sql.js)
- Session hooks are literally the shell command `bun run "<abs path>/hook-client.ts" <event>`,
  written into each session's `settings.json` — `packages/server/src/launcher/artifacts.ts:286,340`

The first two are our own code and could in principle be rewritten. The third is
different in kind: it is a command line **we hand to Claude Code**, executed by a
process we don't own. So "ship a binary so users don't need Bun" only pays off if the
hook command is *also* rewritten to invoke our own executable (see §4).

**Consequence:** every option below assumes Bun on the user's machine, except the
compiled-binary option, and even that one only sheds the Bun prereq if the hook
command changes. Since `claude`, `git`, and `docker` are prerequisites regardless
(§2), "install Bun" is not the binding constraint on first-run friction.

## 2. Prerequisites the app assumes today

| Prereq | Where | Escape hatch |
|---|---|---|
| `claude` CLI | `launcher.ts:190-204` — scans PATH for `claude` + `.exe/.cmd/.bat` | `RUNCASTLE_CLAUDE_BIN` |
| `bun` on PATH **inside sessions** | `artifacts.ts:286` — hook command | none |
| system `node` on PATH | `pty-sidecar.ts:29-44`; required on Bun+win32, `pty.ts:119-127` | `RUNCASTLE_NODE_BIN`, `RUNCASTLE_PTY_BACKEND` |
| `git` | `services/git.ts:6-7,57` via simple-git | none |
| `docker` | default sandbox, `packages/core/src/config.ts:15` | `sandbox: 'no-sandbox'` |
| `cmd.exe` | `launcher.ts:214,689` via `ComSpec` | Windows-only, always present |

`wt.exe` is **not** a default prereq — it is only on the legacy `launchMode: 'window'`
path (`launcher.ts:399`), and the map has already ruled that path deleted, not ported.

Note the awkward one: **`node` is required on Windows even though we ship a Bun app**,
purely to host the node-pty sidecar. Any "one binary, no runtimes" story has to answer
this, not just the Bun question.

## 3. How the web app gets served in production

**Today: it doesn't.** There is no static serving in `packages/server/src` — no
`serveStatic`, no `dist` mount, no SPA fallback. Web is a Vite dev server on 4513
that proxies `/api` → 4512 and `/ws` → 4512 (`apps/web/vite.config.ts:11-27`).
`apps/web/dist/` exists on disk but is gitignored and nothing consumes it — the built
SPA is orphaned.

The gap is smaller than it looks, because the client is already origin-relative:

- tRPC uses `url: '/api/trpc'` — relative, no host, no env var (`apps/web/src/main.tsx:22`).
  If Hono serves the SPA on 4512, this resolves correctly with **zero client changes**.
- **One real bug in the way:** the terminal WebSocket hardcodes port 4512 —
  `` `${proto}//${window.location.hostname}:4512` `` (`apps/web/src/lib/terminal.ts:44-47`).
  It must become `window.location.host` to survive being served from anywhere but 4513.
  `TerminalView` already accepts a `wsBase` prop (`TerminalView.tsx:19`) that no caller passes.
- `apps/web/src/lib/env.ts:8-10` hardcodes mirrors of server config (`SERVER_PORT = 4512`,
  `MODEL`, `SANDBOX_MODE`). Its own comment flags this as a stopgap. Serving from one
  origin makes most of it unnecessary.

So production serving is: `vite build` → Hono mounts `apps/web/dist` with an SPA
fallback → everything on 4512, one origin, one port. Dev keeps the 4513 proxy.
This work is **common to every option below** and independent of the choice.

## 4. The five repo-relative runtime assets

The server reads five things off disk at paths derived from `import.meta.url` /
`import.meta.dirname`. These are what make packaging non-trivial — under
`bun build --compile` these paths collapse into the virtual `/$bunfs/root/…`.

| Asset | Resolver | Site |
|---|---|---|
| Migration SQL (`packages/server/drizzle/*.sql`, 3 files) | `join(import.meta.dirname,'..','..','drizzle')` + `readdirSync`/`readFileSync` | `db/migrate.ts:19,37,43` |
| Hook client (`src/launcher/hook-client.ts`) | `fileURLToPath(new URL('./hook-client.ts', import.meta.url))` | `artifacts.ts:37-38` |
| PTY sidecar host (`src/pty/pty-host.cjs`) | `fileURLToPath(new URL('./pty-host.cjs', import.meta.url))` | `pty-sidecar.ts:18` |
| Skills pack (`packages/skills/packs/runcastle`, 6 `SKILL.md`) | `resolvePluginDir()` — ascends ≤8 dirs hunting a marker, silently falls back to a fixed 4-up layout | `launcher.ts:221-237` |
| Burner prompts (`packages/skills/burner/*.md`, 2 files) | hardcoded 3-up `join(dirname(...),'..','..','..','skills','burner',…)` | `ticket-burner.ts:509-513`, `research.ts:197-200` |

Two of these are **spawned as external processes, not imported**:

- the hook client is run by a *different* `bun` process, launched by Claude Code
- `pty-host.cjs` is run by *system `node`*

Neither external process can read `/$bunfs/root/…` — that filesystem exists only inside
our own compiled binary. So under `--compile` these two must be **extracted to a real
path** at boot (e.g. `~/.runcastle/runtime/<version>/`) — or, better for the hook,
the command becomes `runcastle hook <event>` invoking our own binary, which is what
would actually drop the Bun prereq.

Everything under `~/.runcastle/` (`packages/core/src/paths.ts:13-46`) is home-relative
and fine under any option.

Bun's embedding API is capable enough for the read-only assets: `import x from './f.md'
with { type: 'file' }` embeds the bytes and yields a `/$bunfs/root/…` path readable via
`Bun.file()` or `node:fs`; `Bun.embeddedFiles` enumerates them; a directory is embedded
by globbing it into `entrypoints`. So migration SQL, skills packs, burner prompts, and
the web `dist` are all embeddable — but `readdirSync` over a directory is not a thing
`/$bunfs` supports, so `migrate.ts` and `resolvePluginDir()` need explicit manifests
rather than directory scans.

**node-pty is the hard blocker.** It ships prebuilt `.node` addons and is resolved at
runtime via `createRequire(import.meta.url)` (`pty/pty.ts:91`, `pty-sidecar.ts:49`) —
dynamic resolution the bundler cannot see, plus native binaries per platform.

## 5. The options

### A. `git clone` + `bun install` + `bun dev`

- **Work:** none beyond the README.
- **Prereqs:** bun, git, node, claude, docker.
- **Updates:** `git pull && bun install`.
- **Verdict:** this is the *contributor* path and it already works. As the *user* path
  it reads as "run my dev environment", which is the wrong signal for a launch whose
  entire surface is the repo + README. Keep it, document it as "hacking on runcastle".

### B. npm-published `bunx runcastle`

Publish one public package containing: bundled/plain server TS, prebuilt `apps/web/dist`,
`packages/skills` content, `drizzle/*.sql`, `hook-client.ts`, `pty-host.cjs`.

- **Work:** flatten the workspace into one publishable package (core+skills are private
  `workspace:*` today — either bundle them in or publish them too); add the static-serve
  mount (§3); add a `bin` entry; set `files`/`exports`; CI publish on tag.
- **Why it's cheap:** everything in §4 keeps working *unchanged*. Assets stay real files
  on a real filesystem in `node_modules`; `import.meta.url` still resolves; node-pty
  installs normally and gets its prebuilds; `resolvePluginDir()`'s marker hunt still
  finds the pack. **Zero of the five blockers apply.**
- **Prereqs:** unchanged (bun, node, claude, docker, git) — and Bun was mandatory anyway (§1).
- **Updates:** `bunx runcastle@latest` always fetches current; or `bun add -g runcastle`
  and `bun update -g`. Standard, no updater to build.
- **Cost:** a public npm name; the monorepo must not leak private `workspace:*` deps.

### C. `bun build --compile` standalone binaries

- **Work:** the whole of §4 — embed the four read-only assets with explicit manifests,
  extract `pty-host.cjs` (and the hook client, unless the hook becomes `runcastle hook`)
  to `~/.runcastle/runtime/<version>/` at boot, and solve node-pty's `createRequire` +
  `.node` prebuilds. That last one is the open question; it may force shipping the
  prebuilds beside the binary, which quietly undoes "one file".
- **Cross-compile:** genuinely covered — Bun targets `bun-{darwin,linux,windows}-{x64,arm64}`
  (plus `-baseline`/`-modern`/`-musl` variants), all from one machine, so CI can build
  the full matrix. `windows.icon`/`title`/`version` metadata is supported.
- **Payoff:** the only option that can drop the Bun prereq — *if* the hook command is
  rewritten. Best "download and run" story.
- **Verdict:** highest polish, highest cost, and the payoff is partly illusory while
  `node` is still required for the PTY sidecar on Windows (§2).

### D. GitHub Releases

Not an alternative — it's a **delivery channel**. It's how C's binaries reach people
(and it'd need an update-check, since there's no registry to pull from). It could also
carry a tarball, which is strictly worse than B. Treat D as a sub-decision of C.

## 6. What this implies (for the decision ticket, not decided here)

- **B is the cheap, boring answer**, and it's cheap *because* Bun is mandatory anyway (§1)
  and because it sidesteps all five asset blockers (§4) rather than solving them.
- **C's headline benefit is weaker than it appears**: it can't deliver "no runtimes" while
  Windows still needs system `node` for the PTY sidecar, and its cost is concentrated in
  node-pty, the one item with no known-good recipe.
- **A stays**, relabelled as the contributor path.
- **§3's static-serve work is unconditional** — do it regardless, plus the
  `terminal.ts:47` port fix, which is a latent bug today.
- Two things surfaced that belong to the map's fog, not here: the **`node`-on-Windows
  prereq** (an odd wart for any distribution story) and **`resolvePluginDir()`'s silent
  fallback** to a nonexistent path (`launcher.ts:221-237`), which would fail
  confusingly on a stranger's machine under any option.
