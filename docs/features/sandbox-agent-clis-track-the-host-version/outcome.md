# Outcome — Sandbox agent CLIs track the host version

Sandbox images record their baked Claude Code and Codex CLI versions; the doctor flags drift from the host as stale, Rebuild refreshes just the install layer, and burns fail fast on a version mismatch or a "CLI too old for this model" 400 instead of dying mid-run.

- Shipped: 2026-09-24
- Laps run: 1

## What shipped

14 commits · 18 files

### Lap 1
- 5 tickets landed: #1 Pin agent CLIs to host versions: build-args, version labels, freshness verdict; #2 Doctor flags agent-CLI drift on stock, project and custom images; #3 Burn preflight fails fast on dead Docker, CLI drift and 'CLI too old for this model'; #5 Burn preflight blocks burns on custom (unmanaged) images with a Rebuild fix whose button is disarmed; #6 Doctor image row never says "not on host — not checked" for a runtime missing on the host
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: 73a76ad3c6b5ca08603f385d3a8e38ee34a24950
- Landed since: 2
- Outcome: done

### Lap 1 · verification

- Reviewed commit: 21d1e47e62290f497deca5201201ea5c1127d81f
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Pin agent CLIs to host versions: build-args, version labels, freshness verdict

# Ticket 1 — Pin agent CLIs to host versions

## What was done
- **Dockerfile and Containerfile** (still byte-identical twins): `ARG CODEX_VERSION` now sits directly above `RUN npm install -g @openai/codex@${CODEX_VERSION:-latest}`, and `ARG CLAUDE_CODE_VERSION` directly above `RUN curl … install.sh | bash -s ${CLAUDE_CODE_VERSION}`. If either install fails, the build prints `runcastle: <CLI> <version> install failed — is that version published?` and exits 1. I read the live `install.sh`: it takes an optional `$1` (`stable|latest|X.Y.Z`), and when that is empty it installs the default. A new test in `sandcastle-scaffold.test.ts` pins these lines and checks that the two files stay twins.
- **New `services/agent-cli-versions.ts`**: `parseAgentCliVersion`, and `resolveHostAgentVersions(exec, present?)`. It decides whether a CLI is on the host with the same `resolveTool(bin) !== bin` check that `checkReady` uses. An absent CLI gives null with no problem. A spawn failure, a non-zero exit or unparseable output gives null plus a problem string with the doctor's PATH-fix wording. It uses `RUNTIME_SPECS` from `doctor.ts` for the binary names and labels.
- **`sandbox-image.ts`**:
  - Added `CLAUDE_CODE_VERSION_LABEL` and `CODEX_VERSION_LABEL`.
  - `BuiltImage.versions` is read in the same `image inspect` call, with the format `hash|claude|codex`.
  - Added the pure `imageFreshness` → `{fresh:true} | {fresh:false, reasons}`, and `describeFreshnessReason(tag, reason)`, which returns text like `img: Claude Code 2.1.270 in image, 2.1.280 on host` or `img: no Codex version recorded, 0.46.0 on host`.
  - `ImageBuildStep` has a new `labels` field. The stock step gets version build-args and labels, empty when the host has no version. The project step gets neither.
  - `PlanImageBuildInput` now requires `hostVersions`.
- **`setup.ts` `buildImageTerminal`**: it resolves the host versions, computes `stockFresh` through `imageFreshness`, and passes the versions to the plan. `startTerminal` now returns `{ sessionId, notices }`. `EnableAfkCard`'s ImageRow shows each notice as a toast.

