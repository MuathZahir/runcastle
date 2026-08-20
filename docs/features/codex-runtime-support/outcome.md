# Outcome — Codex runtime support

Add OpenAI Codex (GPT models) as a second agent runtime — interactive sessions and ticket burns — behind an AgentRuntime seam, with full parity: hooks, MCP, prompts, and guards must work the same so the experience is seamless.

- Shipped: 2026-08-20
- Lap: 1

## 1. Runtime-aware model vocabulary (core config + settings UI)

# Ticket 1 — Runtime-aware model vocabulary (core config + settings UI)

## What was done

Core's model vocabulary went from bare strings to `ModelEntry { id, runtime, note? }`.
`CURATED_MODELS` now carries the three Codex ids beside the eight Claude ones, each
declaring its own runtime; `RUNTIME_DEFAULT_MODELS` exports the flagship/smoke pair per
runtime and the schema's own `model` / `stepModels.smoke` defaults are derived from it
rather than hardcoded twice. `RuncastleConfig` gained a `models` roster (defaults `[]`)
that `modelRoster()` merges over the curated list by id, and `resolveModelEntry(step,
config, project, runOverride)` resolves the existing chain all the way to `{ id, runtime }`.
`resolveModel` keeps its name and now delegates, returning `.id` — an id no roster knows
resolves to `claude-code`. Its config parameter widened to a `ModelConfig` alias whose
`models` is optional, so the existing partial-object callers in tests still typecheck.

Two deviations from the ticket's sketch, both small. First, `CuratedModel`'s `label`
field is gone rather than carried into `ModelEntry`: nothing read it (the dropdown always
rendered raw ids), so keeping it would have been a dead third field. Second, the settings
UI needed a place to *write* the roster, which the ticket's context implies but does not
spell out — so `settings.get`/`update` gained a global `models` field validated by
`ModelEntry`, `SettingsUpdateInput`'s value union admits the array, and the event message
JSON-stringifies object values instead of emitting `[object Object]`.

In the web app, `describeField` now derives a model row's choices from the roster and
attaches `modelGroups` (one group per runtime, empty for non-model rows); the `models`
field itself is filtered out of `globalRows` since it is vocabulary, not a value with a
control. `ModelCombobox` renders `<optgroup>`s and shows each entry's note beside its id.
Choosing "Custom…" opens a form asking for the id, the runtime (radio, required, no
default, never inferred), and an optional use-case note; committing writes the entry into
the global roster and *then* selects it, sequentially — both writes read-modify-write the
same config file, so firing them concurrently would clobber one. The "Claude model every
step inherits" copy is now provider-neutral.

## Surprises

`packages/core/src/schemas.ts` had no imports from `./config` before this; adding one for
`ModelEntry` is the first edge between them. It is one-directional (config imports nothing
from schemas), so no cycle, but it is worth knowing the barrel now has that dependency.

The settings service's `DESCRIPTORS` machinery assumed every field is a scalar in two
places that a roster violates: the `String(value)` in the event message, and the
`String(value)` that writes a project override. Only the first mattered here (`models` has
no project column), and it is fixed; the second is still scalar-only and would need work if
a future non-scalar field ever becomes project-overridable.

`bun run test` is **not** fully green on this branch: `packages/server/test/dev-pane.test.ts`
fails one assertion (`expect(pidAlive(-pgid)).toBe(false)` at line 183 — a spawned process
group not reaped in time). It fails standalone too, and `git diff` confirms nothing on its
path (`src/pty/*`, its own file) is touched by this ticket; the only file my diff shares
with that subtree is `services/settings.ts`, which none of the pty modules import. Treating
it as an environment artifact. Everything else: 1896 passed, 4 skipped, typecheck clean.

Re-verified in a second iteration, independently: typecheck exits 0 across all four
packages plus `scripts/`; the full suite is 1896 passed / 4 skipped / 1 failed, that one
failure being dev-pane. Re-run alone (`vitest run packages/server/test/dev-pane.test.ts`,
10 passed / 1 failed / 2 skipped) it still fails with no other test in the process, and
`git diff --name-only 7fefd5a..HEAD` over its whole import graph — the test file,
`src/pty/`, `services/events.ts` — returns zero files. It is a process-group reaping race
in this container, not this ticket's doing.
Note also that the ticket's stated baseline (118 files / 1768 tests) is stale against this
branch, which has 122 files / 1901 tests.

## Left undone

Deliberately out of scope, in ticket order: the launcher still passes whatever id wins the
chain to the `claude` CLI, so selecting a Codex model today launches the wrong binary —
that is the AgentRuntime-adapter ticket's job, and this one only makes the runtime
*observable*. Onboarding does not seed defaults from `RUNTIME_DEFAULT_MODELS` yet (a later
ticket owns it); the constants are exported and waiting. The per-ticket model assignment
that decision 4 hangs off the `note` field — passing only annotated entries to the tickets
session, stamping `ticket.model` — is untouched.

