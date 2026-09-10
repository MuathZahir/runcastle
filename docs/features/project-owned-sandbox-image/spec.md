# Project-owned sandbox image

## Problem

A project whose toolchain isn't JavaScript (Java, Python, Go, …) cannot burn tickets in runcastle's stock sandbox image, and every recovery path today makes it worse. "Rebuild image" builds the stock Dockerfile under whatever tag `sandboxImage` names — silently destroying a custom image. The doctor's staleness check compares Dockerfile mtime against the image's `Created` time, which BuildKit layer caching makes wrong in both directions. And when a burn hits a missing toolchain binary, exit 127 matches the generic retryable pattern and the burner *retries* a failure that can never succeed. The user who hits this must hand-roll a build script, hand-edit config, and decode raw exit codes.

## Approach

From the user's perspective: put a Dockerfile at `.runcastle/sandbox/Dockerfile` (`FROM sandcastle:runcastle`, adding your toolchain) — or let the prepare session write it for you when it probes the repo and finds pom.xml, build.gradle, pyproject, go.mod, etc. The AFK card notices it, its Build button builds it, and burns run in it. If the image drifts from its Dockerfile, the doctor says so and one Rebuild heals it. If a burn would fail on a missing tool, it fails immediately with "`mvn` is not installed in image X — add it to `.runcastle/sandbox/Dockerfile` and rebuild", never a raw exit code and never a retry.

The shape (all locked in decisions.md):

**Detection is the contract; prep-authoring is one client.** The mechanism is authorship-agnostic: the doctor's image probe detects `.runcastle/sandbox/Dockerfile` regardless of who wrote it. The prepare skill additionally learns to author the file (toolchain probing → `FROM` stock + install steps) — prompt content on its existing rails; the prep write-guard already permits `.runcastle/`. Prep never builds; its ending guidance points the human at the Build button.

**Per-project image setting.** `sandboxImage` gains a project column on the existing prepared-setting descriptor pattern (project column + global config twin + env var). Resolution order: project column → env var → global config → stock default, through the single existing resolver all five consumers share (build, doctor, precheck, burn, slot stamp). The column is written by runcastle on successful build of the project image — never at detect time, so consumers never resolve to a tag that doesn't exist. A human-typed value keeps `userSupplied` provenance and is never overwritten or cleared by the machinery. When the Dockerfile is deleted after a build, the doctor clears the machine-written column and resolution falls back; the orphaned local tag is the user's to prune.

**Runcastle owns the build.** The `sandcastle build-image` shell-out is retired. The build-image terminal flow invokes `<runtime> build` directly, passing `--label runcastle.dockerfile-hash=<sha256 of the Dockerfile>` plus the existing `AGENT_UID`/`AGENT_GID` build-args, still as a human-watched terminal. Stock image: the refreshed app-global scaffold context, tag `sandcastle:runcastle`. Project image: context `.runcastle/sandbox/` in the repo, tag `sandcastle:runcastle-<projectId>`. Because the project image is `FROM` the stock one, the build is a chain: stock first if missing/stale, then the project image.

**Staleness is a content hash.** The doctor's image probe replaces mtime-vs-Created with label-hash vs current-file-hash — for stock and project Dockerfiles alike. A project image is stale if *either* its own hash mismatches *or* the stock base's label mismatches the current stock Dockerfile (a runcastle upgrade must not leave derived images silently outdated); the probe names which layer is stale. New probe states: "project image not built yet" (Dockerfile present, no built image) and the custom-tag state below.

**The button builds the resolved chain and cannot clobber.** Build/Rebuild builds whatever the project resolves to — stock only, or the two-step chain. When `sandboxImage` is a hand-typed (`userSupplied`) tag with no runcastle-managed Dockerfile behind it, the button disarms: the row states the image is custom and managed outside runcastle, with fix text about clearing the setting or adopting `.runcastle/sandbox/Dockerfile`. A stored value that is blank or whitespace is unset everywhere: the shared `unmanagedImage` guard trims before any custom-tag reasoning, so the doctor and build planner agree with burn resolution (which already trims) instead of disarming on an invisible string (lap 2, decision 9).

