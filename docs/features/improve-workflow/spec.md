# Improve Workflow — automatic review

## Problem

When a burn run finishes, the feature lands in the review phase and everything from there is manual: the human starts a test drive, clicks through the app from zero, types observations into the notes panel, and only then chooses Merge, Fix, or Rethink. Nothing verifies the feature was ever actually exercised — the UI can only warn that a drive was never started. Review is the one phase where the human still does all the work, and for backend-only changes even that work is awkward (there is nothing to click through; the honest review is "run the tests, hit the endpoints").

## Approach

From the user's perspective: when they emit tickets for a feature, the batch can now include a **review ticket** — a prose description of how to verify the integrated result ("open the app, exercise the new settings flow, check the empty states" — or, for a backend feature, "run the suite, curl these endpoints"). The burn run executes it last, after every implementation ticket has landed on the feature branch. A review agent boots the app through the existing drive machinery, drives it with agent-browser, and writes what it finds as test notes. When the human arrives at the review screen, they start from the agent's report — a loud summary of what the review did and found — instead of from zero. Merge, Fix, and Rethink stay exactly as they are; agent findings ride the existing promote-note → fix-ticket loop.

The shape:

- **Ticket kind.** Tickets gain a `kind` — `implementation` (default, today's behavior) or `review`. The tickets session authors review tickets like any other ticket (title, goal, acceptance criteria), blocked by all implementation tickets in the batch. Optionality and multiplicity fall out of authorship: a backend-only feature gets a tests-and-endpoints review ticket or none at all; multiple review angles are simply multiple review tickets (one per feature in lap 1). Ticket cards in the UI show the kind.

- **Per-kind execution in the burner.** The ticket-burner run treats review tickets differently: no per-ticket branch, no sandbox container, no merge queue entry. A review ticket executes host-side against the integrated feature branch once all implementation tickets are terminal. It never edits code; its deliverable is notes. Its digest joins the run digest like any ticket's.

- **Review drive.** The review agent boots the app through the existing host drive plumbing — driveEnv injection (per-branch database via the `{{id}}` convention), the setup/dev/stop commands, dev-URL sniffing — via a new agent-callable drive wire modeled on the prep session's dry-run drive (start/status/stop; status hands back the dev URL). The drive's deny-while-run-active guard gets a carve-out for review-purpose drives: by the time a review ticket runs, the branch is quiet. The singleton drive slot is respected — if the human holds it, the review ticket fails rather than waits (see semantics below). The drive machinery and preparation keys are consumed as-is; this feature adds no provisioning concepts.

- **Notes wire.** A new agent-callable test-notes wire lets the review agent append notes through the existing test-notes service, attributed as agent-authored so the UI can distinguish them from the human's. Notes land in the feature's test-notes doc and the existing notes panel; promote-to-fix-ticket works on them unchanged.

- **Review semantics — advisory and best-effort.** Findings are not failure: a review ticket is `done` when the review ran to completion, however many bugs it found. `failed` means "couldn't review" — app wouldn't boot, drive slot held, dirty tree, agent crash. Either way the all-tickets-terminal gate is satisfied and the feature enters review; a failed review just means arriving with no agent notes, today's status quo. No gate hardening: the Merge click remains the whole of the ship gate.

- **Loud review surface.** The review screen must make the agent's work unmissable: a review summary on the phase's summary surface — "Review agent: N findings" with agent-attributed notes, or "Review could not run: <reason>" when the ticket failed — not merely rows appended to the notes list. The merge summary gains a review-status line alongside its existing advisory warnings.

- **Review prompt.** The skills pack gains the review agent's prompt: consume the ticket's goal and acceptance criteria, start the review drive, drive the app with agent-browser (snapshot/act/re-snapshot loop), verify each criterion, write a note per finding plus a closing summary note, stop the drive. Backend-only reviews need no special mode — the prose ticket simply prescribes tests/endpoints instead of browser steps.

## Seams

1. **Ticket batch contract** *(existing, extended)* — emit-tickets and the ticket store accept `kind`. Observe: stored tickets carry the kind; blockedBy ordering places review last; ticket cards render it.
2. **Burner run** *(existing, extended)* — a run containing a review ticket executes it host-side after implementation tickets are terminal. Observe: ticket statuses and run digest; a review ticket never creates a branch or merge-queue entry.
3. **Review drive wire** *(new, modeled on the dry-run drive)* — start/status/stop against the feature branch under a run identity, with the run-active carve-out. Observe: drive state transitions, dev URL handed to the agent, drive released on stop and on ticket failure.
4. **Test-notes wire** *(new)* — agent-appended notes flow through the existing notes service with agent attribution. Observe: notes in the doc and the panel, flagged as agent-authored; promote-to-ticket works on them.
5. **Review surface** *(existing, extended)* — the review screen's summary and the merge summary report review outcome. Observe: "N findings" / "could not run: reason" rendering from ticket + notes state.

## Out of scope

- Video walkthrough recording/playback (lap 2 — see Later laps).
- Any gate hardening: merge never blocks on review outcome or unresolved notes.
- Making the burner sandbox run apps or services — implementation tickets stay hermetic.
- Multi-service preparation (redis namespacing, compose project names/ports/health-waits, `{{port}}`, hosted-DB affordances) — parked as the draft feature *Preparation supports multi-service projects*.
- Multiple review tickets per feature, review template library — later laps.
- Drive-state survival across server restarts, port allocation — pre-existing limitations, unchanged.

## Open questions

- Whether the review drive should wait briefly for a human-held drive slot before failing (lap 1: fail fast; revisit if slot contention shows up in practice).
- Exact wording/placement of agent attribution on notes — resolved in implementation within the existing notes UI vocabulary.

## Later laps

- **Video walkthrough** — agent-browser records natively; store the recording as a feature artifact and play it on the review screen. Deferred so lap 1 can answer the real bet: are agent findings worth reading?
- **Multiple review tickets per feature** — different areas/angles per ticket; the schema and ordering already permit it, the prompt and UI summary would need to aggregate.
- **Review template library** — named review styles (browser walkthrough, API probe, test-suite audit) the tickets session can reach for instead of free prose.
- **Teeth** — once findings have earned trust: merge-summary escalation or a soft gate on unresolved agent notes.
