# Decisions — Burns rebuild a drifted sandbox image themselves

> **Title no longer fits.** Ideation chose warn-only over auto-rebuild (decision 2): burns do NOT rebuild the image themselves. The feature now makes CLI drift a warning, and makes the one-click Rebuild easy to reach when it is actually needed. Rename the feature in the UI if you want the title to match.

## 1. One lap, whole scope, no map
**Decision:** The full scope is specced as a single lap. The feature is not mapped and has no deferred later laps.
**Why:** After decision 2 everything hangs off one server seam, the drift branch of the burner's run-level image preflight, plus existing link plumbing in the web app. Nothing needs research or a prototype.

## 2. Warn-only: CLI drift no longer stops a burn, and burns never build
**Decision:** When the run-level preflight finds a **managed** image whose agent CLI version differs from the host's, the burn emits a warning and continues on the image it has. This is the treatment custom images already get. Burns never trigger an image build. Strict-equality drift detection stays exactly as it is; only the verdict changes from abort to warn. This reverses the **fail-fast** half of `sandbox-agent-clis-track-the-host-version` §5, and the "never auto-build" half stands. It lands as an ADR at merge, citing §5.
**Why:** Auto-rebuild was fully designed first: a headless build, per-image locks (the stock image `sandcastle:runcastle` is shared by every project, and project images are built `FROM` it), re-checks after waiting, mid-burn project-image adoption, a coordinated manual Rebuild, and build logs. Its own failure path was already "warn and continue on the old image", so auto-rebuild amounted to warn-only plus a lot of orchestration to save one click. That orchestration would fail exactly where debugging is hardest: concurrent burns with one of them failing. An older CLI almost always serves the model. The one case it does not ("does not support this model") is already run-fatal on the first ticket with a named fix (§7). The doctor still shows the image as stale with its Rebuild button. The human's pain was having to rebuild before almost every burn, and warn-only removes that with almost no new mechanism. Accepted trade-off: burns may lag the host's CLI until someone clicks Rebuild, which gives up §2's "the sandbox runs whatever the host runs" parity for burns.

## 3. Every outcome is named; the human is never stuck or left searching
**Decision:** Every drift outcome tells the human what happened, why, and the fix, and every fix that is a Rebuild is one click away from where the message appears. A burn still aborts before any ticket only for the existing hard stops: container runtime down (§6), and the agent binary or toolchain missing from the image.
**Why:** The human asked for it explicitly: "everything should fail gracefully and the user should be aware of what happened", "make sure the user is never stuck", and "provide the link to the rebuild button so the user doesn't have to look for it in the settings".

## 4. Custom images keep today's behaviour
**Decision:** Custom images covers a hand-typed project tag, a machine-wide `sandboxImage`, `RUNCASTLE_SANDBOX_IMAGE`, legacy global residue, and a hand-typed tag on top of a repo Dockerfile. They keep exactly today's warning (`customImageCliDriftMessage`, which names who owns the image) and carry no Rebuild link, because their Rebuild is refused. Managed images get their own warning text, which points at Settings → Burns (decision 5).
**Why:** Runcastle cannot rebuild what it does not manage. A link to a disarmed button would be a dead end, which breaks decision 3.

## 5. Managed-image drift shows as a warning on the run page, linked to Rebuild
**Decision:** A managed image's drift emits `burn.image_cli_drift`, the same event custom images use, with a managed-image message. The message names the image, both versions, that the burn continues on the older one, and the fix phrased as "Rebuild from Settings → Burns". The run page shows it as a visible warning, and the phrase renders through the existing `MessageWithSettingsLink`, which opens the Burns page at the image row (`sandcastle-image`) with the Rebuild button highlighted. Example: "Sandbox has Claude Code 2.1.280, your machine has 2.1.290 — burning on 2.1.280. Rebuild from Settings → Burns to catch up."
Concretely: today the run timeline (`RunTimeline`) auto-opens only for events `eventWarns` flags, and that is only `data.oversized`. It also prints `e.message` as plain text. So the drift event carries a warning flag in its data, `eventWarns` honours it, and warning rows render their message through `MessageWithSettingsLink`. This applies to both managed and custom drift. The custom message has no Settings pointer, so it simply renders as text.
**Why:** It is one event for one fact, told apart by its text. The link machinery already exists and already lands on the Rebuild row, so "don't make the user look for it" costs almost no new routing. Without the warning flag, the one message that matters would sit in a collapsed panel nobody opens.

## 6. The "CLI too old for this model" message names the right fix
**Decision:** `cliTooOldMessage` compares the required version with the host's CLI version. If the host already meets it, the message says so and the fix is only "Rebuild from Settings → Burns". If it does not, the fix is "run `claude update` on the host, then Rebuild from Settings → Burns". When the host version is unknown, it keeps the two-step wording. The error stays run-fatal (§7).
**Why:** §7's wording assumed the preflight guaranteed image == host, so the host had to be too old as well. Under warn-only the image can lag a host that is already new enough, and telling that human to run `claude update` sends them on a pointless errand.

## 7. A run halted by a Settings → Burns fix leads with that fix
**Decision:** On the feature's next-step bar, a failed run whose summary points at Settings → Burns makes "Open Settings → Burns" the primary action, with Resume burn as a secondary. This applies even when tickets had already started, which is how the CLI-too-old halt arrives (on the first ticket). Today that primary appears only when the run died before any ticket started.
**Why:** Resume would hit the same wall, so the fix has to be the obvious button. The existing rule only covered setup and preflight deaths, and the one failure left under warn-only happens on a ticket.

## 8. No drift warning in the burn confirm dialog
**Decision:** `burnWarnings` (the pre-burn dialog) does not gain a CLI-drift check.
**Why:** It would run container and host `--version` checks every time the dialog opens, and turn a synchronous, db-only function into a Docker caller. The burn no longer stops on drift, so knowing seconds earlier buys little. The run page warning (decision 5) and the doctor's stale row already say it.
