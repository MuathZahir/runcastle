# Outcome — Stopping a headless agent actually stops it

Stop/cancel on a burn, fix, or verification agent must kill the real process (Windows process tree, Docker container), and the UI must not report "stopped" until it is dead.

- Shipped: 2026-09-09
- Laps run: 1

## What shipped

25 commits · 32 files

### Lap 1
- 6 tickets landed: #1 Expose kill handles: sandcastle patch + kill-handle registry; #2 Docker burns: Stop and Cancel kill the container and wait for death; #3 Host agents and waive: tree-kill review/research, waive kills live agents; #5 Terminal state can be written as soon as abort fires, before kill confirmation; #6 Waive skips kill-and-wait for an actively burning ticket; #7 Docker-configured research agents are not registered and survive Cancel run
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 51a6af5f2857ac73ddd9ff234616db10302308de
- Landed since: 3
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 3f424176eaafd5aa9c859e9c313296e8385ab5df
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 8e35fb98ab1eabc9da8c02cc183194a922cc519d
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Expose kill handles: sandcastle patch + kill-handle registry

# Ticket 1 — expose kill handles: sandcastle patch + kill-handle registry

## What was done

The sandcastle patch (`patches/@ai-hero%2Fsandcastle@0.12.0.patch`) grew two
optional, behaviour-preserving additions on top of the ADR-0011 named-volume
hunks: the docker provider now takes `containerName` and uses it verbatim as the
container's `--name` (falling back to `sandcastle-<uuid>` when omitted), and
`noSandbox()` takes `onChildSpawn(pid)`, fired after every `exec` and
`interactiveExec` spawn when the child actually got a pid. Both `.d.ts` surfaces
(`dist/sandboxes/docker.d.ts`, `dist/sandboxes/no-sandbox.d.ts`) were updated in
the same style the existing patch uses.

`packages/server/src/workflows/kill-registry.ts` is new: one handle per lane
(opaque string key), `registerContainer` / `registerHostPid` (overwrites — latest
pid wins) / `release` / `killAndWait`. `killAndWait` runs `docker rm -f <name>`
then polls `docker inspect` until the container is gone, or calls the existing
`killProcessTree` for a host lane, all under one bounded deadline (default 10s).
It never rejects: unknown lane → `{ confirmed: true }`, deadline → `{ confirmed:
false }`. A confirmed kill releases the handle; an unconfirmed one keeps it so a
retry kills again rather than reading as a lane nobody registered. Modelled on
`packages/server/src/pty/registry.ts` — a class with a `killRegistry()`
globalThis-pinned singleton (a `bun --hot` reload must not strand a live handle)
plus `createKillRegistry(deps)` for tests, and the settlement-owning spawn
pattern from `kill-tree.ts` (never `promisify(execFile)`).

Two test files: `packages/server/test/kill-registry.test.ts` (13 cases, both
system calls injected — no docker, nothing real killed) and
`packages/server/test/sandcastle-kill-handles.test.ts`, which drives the compiled
providers the way `sandcastle-volume-mount.test.ts` does. I verified the latter
goes red against the pristine unpatched chunks and green with the patch, so it
actually pins the patch rather than assuming it.

## Deviations and surprises

- **Deviation, deliberate:** I extended `BUNDLED_DEPENDENCIES`'s patch markers in
  `packages/server/scripts/publish-manifest.ts` (plus the `PATCHED_BUNDLE`
  fixture in `publish-manifest.test.ts`) to cover the two new hunks. The ticket
  did not ask for it, but ADR-0011 §3 makes the build prove the patch's code
  survived bundling — without markers, a published build that inlined an
  unpatched copy would ship a stop button that silently cannot kill anything,
  which is the exact failure ADR-0011 was written about. Markers are keyed on
  property access (`.containerName ??`, `.onChildSpawn?.(`) so a bundler
  renaming the `options` binding cannot break them.
