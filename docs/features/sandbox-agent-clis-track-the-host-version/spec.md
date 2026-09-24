# Sandbox agent CLIs track the host version

## Problem

Burns run the Claude Code and Codex CLIs baked into the sandbox image, and those CLIs never refresh. The stock Dockerfile (and its Containerfile twin) installs both unpinned (`npm install -g @openai/codex`, `curl … install.sh | bash`), so BuildKit reuses the cached layer forever and Rebuild finishes instantly with the old CLI. Project images built `FROM` the stock image inherit whatever it had.

For the human, this shows up in three ways:
- A host `claude update`, or a new model that needs a newer CLI, breaks burns with `API Error: 400 Claude Code 2.1.270 does not support this model; version 2.1.280 or newer is required`. Updating the host does nothing, and only a hand-run `docker build --no-cache` fixes it.
- That 400 matches the classifier's retryable `api error` pattern, so every ticket retries it with backoff before failing.
- The doctor cannot see any of this. Its staleness check is the Dockerfile hash label, and CLI drift never changes the hash.

A related problem sits in the same preflight: when Docker or Podman is not running, the burn's image probe cannot start a shell, and the burner reports that as "claude is not installed in image … Rebuild". The human is sent to a Rebuild that also fails, or is left guessing.

## Approach

**From the human's side:** the sandbox runs whatever CLI the host runs. After a host `claude update`, the doctor's image row says "stale: Claude Code 2.1.270 in image, 2.1.280 on host", and Rebuild refreshes only the CLI install layer in seconds. A burn started against a drifted image aborts before any ticket container starts, with a message naming both versions and pointing at Rebuild. A burn started while Docker is down aborts with the doctor's own "Start Docker Desktop" text. A model that needs a newer CLI than even the host has halts the run once, telling the human to `claude update` and then Rebuild, instead of retrying in every ticket.

**Shape:**

1. **Pinned installs (decision 2).** The stock Dockerfile and Containerfile declare `ARG CODEX_VERSION` and `ARG CLAUDE_CODE_VERSION`, each directly above its install `RUN`, so a changed value changes the cache key for that layer and those after it, and nothing before it. The decision-rich shape from the ideation discussion:

   ```dockerfile
   ARG CODEX_VERSION
   RUN npm install -g @openai/codex@${CODEX_VERSION:-latest}
   ...
   ARG CLAUDE_CODE_VERSION
   RUN curl -fsSL https://claude.ai/install.sh | bash -s ${CLAUDE_CODE_VERSION}
   ```

   (With an empty `CLAUDE_CODE_VERSION`, `install.sh` installs latest. The implementer must verify that invocation.)

2. **Host version resolution.** A single server-side function returns the host's version per agent runtime: `{ 'claude-code': string | null, codex: string | null }`. It is parsed as a bare semver out of `claude --version` / `codex --version`, using the same binary resolution the runtimes already use (`resolveBinary`). `null` means "not on host, or not parseable". The doctor, the build route and the burn preflight all call this one function.

3. **Version labels (decision 3).** Next to `runcastle.dockerfile-hash`, the sandbox-image module owns two more label keys: `runcastle.claude-code-version` and `runcastle.codex-version`. The stock build step passes the resolved host versions as both build-args and labels. An unresolved runtime gets an empty build-arg and an empty label (decision 4). The project-image build step passes neither: it inherits the stock image's labels through `FROM`. `inspectBuiltImage` grows to return the two versions next to the hash, from the same single `image inspect` call.

4. **One freshness verdict (decision 9).** Today freshness is computed twice, once in the doctor and once in the setup router that feeds `planImageBuild`, and both compare the hash only. They are replaced with one pure function over (inspected image, expected hash, host versions). It returns fresh, or stale with the reasons: hash mismatch, missing, and per-runtime version drift with both versions. Rules:
   - A runtime whose host version is `null` is never drift ("not on host — not checked").
   - A managed image with no version label for a runtime the host has reads as stale.
   - Otherwise it is strict string equality.

   The doctor's stock and project image rows render these reasons in the existing stale state, and `planImageBuild`'s `stockFresh` comes from the same verdict. So Rebuild rebuilds the stock image, and the chain rebuilds the project image, exactly when the doctor says so.

5. **Custom images (decision 3).** For an unmanaged (hand-typed) image, the doctor runs one probe (`<runtime> run --rm --entrypoint sh <image> -c 'claude --version; codex --version'`), compares the result to the host, and shows drift as a warning. The Rebuild button stays disarmed, as it is today, with the existing unmanaged-image reason.

