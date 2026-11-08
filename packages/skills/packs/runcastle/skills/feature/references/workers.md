# Workers

Load this when you are about to start, message, land or send back a worker, or
you have just been woken by one. Which work gets a worker is SKILL.md's rule
("Build it the cheapest good way").

A worker is an agent in its own sandbox, on its own copy of the feature branch.
The human can step into any worker and talk to it. It cannot see this chat. It
can read the feature's docs, its designs and your latest turns. Its only way to
change the feature is its handback. `get_feature_context` lists the feature's
workers and their statuses.

## Start one

Start workers on the human's yes to the plan, or to an offer in chat. Nothing
else starts them, and they need no approval each.

`start_worker({ label, purpose, kind, goal, doneWhen, model? })`:

- **label** — the short name the human sees in the sidebar ("Thread list").
- **purpose** — one line on what it is for.
- **kind** — `"with-you"` for taste work, `"on-its-own"` for build work.
- **goal** and **doneWhen** — the assignment, below.
- **model** — only an id from `get_feature_context`'s `annotatedModels`, where
  the human's note plainly fits the job. Otherwise omit it. Never invent an id.

A "with you" worker makes a first pass, then waits for the human. It hands back
only when the human says they are happy or presses **Hand back**. An "on its
own" worker hands back when its done-when is met, and stops only for a real
question.

Where one piece must wait for another, start the second after you land the
first. Pieces that run side by side should touch different files: two on the
same files conflict when you land them. Workers share the machine's limit of
agents working at once; past it they queue and start by themselves.

Without Docker or Podman, `start_worker` says so. Tell the human in plain words
and point them at the setup check (doctor).

## Write the assignment

The worker cannot ask you where things live, so the goal and done-when are
concrete:

- **Name what it needs**: the files to touch, the patterns to copy, the shapes,
  the gotchas, the decisions and spec sections that bind it.
- **State the check.** A worker with no stated check reports success on its own
  terms. Say what is built and what proves it: a test worth writing, a command
  that passes, the screen that shows it. Name the tests that cover the change,
  never the whole suite: you run the project's checks after landing.
- **UI work names its design references**: the project's design docs and this
  feature's designs. Ask it to plan the screen, build it, then critique it
  against those docs with screenshots.
- **A screen in `preview.html`**: point it at one named screen block, never the
  file. It reads only the lines between `<!-- screen:<name> -->` and
  `<!-- /screen:<name> -->`. The block shows the approved look, not the
  implementation: it builds with the project's real components.
- **A designed screen** (committed in design mode): name the component and its
  design page, and say the look is approved. Its job is to connect, never
  restyle: real data in place of the sample, the behaviour the design left out,
  markup changed only where the wiring needs it. The states on the design
  page's switcher are the states it must reach.
- **Hard-to-reach state**: when `scenarios.setUp` is true, the done-when ships
  the scenario (`./tickets.md`, scenarios).
- **One area each.** A worker's cost grows with the square of its context, so a
  job across several packages is two workers, one after the other.

## Talk to it

`message_worker({ workerId, text })` reaches any worker at any time. One sent
mid-turn waits for the turn's end. The human may be talking to it too.

Never ask a worker for its transcript or its work in detail. This chat gains
only handbacks, and that is the point.

## A handback

You are woken once, with a handback card: the worker's summary, which carries
any direction the human gave it, plus its commits and changed files. Trust the
commits over the summary. Then do one of three things:

- **Land it**: `land_worker({ workerId })` lands its branch on the feature
  branch through the landing queue, like your own commits. Resolve any conflict.
  Then run the project's checks yourself, and fix small slips yourself rather
  than sending it back.
- **Send it back**: `send_back_worker({ workerId, note })`, saying concretely
  what is wrong. It returns to working.
- **Drop it**: `drop_worker({ workerId })` removes its sandbox and branch.

Where the human's direction to a worker changes a decision, amend
`decisions.md` and `spec.md` when you land it.

A worker the human started with the "+" has no assignment. It hands back the
same way, and you land, send back or drop it the same way.

A worker that hands back after you declared ready: land it, then declare ready
again.

## The review

The review at the end is a worker labelled **Review**. Start it when the work
is done, every build worker landed or dropped: `start_review({})`. It writes no
code and lands nothing. It runs the project's checks itself, reports each
finding as it goes, and hands back.

- **Its mode is set at start.** Left unset, it drives the app when this
  machine can: on the human's machine, in their checkout, while it holds
  the one drive slot. It waits as queued while the human drives. Otherwise, or
  with `mode: "gates"` (a change with nothing to drive), it reads the diff in
  its own sandbox.
- **Its handback is the Review Package** in your chat: its account,
  screenshots, walkthrough, calls and findings, with the findings listed for
  you. Close each finding with `resolve_finding` (`addressed` or `dismissed`,
  with a note). Fix the defects you judge real, yourself or with workers.
- **Then verify.** Once you fixed some, start a fresh one:
  `start_review({ verify: { findingIds, commits } })`, with only those findings
  and the commits that fixed them. It checks each fix holds and nothing else.
- `send_back_worker` asks a review for more; `drop_worker` closes it. Never
  `land_worker` it.

## A failed worker

When a worker's sandbox dies, its setup fails or its agent crashes, you get one
short message saying what failed. Retry it, drop it, or do the job yourself.