One adjacent observation for whoever takes the next slice: the roster has no *delete* or
*edit* affordance in the UI. An operator can add a custom entry and can annotate by
re-adding the same id (the merge upserts), but removing one means hand-editing
`~/.runcastle/config.json`. The ticket asked for neither, so I left it.

I did not run the `.runcastle/` drive scripts (the sandbox is hermetic, and they are `.ts`,
so neither `bash -n` nor the PowerShell parser applies). I read `drive-setup.ts` and
confirmed no edit is triggered: this ticket adds no service, no required env var, no seed,
and no process. `models` defaults to `[]` in the schema, so a drive whose copied
`config.json` predates this change loads unchanged.

## 2. AgentRuntime seam: extract adapter contract, Claude adapter in place

# Ticket 2 — AgentRuntime seam: extract adapter contract, Claude adapter in place

## What was done

Extracted an `AgentRuntimeAdapter` contract into `packages/server/src/launcher/runtimes/`
(`types.ts`, `claude.ts`, `index.ts`). The interface is `{ id, binary, resolveBinary(),
checkReady(), writeArtifacts(input) → { files, argv, env, envScrub }, kickoffLine(kind) }`, and
`writeArtifacts` returns a complete launch spec that fully describes a launch without spawning
it — which is what the `spawn:false` smoke path renders and what the tests assert against.

The Claude adapter wraps the previous behaviour verbatim: `buildClaudeArgs`, `CC_NESTING_ENV`,
and `KICKOFF_LINES` moved out of `launcher.ts` into `claude.ts` unchanged. All four launch entry
points (`launchSession`, `launchPrepareSession`, `launchDriveFixSession`, `launchProjectSession`)
plus their four smoke paths now resolve an adapter from the `{ id, runtime }` that ticket 1's
`resolveModelEntry` yields, and consume the spec for both the rendered command and the PTY spawn.
`launcher.ts` shed 148 net lines and no longer names Claude anywhere.

`index.ts` holds the adapter registry with `registerRuntimeAdapter` / `resetRuntimeAdapters` —
the seam a second runtime arrives through, and the one the tests drive a stub `codex` adapter
from. A runtime with no adapter throws before any session row, worktree, or artifact exists.

Fail-early readiness (`assertRuntimeReady`) runs before the session row at all four sites and
surfaces `reason` + `doctorHint` as a `GateError`. The `spawn:false` smoke path is exempt, since
it fabricates a session minus the process and the process is the only thing readiness is about.

Session stamping: added nullable `model` / `runtime` columns to the `sessions` table in core's
drizzle schema (migration `0027_tired_deadpool.sql`), mirrored on the `SessionRow` wire schema
and `rowToSession`, set at row creation in the launch path, and carried on the `session.launching`
event per the SPEC convention that every mutation announces itself.

**Deviations from the ticket's sketch.** `checkReady()` takes no `ctx` — Claude readiness is a
binary lookup and nothing needed one, so I took the smaller reading. The interface gained a
`binary` field beyond the sketch because the smoke path must render the program word as the
runtime's own CLI name rather than hardcoding `claude`. `resolvePluginDir` / `resolveSkillsRoot`
were moved from `launcher.ts` into a new `skills-root.ts` — not cosmetic: the adapter needs
`resolvePluginDir` and importing it from `launcher.ts` would have made the launcher and its
adapters circular.

## Surprises

`packages/server/test/dev-pane.test.ts` — "kills the child process tree so the port-holder is not
orphaned" — **fails in this sandbox and is not mine**. It is deterministic (3/3 targeted runs), and
I confirmed it fails identically at the pre-ticket base commit `11cfb65` via a scratch
`git worktree`, so it predates every line of this ticket. Neither the test nor `src/pty/dev-pane.ts`
nor anything in its import graph is in this diff. It asserts a PTY process group is fully reaped
400ms after kill; the container's process reaping does not oblige. The verify baseline in the
prompt claims a fully green suite, so treat that baseline as measured in a different environment
rather than as evidence of a regression here. Everything else is green: **typecheck 0 errors;
1912 passed, 1 failed (that test), 4 skipped across 123 files**.

Nullability was the one real design call. The columns had to be nullable for rows that predate
them, but the more interesting case is a session row created *outside* a launch (fixtures, tests):
it resolved no model, and stamping the current default onto it would be a fabrication that reads
back later as fact. So readers treat a null `runtime` as `DEFAULT_RUNTIME` — which is what every
historical session in fact ran on — and a test pins that.

## Left undone

Deliberately out of scope, for whoever picks up the Codex adapter: `hooks.json` / `config.toml` /
`AGENTS.md` generation and the synthetic `CODEX_HOME` have no home in the contract yet —
`writeArtifacts` returns an opaque file list, so a runtime writing a directory tree instead of
three flat files fits without a contract change. The burn surface is untouched: `buildBurnAgent`,
the guard install, and the error classifiers still assume Claude, and decision 8 puts them behind
this same seam eventually — the interface will need to grow those members. `.runcastle/` drive
scripts needed no edit; this ticket adds only a migration, and `drive-setup.ts` already documents
that it runs every step unconditionally for exactly that case (verified by reading it, not by
running it — the sandbox is hermetic).

