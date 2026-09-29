# Burns warn on a drifted sandbox CLI instead of stopping

> The feature's title says burns rebuild the image themselves. Ideation chose **warn-only** instead (decisions.md §2). This spec describes what was decided.

## Problem

Claude Code updates itself on the host very often. Since `sandbox-agent-clis-track-the-host-version` shipped, every burn compares the sandbox image's agent CLI with the host's and **aborts** on any difference. So in practice the human has to open Settings → Burns and click Rebuild before almost every burn. The human's words: "it's annoying to have to rebuild the container every time I want to burn."

When the older CLI does eventually matter (a model that needs a newer Claude Code), the error today always says "run `claude update` on the host, then Rebuild". That can be wrong: the host may already be new enough. The run's next-step bar then offers a generic "Resume burn", which hits the same wall again.

## Approach

**From the human's side.**
- A burn on a managed image whose CLI lags the host just runs. The run page's timeline opens on a warning: "Sandbox has Claude Code 2.1.280, your machine has 2.1.290 — burning on 2.1.280. Rebuild from Settings → Burns to catch up." The "Settings → Burns" phrase is a link that opens the Burns page at the image row, with the Rebuild button highlighted.
- If a model really does need the newer CLI, the first ticket fails run-fatally (as today). The message names the right fix: just Rebuild when the host already meets the required version, or `claude update` then Rebuild when it does not. The feature's next-step bar leads with "Open Settings → Burns", with Resume beside it.
- Custom images, a dead container runtime, and a missing agent binary or toolchain all behave exactly as today.

**Shape.**

1. **Burner preflight (server).** The run-level image preflight keeps its single `sh` probe and its strict-equality comparison of each used runtime's in-image version against the host's. Only the verdict changes for a *managed* image (`isManagedImage`): it no longer returns a failed run. It emits `burn.image_cli_drift` and continues, as the custom-image branch already does. The managed-image message is new. It names the image, the runtime, both versions, that the burn continues on the older one, and the fix as the literal phrase "Rebuild from Settings → Burns". The custom-image message (`customImageCliDriftMessage`) is unchanged and carries no Settings pointer, because a custom image's Rebuild is refused. Both drift events carry a warning flag in their event `data` (for example `{ warning: true, runtime, image, imageVersion, hostVersion, managed }`). The message used to abort, `agentCliDriftMessage`, is retired or repurposed as the managed warning text. Burns never build an image.

2. **"CLI too old" message (server).** `cliTooOldMessage` also takes the host's CLI version for that runtime; the burner already resolves `hostAgentVersions` once per run. It compares the host version with the required version using a numeric dotted-version comparison:
   - host ≥ required: "Claude Code <inUse> is too old for model <m> (needs <required> or newer). Your machine already has <host> — Rebuild from Settings → Burns."
   - host < required, or host unknown: today's two-step wording ("Run `claude update` on the host, then Rebuild from Settings → Burns.").
   The error stays run-fatal (prior feature §7). Its summary must keep the "Settings → Burns" phrase so the web can detect it.

3. **Run timeline (web).** `eventWarns` also returns true for an event whose `data.warning === true`, alongside today's `data.oversized`. That makes the collapsed Run timeline open on a drift warning. Warning rows render their message through `MessageWithSettingsLink` instead of as plain text, so the Settings pointer becomes the link to the image row. Non-warning rows stay plain and single-line.

4. **Next-step bar (web).** In the building-phase resolver, a failed run whose recorded summary points at Settings → Burns (`settingsLocationFromMessage`) gets "Open Settings → Burns" (`openBurnSettings`) as its **primary** action, with Resume burn secondary. This now also applies when tickets had already started. Today that primary exists only on the "could not start" branch, for runs that died before any ticket. The existing copy and alert styling of the could-not-start branch are unchanged. For the halted-mid-run case, the description is the run's failure summary.

5. **Docs.** At merge this reverses the fail-fast half of `sandbox-agent-clis-track-the-host-version` decision 5. The "never auto-build" half stands. It is recorded as an ADR in `docs/adr/`, citing that decision.

No schema, tRPC, or config changes. There is no opt-out setting.

## Seams

- **`burnRun` (existing):** the burner's testable core with fake `exec` and `hostAgentVersions`. Observe: a managed image with drift completes preflight and proceeds to the tickets (the fake `executeTicketRun` is called). It emits one `burn.image_cli_drift` per drifted runtime, with the warning flag and the Settings → Burns phrase. A custom image's event carries the flag without the phrase. The runtime-down and missing-binary/toolchain aborts are unchanged. No build command is ever exec'd.
- **`cliTooOldMessage` (existing, signature widened):** a pure function. Observe the three wordings (host ≥ required, host < required, host unknown) and that every one contains "Settings → Burns".
- **`eventWarns` (existing):** pure. Observe true for `data.warning`, true for `data.oversized`, and false otherwise.
- **`RunTimeline` (existing component):** component test. A warning event opens the disclosure and its "Settings → Burns" phrase renders as a link. Plain events render as before.
- **Building next-step resolver (existing):** pure. A failed run with tickets started and a Settings → Burns summary yields the primary `openBurnSettings` plus secondary Resume. A failed run with tickets started and any other summary keeps today's "Resume the burn". The could-not-start branch is unchanged.

## Out of scope

- Auto-rebuilding the image from a burn, including headless builds, build locks, and mid-burn project-image adoption. Considered and rejected (decisions §2).
- A drift warning in the pre-burn confirm dialog (`burnWarnings`) (decisions §8).
- Changes to the doctor's image rows or the Rebuild button itself. The doctor still shows drift as stale.
- Custom-image behaviour, container-runtime-down handling, and model discovery.
- Running `claude update` on the host.
- A Codex "too old" pattern (none has been observed yet; prior §7).

## Open questions

None.
