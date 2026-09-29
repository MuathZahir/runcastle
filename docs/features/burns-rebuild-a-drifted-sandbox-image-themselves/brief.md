## Why this exists

Burns fail whenever the host's Claude Code version differs from the one baked into the sandbox image. Claude Code auto-updates on the host very frequently, so in practice the human has to click Rebuild before almost every burn. The human's words: "it's annoying to have to rebuild the container every time I want to burn."

This is not a bug. It is a trade-off that `sandbox-agent-clis-track-the-host-version` (shipped 2026-09-24) accepted on purpose. See `docs/features/sandbox-agent-clis-track-the-host-version/decisions.md`:
- **§2**: the stock Dockerfile/Containerfile pin `CLAUDE_CODE_VERSION` / `CODEX_VERSION` build-args to the host's `--version`. A drifted Rebuild therefore only reinstalls the CLI layer and takes seconds.
- **§3**: images carry `runcastle.claude-code-version` / `runcastle.codex-version` labels. Project images inherit them through `FROM`.
- **§5**: the burn preflight compares the in-image version to the host version with strict equality and aborts before any ticket runs. Burns **never auto-rebuild**, because image builds were meant to stay terminal actions a human watches. §5 names this exact cost as accepted: "a silent host update blocks burns until someone clicks Rebuild, even when the old CLI would have served the model."

§2 made the rebuild cheap, and that removes the reason for §5's "never auto-build". This feature overturns that half of §5. It is a project-level decision reversal, so it should land as an ADR at merge (promotion), citing §5.

## What it should do (the cut agreed in the project session)

On a CLI-version mismatch, the burn preflight runs the same resolved build chain Rebuild runs (stock image first if stale, then the project image), but headlessly inside the run. It then re-probes and continues the burn. It must not fail and send the human to Settings → Burns. Sandbox and host stay on the same CLI version, which keeps §2's "the sandbox runs whatever the host runs" parity.

Reuse what exists; do not rebuild it: `planImageBuild` / `imageFreshness` in `services/sandbox-image.ts`, `resolveHostAgentVersions` in `services/agent-cli-versions.ts`, the run-level preflight in `workflows/ticket-burner.ts`, and `buildImageTerminal` in `services/setup.ts` as the reference for how a build is invoked today.

## Open questions for the ideation session (design, not scope)

- **Headless build surfacing:** how the burn page shows "rebuilding image (CLI 2.1.280 → 2.1.290)…" and its log, and how a failed auto-rebuild reports (reuse the §8 named-failure messages for pinned installs).
- **Concurrency:** two burns (or a burn and a manual Rebuild) detect drift at the same moment. They must not both build the same tag, and a burn already running on the old image must not be broken by a retag under it.
- **Project-image cost:** a base rebuild invalidates every layer of a derived project image (`FROM sandcastle:runcastle`), not just the CLI layer. A heavy project Dockerfile makes that burn's start slow. Decide whether that is acceptable, or whether anything (for example, logging/announcing it) is needed.
- **Scope of trigger:** is this only for CLI-version drift, or also for Dockerfile-hash staleness? The recommendation from the project session was CLI drift only, because hash staleness means a human edited a Dockerfile, which is a watched change. The ideation session decides.
- Whether any opt-out setting is warranted (lean: no, per "flexible guidance over brittle machinery" and "less mechanism").

## Fallback considered

Option 2 from the project session: downgrade the drift check to a warning and let the burn run on the older CLI. Its justification is that an older CLI almost always works, and the one case that doesn't ("does not support this model; version … or newer is required") is already classified run-fatal (§7), so it fails on the first ticket with fix text. It was not chosen because burns would silently lag the host and eventually hit a manual Rebuild again. It is the fallback if auto-rebuild proves hard (for example, the concurrency story gets ugly).

## Must NOT swallow

- **Custom / userSupplied images** (for example stream-client's `runcastle-bl`, built outside runcastle). Runcastle cannot rebuild them. They keep today's warn/fail behaviour with the disarmed button.
- **Model discovery** (new models appearing in the roster): a separate concern.
- **Dead container runtime handling** (§6): unchanged. If Docker is down, the burn still fails fast with the doctor's fix text. There is nothing to rebuild.
- **The host update itself**: runcastle does not run `claude update`. It follows whatever the host has.

## Verify

- Update the host CLI (or fake a version mismatch via labels), then burn. The burn rebuilds only the CLI layer of the stock image, then the project image, and proceeds. The in-image `claude --version` matches the host afterwards. No manual Rebuild is needed.
- Two burns started together on a drifted image produce one build, and both proceed.
- A custom image with drift behaves exactly as today.
- Docker down still fails fast with the doctor's message.