6. **Burn preflight (decisions 5 and 6).** The run-level preflight in the burner, which today is one `sh` probe for the agent binary, setup commands and verify commands, gains two things, in this order:
   - **Container runtime health first.** It reuses the doctor's container-runtime classification (not installed / daemon not responding / podman machine stopped). If the runtime is unhealthy, it emits a new `burn.container_runtime_down` event carrying the doctor's detail and fix text, and aborts the run before any ticket.
   - **Version check inside the same image probe.** The probe also prints the version of every agent runtime the run's tickets will use (the run runtime plus any per-ticket runtimes). Each one is compared strictly with the host version, skipping runtimes whose host version is `null`. On a mismatch it emits the existing image event with a message naming the image, the runtime and both versions, plus "Rebuild from Settings → Burns — only the CLI layer rebuilds". It aborts the run. Burns never build.

   The probe's "could not start a shell" fallback no longer claims the binary is missing. With the runtime proven healthy, it reports that the image could not be started, with the probe's stderr.

   None of this applies to `noSandbox` burns, which already skip the image probe.

7. **Classifying "CLI too old for this model" (decision 7).** A Claude Code pattern matching `does not support this model … version … or newer is required` is added as **run-fatal**. Run-fatal patterns are checked before the retryable ones, so the `api error` pattern can no longer catch it. The halt message carries the in-use version, the required version and the model, and the fix: "run `claude update` on the host, then Rebuild from Settings → Burns". No Codex pattern is added.

8. **Build setup failures (decision 8).**
   - If host version resolution fails to spawn or parse for a runtime, the image card shows a named message with the doctor's PATH fix text, and the build proceeds unpinned for that runtime.
   - When a pinned install step fails inside the build terminal, the card's failure state names the step and the version (for example "Codex 0.x.y install failed — is that version published?") rather than only the exit code.

Every mutating path keeps emitting events as it does today. The new preflight abort emits `burn.container_runtime_down`.

## Seams

- **Host version resolver** (new, pure except for exec): given a fake exec, observe the parsed versions and `null` for missing or unparseable output.
- **`inspectBuiltImage`** (existing, extended): observe hash plus the two version labels from one inspect; an absent label reads as `null`.
- **Image freshness verdict** (new, pure): the one function both the doctor and the build plan use. Given inspected labels, expected hash and host versions, observe fresh or stale and the reasons. Unit-tested exhaustively (host null, label missing, drift per runtime, hash drift).
- **`planImageBuild` / `imageBuildTerminal`** (existing): observe that the stock step carries the version build-args and labels, that the project step carries neither, and that `stockFresh` from the verdict drops or keeps the stock step.
- **Doctor image rows** (existing, `runDoctor` via fake exec): observe stale rows naming runtime and versions, "not checked" for a runtime missing on the host, and the custom-image warning with the button disarmed.
- **`burnRun` preflight** (existing, fake `deps.exec`): observe `burn.container_runtime_down` on an unhealthy runtime, the version-mismatch abort with its message, a pass when versions match, and no ticket executed in the abort cases.
- **`classifyTicketRunError`** (existing): observe the incident's exact 400 string classifying as `run-fatal`, not `retryable`, and the halt message's fix text.
- **Stock Dockerfile / Containerfile** (existing assets): a content test pins each `ARG` directly above its install `RUN`, and the two files stay twins.

## Out of scope

- **Model discovery.** A parked, separate feature that depends on this one.
- **Migrating stream-client's custom image** (`runcastle-bl`). Runcastle only detects and warns. The fix is that project adopting `.runcastle/sandbox/Dockerfile`.
- **A project Dockerfile that reinstalls an agent CLI** on top of the base. The inherited label would then be wrong, and that is accepted.
- **Docker dying mid-run.** Only the pre-run health check is in scope.
- **A general redesign of how build errors render.**
- **Auto-rebuilding from a burn**, which the shipped decision forbids.
- **A Codex "CLI too old" pattern**, deferred until its real wording is observed.

## Open questions

- The exact `install.sh` invocation for pinning a version (`bash -s <version>`) and its behaviour with an empty argument must be verified by the implementing ticket against the live script. If it differs, adjust the Dockerfile line and keep the decision (layer-scoped pin via `ARG`).
- The exact output formats of `claude --version` and `codex --version` must be confirmed so the parser extracts a bare semver on both host and image the same way.