## 3. Codex interactive adapter: synthetic CODEX_HOME sessions with full parity

# Ticket 3 — Codex interactive adapter

## What was done

The Codex adapter now sits behind the `AgentRuntime` contract ticket 2 built, and
selecting a codex-runtime model for any talk-session kind opens a real Codex
session. Because Codex takes no per-launch configuration flags, the adapter
*builds* a home instead of passing them: `<sessionDir>/codex-home` containing
`config.toml` (the resolved model, `sandbox_mode = "workspace-write"` +
`approval_policy = "never"` as the `acceptEdits` analogue, `[projects."<worktree>"]
trust_level = "trusted"`, and the runcastle MCP server as streamable HTTP with the
same `X-Runcastle-Session` header), `hooks.json` (the five lifecycle events →
the same runtime-neutral `hook-client.ts`, with `commandWindows` on win32),
`AGENTS.md` (the per-kind system prompt) and a copy of the human's own
`auth.json`. Argv is `[resume <id>]? --dangerously-bypass-hook-trust`; env is
`CODEX_HOME` plus the two `RUNCASTLE_*` vars. `checkReady` refuses early — with a
doctor hint — on a missing binary *or* missing credentials, since a Codex session
runs on borrowed auth and "logged out" means a home with nothing in it.

Two things spread beyond the adapter, both because the ticket asked. The skill
spelling is now parameterized per runtime (`skillRef`): the prompt renderers in
`artifacts.ts` and the per-kind kickoff table both build from one place, so Claude
gets `/runcastle:ideate` and Codex gets `$ideate` from the same source. And the
skill pack renders into the worktree's `.agents/skills/<name>/SKILL.md` at launch,
kept out of the human's diff through `.git/info/exclude` (resolved via the
repository's *common* git dir, since a linked worktree's `.git` is a file).

Two deviations from the ticket's sketch. Codex's `SessionStart` hook is registered
with **no** matcher, unlike Claude's one-entry-per-source: Codex's matcher is a
tool-name regex, so a source matcher there would be a filter that never matches. And
no `timeout` field is declared on any Codex hook — the unit is not pinned against a
live CLI and the hook config structs may reject unknown keys, which would silently
kill every hook. Also: `renderCommand` (the `spawn:false` smoke line) now prefixes
the runtime's env, because a launch configured through a synthetic home is only
half described by its argv.

## Surprises

- `codex` is not installed in the sandbox, so every fact was pinned against ctx7
  `/openai/codex` source rather than `codex --help` (3 calls, the ticket's budget).
  That confirmed the exact wire values — `sandbox_mode` ∈ read-only /
  workspace-write / danger-full-access, `approval_policy` ∈ untrusted / on-request /
  granular / never, the `hooks.json` matcher-group shape, and
  `--dangerously-bypass-hook-trust` — but **not** two things the ticket asserted
  and I took on faith: the `http_headers` key on an MCP server entry, and
  `commandWindows` on a hook command. Both are cheap to correct if they drift.
- The bigger unverified one: the edit guard denies on `tool_input.file_path`, and I
  could not confirm Codex's `apply_patch` payload carries that field (its tool
  argument is a patch *envelope*). `EDIT_TOOLS` gained `apply_patch` additively, and
  the route is untouched as the ticket required — but if Codex sends the patch text
  instead of a path, the guard fails open (its documented policy) and the deny
  never fires. That is the one acceptance criterion I cannot claim was proven
  against a real CLI; the test proves the route denies an `apply_patch` call *that
  carries a file_path*.
- `runtime-adapter.test.ts` had a test asserting codex has no adapter. Wiring one up
  is this ticket, so it was repointed at a synthetic third runtime id.
- `bun test` has one failure, `dev-pane.test.ts > kills the child process tree`
  (`kill -0 -pgid` still reports the group alive). It fails identically before and
  after, and none of the seven files I touched are in that test's import graph —
  it is a process-reaping fault of this sandbox. Everything else: 1967 passed.
  `bun run typecheck` is clean. Note the prompt's baseline count (118 files / 1768
  tests) is stale for this branch, which now has 124 / 1972.

## Left undone

- `lapKickoff` in `sessions.ts` still hardcodes `/runcastle:revisit`. It is a
  kickoff *override* built at the launcher, not part of the per-kind table this
  ticket parameterized, so a Codex lap session would be handed the Claude spelling.
  It needs a runtime argument threaded through `planKickoff` → `launchSession`.
  Same for the burner prompt templates in `packages/skills`, which the spec says
  should lose their Claude-specific phrasing.
- `wellKnownBinDirs` was not given a Codex-specific Windows entry. Codex installs via
  npm global and brew, both already covered; there is no `Programs\codex` analogue to
  Claude's native installer path. Add one if a real install turns up somewhere else.
- The transcript parser for Codex's rollout JSONL (decision 10) and the burn side
  (sandcastle `codex()` provider, the container-side guard twin) are other tickets;
  nothing here touches them.
