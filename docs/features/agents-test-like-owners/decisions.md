# Decisions — Agents test like owners

Planned without the human (a headless planning run). Decisions 1–5 were settled with the human in the brief; the rest are the lead's assumptions, to be checked.

Check first: 7, 8, 10, 13, 19

## 1. Repeated drives go to a Haiku helper
**Decision:** When the lead drives the app to check its own work, a helper agent on Haiku does the driving: it opens the scenario or page, does the steps the lead gives, screenshots each major step, and reports what it saw. The lead reads the report and the screenshots that matter, then fixes.
**Why:** The drive-fix loop runs in the lead's own chat, on its strongest model, with a context that grows every round. Clicking is mechanical work.

## 2. Step back after the second failed round
**Decision:** Before a third fix, the agent asks whether the problem is this bug or the approach: what the failures have in common, and whether a different design makes the problem go away instead of patching it.
**Why:** Agents get stuck on one issue instead of zooming out; sometimes the answer is to change the approach.

## 3. Stop after three
**Decision:** After 3 rounds of fix and re-check on the same problem without fixing it, the agent stops, tells the human what was tried, what each check showed and what it thinks is wrong, and waits.
**Why:** The human watched an agent loop for over an hour while assuming all was well.

## 4. Free to change how, asks before changing what
**Decision:** Rewriting how something works under the hood, switching a library, or throwing away its own code is the agent's call; it tells the human in one line what it changed and why. Anything that changes what the human gets (a different screen or behaviour, a dropped requirement, going against something they decided) is brought to them with the problem and a recommended new direction, and they decide. The line is the same one as "never guess what, where or who".
**Why:** The human wants the agent to act like an owner of the project, not a ticket-taker, without taking their decisions from them.

## 5. Owner outside the task too
**Decision:** When the agent notices something broken or badly built nearby, it says so and offers to add it to the backlog as a new feature. It neither ignores it nor quietly fixes it inside this feature.
**Why:** An owner notices; a feature stays one feature.

## 6. Every kind of check counts, not only drives
**Decision:** A "round" is one fix followed by any check that shows the same problem is still there: a drive, a failing test, a typecheck error, a build error. The step-back after two and the stop after three apply to all of them. Only failures of the same problem add up: an unrelated error that a check turns up starts its own count.
**Why:** Looping on a failing test is the same trap as looping on a drive, and just as costly.
**Assumed.** Alternative: count only fix-and-re-drive rounds, as the brief's words say.
**For the human.** Agents will stop and ask about stubborn test or type failures too, not only about what a drive shows.

## 7. One count per problem, and it replaces the old runaway guard
**Decision:** The lead keeps one count per problem, whoever made the try: its own fixes and the times it sent a worker back on that problem add up together. The rule "step back after the second, stop after the third" replaces today's runaway guard, which stops before a third send-back. A third try is now allowed only after the step-back, and the stop after it uses the same "stuck" wait as today.
**Why:** Two rules with different counts for the same situation would confuse the agent. Allowing a third try that takes a different approach is the point of the step-back.
**Assumed.** Alternative: keep the old guard for workers sent back (stop before a third), and apply the new rule to the lead's own fixes only.
**Challenged:** The human asked for a rule on the agent's own loops, not for loosening the cost control on workers, which cost real money; keep the stricter guard for them.
**For the human.** A worker that keeps failing now gets one more try than today before you hear about it, but only with a changed approach.

## 8. Workers carry the same rule in their own briefing
**Decision:** The text every sandboxed worker starts with (the worker briefing) gains one rule: after the second failed try at the same problem, step back and rethink the approach; after the third, stop. A worker working on its own hands back to the lead with what it tried and what each try showed; a worker working with the human tells the human in its chat. The briefing is a text string inside the server code, so this one line is the only code change in the feature.
**Why:** The brief asks to carry the same spirit to workers without new machinery. A worker loops the same way a lead does, and the briefing is the only text a worker is sure to read. A line of text is not machinery.
**Assumed.** Alternative: leave workers alone and rely on the lead's count when it sends them back (decision 7).
**For the human.** Workers will stop and hand back sooner when stuck, instead of going on alone.

## 9. The helper's model comes from the human's model notes
**Decision:** The lead picks the helper's model from the human's notes on their models: the one whose note fits simple, mechanical work, which is Haiku in this project. With no notes, it names Haiku where the runtime offers it, and otherwise the smallest model it can name.
**Why:** It keeps the human's choice of Haiku here, and works for every runcastle user, whatever models they set up.
**Assumed.** Alternative: always name Haiku.

## 10. Every self-check drive goes to the helper, the first included
**Decision:** The lead never drives the app in its own window to check its work: the first drive goes to the helper too, not only the repeats.
**Why:** One rule is easier to follow than "the second time, switch". The first drive costs the same context as the later ones, and the lead often cannot know a drive will repeat.
**Assumed.** Alternative: the lead drives the first time itself and hands only repeats to the helper, as the brief's words say.
**Challenged:** The human agreed to "repeated drives"; a first quick look by the lead's own eyes catches things a small model misses, and writing the helper's steps has a setup cost. Follow the brief's words or ask.
**For the human.** You will see the lead hand off even a single check drive; it costs less and the lead's chat stays smaller.

## 11. The helper drives and reports; the lead judges and fixes
**Decision:** The lead gives the helper where to start, the steps, and what each step should show. The helper does the steps, screenshots each major step, and returns a short report: for each step whether it showed what was expected, anything odd, console or server errors, and the screenshot paths. It never edits code and never decides whether the feature is done. The lead opens the screenshots of steps that failed or look odd, and the last screenshot of a drive it is about to call a pass, so a helper's false pass is caught.
**Why:** Judging needs the strong model and the feature's context; clicking does not. Keeping the helper away from code keeps one place where fixes happen.
**Assumed.** Alternative: the helper also tries small fixes.