## Surprises
- `doctor.test.ts` keys its fake exec on the exact inspect argv, so I updated its `inspectKey` helper to the three-label format. That was a test-helper change only; I did not touch the doctor's logic. Doctor stubs that return a bare hash still parse, and the versions come back null.
- There was a small semantic shift in the Rebuild route. Before, an unreadable stock Dockerfile hash counted as not fresh. Now it is no evidence of drift, which matches what the doctor already does. In practice the context is scaffolded just before, so the hash can always be read.
- The full suite had one failure: `dev-pane.test.ts › kills the child process tree…`. It fails the same way when run alone, and this diff does not touch it, so it looks like the sandbox's process-kill behaviour. Everything else passes, and `bun run typecheck` is clean.
- `sandbox-image.ts` now imports `RUNTIME_SPECS` from `doctor.ts`, which imports `sandbox-image.ts` back. The cycle is harmless because both sides only use each other inside function bodies.

## Left undone (sibling tickets)
- Doctor image rows still compare the hash only. `imageFreshness` and `describeFreshnessReason` are ready for them, and so is the custom-image probe.
- The burn preflight and the classifier for the "CLI too old" 400.
- There is no test at the route level for `buildImageTerminal`, because it builds its own `createSystemExec`. Its composition is covered in `sandbox-image.test.ts` ("rebuilds a CLI-drifted stock image before the project image").
- The drive machinery needed no change: no new service, env var, seed or process.

#### 2. Doctor flags agent-CLI drift on stock, project and custom images

# Ticket 2 — Doctor flags agent-CLI drift

## What was done
- `runDoctor` resolves the host versions once with `resolveHostAgentVersions(exec, () => true)` and passes them into the image probe through a new required field, `ImageProbeInput.hostVersions`. The presence check is `() => true` because the doctor's injected exec already decides whether a binary is there, as it does for every other probe. The production exec resolves binaries the same way, and this keeps the tests independent of whatever is installed on the machine.
- **Stock row:** `imageFreshness` replaced the hash-only `stockFresh`. A stale row lists every reason, joined with `; `. A hash mismatch keeps its old wording ("no longer matches the burner Dockerfile"). CLI drift uses `describeFreshnessReason`, for example `sandcastle:runcastle: Claude Code 0.9.0 in image, 1.0.0 on host — rebuild`. An image with no version labels reads as stale ("no Claude Code version recorded").
- **Project row:** `imageFreshness` also runs on the project image's own inspected labels. Its hash and CLI reasons are reported first. If the project image is current but the base is not, the existing "is built on sandcastle:runcastle, which …" wording covers a missing base or a hash mismatch. A base whose only problem is CLI drift reads `<tag> is built on a stale sandcastle:runcastle — <drift>`.
- **Custom row:** for a present, non-legacy custom image, one `docker run --rm --entrypoint sh <img> -c 'claude --version 2>/dev/null; echo ---; codex --version 2>/dev/null'` probe runs. When a version differs from the host's, a clause is appended: `its Claude Code X differs from the host's Y — rebuild it with the tool that built it`. Status stays `custom` and the severity rule is unchanged. Drift is only reported when both sides have a version. A failed probe adds nothing.
- The ok detail does not mention "not on host — not checked". Adding it would have changed existing exact-match assertions.

## Surprises
- The existing doctor fixtures had no version labels, so with the host at `claude 1.0.0` they read as stale. I added a `labelled(hash, claude, codex)` fixture helper and did not change any assertion.
- The sync hook's `--force-with-lease` push was rejected ("stale info") because the clone had no remote-tracking ref for the branch. Running `git fetch origin <branch>:refs/remotes/origin/<branch>` and pushing again fixed it.
- In the full suite the only failure is `dev-pane.test.ts › kills the child process tree…`. Ticket 1 saw the same failure when it ran that file alone, and this diff does not touch it.

## Left undone
- The legacy-global custom branch is not probed; it keeps its wording.
- A custom image that lacks a CLI the host has gets no warning. That case belongs to the burn preflight in a sibling ticket.
- No web change was needed. Status `custom` already disarms Rebuild.
- The drive machinery needs no change: this ticket adds no service, env var, seed or process.

#### 3. Burn preflight fails fast on dead Docker, CLI drift and 'CLI too old for this model'

# Ticket 3 — Burn preflight: dead Docker, CLI drift, "CLI too old for this model"

## What was done
- **Classifier.** Added a `CLI_TOO_OLD` pattern to `RUNTIME_RUN_FATAL_ERROR_PATTERNS['claude-code']`, so the incident's `API Error: 400 Claude Code X does not support this model; version Y or newer is required.` now classifies as `run-fatal` instead of `retryable`. A new exported function, `cliTooOldMessage(err, model?)`, rewrites it into `Claude Code 2.1.270 is too old for model <id> (needs 2.1.280 or newer). Run \`claude update\` on the host, then Rebuild from Settings → Burns.` `burnTicket`'s run-fatal return uses that text as `error`, and that error becomes the run's halt headline. No Codex pattern was added.
- **Runtime health first.** `containerRuntimeProbe(exec, only?)` in `doctor.ts` takes a new optional `only: 'docker' | 'podman'` that restricts it to one runtime. The doctor still calls it without the argument, so the doctor's output is unchanged. The burn preflight calls it with `deps.config.sandbox`. If the result is not ok, it emits the new `CONTAINER_RUNTIME_DOWN_EVENT = 'burn.container_runtime_down'` with `${detail} — ${fix}` and returns failed before any ticket runs.
- **Version check in the same single probe.** `buildToolchainProbeArgs` takes a new optional `versionsOf` list. For each runtime in it, the script appends `echo "@@runcastle-cli-version <runtime>"; <bin> --version 2>/dev/null || true`. `parseMissingCommands` now reads only the part before the first marker, and a new `parseProbedVersions` parses each section with `parseAgentCliVersion`. The runtimes checked are `deps.runtime` plus `deps.ticketRuntime` over burnable non-review tickets, dropping any runtime whose host version is null. On a mismatch the preflight emits `IMAGE_RUNTIME_MISSING_EVENT` with the message from `agentCliDriftMessage` and aborts. `BurnDeps.hostAgentVersions` is new and optional. `resolveBurnDeps` became async and fills it through `resolveHostAgentVersions` for container burns only.
- **"Could not start a shell".** When the runtime is healthy, a probe that exits non-zero now reports `could not start image <image>: <first stderr line>` instead of saying the agent binary is missing.

