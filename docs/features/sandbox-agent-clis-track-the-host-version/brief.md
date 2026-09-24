## Why this exists

Burns failed at agent start with `API Error: 400 Claude Code 2.1.270 does not support this model; version 2.1.280 or newer is required.` Updating Claude Code on the host did nothing: burns run the CLI baked into the Docker image, and that CLI never refreshes.

Root cause: the stock Dockerfile (`packages/server/src/assets/sandcastle/Dockerfile:36`, plus the Containerfile twin) installs Claude Code with an unpinned `RUN curl -fsSL https://claude.ai/install.sh | bash`. The instruction text never changes, so BuildKit always reuses the cached layer, and Rebuild finishes instantly with the old CLI. Only `docker build --no-cache` refreshes it. Codex has the same bug: line 21 is an unpinned `RUN npm install -g @openai/codex`. Derived project images (`FROM sandcastle:runcastle`) inherit whatever CLI the base had when they were built.

Observed state on 2026-09-23 (the human's machine):
- `sandcastle:runcastle` (base): rebuilt with --no-cache by hand, now 2.1.280
- `sandcastle:runcastle-proj_YftnChcmQp-w` (project-helix, built from `project-helix/.runcastle/sandbox/Dockerfile`): now 2.1.280
- `sandcastle:runcastle-bl` (stream-client custom image, built by `stream-client/.runcastle/sandbox-build.ps1`): still 2.1.215

Goal: a host `claude update`, or a new model that needs a newer CLI, must never break burns again, and nobody should need to know about `--no-cache`.

## What is already settled (do not re-litigate)

`project-owned-sandbox-image` (shipped; see `docs/features/project-owned-sandbox-image/decisions.md` §4–5) already:
- has runcastle own the build (`<runtime> build` directly, not `sandcastle build-image`);
- stamps `--label runcastle.dockerfile-hash=…` on images, with the doctor comparing the label hash to the file hash for both the base and the project image, and naming which layer is stale;
- makes Rebuild build the resolved chain (stock first if stale or missing, then the project image), so derived images are always rebuilt after the base;
- disarms the button for a hand-typed (`userSupplied`) custom tag, so it can no longer clobber custom images like `runcastle-bl`.

So the constraints "don't make the clobbering worse" and "derived images must rebuild after the base" are already met. This feature has to keep them met, not solve them again.

`stale-sandbox-image-detect-it-fail-fast-and-offer-a-rebuild` (shipped) already classifies "agent CLI missing from image" as a fatal, non-retryable burn error that points at Rebuild. The "requires version X or newer" 400 is the same kind of failure and belongs in the same classification.

## The gap this feature closes

Staleness today means the Dockerfile hash changed. CLI drift never changes the hash, so it is invisible. The feature should:
1. Make the agent-CLI version part of what an image records (for example a label, or a probe via `docker run --rm --entrypoint sh <image> -c 'claude --version'`) for both runtimes, Claude Code and Codex.
2. Have the doctor compare that to the host's `claude --version` / `codex --version` and surface a mismatch as the same "stale → Rebuild" state the hash check already uses.
3. Make Rebuild refresh only the install layer when the CLI moved. Leading idea: a version build-arg (for example `ARG CLAUDE_CODE_VERSION`, resolved from the host at build time), which changes the cache key for that layer alone. `--no-cache` on every build was the rejected alternative: it pays the full rebuild each time. Installing the CLI at sandbox start (every burn pays the cost and needs network) was the other candidate in the incident note. The ideation session picks and justifies one.
4. Add a burn preflight that fails fast with a clear message on mismatch, instead of a 400 halfway through the run. Whether it should also auto-rebuild is open. Note that the prior decision says burns never auto-build and image building stays a human-watched terminal action, so overturning that needs a reason.
5. Classify the "does not support this model; version … or newer is required" 400 as fatal and non-retryable, with fix text pointing at Rebuild.

Surface setup failures properly: today image-build setup failures surface only stderr.

## Must NOT swallow

- **Model discovery** (new Claude/Codex models appearing in the roster automatically). That is a separate, parked feature, and it depends on this one: a newly discovered model is exactly what triggers "CLI too old".
- **Migrating stream-client's custom image.** `runcastle-bl` is built outside runcastle by a `.ps1` script. Runcastle may *detect and warn* about its CLI drift, but cannot rebuild it. The real fix is for stream-client to adopt `.runcastle/sandbox/Dockerfile`, which is work in that project.

## Verify

- Bump the CLI version: only the install layer rebuilds, and `docker run --rm --entrypoint sh <image> -c 'claude --version'` matches the host's `claude --version` for the base and a project image (for example project-helix). Same for codex.
- A custom (`userSupplied`) image with an old CLI shows a warning, and the button stays disarmed.
- A burn on a model that needs the newer CLI starts without the 400. With a deliberately stale image, the burn fails fast with the clear message.