- No `.runcastle/` drive-script change: this ticket adds no service, no env var the
  app requires at boot (`RUNCASTLE_CODEX_BIN` is an optional override), no seed and
  no extra process. I ran no drive-script check because I changed none of them.

## 4. Codex burns: sandcastle codex() provider, auth, guard twin, image

# Ticket 4 — Codex burns: sandcastle codex() provider, auth, guard twin, image

## What was done

Four commits from earlier interrupted attempts already carried the bulk of this ticket; this
iteration verified them end-to-end and added two self-review fixes. The burn chokepoint
`buildBurnAgent` now takes the resolved `ModelEntry` rather than a bare id and builds
sandcastle's `codex()` for codex-runtime models, `claudeCode()` otherwise, across all four
headless callers (ticket burns, conflict resolution, review, research). Auth follows the model
through one table: `RUNTIME_AUTH_KEY` maps each runtime to the env var its burns authenticate
with, `readTokenFromEnvFile(path, runtime)` pulls that runtime's key out of the single
`~/.runcastle/.env`, `buildAgentEnv` injects it under that name, and both fail-early prechecks
emit the runtime's own setup hint. The burn guard renders twice from one rule set — the same
POSIX sh script installed under `$HOME/.codex/hooks/` and registered by a `hooks.json` with a
`^Bash$` regex matcher — and both container images install the codex CLI before the USER switch.
Error classification gained per-runtime pattern tables, and the burner prompts dropped
`claude --print` for runtime-neutral wording.

Two deviations worth naming. The ticket floated `CODEX_HOME` as an option for the review path's
MCP injection; the implementation used `-c` dotted overrides instead, which I verified against
codex's actual `RawMcpServerConfig` schema — and that check mattered, because the struct is
`deny_unknown_fields`, so forwarding the `type: "http"` field that Claude's `mcp.json` carries
would have been rejected outright. Omitting it is required, not merely harmless. Second, codex
needs `--dangerously-bypass-hook-trust` for the guard to bind at all: writing `hooks.json` is
necessary but not sufficient, so the flag is paired with the install and never passed on the host.

## Surprises

The baseline in the prompt is stale in a way worth knowing: it claims 118 files / 1768 tests, but
tickets 1 and 4 have grown the suite to 122 / 1930. More importantly, the run is **not** fully
green — `packages/server/test/dev-pane.test.ts > "kills the child process tree so the port-holder
is not orphaned"` fails, both in a full run and in isolation. It is not this ticket's: nothing on
this branch touches `src/pty/*`, `src/services/events`, or anything else in that test's import
graph (I checked the full branch file list against it). The test spawns a real native PTY,
backgrounds a `sleep 300`, and asserts the whole process group is reaped after a fixed 400ms —
a timing- and environment-sensitive assertion that a hermetic container fails. I left it alone
rather than expand scope, but the next agent should not spend an iteration rediscovering it.

The win32 model de-quote workaround turned out to be needed for *both* providers, not just
claude: sandcastle POSIX-single-quotes the model value for `-m` exactly as it does for `--model`,
so the fix forks only on flag spelling.

## Left undone

The `.runcastle/` drive scripts needed no structural change — the setup hook copies the whole
`.env` rather than named keys, so `CODEX_API_KEY` was already carried into the drive tree; I only
corrected its comment, which my own diff had made false. Verification was hermetic as required:
no drive script was executed, and since both are TypeScript their syntax is covered by
`bun run typecheck` (exit 0) rather than `bash -n`.

Deliberately not done: the doctor probes still check only Claude readiness, and the AFK-enable UI
still offers only the Claude token — both are named in the feature spec as per-runtime surfaces
but belong to other tickets. `interpretRunResult` and the merge queue were left untouched per the
ticket. I also did not verify a codex burn against the live CLI; nothing in this sandbox can run
one, so the codex path is pinned by rendered-command assertions and the upstream schema, not by
execution.

## 5. Per-ticket model assignment from the annotated roster

# Ticket 5 — per-ticket model assignment

**What was done.** Tickets now carry an optional `model` (zod field on `TicketInput`,
nullable `model` column on the tickets table, migration `0028_damp_stellaris.sql`).
`get_feature_context` grew `annotatedModels` — `{ id, runtime, note }` built only from
roster entries whose note is non-blank, empty otherwise — and `emit_tickets` /
`update_ticket` take a model back. I put the roster validation in the tickets *service*
(`normalizeModel` in `services/tickets.ts`) rather than duplicating it in each MCP tool:
`storeTickets` and `editTicket` are the only two mutations, so one helper covers both MCP
tools and the tRPC `ticket.edit` path the web UI actually uses. Blank/whitespace clears the
assignment; an id off the roster is refused with the configured ids named. The tickets
SKILL.md gained an "Assigning a model" section (choose only from `annotatedModels`, only
when a note fits, never invent an id). The burner's model resolution moved *into* the
per-ticket closure in `resolveBurnDeps` via a new exported pure `resolveTicketModel`, so an
assigned ticket burns on its model as the run override and an unassigned one on the
unchanged chain. The ledger row shows a `model · runtime` chip when assigned, and the
existing in-place editor gained a runtime-grouped `<select>` whose first option ("default")
clears it, backed by a pure `ticketModelChip` helper in `feature-ui.ts`.