## Surprises
- The mirror push at the first commit was rejected with "stale info" because the local tracking ref was stale. Running `git fetch` on that ref and pushing again fixed it.
- In the full suite, `dev-pane.test.ts` (killing a process tree, which ticket 1 also saw) and `pty-teardown.test.ts` (a 5s deadline) failed. Run alone, `pty-teardown` passes, so it is a timing flake under load. Neither test is touched by this diff. Typecheck is clean.
- Existing preflight tests had to change. Their fake exec answered every argv the same way, so the new runtime-health calls became visible in the recorded probes. The "image lacks the runtime binary" test used to fake that case with a 127 exit, and now fakes it with a `claude` line on stdout.

## Left undone
- In a mixed run, only the run runtime's binary is in the `command -v` sweep. When the other runtime's CLI is missing from the image, the preflight reports "an unknown Codex version" drift, not a "not installed" message.
- `RUNTIME_BINARY`, `AGENT_BINARY` and `RUNTIME_SPECS[..].bin` duplicate each other. That duplication predates this ticket and I left it alone.
- The UI does not render `burn.container_runtime_down` specially. No web code keys on `burn.image_runtime_missing` either, so it shows the same way the generic event does.
- Drive machinery: no new service, env var, seed or process, so I made no edit and did not run anything.

#### 6. Doctor image row never says "not on host — not checked" for a runtime missing on the host

# ticket(6) — doctor says which runtime it did not check

## What was done

The doctor's managed sandcastle-image rows now end with a parenthetical naming every
agent runtime whose in-image CLI version the freshness verdict skipped, e.g.
`sandcastle:runcastle present (Codex not on host — not checked)`. A new private helper
in `doctor.ts`, `uncheckedRuntimes(hostVersions)`, returns that clause (or `''` when the
host has every CLI, so a fully checked row keeps its old wording); it is appended to the
stock `ok` row, the project `ok` row, and — via a second optional argument to
`staleImage`, placed *after* `— rebuild` so the call to action comes first — to every
managed stale row. `missing` / `not-built-yet` rows are untouched: there is no image to
have judged. Custom (hand-typed) rows are also untouched: they carry their own
probe-based drift wording and the unmanaged-image fix, and the ticket named the ok/stale
managed rows.

