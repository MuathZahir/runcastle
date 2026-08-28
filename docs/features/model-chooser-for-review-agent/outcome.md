# Outcome — Model Chooser for Review Agent

Currently, in the burn phase, there's a review agent that runs after all tickets are burnt. The review agent is just another burn agent but it runs when everything is done. Currently, there's no way to choose the model of the reviewer agent (I usually want it different than the models of the implementers) from the settings. I want to add this

- Shipped: 2026-08-28
- Lap: 1

## 1. Currently, in the burn phase, there's a review agent that runs after…

# Ticket 1 — model chooser for the review agent

## What was done

The burn's review agent now has its own model setting. `review` was already a
name in `MODEL_STEPS`' doc comment, but deliberately *absent* from the list —
reserved back when no review workflow existed. It is now a real step, slotted
between `implement` and `prepare`, so the whole existing per-step machinery
picks it up for free: the settings service already builds one field per
`ModelStep` and already validates writes against that set, and the web overlay's
"Advanced — per-step models" section already renders and offers every step it is
given. The only web change needed was a `review: 'Review'` label so the row
reads as a name rather than a config key.

The wiring is one line in the burner. `resolveTicketModel` — the chokepoint that
decides what model and runtime one ticket burns on — resolved `'implement'` for
every ticket; it now picks the step from the ticket's kind, `review` for a review
ticket and `implement` for everything else. That flows straight into
`executeReviewTicket`'s `deps.model` and its token lookup, so a reviewer set to a
Codex model launches the Codex CLI with the Codex key, exactly as an assigned
implementation ticket already did. `isReviewTicket` was widened from `Ticket` to
`Pick<Ticket, 'kind'>` so the chokepoint can keep taking a narrow ticket shape.

Precedence is unchanged and deliberately uniform with every other step: a review
ticket's own stamped `model` still wins (it is that ticket's run override), then
a per-project model, then `stepModels.review`, then the global default. Nothing
seeds `stepModels.review`, so a machine that never touches the setting behaves
byte-for-byte as before — the reviewer inherits the default model.

Verification: `bun run typecheck` clean (0 errors, all four projects plus
scripts). Tests — the four affected files (core config, server step-models,
server ticket-burner units, web settings) are green, 256 tests.

## Surprises

- The stated test baseline is stale. The prompt says 118 files / 1768 passed;
  this tree actually runs 141 files / 2423 tests. Worth correcting for the next
  burn, since "any failure outside the baseline is yours" is unusable against a
  count that far off.
- One full-suite failure, and it is an environment fault, not mine:
  `packages/server/test/dev-pane.test.ts` — "kills the child process tree so the
  port-holder is not orphaned" — fails reproducibly here, asserting a PTY process
  group is gone 400ms after `stopDevPane`. This sandbox has no init reaper, so
  `kill -0 -pgid` still succeeds on the zombies. My diff touches no file under
  `src/pty/`; the test and every source file it exercises are byte-identical
  before and after my commit. Everything else in the suite passes.
- Three tests actively asserted the reserved state (`ModelStep` rejects
  `'review'`, the settings view omits `stepModels.review`, an update to it
  throws). Those were the specification of the old behaviour, so they were
  rewritten rather than deleted — each now asserts the review step is offered,
  writable and persisted.
- `STEP_LABEL` in `apps/web/src/lib/settings.ts` is already missing entries for
  `revisit` and `project`; both fall through to the raw step name. Pre-existing,
  left alone.

## Left undone

- **The tickets ledger's model chip still shows the `implement` model.**
  `TicketsBody` renders one header chip from `effectiveStepModel(view,
  'implement')` for the whole ledger, so with a review override configured the
  review row burns on a model the UI never names. Making the chip per-kind (or
  per-row) is a real improvement and a visible one, but it is a display change
  this ticket did not ask for.
- **The container auth gate does not exempt reviews.** `gateTicketAuth` fails any
  ticket whose model's runtime has no token in `.env` when `sandbox !==
  'noSandbox'` — but a review runs host-side under `noSandbox()` regardless, so
  it needs no container credential. Set the reviewer to a runtime you are logged
  into interactively but have no key for, and the review fails "auth missing"
  before it starts. This is pre-existing (a per-ticket model assignment on a
  review ticket already hit it) and my change only makes it easier to reach; the
  fix is a one-line `isReviewTicket` skip in that gate.
- No drive-machinery change was needed or made: this adds a config key with an
  inherit-by-default fallback — no new service, no required env var, no seed, no
  process. `.runcastle/drive-setup.ts` and `drive-stop.ts` are untouched and I
  did not run them (nothing to verify, and the sandbox has no app).

## 2. Review the integrated change

You can now pick a separate model for the agent that reviews a burn, instead of it silently
riding on whatever the implementers were set to. The control lives in Settings, in the
collapsed "Advanced — per-step models" section: add an override, choose the row now labelled
"Review", and the review pass that runs once every implementation ticket is done will launch
on that model — including on the other runtime, so setting a Codex model there starts the
Codex CLI with the Codex key exactly as an assigned implementation ticket already did.

The shape that landed is smaller than you might expect, and that is the good news. "Review"
was already a name the settings machinery knew about but deliberately refused to offer,
reserved from back when no review workflow existed. This lap simply made it real: one entry
added to the list of steps, and one line in the burner that picks the step from the ticket's
kind rather than assuming every ticket is an implementation. Everything else — the settings
field, the validation, the picker row, the persistence — fell out of machinery that was
already there. Three tests that existed only to assert the old refusal were rewritten to
assert the new behaviour.

Two things are worth your attention before you rely on it. First, if the project you are
burning has its own model pinned, this setting does nothing at all: a project model outranks
every per-step model, so reviewer and implementers collapse back onto one model — precisely
the situation you asked to escape. The overlay does say so in its body text, but it is easy
to miss, and it means the feature works today only on projects that have not pinned a model.
Second, choosing a reviewer on a runtime you are logged into interactively but hold no API
key for will fail the review before it starts, on any container sandbox — the credential
gate checks every ticket, even though a review always runs on your already-authenticated
host. That bug predates this lap but this is the change that makes it easy to hit, and the
fix is a one-line exemption.

There is also a quiet behaviour change nobody flagged in the change itself: if you had set a
model for the "Implement" step, your reviewer was previously using it, and from now on it
will use your default model instead until you set a review model explicitly. Defensible, and
probably what you want, but the code comments claim the opposite so it would have gone
unnoticed.

I could not drive the app for this review — the drive refused to start because the run's own
scaffolding files left the working tree dirty. So the Review row is confirmed by reading the
code and by the test suite (clean typecheck, 256 tests green across the four affected files)
but has not actually been seen rendered in the picker by anyone yet. That is the one thing
worth eyeballing yourself.
