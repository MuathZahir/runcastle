# Preparation proves its findings

## Problem

A preparation session records the host keys every later drive depends on — the dev command, the drive setup/stop hooks, the drive environment — with provenance and evidence, but nothing ever checks that the recorded values *work*. A `driveSetupCommand` with a typo, a `driveEnv` whose `DATABASE_URL` points at the wrong port, a dev command that boots but never serves: all of these sit in settings looking exactly as trustworthy as values that run perfectly. The first time anyone finds out is mid-feature, when a human starts a real test drive to review someone's work and the environment falls over — the worst possible moment to be debugging preparation, and one that quietly teaches people not to trust drives at all.

## Approach

The prep session ends by *driving what it recorded*. After the open keys are established, the agent proposes a **dry-run drive** as the session's finale — under the existing ask-before-you-act rule, since it starts services and creates a database on the host. On the human's yes, the agent triggers it via a new MCP tool (gated to prepare sessions), and the **server runs the real drive machinery**, not a re-enactment: the same env rendering, the same hook runner with its shell choice and Windows quoting, the same dev-pane spawn and localhost-URL sniffing. The only thing missing versus a feature drive is the branch switch — there is no feature; the repo stays where it is.

The dry run replays the whole test-drive lifecycle in **two halves with the agent inspecting between them**. Start half: render `driveEnv` under a synthetic drive identity — reserved slug `prep-dry-run`, so `{{id}}` renders `prep_dry_run` and the canonical setup creates a self-describing temp database; `{{branch}}` is the repo's real current branch — then run `driveSetupCommand` and spawn `devCommand` in a real drive-owned dev pane. While it's up, the agent does the stack-aware checks the server refuses to model generically: the temp database exists and is fresh, migrations applied, the app actually responds at the sniffed URL. Stop half (agent-triggered, human watching): run `driveStopCommand`, then the agent inspects cleanup — temp database gone, nothing orphaned. Anything off at any step, the agent fixes the finding and re-runs until a full pass is clean. A leftover database from a failed attempt is a feature, not a bug: the retry's `createdb` fails loudly, which is the "make sure it's new" check enforced by the machinery itself.

**Verification is stamped server-side, from machinery observables, on a clean full pass only.** The four drive-loop keys each have one observable: `driveEnv` rendered with zero unknown placeholders; `driveSetupCommand` exit 0; `devCommand` pane spawned *and* localhost URL sniffed; `driveStopCommand` exit 0. The dry run verifies whatever subset is set — an empty key simply isn't part of the run. The agent's deeper inspections decide whether to fix-and-retry; they never touch the stamp. The other four prepared keys (`dbResetCommand`, `setupCommand`, `verifyCommands`, `knownFailures`) are unverifiable by a host drive and never carry a badge — absence of proof, not failure.

The stamp lives on the finding: `ProjectFinding` grows optional verification fields (stamped-at time and sha), one source of truth for every surface. **Any write to a verified key clears its stamp** — human settings edit, prep re-record, or clear; no value-diffing. Verification is orthogonal to provenance: a human-sourced value can be verified, because the stamp records "this exact value was seen working," not who chose it. Repo movement does *not* un-verify — verification ages visibly the way findings already do, but staleness never triggers the warning.

The dry run **occupies the existing singleton drive slot**. A dry run while a feature drive is active is refused with a reason, and vice versa (the next-step bar says a preparation dry-run is in progress). The dry run surfaces as the active drive — project-scoped, no feature — with a working Stop control, so a human can run the teardown half by hand if the prep session dies mid-run, and server-boot reconciliation treats it like any orphaned drive.

Three display surfaces read the stamp. The **preparation workspace** findings list shows per-key "verified (age)" / "unverified" on the drive-loop keys. **Project settings** shows the same stamp inline on the prepared-key fields — the place where an edit clears it is the place that must show it clearing. And the **next-step bar's Start-test-drive step** grows an inline, non-blocking warning when any drive-loop key has a value but no valid stamp, naming the specific keys and pointing at preparation; one click still starts the drive, and keys with no value don't warn. No modal anywhere, no gate anywhere: `isPrepared` and session-end are untouched, because skipping the dry run already carries its own visible consequence.

## Seams

- **Dry-run lifecycle (new)** — the MCP tool boundary a prepare session drives: start half, stop half. Observes: refusal (drive slot busy, non-prepare session), hook results and rendered env, the sniffed URL, and — the money shot — which findings carry verification stamps after a clean pass vs. a failed one. This is the seam the whole feature is tested at; it sits on top of the real drive machinery, so exercising it exercises that too.
- **Findings service (existing)** — stamp semantics: write-clears-verification (human write, prep re-record, clear), stamp-on-clean-pass, and verification fields flowing out of the findings listing with age resolved.
- **Drive slot guard (existing)** — mutual exclusion both directions between dry runs and feature drives, and the dry run's visibility as a stoppable project-scoped active drive.
- **Prepare-prompt renderer (existing, pure)** — the closing section: propose-the-dry-run instructions, ask-first framing, fix-and-retry protocol.
- **Next-step model (existing, pure)** — the Start-test-drive step's inline warning: present exactly when a drive-loop key has a value and no valid stamp, naming the keys, absent for empty keys and after a clean pass.
- **Prep view (existing)** — verification data reaching the preparation workspace and settings surfaces through the view the UI already polls.

## Out of scope

- Verifying `dbResetCommand` or the sandbox keys (`setupCommand`, `verifyCommands`, `knownFailures`) — no drive slot proves them; they show no badge.
- Staleness-driven invalidation, re-verify nudges, or any scheduled re-running of dry runs — staleness keeps its existing voice only.
- Recording or auditing the agent's between-halves introspection (DB freshness, migration state) — those checks are conversational; the stamp never depends on them.
- Blocking anything: no gate on session end, no `isPrepared` change, no modal before drives.
- Concurrent drives or per-run unique identities — the singleton slot and the fixed `prep-dry-run` identity are deliberate.

## Open questions

- Exact MCP tool shape (one tool with a start/stop action vs. a pair) and the wait budget for the URL sniff before the start half reports "no URL yet" — implementation calls; the stamp aggregates at stop time either way, so async sniffing is safe.