**Surprises.**
- The ticket's context pointed at a "per-ticket `resolveModel` call ~:2463". There is no
  per-ticket call: after the codex work the model is resolved **once per run** in
  `resolveBurnDeps` (~:2602), and the resolved `runtime` also picks which auth key is read
  from `~/.runcastle/.env`. So a per-ticket model is implicitly a per-ticket *runtime*,
  which means a per-ticket *token* — the closure now re-reads the token when a ticket's
  assignment crosses runtimes. The run-level `runtime`/`hasAuthToken` on `BurnDeps` (what
  the fail-early auth precheck reports on) deliberately stay the run's default pair.
- `apps/web` has no component-render tests at all — every test there is a pure lib test.
  So the "test for the card" is a `ticketModelChip` test in `feature-ui.test.ts`; the JSX
  itself is covered only by typecheck.
- Baseline drift: the stated baseline (118 files / 1768 tests) is stale — the branch now
  runs 125 files / 1997 tests. `packages/server/test/dev-pane.test.ts > kills the child
  process tree` fails both before and after my change; it spawns a real PTY, backgrounds
  `sleep 300`, and asserts the process group is reaped within 400 ms, which is a container
  process-reaping artefact, not this ticket. Everything else is green
  (`bun run typecheck` clean; 1992 passed).

**Drive scripts.** No edit needed and none made. This ticket adds a migration and a column
— no new service, required env var, seed, or long-running process — and
`.runcastle/drive-setup.ts` states in its own header that every step runs unconditionally
and a branch adding a migration is already covered. Note those scripts are TypeScript, not
shell, so `bash -n` does not apply; they are covered by the repo typecheck, which is green.

**Left undone.** `configuredRuntimes` in `packages/core/src/config.ts` already accepts an
`extraModelIds` argument documented as "per-ticket assignments", but no caller passes
ticket models yet — so the doctor still will not flag a missing Codex CLI when the *only*
Codex model in play is one stamped on a ticket. That is the doctor-probes seam, not this
one, and it is now a one-line wiring job for whoever owns it. Also: `RunBody.tsx` renders
ticket rows during a burn and does not show the model chip; I left it alone since the
ticket names the ticket *card*.

## 6. Runtime-agnostic onboarding, doctor, and per-runtime AFK setup

# Ticket 6 — Runtime-agnostic onboarding, doctor, and per-runtime AFK setup

## What was done

Onboarding, the doctor, and the AFK card stopped being Claude-shaped and became
per-runtime, driven by one table instead of per-provider branches.

The centre of the change is `RUNTIME_SPECS` in `packages/server/src/doctor/doctor.ts`
— one entry per runtime carrying its binary, login command, auth-status argv,
AFK env var, and the words used to describe its credential. Onboarding, the
doctor, the setup service, and the AFK card all read that table, so nothing in
those surfaces names a provider inline any more.

The doctor now runs three checks per runtime (CLI present, interactive login, AFK
credential) with **conditional severity**: a gap is an `error` only when some
configured model resolves to that runtime, otherwise it rides along as `info` —
printed with a `·` and a "(not in use)" suffix, no fix line, outside the issue
count. The set of runtimes that counts is computed by `configuredRuntimes` in
core, folding the global default, every step override, and per-project model
overrides through the roster. The tRPC `doctor` query feeds it project models
from the db.

The setup service generalized `saveAfkToken` into `saveAfkCredential(io, value,
runtime)`, writing whichever runtime's key into the same `~/.runcastle/.env`
(`CODEX_API_KEY` beside `CLAUDE_CODE_OAUTH_TOKEN`) and verifying against that
runtime's own CLI. `terminalSpec` gained `claude-login` / `codex-login` flows
beside `setup-token`. `seedModelDefaults` writes the authed runtime's curated
pair as ordinary settings mutations (each emitting `settings.updated`), Claude's
pair winning when both are authed.

On the web side the wizard gained a "Coding agents" step showing both providers
as peer cards — detected state, an install line to copy when the CLI is absent,
the runtime's own sign-in terminal when it is present — and continues only once
at least one runtime can open a session. Completion fires `seedModelDefaults`.
The AFK card renders one credential section per runtime. The headline is now
"Your coding agent, driven through a pipeline".

### Deviations from the ticket's description

- The ticket suggested detecting Codex interactive auth via `~/.codex/auth.json`
  presence. The implementation prefers `codex login status` (as the ticket's
  parenthetical asked) and falls back to `$CODEX_HOME/auth.json` **only** when
  the CLI answers that the subcommand is unrecognized — i.e. it is too old. A
  file check alone would be a false negative on hosts that keep credentials
  elsewhere.
- `talkReady` accepts **either** an interactive login or the AFK credential,
  rather than requiring login. Both genuinely authenticate a session, and an
  operator who pasted a key should not be sent back to log in a second time.