I re-ran the reviewer's repro step exactly: `runDoctor` with a canned exec where
`codex --version` fails to spawn (it is absent from `ALL_HEALTHY`) and a labelled, fresh
stock image. It no longer reproduces — the detail is now
`sandcastle:runcastle present (Codex not on host — not checked)`, asserted as a literal
in the new test `says which runtime was not checked because the host does not have it`,
which also pins the other direction (both CLIs on the host ⇒ plain
`sandcastle:runcastle present`).

## Surprises

The suffix lands on nine existing exact-match detail assertions across `doctor.test.ts`,
because the canned host in that file deliberately has no Codex — exactly the churn
ticket 2's digest said it was avoiding. They are updated through one test constant,
`CODEX_UNCHECKED`, rather than nine re-typed strings. I dropped a second new test I had
written for the stale row: the existing CLI-drift stale tests already observe the clause,
and a duplicate scenario is a review smell. Nothing in `apps/web` parses this detail — it
is rendered as free text — so no UI change was needed, and the web fixtures that happen
to contain `sandcastle:runcastle present` are their own hand-written rows.

`bun run typecheck` is clean. `env -u GIT_ASKPASS bun run test`: 1 failed, 3828 passed —
the failure is `packages/server/test/dev-pane.test.ts` "kills the child process tree so
the port-holder is not orphaned", which fails identically when run alone and is a
process-group reaping fault of this container, not of this diff (ticket 4's review
reported the same pre-existing dev-pane failure). My change touches only doctor detail
strings.

No drive-machinery edit was needed: this adds no service, required env var, seed, or
long-running process, so none of the standing triggers fire. I did not run
`drive-setup`/`drive-stop` (no services in this sandbox) and did not need to check any
new path, since `.runcastle/` is untouched.

## Left undone

- The custom-image row still says nothing about an unchecked runtime, though its probe
  skips a runtime the host lacks for the same reason (`customImageDrift`). Adding it
  there would be consistent; it was out of this ticket's stated location.
- A host CLI that is installed but whose `--version` cannot be read is also `null` here,
  so such a runtime reads as "not on host". `resolveHostAgentVersions` already returns a
  named `problems` entry for exactly that case, and `runDoctor` discards it; threading it
  into the image row would let the wording distinguish "absent" from "unreadable". The
  per-runtime binary probes still report the unreadable CLI on their own rows.

#### 7. Verify the fixes that landed

Gates verification pass

Verified both fixes that landed after pass #4 against their reported findings and repro cases.

- Ticket #5 holds: burn preflight now uses the same managed-image predicate as `imageBuildTarget`. CLI drift on `sandcastle:runcastle-bl` emits `burn.image_cli_drift`, tells the user to rebuild it with the external tool that owns it, and continues the burn; the same custom image remains refused by the in-app Rebuild action. Managed-image drift still fails fast with `burn.image_runtime_missing` and the Settings → Burns remedy.
- Ticket #6 holds: managed stock and project image rows append `(Codex not on host — not checked)` when Codex has no host version, including the fresh stock-image repro. When both host CLIs resolve, the ordinary `sandcastle:runcastle present` detail remains unchanged.
- The fixes include focused regression assertions for the exact custom-image burn scenario, the disarmed Rebuild verdict, the missing-host-runtime doctor detail, and the fully checked control case.
- No configured verification gates exist for this project, so no gate commands were run.
- Nothing plainly broken was found in the reviewed fix diffs. No verification findings were reported.

REVIEW-MODE: gates
REVIEW-VERDICT: verified
REVIEW-REASON: Both landed fixes close their reported repros; this project has no configured verification gates.
