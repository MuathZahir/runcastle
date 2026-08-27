# Outcome — Stale sandbox image: detect it, fail fast, and offer a rebuild

Burn error classification: a container burn whose agent CLI is missing from the image must fail fast, not retry. Context: config `sandbox: docker`, image `sandcastle:runcastle-demo` built 2026-07-23; the burner Dockerfile (`packages/server/src/assets/sandcastle/Dockerfile`) gained `npm install -g @openai/codex` in a69cf5a on 2026-08-18. A Codex burn then dies with `codex exited with code 127` (the container shell's 'command not found'), and `RETRYABLE_ERROR_PATTERNS` in `packages/server/src/workflows/ticket-burner.ts` (`/exited with code \d+/`) classifies that as retryable, so every retry attempt is spent on a deterministic failure. Fix: in `classifyBurnError` (or wherever the pattern tables are consulted), treat exit code 127 and the wordings `command not found` / `not found` after an agent binary name as FATAL, checked before the retryable table. The surfaced message must name the runtime binary, the image tag, and the fix: e.g. `codex is not installed in image sandcastle:runcastle-demo — the image predates the burner Dockerfile. Rebuild it from Settings → AFK burns (Rebuild image).` Add unit tests for both runtimes and for the existing `exited with code 1` case staying retryable.

- Shipped: 2026-08-27
- Lap: 1

## 1. Burn error classification: a container burn whose agent CLI is missing…

What was done

Added fatal detection for missing Codex and Claude agent binaries before the broad nonzero-exit retry rule.
Recognized exit code 127 and shell `command not found`, `not found`, and `No such file or directory` wording only when it follows the runtime binary name.
Surfaced an actionable failure naming the binary and resolved sandbox image tag, with the Settings → AFK burns rebuild path.
Preserved commits salvaged from a failed attempt even when the stale image stops further retries.
Added unit coverage for both runtimes, alternate shell wording, the exact guidance, and exit code 1 remaining retryable.

Surprises

The classifier returns only fatal/retryable, so the actionable message also had to be wired into the ticket-run catch path.
The exact full suite ran 2,252 tests rather than the prompt's older 1,768-test count.
Five full-suite tests failed from the sandbox environment: injected pager variables, an injected Claude OAuth token, and a process-group teardown race; the focused 40 classifier tests and full typecheck passed.

Left undone

No drive scripts changed because this ticket adds no service, required boot variable, seed, or companion process.
No unrelated environment-sensitive tests were modified.

## 2. Container burn precheck: verify the image can run the burn's runtime…

What was done

Added a run-level container image precheck to the ticket burner.
Docker and Podman now run the resolved runtime binary's `--version` inside the configured image before ticket scheduling starts.
The probe uses the doctor's injected execution boundary and production system executor.
Probe results are memoized by image and runtime for the lifetime of the burn dependency set.
Failures emit `burn.image_runtime_missing` with the binary, image tag, and Settings rebuild instruction, then abort before ticket execution.
Host-only `noSandbox` burns bypass the image probe.
Workflow tests cover a successful Codex probe across multiple tickets, a Claude exit-127 failure with zero ticket executions, and the noSandbox bypass.

Surprises

The full suite inherits `GIT_PAGER` and a Claude OAuth token from the burn harness, causing four unrelated environment-sensitive failures; a process-group teardown test also remained flaky. The 55 affected workflow tests passed.

Left undone

No drive machinery changed because this ticket adds no service, required boot environment variable, seed, or companion process.

## 3. Doctor: report the sandcastle image as STALE when it predates the…

What was done
Added a `stale` doctor probe status for a Sandcastle image built before the bundled burner Dockerfile.
The image probe now reads the runtime image `Created` timestamp with formatted inspect output.
Dockerfile mtime access is injected through `DoctorEnv`, so doctor tests do not touch the filesystem.
Stale detail includes the image build date, Dockerfile change date, and a rebuild instruction.
The CLI report renders stale as an error and overall doctor health folds it in as non-ok.
The AFK settings card labels the stale-image action “Rebuild image” while preserving “Build image” for missing images.
Tests cover healthy, missing, and stale image outcomes; typecheck and affected tests passed.

Surprises
Importing `sandcastleTemplateDir` into doctor would create a cycle because setup imports doctor runtime definitions, so doctor resolves the same bundled asset directly.
The full suite had unrelated sandbox failures from injected PAGER variables and process-group teardown; 132 files and 2239 tests passed on the cleanest rerun.

Left undone
No drive machinery changed because this ticket adds no service, boot-time environment variable, seed, or companion process.

## 4. AFK burns card: always offer a Rebuild image button when the image is…

What was done
The AFK burns image row now remains actionable for missing, stale, and healthy images.
Missing images retain the primary Build image action.
Stale images show the doctor's detail and fix, an amber status, and a primary Rebuild image action.
Healthy images retain their green status and gain a secondary Rebuild image action.
All three actions reuse the existing build-image terminal and Done — re-check flow.
The runcastle-owned sandbox build context now refreshes bundled scaffold files before every build.
Component coverage renders all three image action states, and server coverage proves stale files are overwritten.

Surprises
The full suite found unrelated sandbox-environment failures from GIT_PAGER, a host OAuth token, and process teardown timing.
The ticket-focused tests and repository typecheck are green; the unrelated failures reproduced in one targeted confirmation.
No drive machinery change was needed because this adds no boot-time service, environment variable, seed, or process.

Left undone
Existing user/project `.sandcastle` scaffolds remain create-only; only the app-owned global build context is refreshed.

## 5. Review the integrated change

This lap makes stale Sandcastle images visible and recoverable instead of letting unattended burns waste every retry on a missing agent CLI.
Container burns now preflight the selected image’s Codex or Claude binary and surface an actionable failure that names the image and points back to the AFK burns settings.
The fallback error classifier also recognizes exit 127 and missing-command wording as fatal while preserving ordinary exit-code failures as retryable.
The setup doctor now compares the image creation date with the bundled burner Dockerfile and reports an out-of-date image as stale.
In Settings, missing images retain the Build image action, stale images receive an amber Rebuild image action with the doctor’s guidance, and healthy images can also be rebuilt on demand.
Rebuilds refresh Runcastle’s app-owned build context from the current bundled template, so upgrading the app no longer leaves an old scaffold behind.
The main gap is mixed-runtime burns: preflight currently checks only the run-default runtime, even though an individual ticket may be assigned to the other runtime, so that ticket can still reach container creation before its missing CLI is discovered.
The review also found that the new scaffold mutation does not emit the event required by the repository’s service convention, and that the runtime mapping and missing-image guidance are duplicated across two paths.
The automated diff review confirmed the rest of the requested shape and its focused test coverage.
The AFK settings walkthrough could not be performed because the shared checkout had uncommitted changes and the drive correctly refused to switch branches.
No checkout changes, browser session, recording, development server, or drive slot were left behind.