## Surprises

- **Ticket model assignments do not exist yet.** The ticket asked the doctor's
  conditional severity to compute over "any ticket model assignments", but the
  `tickets` table has no `model` column — that is the sibling per-ticket-model
  ticket's work. `configuredRuntimes` therefore takes an `extraModelIds` list and
  the tRPC caller passes project overrides only. The seam is already the right
  shape; when tickets carry a model, it is one more array to pass.
- **Env-locked settings are signalled only by exception.** `updateSettings`
  throws `InvalidInputError` when a field is pinned by an env var, and there is
  no exported predicate to ask beforehand. `seedModelDefaults` therefore catches
  that error to mean "pinned, leave it alone". It is a broader catch than ideal,
  but adding a predicate would mean editing `settings.ts`, which this ticket does
  not own. Behaviour is pinned by a test.
- **The drive scripts needed no change.** `.runcastle/drive-setup.ts` copies the
  whole `~/.runcastle/.env` into the drive's scratch data dir, so `CODEX_API_KEY`
  rides along with no edit. This ticket adds no service, no required boot env var,
  no seed, and no extra process — none of the four triggers fire. Hermetic checks
  run: the scripts are TypeScript (not shell), so `bash -n` does not apply; they
  are covered by `bun run typecheck`, which is green. I did not run `drive-setup`
  itself — the sandbox is hermetic by design.

## Verification

`bun run typecheck` — **0 errors** across core, server, web, design-system.

`env -u GIT_ASKPASS bun run test` — **1932 passed, 4 skipped, 1 failed**.

The one failure is `packages/server/test/dev-pane.test.ts > "kills the child
process tree so the port-holder is not orphaned"`, which asserts a real OS
process group has been reaped (`kill -0 -pgid` must throw ESRCH). **It is not
mine**: this ticket's diff touches no pty or dev-pane code, so the code under
test is byte-identical to the baseline commit, and the failure reproduces on a
targeted single-file run. It is an environment characteristic of this sandbox's
process reaping, not a regression. The stated baseline claimed a fully green
suite, so treat that note as stale for this one test.

## Left undone

- `GRILL_EXPLAINER` in `apps/web/src/lib/vocabulary.ts` still says "a Q&A
  conversation with Claude". It is session copy, which the ticket explicitly
  assigns to a sibling ticket, so I left it. Worth noting it currently has no
  importer — it may be dead.
- The Codex login terminal is reachable from the wizard. Settings surfaces the
  per-runtime **AFK credential** rows but not the interactive login button; if
  the intent is that a user can re-run `codex login` from Settings after
  onboarding, that is a small addition to `EnableAfkCard` nobody has asked for
  yet.
- `terminalSpec` does a reverse lookup by looping `RUNTIME_SPECS` and comparing
  against `LOGIN_TERMINAL_KIND`. It works and is tested; a direct
  kind→runtime map would read better if a third runtime ever lands.

## 7. Runtime-visible UX: copy sweep and Codex transcripts

# Ticket 7 — Runtime-visible UX: copy sweep and Codex transcripts

## What was done

The transcript service now dispatches on the session's runtime instead of reading
every `transcript_path` as Claude Code JSONL. `parseTranscript(jsonl, runtime)` picks
one of two parsers and both meet in the existing `TranscriptTurn[]` shape, so the
conversation pane did not have to learn anything about formats. The Codex parser reads
rollout lines (`{ timestamp, type, payload }`), taking the said turns from
`response_item` payloads of `type: 'message'` and dropping reasoning summaries,
`function_call`/`function_call_output`, and the `<user_instructions>` /
`<environment_context>` preamble Codex replays as user messages — that preamble is this
runtime's `isMeta`, and without dropping it the pane would open with an environment
dump attributed to the human.

Reads return a status rather than a bare list: a file with content but not one line the
runtime's parser recognises comes back `unavailable`, and the pane renders "transcript
not available for this session." An absent or empty file stays an ordinary empty
conversation (that one really has no record), so the existing "cleared or was never
written" state is unchanged. `conversationTranscript` returns `{ status, turns, runtime }`
— the pane needs the runtime to label bubbles, and `project.conversations` does not
carry it.

Session `model` + `runtime` already reached the web app on `feature.get` (the
`SessionRow` mapper carries them, unprojected); rather than add plumbing I pinned that
with an assertion, since a column projection on the session read would take it away
silently. Copy is named from one vocabulary helper — `agentName(runtime)` for
"Claude"/"Codex"/"the agent", and `sessionAgentName(session)` for a row that exists,
which applies the schema's null-reads-as-default convention.

Deviations from the ticket's sketch: (1) `AgentTranscript.tsx:10` and `RunBody.tsx:21`
turned out to be file-header **comments**, not labels — there is no user-visible
"Claude" in either file and the burn transcript has no per-run label to make
runtime-aware, so I neutralised the comments and added no new UI. (2) The tickets
next-step line says "the agent" rather than naming a runtime: tickets each carry their
own model (decision 4), so a batch can span both. (3) I also fixed
`GRILL_EXPLAINER` in `lib/vocabulary.ts`, which the ticket did not list — it is
hardcoded "Claude" copy in the same sweep (it currently has no `src` importer, only a
test).