## 12. The helper drives whatever this project is
**Decision:** It starts from the feature's own scenario when one can be run here, and otherwise from the page or route. For a web app it uses `agent-browser` against the lead's own dev server. For a command-line tool or an API it runs the commands and reports their output. When nothing can be driven here (no `agent-browser`, nothing to run), there is no helper: the lead relies on the project's checks and says so.
**Why:** Runcastle is used on projects of every language and shape. Scenarios belong to the "Each feature's own scenarios" feature, so this guidance must work with or without one.
**Assumed.** Alternative: web apps only.

## 13. A stop halts the lead's own work, not workers on other parts
**Decision:** When the lead reaches the third failed round, it stops its own work on the feature and starts nothing new. It tells the human the problem, each try and what its check showed, what it thinks is wrong, and the direction it recommends. Then it waits with the "stuck" wait, under an orchestrator chat too: the feature skill already sends anything only the human can decide, a stuck worker among them, to the human directly. Workers already at work on parts that do not depend on the stuck problem finish their current assignment and are not stopped. Their handbacks are landed or held as usual, but the lead sends none of them on new work until the human answers.
**Why:** The worry that the approach is wrong applies only to the parts that depend on the stuck one; halting independent workers wastes the human's time. Telling the human at once is still the point of the rule.
**Assumed.** Alternative: stop everything, workers included; or carry on with independent parts of the lead's own work too, then stop.
**Changed by the orchestrator:** it first read "stop all work on the feature"; the orchestrator let independent workers finish, since halting them wastes the human's time.
**For the human.** When you hear "stuck", the lead has stopped, but workers on unrelated parts may still finish what they were doing.

## 14. A change of approach never starts a new worker without a yes
**Decision:** Changing how something is built is the agent's call (decision 4) when it does the new approach itself or sends an existing worker back with it. Starting a worker the agreed plan did not name still needs the human's yes, as it does today.
**Why:** Workers cost money and the human can watch them; the plan yes is the one approval runcastle has. An owner can change the approach without changing the team.
**Assumed.** Alternative: an approach change may start the workers it needs, with a one-line note.
**For the human.** A pivot that needs more workers still comes to you first.

## 15. Nearby problems: the lead offers, workers report
**Decision:** The lead offers in chat to park the problem it noticed as a backlog feature, and parks it (a draft feature) only on the human's yes. The lead gathers these into its next message to the human rather than breaking off its work for each. A worker working on its own names it in its handback, and the lead offers it. A worker working with the human asks the human in its chat and parks it on their yes, with the tool it already has. A problem that blocks this feature is not backlog: it is this feature's, and decision 4 decides who chooses the fix.
**Why:** The brief says "offers". Parking without asking would fill the backlog with things the human never wanted.
**Assumed.** Alternative: park it straight away as a draft, which the human can delete.
**For the human.** You get one line and an offer for each problem noticed; nothing lands in your backlog without your yes.

## 16. The rules live in the feature skill; the helper recipe in a reference file
**Decision:** The feature skill's main file (`SKILL.md`) gets a short "own the work" section with the counts, the how-or-what line and the nearby-problem offer. It replaces the old runaway guard bullet. A new reference file carries how to brief the helper and what a stop message holds, read when the lead first checks its work. `SKILL.md` ends no longer than it is today: room is made by tightening other text. The orchestrator's skill is not touched.
**Why:** The rules must be in front of the agent at all times; the recipe is needed only at the moment of a drive. Only the orchestrator's skill has a tested size cap (26,700 characters, and it is at the cap). The feature skill has no cap, but it is read in every feature chat, so it should not grow.
**Assumed.** Alternative: put everything in `SKILL.md`, or add a size cap test for it.

## 17. Workers do not get their own helper
**Decision:** Workers keep driving their own work themselves. Only the lead hands drives to a helper.
**Why:** The brief places the helper on the lead's repeated drives. A worker's context is thrown away when it hands back, so the growing-context cost is smaller there, and a worker's briefing grows only by decision 8's line.
**Assumed.** Alternative: workers also hand their drives to a helper.

## 18. The step-back is said out loud
**Decision:** When the agent reaches the second failed round on a problem, it says so in one chat line before the third try: the problem, that two fixes failed, and whether it is keeping the approach or changing it and why. It keeps no running tally otherwise.
**Why:** The human cannot see how the agent counts. One line at the step-back makes the rule visible, and makes it hard to dodge by calling each failure a new problem.
**Assumed.** Alternative: a visible "round N of 3" line after every failed round; or nothing until the stop.
**For the human.** You will see a one-line "stepping back" note in the chat when a fix fails twice.

## 19. Some "how" changes still come to the human
**Decision:** A change of approach that the human would pay for or have to act on is brought to them like a change of what they get: a new paid service, a new account, key or install they must set up, a licence that limits their use, or anything that loses or migrates their data. Switching to a new free library, rewriting code, or throwing away the agent's own work stays the agent's call (decision 4).
**Why:** These are "how" on paper but land on the human: in their bill, their setup or their data. An owner would not make them alone either.
**Assumed.** Alternative: every "how" change is the agent's call, as decision 4 reads.
**For the human.** You will be asked before a pivot adds a cost, a setup step or a risk to your data.

## 20. A new direction from the human starts a fresh count
**Decision:** When the human answers a stop or a step-back with a direction (try this approach, drop that requirement), the count for that problem starts again from zero.
**Why:** The human's direction is a new approach; counting the old failures against it would stop the agent again at once.
**Assumed.** Alternative: the count carries on, so the agent comes back after one more failure.
**For the human.** After you redirect a stuck agent, it gets three fresh tries before it stops again.