- **The ticket's `bun patch` workflow does not work here** — ADR-0011 §2 says so
  explicitly (Bun's isolated linker). I used the ADR's route instead: pristine
  package from `~/.bun` store into a scratch git repo, apply the current patch,
  edit, `git diff --cached --full-index`. Regenerating the *unmodified* patch
  that way produced a byte-identical file, which is what made the route safe to
  trust. A plain `bun install` afterwards re-derived the package from the new
  patch into a fresh store entry (`patch_hash=69e07bcb…`), so bun's own applier
  accepts it, not just `git apply`. `bun.lock` needed no change (it references
  the patch by path, not by content hash).
- **Watch out:** `node_modules/.bun/@ai-hero+sandcastle@0.12.0/**` is HARDLINKED
  into the shared bun store. Editing those files in place silently corrupts the
  pristine cached copy for every slot. Break the link (`cp --remove-destination`)
  or let `bun install` redo it.
- The ticket says to run `bun test <file>`; this repo's runner is vitest
  (`bun run test` / `bunx vitest run`), and every test imports from `vitest`, so
  I used that.
- `packages/server/test/dev-pane.test.ts` › "kills the child process tree so the
  port-holder is not orphaned" **fails in this sandbox and is not mine** — it is
  not in the prompt's baseline list, so I confirmed it by running that one file
  from a `git worktree` at the pre-ticket commit `13a83d4`, where it fails
  identically. It also predates my `bun install`. Full suite otherwise:
  232 files / 3380 passed, that one failure. Typecheck: 0 errors.
- Drive machinery: unchanged, and correctly so — this ticket adds no service, no
  required env var, no seed and no extra process, so `.runcastle/drive-setup.ts`
  and `drive-stop.ts` needed no edit. I did not run them (no services here).

## Left undone

- Nothing calls the registry yet. Tickets 2/3 own the wiring: passing
  `containerName: runcastle-<runId>-t<seq>` and `onChildSpawn` at the four
  `run()` sites, and making `ticket.stop` / `run.cancel` / `ticket.cancel`
  kill-and-wait. The registry is deliberately agnostic about the lane key.
- `sandboxes/podman.js` has the identical `sandcastle-${randomUUID()}` line and
  was left alone — the decisions doc scopes the container path to docker. If
  podman burns ever need stopping, that is a one-line extension of the same hunk.
- Boot-time sweep of stray `runcastle-*` containers is now possible (deterministic
  names) and is explicitly out of scope for this lap.

#### 2. Docker burns: Stop and Cancel kill the container and wait for death

# Ticket 2 — docker burns: Stop and Cancel kill the container and wait for death

## What was done

Every docker agent a burn starts now runs under a name runcastle chose —
`runcastle-<runId>-t<seq>`, with `-resolve` appended for the conflict-resolver
lane — threaded from a new `burnContainerName` helper through `selectSandbox` /
`buildSandboxOptions` into the patched provider's `containerName` option. Right
before each `run()` the lane registers that name in the kill registry keyed by
the ticket id and tagged with the owning run; the burner's existing `finally`
releases it beside `releaseTicketAbort`. Registration is guarded to
`sandbox === 'docker'`: podman still names its own containers (the patch covers
docker only) and host mode is ticket 3's.

`stopTicketRun` is now async — it aborts, then `killAndWait`s the lane, and
returns `{ stopped, confirmed }`. `cancelRun` is async the same way, using a new
`killAllForRun(runId)` on the registry. To make that findable I gave the registry
an optional `LaneOwner` (`{ runId }`) recorded with each handle, rather than
encoding the run in the lane key: run-scoped host lanes are already keyed BY the
run id (ticket 1's own tests), so a `<runId>:<ticketId>` key scheme would not
have covered them. No terminal state is written from the stop path; the kill is
what makes `run()` reject, and the existing failure paths still do that writing.

`ticket.stop` and `run.cancel` await those, return `confirmed`, and on
`confirmed: false` emit `ticket.stop_timeout` / `run.cancel_timeout`. The web
Stop button reads "Stopping…" for the lane whose mutation is in flight, the
Cancel-run button likewise, and both surfaces toast the shared `STOP_TIMEOUT`
sentence when the kill could not be confirmed.

## Deviations and surprises

- Two small things outside the ticket's letter, both needed for what it asked
  for to actually read: (a) `eventLevel` in `apps/web/src/lib/activity.ts`
  scored `ticket.stop_timeout` as an ordinary info line (its error keywords are
  "stopped", not "stop"), so `timeout` joined the alternation; (b) the
  next-step bar's Cancel run (`Workspace.tsx`) is a SECOND caller of
  `run.cancel` and toasted "cancel requested" — now stale wording, and it would
  have swallowed the timeout warning. Its toast reports what happened and warns
  on `confirmed: false`. The warning sentence lives in `lib/vocabulary.ts` so
  both callers say it identically.
- `deleteFeature` now `await`s `cancelRun`; it already ran in an async function
  and its step (4) worktree removal is exactly what a still-live container
  breaks on Windows.
- I did NOT add a router-level test for the timeout branch. The global
  `killRegistry()` has no injected deps (by design — `createKillRegistry` is the
  test seam), so forcing an unconfirmed kill through tRPC would mean either
  swapping the `globalThis` singleton or shelling out to real docker inside a
  unit test with a 5s vitest deadline. The timeout contract is covered on the
  registry itself; the ticket says the review ticket exercises the real chain.
- `startContainer` in the vendored sandcastle FAILS on a name that already
  exists ("Container 'X' already exists"), and its `close()` awaits `docker stop`
  + `docker rm`. That is fine for the deterministic name — implementer attempts
  and resolver passes are strictly sequential — but it is the assumption to
  check first if a burn ever dies with that message. Its `removeContainer`
  ignores errors, so our own `docker rm -f` beforehand cannot break teardown.
- Full suite: 232 files / 3391 passed, one failure —
  `dev-pane.test.ts › kills the child process tree` — which is NOT mine. Ticket 1
  confirmed it failing at the pre-ticket commit `13a83d4` in a scratch worktree;
  it exercises `packages/server/src/pty/*`, which this diff does not touch.
  Typecheck: 0 errors.
- Drive machinery: unchanged, and correctly so — no new service, required env
  var, seed or process. I did not run `drive-setup`/`drive-stop` (no services in
  this sandbox) and did not need to: nothing in `.runcastle/` is referenced by
  this change.

## Left undone

- Host-mode lanes (review/verification and research agents) register nothing, so
  a stop on one still resolves `confirmed: true` with the process alive — that is
  ticket 3's `onChildSpawn` wiring, on the registry API as it now stands
  (`registerHostPid(laneKey, pid, { runId })` — pass the owner, or Cancel run
  will not find the lane).
- `cancelTicket` (waive) still does not kill a live agent (decisions.md #5); no
  acceptance criterion here covers it and the route is untouched.
- Podman burns are unkillable for the same reason as before: the patch names
  only docker's container. One extra hunk in the patch and dropping the
  `sandbox !== 'docker'` guard would cover it.
- A boot-time sweep of stray `runcastle-*` containers is now possible from the
  deterministic names, and is explicitly out of scope for this lap.

#### 3. Host agents and waive: tree-kill review/research, waive kills live agents

# Ticket 3 — host agents and waive

## What was done

The three host-mode launch sites now report what a stop has to kill. The
review/verification agent hands the patched `noSandbox` provider an
`onChildSpawn` keyed by its ticket id, a research waypoint one keyed by its run
id (a waypoint has no ticket, and a run researches exactly one at a time), and
the ticket burner one keyed by its ticket — a `noSandbox` burn is a real
configuration, so its lane registers pids exactly as a docker lane registers a
container name. All three go through one new `registerHostChildren(laneKey,
owner)` in `kill-registry.ts` rather than three copies of the same closure, and
each releases its lane when the agent is over.

`selectSandbox`'s fourth parameter changed from ticket 2's bare `containerName`
to a `KillHandleOptions` object carrying both handles, because a caller cannot
know which provider `config.sandbox` will reach for and a fifth positional
argument would have been the wrong shape. `buildSandboxOptions` is untouched.

Waive kills first (decision 5). `ticket.cancel` runs the same kill-and-wait Stop
does, emits the `ticket.stop_timeout` timeline event when the kill could not be
confirmed, and only then flips the row; it returns `{ ticket, stopped, confirmed
}`. Waiving an idle ticket is the pure flip it always was. The layering stayed
as the ticket preferred — the route calls `stopTicketRun`, `services/tickets.ts`
is untouched. In the web app the Waive button reads "Waiving…" while its
mutation is in flight and toasts the shared `STOP_TIMEOUT` sentence on an
unconfirmed kill.

## Surprises

- **`cancelTicket` refuses a `burning` ticket** (`assertMutable`, pending/failed
  only), which decisions.md #5 does not mention. Killing and then erroring would
  have made a *rejected* waive leave a dead agent behind, so the route skips the
  kill for a `burning` ticket and refuses as before — Stop is the control for a
  lane that is openly running. The state the feature actually exists for (a
  ticket that READS terminal while its process carries on) is `failed`, which
  the kill path covers.
- **The abort-then-release race is closed by JS, not by luck.** `cancelRun` and
  `stopTicketRun` both call `abort()` and then look the lane up in the *same
  tick*, so a `finally` that releases the handle when `run()` rejects can never
  interleave. That is what makes the tight `finally` around research's `run()`
  safe; it is worth knowing before anyone makes the lookup async.
- The prompt's baseline ("118 files, 1768 passed") is stale — this repo runs
  **235 files / 3403 tests**. The suite is green except
  `dev-pane.test.ts › kills the child process tree so the port-holder is not
  orphaned`, which is **not mine**: it exercises `packages/server/src/pty/*`,
  which this diff does not touch, and tickets 1 and 2 each confirmed it failing
  at the pre-feature commit `13a83d4`. Typecheck: 0 errors.
- Drive machinery: unchanged, and correctly so — no new service, required env
  var, seed or process. I checked that nothing under `.runcastle/` references
  anything this diff touches; I did not run `drive-setup`/`drive-stop`, which
  this sandbox has no services for.

## Left undone

- **Research in docker mode is still unkillable.** `research.ts` goes through
  `selectSandbox`, so a `docker`-configured waypoint burns in a container that
  gets no `containerName` — only the host path was in this ticket's criteria.
  One `burnContainerName`-style name plus a `registerContainer` call would close
  it, in the same shape the burner already uses.
- **The MCP `cancel_ticket` tool** (`mcp/server.ts`) still calls the
  `cancelTicket` service directly, so an agent waiving through MCP does the old
  pure flip. The ticket scoped the change to the tRPC route.
- `TicketsBody`'s ledger "Cancel ticket" shares the same mutation and inherits
  the kill, but got no pending-state treatment — it acts on pending tickets,
  which never have an agent behind them.
- Podman burns remain unkillable (the patch names only docker's container), as
  ticket 2 recorded.

#### 5. Terminal state can be written as soon as abort fires, before kill confirmation

# ticket 5 — terminal state waits for the kill

## What was done

The stop chain aborted first and killed second, and the abort alone is enough to reject
sandcastle's `run()` — so the *failure continuation*, a different async path from the
mutation's, wrote the terminal row while the container was still being removed. The fix is a
gate the continuation waits behind, not a reordering of the stop.

`KillRegistry` now records a kill as in flight the moment one is ordered, and exposes
`whenKillSettled(laneKey)` / `whenRunKillsSettled(runId)` — resolve-immediately when no kill
is in flight (every ordinary finish), pending until the kill confirms death or runs out its
deadline otherwise. `killAndWait` was deliberately un-`async`ed so the in-flight entry is
recorded synchronously, in the same tick as the `abort()` that preceded it; otherwise the
abort's own continuation could reach the gate before there was anything there to wait for.
Two call sites put that gate in front of their write: `burnTickets`'s `runOne` (before the
ticket row moves to done/failed) and `runner.ts`'s `executeRun` (before the run row moves and
before its `run.error` breadcrumb is emitted). Three commits from earlier attempts carried
the registry change, the two gates, and their tests; this iteration added the self-review
pass and the red-check below.

The reviewer's repro step was re-run exactly, both ways. With the gates commented out,
`packages/server/test/stop-before-terminal.test.ts` fails as reported — the ticket row already
reads `['burning','failed']` and the run row already reads `cancelled` while `killAndWait` is
still pending. With the gates restored both cases pass: the rows hold at `burning` / `running`
until the held container is released. `bun run typecheck` is clean.

## Surprises

`env -u GIT_ASKPASS bun run test` is **not** at the baseline the prompt states (118 files /
1768 tests); this branch runs 236 files / 3410 tests. One test fails:
`packages/server/test/dev-pane.test.ts:183` ("the process group must be gone"). It is not
mine — the whole feature branch touches nothing in that test's import closure (`src/pty/*`,
`services/events`), and it fails identically on a targeted single-file run. It spawns a real
node-pty and asserts a real process group was reaped, so it reads as environment-dependent in
this sandbox. Everything else is green.

Also worth knowing for whoever reads next: ordering is only self-enforcing because the abort
and the registration happen in the same tick. `cancelRun` relies on `killAllForRun` building
its lane list and calling `killAndWait` synchronously before its first `await`. A future
refactor that makes any of that lazily async silently reopens this bug.

## Left undone

- No router-level (`caller.run.cancel` / `caller.ticket.stop`) version of the repro test was
  added — the routers add only the timeout-event branch on top of the functions already
  covered, so it would have been duplication. If the tRPC layer ever writes row state itself,
  that test becomes worth having.
- The dev-pane failure above was left alone; it is another feature's territory.
- No drive-machinery change was needed: this ticket adds no service, env var, seed, or
  process. Nothing under `.runcastle/` was touched, and nothing was run there (checked by
  reading, not executing, per the standing instruction).

#### 6. Waive skips kill-and-wait for an actively burning ticket

# Ticket 6 — waive skips kill-and-wait for an actively burning ticket

## What was done

The `ticket.cancel` mutation branched on `status === 'burning'` and returned
`{ stopped: false, confirmed: true }` without ever calling `stopTicketRun`, then
handed the flip a row `cancelTicket`'s mutable-state guard refuses outright — so
the one state the kill exists for was the one state it could not reach. The
mutation now always runs kill-and-wait, exactly as `stop` does, and the timeout
sentence on the timeline is unchanged.

Getting the flip past that guard needed a second change, in
`packages/server/src/services/tickets.ts`: `cancelTicket` takes an optional
`CancelTicketOptions { agentStopped }`, which waives the guard for a `burning`
row and nothing else. The reasoning is written next to it — after a confirmed
kill the row is only still `burning` because the burner's own failure path has
yet to catch up with the death, so it is stale rather than live. A `burning`
ticket with *no* agent behind it (`stopped: false`) is still refused: that orphan
belongs to Stop's sweep, and the MCP `cancel_ticket` tool, which passes no
options, is untouched.

I re-ran the reviewer's repro step verbatim as the new test in
`packages/server/test/waive-kill.test.ts` ("kills the agent of an openly burning
ticket, then waives it"): a container handle registered on an injected kill
registry plus a live abort controller, row status `burning`, `ticket.cancel`
invoked. Before the change it reproduced exactly as reported — no `killAndWait`,
mutation rejected with `cannot cancel ticket 1 — it is burning`. After, the
controller aborts, `docker rm -f runcastle-run1-t1` runs, and the ticket lands
`cancelled`. Ticket 3's old test asserting the refusal encoded the defect, so it
was replaced by that one plus a narrower case pinning the no-agent refusal.

## Surprises

`bun run test` is one failure off green, and it is not mine:
`packages/server/test/dev-pane.test.ts:183` (`expect(pidAlive(-pgid)).toBe(false)`
— a POSIX process-group reap from the already-shipped dev-pane teardown feature)
fails on a targeted single-file run too, on files my diff does not touch. The
prompt's baseline is also stale in scale — it promises 118 files / 1768 tests,
the branch now runs 235 files / 3404. Everything else is green; `bun run
typecheck` is 0 errors.

Also worth knowing: after a waive-on-burning the burner's lane is still
unwinding, and its `failTicket` (`ticket-burner.ts` ~2587) writes
`status: 'failed'` unconditionally a second or two later — so the `cancelled` row
can be clobbered back to `failed`. That is the sibling review finding about
terminal state being persisted off the abort rather than off confirmed death, so
I left it in that ticket's territory rather than adding a guard here.

## Left undone

- No UI change. Both surfaces gate their Waive/Cancel affordance on
  pending/failed (`Lane.tsx`'s `retryable`, `TicketRow.tsx`'s
  `EDITABLE_STATUSES`), so the one-click kill-then-waive path is now honest on
  the wire but not offered on a burning row. The acceptance criterion is the
  mutation's, so surfacing the button is a separate call.
- Drive machinery: nothing to update — this ticket adds no service, no required
  env var, no seed and no extra process, so `.runcastle/drive-setup.ts` and
  `drive-stop.ts` are already covered by being idempotent. I did not run them
  (no services in this sandbox) and did not need to edit them.

#### 7. Docker-configured research agents are not registered and survive Cancel run

# ticket(7) — Docker-configured research agents are now registered and die on Cancel run

## What was done

The research lane in `packages/server/src/workflows/research.ts` selected the configured
sandbox (so a docker project researches inside a container) but only ever handed the
provider `onChildSpawn`, which a container provider never calls. Nothing was registered,
so `cancelRun` found no handle for the run, reported `confirmed: true`, and left the
container burning.

Two exported helpers now sit next to `researchTemplatePath`: `researchContainerName(runId,
seq)` → `runcastle-<runId>-w<seq>` (a waypoint's counterpart to the burner's `t<seq>`
lanes), and `registerResearchKill(config, runId, seq)`, which registers that container name
against the run lane when `config.sandbox === 'docker'` and returns both handles for
`selectSandbox`. The call replaces the inline object at the sandbox option, so registration
happens before `run()`; the existing `finally` already releases the lane. Podman is
deliberately left alone — sandcastle still names those containers itself, exactly as in the
burner's `makeKillable`.

No deviation from the ticket's approach. I did not extract the burner's near-identical
`makeKillable`/`killHandles` pair into a shared helper: the burner registers at a different
moment in its loop (after `excludeAttachments`, with a name computed per attempt), so a
combined helper would force a restructure of the burner for three shared lines.

## Repro step, re-run

I re-ran the reviewer's repro mechanically rather than with a real container: a throwaway
script registered the research lane exactly as `realExecuteResearchRun` does with
`sandbox: 'docker'`, then called `cancelRun(runId)` with a fake `docker` first on PATH that
logged its arguments (`rm` exit 0, `inspect` exit 1 = container gone). Result: the registry
held the lane `run_repro7`, and the cancel issued `docker rm -f runcastle-run_repro7-w3`
followed by `docker inspect runcastle-run_repro7-w3`, returning `{confirmed: true}` and
releasing the lane. Before this change the registry would have been empty at that point and
no docker command would have run. The script was deleted, not committed.

## Surprises

- `bun run test` has one failure on this branch that is **not** in the prompt's baseline:
  `packages/server/test/dev-pane.test.ts > "kills the child process tree so the port-holder
  is not orphaned"` (`expect(pidAlive(-pgid)).toBe(false)`). I confirmed it fails identically
  at `HEAD~1` in a scratch `git worktree`, i.e. before my change — a POSIX process-group
  reap that this container does not permit. Everything else: 233 files, 3402 tests passing.
  The prompt's baseline counts (118 files / 1768 tests) are stale for this merged branch.
- Ownership of a lane (`{runId}`) is not observable through the registry's public surface —
  only `keys()` is — so the new tests assert the lane key, and the run-ownership half is what
  the repro script above exercised through `cancelRun`.

## Left undone

- The burner and research now express the same "docker registers a name, host registers
  pids" policy in two places. Worth one small helper in `kill-registry.ts` if a fourth
  launch site appears, but it needs the burner's registration point untangled first.
- `packages/server/src/workflows/review-ticket.ts` calls `noSandbox()` directly rather than
  `selectSandbox` — correct today (review is always host-mode), but it is the one launch
  site that would silently ignore a future container-mode review.
- Drive machinery needed no edit: this change adds no service, env var, seed, or process.

#### 8. Verify the fixes that landed

Gates verification pass

Verified pass #4 against `feature/stopping-a-headless-agent-actually-stops-it` without checking out the integration branch.

## Fixes that held

- **#6 — Waive skips kill-and-wait for an actively burning ticket:** held. In `packages/server/src/trpc/routers/ticket.ts`, `ticket.cancel` now calls and awaits `stopTicketRun` for every ticket state before performing the database cancellation. In `packages/server/src/services/tickets.ts`, the narrow `agentStopped` option permits the subsequent transition from a stale `burning` row only when the router observed an active lane. The regression test registers a live abort controller and container handle, invokes the mutation on a burning ticket, and checks abort, `docker rm -f`, confirmed death, and the final cancelled state. The former skip-and-reject path is gone.
- **#7 — Docker-configured research agents are not registered and survive Cancel run:** held. In `packages/server/src/workflows/research.ts`, `registerResearchKill` assigns Docker research the deterministic name `runcastle-<runId>-w<seq>`, registers that container under the owning run before `run()` starts, and passes the same name to `selectSandbox`. The existing `finally` releases the lane after the agent settles. The added tests pin the naming and registration behavior, so `cancelRun` can discover the run-owned lane and remove its container.

## Findings

No verification findings were found. Neither listed repro remains present in the landed diff.

## Gates

No verify commands are configured, so there were no gates to run.

<promise>COMPLETE</promise>

#### 9. Verify the fixes that landed

Gates verification pass

Verified pass #8 against the landed ticket #5 fix: **held**.

- `KillRegistry.killAndWait` records the in-flight kill synchronously before returning its promise, closing the abort/continuation race described by the finding.
- The ticket burner waits on `whenKillSettled(ticketId)` before writing `done` or `failed`, so the ticket row remains `burning` while the held kill is pending.
- The run executor waits on `whenRunKillsSettled(runId)` before emitting its failure breadcrumb or writing the terminal run row, so a cancelled run remains `running` while any ordered lane kill is pending.
- The focused regression test covers both supplied repro variants by holding container death after abort and asserting the ticket/run rows remain non-terminal until release.
- The gate also releases after the bounded kill deadline, preserving the specified timeout behavior; the existing mutation result remains responsible for surfacing an unconfirmed stop.

No configured verify commands exist for this project, so no gates were run; the full Gates pass was spent on the landed diff as instructed.

No verification findings were found, and nothing plainly broken was observed in the reviewed surfaces.

<promise>COMPLETE</promise>