## Surprises

**The kickoff filter was a latent bug the runtime seam exposed.** Titles and transcripts
both strip the launcher's opening line via `promptMatchesKickoff`, and each adapter
*spells* that line differently (`/runcastle:project` vs `$project`). Title derivation
still matched Claude's spelling, so a Codex conversation kept its kickoff as a turn and
the conversation list titled the row "Proceed with your task: invoke the $project
skill…". Caught in self-review, pinned with a red test first, fixed by threading the
runtime through `deriveTitle` and making it a *required* parameter on `withoutKickoff`
so a wrong-runtime match cannot return silently.

**The rollout format could not be pinned empirically, contrary to the ticket's
instruction.** The sandbox is hermetic: no `codex` binary, no `~/.codex`, no
`rollout-*.jsonl` anywhere on disk, and no Codex research note in `docs/research/`. The
parser encodes the format `codex-rs` writes (rollout envelope + Responses-API items) but
it is **unverified against a live file**. This is exactly the risk decision 10 accepts,
and the `unavailable` status is the designed landing spot if I got it wrong — a mismatch
degrades to "transcript not available", never to an error in the session. One specific
guess worth re-checking against a real rollout: I treat `event_msg` lines as recognised
but skipped, on the assumption they duplicate the `response_item` prose. If that is
wrong, Codex transcripts will render short rather than doubled.

**No component-test infrastructure in `apps/web`** — no testing-library, no jsdom. So
"web tests for runtime-labelled rendering" are at the lib seam (`agentName` /
`sessionAgentName` / `nextStep` copy), which the components are thin views over.

**One pre-existing test failure, not mine.** `packages/server/test/dev-pane.test.ts >
"kills the child process tree so the port-holder is not orphaned"` fails both in the
full suite and in isolation. It is environmental (process-group reaping in this
sandbox): `git diff` against the branch point shows **zero** lines changed in
`packages/server/src/pty/` or in that test file, and my diff touches only the transcript
service, conversations, and web copy. I tried to confirm it at the branch point in a
scratch `git worktree`, but the worktree cannot resolve `@runcastle/core` without a full
install there, so the confirmation rests on the diff evidence instead. Everything else is
green: **2035 passed, 1 failed, 4 skipped**, and `bun run typecheck` is clean across all
packages. Note the ticket's stated baseline (118 files / 1768 tests) is stale — the
branch now has 126 files / 2040 tests after tickets 2–5 landed.

## Left undone

- **`SettingsOverlay.tsx:441`** — the custom-model-id placeholder still reads
  `"model id (e.g. claude-opus-5, claude-opus-5[1m])"` in a field that is explicitly
  cross-runtime (the runtime radio group sits directly below it). Left alone: it is
  settings, not the feature pipeline, and the ticket scoped me away from settings copy.
  A Codex example id beside the Claude one would be a one-line improvement.
- **`GRILL_EXPLAINER` has no `src` importer.** It is referenced only by
  `apps/web/test/vocabulary.test.ts`. Either the New-feature form lost its explainer or
  it was never wired — worth someone deciding which.
- **No `.runcastle/` drive-script change.** This ticket adds no service, required env
  var, seed, or long-running process, so the setup/stop scripts are already correct. I
  ran none of them (hermetically impossible, by design) and made no edits to check.
- **`project.conversations` still omits `runtime`.** The pane gets the runtime from the
  transcript payload instead, which is enough for the bubbles. If a future surface wants
  a per-row runtime badge in the conversation *list*, that projection needs widening.

## 8. Review: exercise the integrated Codex runtime feature

This lap makes runcastle a two-runtime product. GPT models now sit alongside Claude ones in the same settings dropdowns, grouped by which agent they run on, and picking one is the whole decision — there is no separate runtime switch to forget. Choose a GPT model for ideation and the session opens in Codex; choose a Claude model and it opens in Claude Code, with the same hooks, the same edit guard, the same runcastle tools and the same kickoff. Nothing about the Claude path changed underneath: the launch flags, the prompts and the argv are the ones that were there before, now reached through a per-runtime adapter rather than hardcoded.

Three things are newly yours to use. You can annotate any model in settings with a free-text note about what it is good at, and only annotated models are offered to the agent that writes your tickets — so it can stamp "this one is a mechanical refactor, run it on GPT" per ticket, and you can change that on the card right up until you burn. First-run onboarding now treats Claude and Codex as peers: authenticate whichever you have, and one is enough, with your defaults seeded from whatever you authed. And the app has stopped assuming Claude in its own copy — transcripts, session panels and the wizard name the agent you are actually talking to, or say "the agent" when they cannot know.

The shape that landed matches what was specified, with one deliberate narrowing: the runtime adapter covers launching sessions, while burns pick their provider at the existing burn chokepoint rather than through the same interface. That reads as the right call, not a shortcut.

