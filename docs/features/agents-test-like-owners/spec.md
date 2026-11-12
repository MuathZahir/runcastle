# Agents test like owners

## Problem

A feature agent can change code, drive the app, find an issue, fix it and drive again for over an hour, and nothing tells it to stop. The human assumes all is well while it goes round. The loop is also expensive: it runs in the lead's own chat, on its strongest model, with a context that grows every round. And an agent stuck on one bug rarely zooms out to ask whether the approach itself is wrong, or to change it, the way an owner of the project would.

## Approach

**What the human sees.** Feature agents check their own work through a cheap helper, so the lead's chat stays small. When a fix fails twice, the agent says in one line that it is stepping back and whether it keeps or changes its approach. When a problem survives three fixes, the agent stops all work on the feature and tells the human the problem, each try and what its check showed, what it thinks is wrong and the direction it recommends. The human gets a "stuck" wait, which runcastle already pings to their desktop and phone. The agent changes how things are built on its own, with one line saying what and why. It asks first when a change would alter what the human gets, or would cost them money, a setup step or their data. Problems it notices outside the feature come to the human as one-line offers to park them in the backlog, gathered into the next message rather than breaking off work.

**Shape.** This is guidance text, plus one line in the worker briefing:

- **The feature skill's main file** gains a short "own the work" section. It holds:
  - the counting rule: one count per problem, shared by the lead's own fixes and its send-backs of a worker; any check (drive, test, typecheck, build) counts; only the same problem adds up; a new direction from the human resets the count to zero
  - the one-line step-back after the second failed round, and the stop after the third (decisions 2, 3, 6, 7, 13, 18, 20)
  - the line between how and what, with the exceptions that still come to the human (decisions 4, 14, 19)
  - the nearby-problem offer (decisions 5, 15)
  - a pointer to the new reference file

  It replaces today's "Runaway guard" bullet under "When to ask, and when to stop", and keeps that bullet's exact `stuck` wait call, which a test pins. The file ends no longer than it is today: room is made by tightening other passages, never by dropping a rule.
- **A new reference file in the feature skill** (for example `references/checking-your-work.md`), read the first time the lead checks its own work. It covers:
  - how to pick the helper's model from the human's model notes (decision 9)
  - what to hand the helper: where to start (the feature's own scenario when one can be run, else a page, route or command), the steps, and what each step should show
  - how the helper drives each project shape: `agent-browser` against the lead's dev server for a web app, running commands for a CLI or API, and no helper when nothing can be driven (decision 12)
  - the helper's report: per step expected or not, anything odd, errors, screenshot paths. The helper never edits code (decision 11).
  - which screenshots the lead opens: failed or odd steps, plus the last one of a drive it calls a pass
  - what a stop message holds, and that it uses `wait_for_you` with the `stuck` kind, or `hand_back` when an orchestrator chat owns the feature

  It reuses the existing "screenshot critique loop" and "Look at your own screens" patterns rather than restating them. Every self-check drive goes to the helper, the first included (decision 10).
- **The worker briefing** (the text the server writes into every sandboxed worker's system prompt) gains one rule under "How you work" (decision 8). After the second failed try at the same problem, the worker steps back and rethinks the approach. After the third, it stops: a worker working on its own hands back with what it tried and what each try showed, and a worker working with the human tells the human. The review worker's briefing is untouched.
- **`workers.md`**, the reference on handling workers, says in its send-back section that send-backs count toward the problem's count.

The lead writes all of this itself: it is a few hundred words of text and one string. It ends with a Review worker in checks-only mode, since there is no screen to drive.

## Seams

- **The feature skill's content test** (existing). It asserts exact phrases in the skill and its references. New assertions:
  - the step-back and stop rule
  - the how/what line
  - the `stuck` wait string (kept)
  - the pointer to the new reference file
  - the helper's never-edits-code rule
  - the old runaway-guard sentence is gone
- **The worker briefing test** (existing; the tests of the worker briefing function). Asserts the new rule appears for both worker kinds that take assignments and for the human-started kind, and not in the review worker's briefing.
- **The never-guess test** (existing). It must stay green: the never-guess paragraph is not edited anywhere.
- **The skill-packaging tests** (existing: skills-root, plugin-dir, Codex workers). These must stay green: they copy every reference file, so the new file must ship without changes to the packaging.
- **Size check** (no test): the main skill file's character count after the change is no larger than on the base branch, measured and reported in the ready message.

## Out of scope

- Review speed and the Review worker's own driving. That belongs to "Faster, cheaper reviews", and a Review worker stays one agent.
- Feature scenarios themselves: how they are made, run or picked. That belongs to "Each feature's own scenarios". This guidance only uses one when it exists.
- Any server machinery: no counters, no enforced stop, no new tool, no new wait kind.
- The orchestrator's skill. It sits at its tested size cap and is not touched.
- Workers handing their own drives to a helper (decision 17).
- Headless planning runs and the human's own test drive.

## Open questions

- Whether a step-back or stop rule ever needs enforcing in the server, if agents prove not to follow the text. This is deferred until there is evidence.
- The reference file's final name is the lead's to settle while building.
