# Sandcastle — notes for a Bun-server orchestrator (Windows + Docker Desktop)

Source: local clone of `mattpocock/sandcastle`, package `@ai-hero/sandcastle`, **version 0.12.0** (package.json).
Repo: `https://github.com/mattpocock/sandcastle`. License MIT. Type: ESM only (`"type": "module"`, `main`/`types` under `dist/`).

## 9. Package identity

- npm name: **`@ai-hero/sandcastle`** (NOT the unscoped `sandcastle` package — that's unrelated).
- Current version: **0.12.0**.
- `peerDependencies`: `@daytona/sdk: ^0.164.0`, `@vercel/sandbox: >=1.0.0` — both marked `optional: true` in `peerDependenciesMeta`. Only needed if you use the Daytona or Vercel sandbox providers. **Docker/Podman need no npm peer dep** — they shell out to the `docker`/`podman` CLI binaries on PATH.
- Runtime dep: only `@clack/prompts` (used by the CLI's interactive prompts, not by the programmatic API).
- Subpath exports: `.`, `./sandboxes/docker`, `./sandboxes/podman`, `./sandboxes/vercel`, `./sandboxes/daytona`, `./sandboxes/no-sandbox`.
- Bun compatibility: no Bun-specific code paths found anywhere in src/. It's plain Node ESM built with `tsup`, uses `node:child_process` (`spawn`/`execFile`) and the Effect ecosystem (`effect`, `@effect/platform-node`). Nothing here is Node-API-exotic; a Bun server importing it should work, but it has never been tested against Bun by upstream (init only detects npm/pnpm/yarn/bun as the **host project's** package manager for `sandcastle init` scaffolding, not as a runtime it validates itself against).

## 1. Full `run()` options

```ts
export interface RunOptions<A extends AgentProvider = AgentProvider> {
  readonly agent: A;                    // required — claudeCode(model, opts?), codex(), pi(), cursor(), opencode(), copilot()
  readonly sandbox: SandboxProvider;     // required — docker(), podman(), vercel(), noSandbox()
  readonly cwd?: string;                 // host repo dir; replaces process.cwd() as anchor. THIS is how you target another repo.
  readonly prompt?: string;              // inline (mutually exclusive with promptFile)
  readonly promptFile?: string;          // resolves against process.cwd(), NOT cwd — pass absolute path if cwd is custom
  readonly maxIterations?: number;       // default 1
  readonly hooks?: SandboxHooks;         // host.onWorktreeReady / host.onSandboxReady / sandbox.onSandboxReady — no per-iteration hook exists
  readonly promptArgs?: PromptArgs;      // {{KEY}} substitution — promptFile only, inline prompts pass through literally
  readonly logging?: LoggingOption;      // { type:'file', path, onAgentStreamEvent?, verbose? } | { type:'stdout', verbose? }
  readonly completionSignal?: string | string[];  // default '<promise>COMPLETE</promise>'
  readonly idleTimeoutSeconds?: number;  // default 600 — fails run if agent silent this long, PRE-signal
  readonly completionTimeoutSeconds?: number; // default 60 — grace window POST-signal for hanging child procs; resolves successfully on expiry
  readonly name?: string;                // log prefix / filename suffix
  readonly copyToWorktree?: string[];    // host-relative paths copied into worktree pre-start; NOT allowed with branchStrategy 'head'
  readonly branchStrategy?: BranchStrategy; // see §branch strategy below
  readonly resumeSession?: string;       // incompatible with maxIterations > 1
  readonly signal?: AbortSignal;         // cancels run; kills subprocess; worktree preserved on disk
  readonly timeouts?: Timeouts;          // copyToWorktreeMs(60_000) gitSetupMs(10_000) commitCollectionMs(30_000) mergeToHostMs(30_000)
  readonly output?: OutputDefinition;    // Output.object({tag,schema,maxRetries?}) | Output.string({tag}) — requires maxIterations===1
}
```

### Agent — `claudeCode(model, options?)`

```ts
export interface ClaudeCodeOptions {
  effort?: "low" | "medium" | "high" | "xhigh" | "max"; // "max" is Opus-only
  env?: Record<string, string>;                          // merged at launch; must not overlap sandbox provider env
  captureSessions?: boolean;                              // default true
  permissionMode?: "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions";
  // when set, REPLACES sandcastle's default --dangerously-skip-permissions on AFK (run()) invocations
}
```

Exact CLI invocation built by the provider for AFK runs (`AgentProvider.ts` `claudeCode().buildPrintCommand`):

```
claude --print --verbose [--permission-mode <mode> | --dangerously-skip-permissions]
  --output-format stream-json --model <model> [--effort <level>]
  [--resume <id>] [--fork-session] -p -
```
Prompt is piped over **stdin** (avoids the ~128KB argv limit), not passed as an argument. By default (no `permissionMode`), AFK runs always pass `--dangerously-skip-permissions` — there is no prompt-based approval loop unless you set `permissionMode: "auto"`.

`sandcastle init` default model constant `DEFAULT_MODEL = "claude-opus-4-8"`. Pass any model string explicitly (`claude-sonnet-4-6`, etc.) — not validated against a fixed enum.

### Branch strategy (`BranchStrategy`)

```ts
type HeadBranchStrategy         = { type: "head" };
type MergeToHeadBranchStrategy  = { type: "merge-to-head" };
type NamedBranchStrategy        = { type: "branch"; branch: string; baseBranch?: string };
```
- Default: `{ type: "head" }` for bind-mount providers (docker/podman), `{ type: "merge-to-head" }` for isolated providers (vercel/daytona).
- **head**: agent writes directly to the host working directory (bind-mounted straight through) — no worktree, no merge step. Only valid for bind-mount / no-sandbox providers. `copyToWorktree` is rejected in this mode.
- **merge-to-head**: sandcastle creates a git worktree on a generated temp branch (`sandcastle/<YYYYMMDD-HHMMSS>-<6hex>`), agent commits there, then on success sandcastle does a plain `git merge <tempBranch>` into the host's current branch inside the **host repo directory itself** (not a merge in the worktree) and deletes the temp branch. **Conflict handling: no auto-resolution.** If `git merge` fails, `run()` throws an `Error` whose message names the preserved temp branch and gives literal recovery commands (`git merge <branch>`, then `git branch -D <branch>` once resolved). The host repo is left in whatever half-merged/conflicted state `git merge` leaves it in — the caller (you) must resolve it like any manual merge conflict. `mergeToHostMs` (default 30s) bounds the merge step itself; a slow merge throws `MergeToHostTimeoutError`, not a conflict-specific error.
- **branch**: commits land on an explicit named branch you supply. Re-running with the same `branch` reuses the existing `.sandcastle/worktrees/<branch>` worktree; on a **clean** worktree it runs `git fetch origin <branch>` + `git merge --ff-only origin/<branch>` to catch it up (skipped if dirty/diverged/offline — non-fatal). No merge to host happens in this mode at all — the branch is the deliverable; you merge/PR it yourself outside sandcastle.

`cwd` targeting: **yes**, `run()`, `interactive()`, `createSandbox()`, and `createWorktree()` all accept `cwd?: string`, which becomes the anchor for `.sandcastle/worktrees`, `.sandcastle/.env`, `.sandcastle/logs`, `.sandcastle/patches`, and all git operations — this is exactly the hook you need to point sandcastle at a target repo that isn't your Bun server's own cwd. Relative paths resolve against `process.cwd()`; absolute paths pass through; a `CwdError` throws if the path doesn't exist or isn't a directory. **Caveat:** `promptFile` always resolves against `process.cwd()`, never against `cwd` — pass an absolute `promptFile` path when driving a non-cwd repo.

### Iteration loop / stop conditions

- `maxIterations` (default 1) is a hard cap — each iteration is one fresh non-interactive `claude --print ...` invocation against the (possibly already-modified) worktree.
- Loop stops early when the agent's accumulated stdout contains any of `completionSignal` (default `<promise>COMPLETE</promise>`) — this is a convention your prompt must tell the agent to emit; sandcastle never injects it.
- No `onIteration` hook exists. Hooks are lifecycle-only (`host.onWorktreeReady`, `host.onSandboxReady`, `sandbox.onSandboxReady`) and run once per sandbox creation, not once per iteration. To act between iterations, either drive the loop yourself with `createSandbox().run()` called repeatedly, or use `logging.onAgentStreamEvent` (fires per text chunk / tool call / raw line, each event carries the `iteration` number) to detect iteration boundaries externally.

### `RunResult`

```ts
interface RunResult {
  iterations: IterationResult[];   // .length = iteration count
  completionSignal?: string;
  stdout: string;                  // combined agent output, all iterations
  commits: { sha: string }[];
  branch: string;                  // resolved branch name the agent worked on
  logFilePath?: string;
  preservedWorktreePath?: string;  // set when run succeeded but worktree left dirty
  resume?: (prompt: string, opts?) => Promise<RunResult>;  // present only if provider.sessionStorage
  fork?:   (prompt: string, opts?) => Promise<RunResult>;  // ditto — session-only fork, ADR 0018
  output?: T;                      // present only when `output` option set
}
interface IterationResult {
  sessionId?: string;
  sessionFilePath?: string;        // absolute HOST path to captured session JSONL
  usage?: IterationUsage;          // inputTokens, cacheCreationInputTokens, cacheReadInputTokens, outputTokens
}
```

## 2. Observability

- **Streaming while running**: `logging: { type: 'file', path, onAgentStreamEvent?, verbose? }` (or `{ type: 'stdout', verbose? }`). `onAgentStreamEvent(event)` fires for **every** `text` chunk, `toolCall`, or (with `verbose: true`) `raw` stdout line the agent emits, each tagged with `{ iteration, timestamp }`. This is your integration point for pushing live progress into your Bun server / a websocket / a DB row. Errors thrown inside the callback are swallowed so a broken forwarder can't kill the run.
- With `verbose: true`, every raw stdout line (including ones the stream-json parser drops) is also appended to the log file / stdout — useful for debugging a stuck agent but noisy for a UI feed; prefer the typed `text`/`toolCall` events for a live view and keep `verbose` off unless debugging.
- **Per-iteration transcripts / session IDs**: yes. Each `IterationResult` carries `sessionId` and, when session capture succeeds, `sessionFilePath` — an **absolute host path** to the captured Claude Code session JSONL (`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, `cwd` fields rewritten to the host repo root so `claude --resume` works natively outside sandcastle too). For Claude Code, subagent/Workflow-tool transcripts under `<session-id>/subagents/agent-*.jsonl` are captured alongside the main session (best-effort; main-session capture failure fails the whole run).
- Session capture is on by default for `claudeCode()`/`codex()`/`pi()`; disable per-agent with `captureSessions: false` in the agent options.
- `result.stdout` is the full combined agent output across all iterations — usable as a crude transcript if you don't need the structured JSONL.
- No built-in webhook/SSE — you build that on top of `onAgentStreamEvent` yourself.

## 3. Worktree API — `createWorktree()`

One paragraph: `createWorktree()` gives you a git worktree as an independent, first-class handle, decoupled from any container. Use it when the worktree needs to outlive or be shared across multiple sandbox/agent invocations — e.g. run an `interactive()` (human-in-the-loop, defaults to `noSandbox()`) session to explore/triage, then hand the *same* worktree to a sandboxed AFK `wt.run()` to implement, without recreating the branch or losing state in between. Only `branch` and `merge-to-head` strategies are valid (`head` is a compile-time type error since head means "no worktree" by definition). `wt.close()` preserves the worktree on disk if dirty, removes it if clean; `await using` triggers this automatically. Ownership is split from `createSandbox()`: when a sandbox is created via `wt.createSandbox()`, `sandbox.close()` tears down only the container — the worktree survives until `wt.close()`. Prefer `createWorktree()` over top-level `run()`/`createSandbox()` whenever you need the worktree to persist independently of container lifecycle (interactive-then-AFK handoff, or inspecting/reusing a worktree across multiple orchestrator phases); prefer plain `createSandbox()` when the worktree and container should always live and die together.

## 4. Docker specifics

- **Default image name**: `sandcastle:<repo-dir-name>` (derived from the host repo directory's basename) unless `imageName` is passed to `docker()`.
- **Who builds it, when**: nobody builds it automatically at `run()` time. `sandcastle init` optionally builds it once at scaffold time; otherwise you (or your orchestrator) must run `sandcastle docker build-image` (or call `buildImage()` — not exported from the public `src/index.ts`, so from a Bun server you'd shell out to the CLI, or pre-build the image out-of-band). `run()`/`createSandbox()` do a **pre-flight `docker image inspect`** check before starting a container and throw a clear "Image not found locally. Build it first with `sandcastle docker build-image`" error if missing — it never builds for you.
- **Default `.sandcastle/Dockerfile` scaffolded by `init`** (`node:22-bookworm` base):
  - `git`, `curl`, `jq` via apt.
  - GitHub CLI (`gh`) via the official apt repo.
  - `ARG AGENT_UID=1000` / `ARG AGENT_GID=1000`, then `groupmod -o -g $AGENT_GID node && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node` — renames the base image's `node` user to `agent` and aligns UID/GID, `-o`/`--non-unique` so a colliding host GID (e.g. macOS `staff`=20) doesn't abort the build.
  - `USER ${AGENT_UID}:${AGENT_GID}` (numeric, so `docker image inspect --format '{{.Config.User}}'` is parseable for the pre-flight UID check).
  - Claude Code CLI installed via `curl -fsSL https://claude.ai/install.sh | bash`, added to `PATH` at `/home/agent/.local/bin`.
  - `WORKDIR /home/agent`, `ENTRYPOINT ["sleep", "infinity"]` — the container just idles; sandcastle bind-mounts the worktree at `/home/agent/workspace` and `docker exec`s into it per command. No Bun/Node build tooling beyond what the base image ships (Node 22) — add your own language runtimes/build tools as needed. **No bun preinstalled** — add it yourself if the target repo's own build needs it (irrelevant to your Bun *server*, which runs on the host, not inside this container).
- **`DockerOptions` (full)**: `imageName?`, `containerUid?` / `containerGid?` (default: host `process.getuid()/getgid()` or 1000 — meaningless defaults on Windows, see §8), `selinuxLabel?: "z"|"Z"|false` (default `"z"`, no-op on non-SELinux hosts incl. Docker Desktop on Windows), `mounts?: MountConfig[]` (`{ hostPath, sandboxPath, readonly? }`, tilde-expansion supported both sides), `env?`, `network?: string | string[]`, `groups?: (string|number)[]` (`--group-add`, e.g. for a bind-mounted docker socket), `devices?: string[]` (`--device` specs), `cpus?: number`, `maxOutputTailChars?` (default 64KiB rolling tail on streamed exec output to avoid V8 string-length crashes on long runs).
- **Container start mechanics**: `docker run -d --name sandcastle-<uuid> -e K=V... -v <mounts> -w <worktreeSandboxPath> --user <uid>:<gid> [--network ...] [--group-add ...] [--device ...] [--cpus ...] <image>`, then `sleep infinity` keeps it alive; every agent invocation and hook is a separate `docker exec`. Teardown is `docker rm -f` on `close()`, plus a shared process-exit/SIGINT/SIGTERM handler (`shutdownRegistry`) so many concurrent sandboxes don't trip Node's `MaxListenersExceededWarning`.
- **UID/GID pitfalls on Windows Docker Desktop**: `process.getuid?.()` / `process.getgid?.()` are `undefined` on Windows (no POSIX UIDs), so the provider's default falls through to hardcoded `1000` for both — which happens to match the Dockerfile's own `ARG AGENT_UID=1000` default, so **out of the box this generally just works on Windows** (unlike Linux hosts with a non-1000 UID, which must rebuild the image with matching build-args). Windows NTFS bind-mounts have no real UID/GID concept anyway — Docker Desktop's LinuxKit VM presents mounted files as owned by whatever `--user` was passed, so permission mismatches are less likely than on native Linux, but you should still not override `containerUid`/`containerGid` unless you rebuilt the image with matching `AGENT_UID`/`AGENT_GID` build-args — a mismatch throws a clear pre-flight error before the container starts, rather than a silent `EACCES` later.

## 5. Auth — env var flow

- **Exact vars for Claude Code**: `sandcastle init` scaffolds `.sandcastle/.env.example` with `CLAUDE_CODE_OAUTH_TOKEN=` (primary — get it by running `claude setup-token` on the **host**) and a commented `# ANTHROPIC_API_KEY=` fallback. Both are plain env vars forwarded into the container as `-e KEY=VALUE`; sandcastle does not special-case either name internally (no branching logic on which is set) — it relies on the `claude` CLI inside the container picking whichever is present, same as it would on a normal host install.
- **Where `.sandcastle/.env` is read**: `EnvResolver.ts::resolveEnv(hostRepoDir)` parses `<hostRepoDir>/.sandcastle/.env` only (repo-root `.env` is explicitly NOT part of the chain). Critically: **only keys that are literally declared as lines in `.sandcastle/.env` get resolved at all** — for each declared key, if the `.env` file's value for it is empty, it falls back to `process.env[key]` (the host process's own env); if the `.env` value is non-empty, that value wins. A key that exists in `process.env` but has no corresponding line in `.sandcastle/.env` is never picked up. Practical implication for a long-lived Bun server: if you want `CLAUDE_CODE_OAUTH_TOKEN` sourced from your server's own process env (secrets manager, etc.) rather than a file on disk, you must still have a (possibly value-less) `CLAUDE_CODE_OAUTH_TOKEN=` line present in the target repo's `.sandcastle/.env` for the resolver to pick it up from `process.env`.
- **Merge order** (`mergeProviderEnv.ts`): `resolvedEnv (.sandcastle/.env ∪ process.env fallback)` → overridden by `sandboxProviderEnv` (`docker({ env: {...} })`) → overridden by `agentProviderEnv` (`claudeCode(model, { env: {...} })`). Agent-provider env and sandbox-provider env **must not share keys** — `run()` throws synchronously if they do. This means you can bypass the `.sandcastle/.env` file entirely and inject `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` straight from your Bun server via `claudeCode(model, { env: { CLAUDE_CODE_OAUTH_TOKEN: token } })` per-run — this is probably the cleaner integration point for a server holding per-tenant/per-ticket credentials, since it skips the file-based resolver's "must be declared in .env" gate entirely.
- Flow to sandbox: resolved+merged env object is passed as `env` into `startContainer(containerName, imageName, env, {...})` → `docker run ... -e K=V ...` for every key, plus sandcastle force-sets `HOME=/home/agent`. All env vars are visible to every process inside the container, not scoped to just the `claude` invocation.

## 6. `.sandcastle/` scaffold from `init`

Always written: `Dockerfile` (or `Containerfile` for Podman) — the per-agent Dockerfile template; `.gitignore` — ignores `.env`, `logs/`, etc.; `.env.example` — concatenation of the chosen agent's env block + chosen issue tracker's env block (e.g. `GH_TOKEN=` for GitHub Issues).

Plus template-specific files copied from `src/templates/<template>/` (you pick the template at `init` time):
- `blank`: `main.mts`/`main.ts` (bare `run()` call skeleton), `prompt.md`.
- `simple-loop`: `main.mts`, `prompt.md` (single prompt, picks-and-closes issues one by one).
- `sequential-reviewer`: `main.mts`, `implement-prompt.md`, `review-prompt.md`, `CODING_STANDARDS.md` (loaded by the reviewer agent).
- `parallel-planner`: `main.mts`, `plan-prompt.md`, `implement-prompt.md`, `merge-prompt.md`.
- `parallel-planner-with-review`: `main.mts`, `plan-prompt.md`, `implement-prompt.md`, `review-prompt.md`, `merge-prompt.md`, `CODING_STANDARDS.md`.

(This repo's own dogfooded `.sandcastle/` — visible in the clone — uses `parallel-planner-with-review`, renamed `main.mts`→`run.ts`, and additionally has hand-written `test-interactive.ts`/`test-podman.ts`/`test-vercel.ts` smoke scripts that are NOT part of the generic scaffold.)

`main.ts` vs `main.mts` naming depends on the target repo's own `package.json` `"type"` field (`main.ts` if already `"module"`, else `main.mts`) — `init` auto-detects this (`detectMainFilename`).

## 7. `interactive()` and `createSandbox()`

**`interactive()`** launches a human-attended TUI session inside a sandbox — the caller (a real terminal, not your Bun server) sees the agent's interactive UI directly (stdin/stdout/stderr piped through via `docker exec -it`/`-i`), and when the session ends sandcastle collects commits and runs the same branch-merge logic as `run()`. `sandbox` defaults to `noSandbox()` here (unlike `run()`, which requires an explicit sandbox), so a bare `interactive({ agent, prompt })` runs the agent directly on the host with no container. It accepts the same `branchStrategy`/`hooks`/`copyToWorktree`/`cwd`/`signal`/`timeouts` shape as `run()`, but no `maxIterations` or `completionSignal` — a human ends the session, not a signal match. Because it's inherently attended, it is not the primitive you want for an AFK server-driven pipeline, but it's useful as an escape hatch for a "attach to this ticket's sandbox" debug feature.

**`createSandbox()`** creates one long-lived container/worktree up front (`await using sandbox = await createSandbox({ branch, sandbox: docker(), hooks, copyToWorktree, timeouts })`, `branch` required) and returns a handle you call `.run(SandboxRunOptions)` on repeatedly — each call is one agent invocation sharing the same warm container, same branch, same installed deps/build artifacts. Use this instead of top-level `run()` whenever you need >1 agent invocation against the same state (implement→review→fix pipelines) since it amortizes container boot cost; `run()` is strictly single-shot and tears everything down itself. The handle also exposes `.exec(command, options?)` for the harness to run shell commands (tests, lints, gates) directly in the warm sandbox between agent runs — non-zero `exitCode` is returned, not thrown — and `.interactive()` for attaching a human mid-pipeline. `sandbox.run()`'s result exposes `.resume()`/`.fork()` too, scoped to that same warm container. `sandbox.close()` (or `await using` teardown) removes the container and, when using top-level `createSandbox()` (not `wt.createSandbox()`), also removes the worktree if it's clean (preserves it on disk if dirty).

## 8. Windows caveats (found in ADRs / CHANGELOG)

Multiple Windows-specific bugs have been fixed across releases — evidence this is an actively-hit path, not theoretical:

- **ADR 0006 — git worktree mounts on Windows**: a git worktree's `.git` file contains a `gitdir:` pointer. On Windows this pointer is a native `C:\...` path, which is meaningless inside the Linux container, and the *parent* `.git` directory's host path (`C:\Users\...\.git`) can't be remapped under the worktree mount either — both break bind-mounted worktrees outright without a fix. Sandcastle fixes this by mounting the parent `.git` dir at a fixed POSIX path `/.sandcastle-parent-git` and overlay-mounting a corrected `.git` file (rewritten `gitdir:` pointer) over the worktree's own `.git` file, before the container starts. `patchGitMountsForWindows` in `mountUtils.ts` is a no-op on non-Windows.
- **9a895ba** (0.11.0): `interactive()` (non-head strategy), `worktree.interactive()`, and `worktree.run()` originally forgot to call `patchGitMountsForWindows`, causing a Docker `too many colons` error on Windows bind-mounts specifically through those three entry points — fixed to mirror `run()`/`createSandbox()`.
- **c9f8348** (0.5.9): switched Docker volume args from `-v host:sandbox` to `--mount type=bind,source=...,target=...` specifically because `-v C:\path:...` collides with Docker's `host:container` colon-delimiter syntax on Windows drive letters.
- **8d4e8ef / 21b6442**: backslashes in Windows host paths, and backslash separators emitted during session capture/resume/`copyPaths`, both had to be normalized to forward slashes before reaching `docker cp` / the container runtime, which rejects Windows-style paths.
- **bbb0f39**: `encodeProjectPath` (used to compute the Claude session storage directory name) had to be fixed to strip drive-letter colons and convert backslashes to hyphens so it produces a valid single path component on Windows.
- **f1d5ddc**: `git worktree list` reports forward-slash paths even on Windows while Node's `path.join` uses backslashes, causing worktree-reuse detection to misfire (false "already checked out" errors) and stale-worktree pruning to delete active worktrees out from under running sandboxes — fixed by normalizing separators before comparison.
- **702d829** (0.11.0): `noSandbox()` failed with `spawn sh ENOENT` on Windows because it assumed a POSIX shell; now routes through `cmd.exe /d /s /c` and spawns with `shell: true` on Windows so `.cmd`/`.ps1` wrappers (e.g. `claude.cmd`) resolve via `PATHEXT`. (Only relevant if you ever use `noSandbox()` directly on the Windows host — irrelevant to the Docker path, which always execs inside the Linux container.)
- **Worktree TEARDOWN failures reject a successful run** (observed in a real Windows burn, 0.12.0): `cleanupWorktree` runs as the release step of the run's scope — if `git status --porcelain` says the worktree is clean it calls `git worktree remove --force`, and that call is wired with `Effect.orDie`. A failure there is a defect, so `run()` **rejects even though the agent finished and its commits were already collected**. On Windows the trigger is routine: the container is removed first, but its bind mount can still hold a handle, and git reports `error: failed to delete '<repo>/.sandcastle/worktrees/<branch-with-dashes>': Directory not empty`. Worse, git only drops the `.git/worktrees/<name>` admin entry when the work-tree delete succeeded, so the half-deleted dir stays registered (and `git worktree prune` ignores it while the dir exists) — leftovers accumulate and sandcastle's own `pruneStale` won't collect them either, since it only removes dirs absent from `git worktree list`. Runcastle handles this in `isWorktreeTeardownError` + `cleanupBurnWorktree`: a teardown-shaped rejection whose temp branch holds commits is treated as a completed attempt (the commits are re-derived from git, since `RunResult` is lost), and the leftover worktree is removed with retries.
- **46eb483**: non-English git locales localize stderr strings sandcastle pattern-matches on for worktree-creation control flow; git is now invoked with `LC_ALL=C`. Not Windows-specific but worth knowing if your CI/dev machines have a non-English locale set.
- No CRLF/line-ending-specific bug was found in the changelog — but given the container is Linux and the host is Windows/NTFS, treat the bind-mounted worktree's line endings as the host's `core.autocrlf`/`.gitattributes` config, same as any Windows+WSL2/Docker Desktop bind-mount setup; sandcastle does not add its own normalization on top of git's.
- Net assessment: Windows + Docker Desktop is a **supported, exercised path** (dedicated ADR + ~7 targeted patch releases), not an afterthought, but it has had a materially higher bug rate than macOS/Linux — budget for edge cases when your target repos are also git worktrees themselves, or when paths contain unusual characters.

---

## Summary (API surface + red flags for a Bun-server integration)

- Core surface is `run()` (one-shot, tears down its own sandbox) and `createSandbox()` (warm, multi-call, add `.exec()` for verification gates) — for "one AFK run per ticket" you almost certainly want `createSandbox()` per ticket if you'll ever review/retry, else plain `run()`.
- `cwd` on every entry point lets you target a repo other than your server's own directory — the correct hook for a multi-repo orchestrator; remember `promptFile` ignores `cwd` and resolves against `process.cwd()`, so pass absolute prompt paths.
- Observability is push-based via `logging.onAgentStreamEvent` (text/toolCall/raw, per-iteration-tagged) plus per-iteration `sessionId`/`sessionFilePath`/`usage` on the result — solid enough to build a live per-ticket log stream and post-hoc transcript viewer without extra plumbing.
- `merge-to-head` conflicts are **not auto-resolved**: a failed merge throws with the temp branch preserved and manual recovery commands — your server needs an explicit failure/needs-human-review state, not just retry.
- Auth flows through `.sandcastle/.env` with a "must be declared as a key in the file, value can come from process.env" gate, which is easy to get wrong silently — prefer injecting `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` directly via `claudeCode(model, { env })` from server-held secrets instead of relying on the file resolver.
- Nobody auto-builds the Docker image — your server (or a setup script) must run `sandcastle docker build-image` (or shell equivalent) before the first `run()`, and re-run it whenever the Dockerfile changes; `run()` only pre-flight-checks and fails loudly if it's missing/UID-mismatched.
- No `onIteration` hook — mid-run control from your server is limited to `AbortSignal` (kills the in-flight process, preserves the worktree) and the stream-event callback; there is no pause/resume-per-iteration primitive beyond driving `maxIterations` and looping `createSandbox().run()` calls yourself.
- Windows+Docker Desktop is real but scarred territory — multiple worktree/path/colon bugs were fixed over many releases; test worktree-heavy flows (`branch`/`merge-to-head` strategies) explicitly on Windows before trusting them in production, and pin to 0.12.0+ to get all the Windows fixes found above.