What deserves your attention before anyone leans on this. If you install Codex, paste an OpenAI API key, but never run `codex login`, onboarding will wave you through and seed GPT models as your defaults — and then every talk session will refuse to open, because a session copies your real login and an API key is not one. That is the exact user this feature was built for, so it is worth fixing first. Two smaller versions of the same gap: a ticket you assign to a GPT model inside an otherwise-Claude burn gets no advance auth check and no doctor warning, so a missing key surfaces as a container failure rather than a refusal up front; and a project session on a GPT model auto-approves edits across your whole repo where the same session on Claude would ask you.

Be aware this review is code-only. The drive would not start — your checkout has uncommitted work in progress, which it refuses to move — so nothing here was confirmed by running the app. The test suites, the settings walkthrough, the ticket-card model chip, the doctor screen and the generated Codex session files are all unverified. Commit or stash those two files and this review will run properly.

## 9. Fix: Codex hooks.json test is platform-blind to commandWindows on win32

# Ticket 9 — Codex hooks.json test was platform-blind to `commandWindows`

## What was done

One test file changed; no production code, as the ticket predicted.

`launch-artifacts.test.ts › codexRuntime.writeArtifacts › registers the five lifecycle
events…` writes a real `hooks.json` on whatever platform the suite runs on, then asserted
the SessionStart entry with `toEqual` against the POSIX shape — so it passed in the
burner's Linux sandbox and failed on a Windows dev machine, where `renderCodexHooks` adds
`commandWindows` by design. That assertion is now `toMatchObject`, which is already this
file's idiom for hook entries (the `renderSettings` tests at lines 218 and 242 use it for
exactly the same shape). It still proves the command string, all five events and the
PreToolUse matcher, none of which are platform-dependent.

The exhaustiveness given up there is recovered — and then some — in the sibling test that
*names* its platform instead of inheriting the host's. It previously checked only that
SessionStart lacked `commandWindows` on `'linux'`. It now pins the full entry shape with
`toEqual` against known-good literals on both branches: `commandWindows` equal to `command`
on every win32 hook, absent from every hook on `'linux'` *and* `'darwin'`. That test runs
identically on every host, which is what makes the win32 criterion provable from here.

## Surprises

The ticket asked me to "add an explicit assertion that `commandWindows` equals `command` on
win32" — but such a test already existed on the branch (added by ticket 3, `git log` on the
file confirms). So the work was strengthening it, not writing it: extending the absence
check from one hook to all five and from one platform to two, and adding the exhaustive
win32 literal that recovers what the other test stopped asserting.

Verifying "passes on win32 and darwin" from a Linux sandbox needed a trick, since the whole
bug is a platform branch this container never takes. I ran the *real* test file under a
throwaway vitest config whose setup file stubs `process.platform`: 57/57 passed as `win32`
and as `darwin`, and 57/57 natively on linux. One wrinkle worth recording — a naive stub
makes 16 tests fail for an unrelated reason: `os.tmpdir()` switches to reading `TEMP`/`TMP`
once it believes it is on win32, and neither is set on Linux, so every `mkdtempSync` in the
file blows up on `undefined`. Setting those two vars in the stub cleared it. The scratch
config, setup and probe test were deleted before committing; nothing of that harness ships.

I also mutation-checked the strengthened test rather than trusting a green run: flipping
`platform === 'win32'` to `!==` in `renderCodexHooks` turns it red, and `codex.ts` was
reverted immediately (`git status` confirms the committed diff is the one test file).

`env -u GIT_ASKPASS bun run test` is **2177 passed / 4 skipped / 1 failed**. The one failure
is `packages/server/test/dev-pane.test.ts › kills the child process tree`, which asserts a
real OS process group is reaped 400ms after a kill (`expect(pidAlive(-pgid)).toBe(false)`).
It is not mine: it fails on a targeted single-file run with nothing else in the process, and
my diff touches exactly one file that dev-pane does not import. Every prior ticket digest on
this branch (1, 2, 3, 4, 5, 6, 7) reports the same failure, so treat the prompt's
"fully green" baseline as stale for this one test in this container. `bun run typecheck` is
clean across all four packages plus `scripts/`.

## Left undone

Nothing this ticket asked for. Two adjacent observations for whoever follows:

The `platform` seam only exists on `renderCodexHooks`. `codexRuntime.writeArtifacts` reads
`process.platform` through that default argument, so there is no way to drive a full
artifact write at a chosen platform from a test — which is exactly why the shape assertion
had to move down to `renderCodexHooks`. If more of the Codex artifact set ever grows
platform-dependent branches (`config.toml` paths are the obvious candidate), that seam wants
widening to `writeArtifacts` rather than repeating this split per field. I did not do it
here: the ticket says no production change is needed, and none was.

The same latent hazard exists on the Claude side and I left it alone as out of scope —
`renderSettings` takes no `platform` parameter at all, so if Claude's hook entries ever gain
a win32 spelling, its tests will be blind in precisely the way this one was.
