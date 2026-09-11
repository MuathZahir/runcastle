## Why this feature exists

A Java project burned in runcastle's stock sandbox image failed because the image had no JVM toolchain — and every part of the recovery path made it worse. This feature makes non-JS toolchains a supported, first-class path instead of a hand-rolled script plus manual config edit.

Incident fallout this must fix (from the human's diagnosis, 2026-09-09):

1. **"Rebuild image" clobbers custom images.** Today it runs `sandcastle docker build-image --image-name <config.sandboxImage>` — building runcastle's stock Dockerfile under the user's custom tag, silently destroying their customization. Minimum: always build the stock tag, and disable/relabel the button when `sandboxImage` is custom. Proper (the point of this feature): let a project ship `.runcastle/sandbox/Dockerfile` (FROM the stock image), have runcastle detect it, build it as `sandcastle:runcastle-<projectId>`, and set `sandboxImage` itself.

2. **Staleness must be a content hash, not mtime vs Created.** The doctor compares the Dockerfile's mtime against the image's `Created` time, but BuildKit layer-cache reuse keeps the old `Created`, so a rebuilt-but-cached image reads as stale (or a stale one as fresh). Store the Dockerfile content hash as an image label and compare against it — for the stock Dockerfile and the custom one alike.

3. **Preflight the toolchain, not just the agent binary.** The shipped feature `stale-sandbox-image-detect-it-fail-fast-and-offer-a-rebuild` already made exit 127 on the claude/codex binary fatal with a message naming the binary, the image, and the fix — this is a second lap on that exact seam (`classifyBurnError` / RETRYABLE_ERROR_PATTERNS in packages/server/src/workflows/ticket-burner.ts). Extend the same treatment to the first token of the setup command and each verify command: exit 127 becomes "mvn is not installed in image X — add it to .runcastle/sandbox/Dockerfile and rebuild", not a raw failure (or worse, a retried one). Read that feature's docs (docs/features/stale-sandbox-image-detect-it-fail-fast-and-offer-a-rebuild/) before designing.

## Where the flow lives

The human's instinct is preparation, and the precedent supports it: `drive-instructions-the-project-tells-review-agents-how-to-drive-it` was authored by the prep session and editable in settings. Open design question for ideation: does the prep agent *write* the Dockerfile (probing the repo for toolchains — pom.xml → JDK+maven, build.gradle → gradle, etc.) or merely *detect* one the human wrote? Also: what re-prepare/doctor nudges fire when the custom Dockerfile changes after the image was built (the hash label answers "is it stale"; the UI must surface it).

## What this feature must NOT swallow

- **Burn orchestration** — when/where the setup command runs relative to ticket fan-out is the sibling feature (setup-once-on-base-branch), started the same day. This feature owns *what is in the container*; that one owns *when setup runs*. Do not touch the fan-out/blocking logic.
- **Cache mounts** — ~/.m2 etc. ride the burn cache volume (quick change, same day) under ADR-0004's constraints. The image feature must not bake package caches into layers as a substitute (the incident's workaround, explicitly retired by the cache-volume change).
- **Setup-failure diagnostics** (stdout tail) — separate quick change on the exec error helper.
- The stock Dockerfile's contents beyond what the labeling/tagging needs.

## Related shipped work to read

- docs/features/stale-sandbox-image-detect-it-fail-fast-and-offer-a-rebuild/ — the exit-127 classification this extends.
- docs/features/doctor-probe-stats-a-nonexistent-dockerfile-path-in-the-installed-package/ — how the doctor resolves the stock Dockerfile path (sandcastleTemplateDir); the hash probe must go through the same resolver.
- docs/features/flow-redesign-preparation/ and docs/features/improve-preparation/ — the prep flow this rides on.