**Burns preflight the toolchain; 127 goes fatal.** Burns never auto-build. The existing per-run image probe widens into a toolchain preflight: distinct command names extracted from the setup command and every verify command (verify commands are prompt text today — this is their first exec-adjacent check), verified in one container run via `command -v`, memoized on (image, commands), alongside the agent-binary check. Any missing binary aborts the run fatally with the named-command message. Extraction is a deliberate heuristic — split on `&&`/`;`/`|`, first word per segment, skip `VAR=` prefixes and shell builtins — not a shell parser; a false miss defers to the classifier. The burn-error classifier's exit-127 handling extends to setup-hook failures: fatal with the named-command message when the command is extractable, and in no case matching the generic retryable pattern.

**Known cost:** the burn-cache slot stamp includes the sandbox image id, so a project switching to its custom image (or any rebuild) invalidates slot caches — one cold burn, expected and acceptable.

## Seams

- **`resolveSandboxImage` (existing, widened):** the one resolver all image consumers call; observe that project column → env → global → default ordering holds and that all five consumers agree.
- **Doctor image probe (existing, rewritten):** observe status transitions — ok / stale (which layer) / missing / not-built-yet / custom-tag-disarmed — from combinations of Dockerfile presence, hash labels, and provenance. Hash and mtime injection already flow through the doctor's env seam.
- **Build-image terminal command (existing, re-pointed):** the (cmd, args, cwd) the setup service hands the terminal; observe the direct `build` invocation, label, build-args, tag, and chain ordering, without running docker.
- **Prepared-settings descriptor rails (existing):** the `sandboxImage` project column rides the same descriptor/provenance machinery as `setupCommand`; observe write-on-build, never-overwrite-userSupplied, and clear-on-Dockerfile-deletion.
- **Toolchain preflight (new, inside the existing per-run probe seam):** given a config's setup/verify commands and an image, observe the probe command built, the memoization key, and the fatal abort message. Command-name extraction is a pure function — its own unit seam.
- **Burn-error classifier (existing):** given setup-hook failure text carrying exit 127, observe fatal classification with the named-command message and non-matching of retryable patterns.
- **Prepare skill content (existing):** the authored Dockerfile contract — `FROM` stock, toolchain mapping, ending guidance — is prompt content, exercised by prep-session review rather than unit tests.
- **`unmanagedImage` guard (existing, normalized — lap 2):** given a stored value/provenance pair, observe that blank/whitespace stored values answer "not user-managed" (null), identically for the doctor's probe and `planImageBuild`.
- **Module split (lap 2):** `sandbox-image.ts` exports only pure mechanics (`hashDockerfile`, `inspectBuiltImage`, `planImageBuild`, `imageBuildTerminal`); `adoptProjectImage`/`releaseProjectImage` live with the stateful services, and the doctor imports only the mechanics module.

## Out of scope

- **Burn orchestration** — when/where the setup command runs relative to ticket fan-out belongs to the sibling feature (setup-once-on-base-branch). This feature owns *what is in the container*, not *when setup runs*.
- **Cache mounts** — ~/.m2 and friends ride the burn cache volume under ADR-0004 / the cache-volume decisions; package caches must not be baked into image layers.
- **Setup-failure diagnostics** (stdout tail) — separate quick change.
- **The stock Dockerfile's contents** beyond what labeling/tagging needs.
- **The mixed-runtime preflight gap** (probe only checks the run-default runtime) — pre-existing, not widened here.
- Retiring the permanent sandcastle patch (ADR-0011) — untouched; this feature merely stops using the build-image CLI.

## Open questions

None — all decisions locked; edge behaviors (Dockerfile deletion, custom-tag disarm, base-layer staleness) resolved in decisions.md.
