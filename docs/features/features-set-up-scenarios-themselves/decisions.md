# Decisions — Features set up scenarios themselves

Planned without the human (a headless planning run, 2026-11-16). Decisions 1 and
2 are the human's own, from the brief; 3–8 were the lead's picks, confirmed by the
human; 9 is the human's own idea.

All assumed decisions confirmed by the human on 2026-11-16 ("Sounds good").

## 1. A feature's own agents set scenarios up when the project has none
**Decision:** When a feature needs a slow-to-reach state and the project has no scenarios set up, the feature's own agents set them up (the runner command, the drive-only login route, base fixtures, the scenario itself), so its reviews start at that state. This holds for every runcastle project's features. It serves the human, who gets fast reviews and walkthroughs of the fixed state, and the Review worker, which uses the scenarios. It reverses "only the human's first ＋ New scenario chat sets scenarios up" (drive-scenarios decision 5), which assumed the human is at the drive; the human's ＋ New scenario chat still sets them up too.
**Why:** On the human's autopilot project no scenarios ever existed, so every review redid signup and onboarding by hand (20–30 minutes and $0.20–0.50 per live run). The human: "Yes".

## 2. Both reviews stay; the verify review is made fast instead
**Decision:** The full review and the verify review both stay. The second is made fast by starting it from scenarios, not dropped.
**Why:** The human: the walkthrough video "would be kinda useless if they show the state before the fixes".

## 3. The lead does the setup itself, and its Plan says so
**Decision:** The feature's lead sets scenarios up as part of its own work, after the code that builds the slow state and before the first review. It does not hand setup to a worker, and the Review worker still never writes a scenario. When a feature will set scenarios up, its Plan says so in who builds what, so the human (or the epic, on autopilot) sees it before the yes. A worker may still write a plain scenario once setup exists (each-feature-s-own-scenarios decision 5).
**Why:** Setup has to be proven on a real drive with the project's database, and only the lead runs on this machine; sandbox workers cannot reach a drive. The login route is a few lines of app code, too small to justify a worker.
Alternative not taken: a worker writes the setup as one of its jobs and the lead only proves it; or the Review worker sets it up when it finds none.
**The human (2026-11-16):** "Sounds good" — stands as planned.

## 4. "Slow to reach" means anything the person driving would build by hand
**Decision:** A state is slow to reach when someone driving the feature would have to build it by hand before they could see the change: signing up or in, an onboarding flow, or data that takes several steps to create. A copy change, a settings toggle, or a screen the app opens on gets no scenario. This is the same judgement planning already makes (drive-scenarios decision 13), now applied when the project is not set up too.
**Why:** One test the lead already knows. Any app with sign-in qualifies at once, which is exactly the case that cost 20–30 minutes a review.
Alternative not taken: a time threshold (say, more than a minute of clicking), which nobody can measure while planning.
**The human (2026-11-16):** "Sounds good" — stands as planned.

## 5. The lead proves setup on a real drive of its branch before the first review
**Decision:** The lead gets the drive the Review worker already has: it can start a drive of its own feature branch on this machine, run a scenario on it through the same runner the human's picker uses, and stop it. It runs each new scenario once, and a subagent opens the landing in a browser to check it shows the expected state, signed in where the app has sign-in. Only then does it start the review. The lead may also record the project's runner command, as the ＋ New scenario chat does.
**Why:** Decision 5 of drive-scenarios kept setup in front of the human so it would be proven, not written blind. A real drive with a real landing gives the same proof without the human. A setup that breaks inside the review instead costs the very by-hand setup this feature removes, plus a fix round.
Alternative not taken: no new tool; the first review's drive is the proof, and a broken scenario there is a defect the lead fixes before the verify review.
**The human (2026-11-16):** "Sounds good" — stands as planned.

## 6. Setup stays with the project, with one permanent signed-in scenario
**Decision:** The runner command, the login route, the base fixtures and the typecheck covering scenarios merge with the feature and stay. The lead also keeps one base scenario for good: a freshly signed-up user who has finished onboarding, landing on the app's first real screen. Every other scenario the feature wrote still leaves with it unless the human keeps it (each-feature-s-own-scenarios decision 3). A project counts as set up once the runner is recorded and the base branch has the scenarios folder, whether or not it still holds scenarios, so a later feature reuses the setup and never redoes it.
**Why:** Signup plus onboarding is what every later review on that project would otherwise redo, so one kept scenario pays for itself on the next feature. On autopilot nobody says "keep this one", so the lead decides it.
Alternative not taken: everything the feature wrote leaves with it except the runner, login route and fixtures; later features rebuild their landing from the fixtures.
**The human (2026-11-16):** "Sounds good" — stands as planned.

## 7. A state the review had to reach by hand gets a scenario before the verify review
**Decision:** When the full review reports "No scenario reaches <state>" (it already files that observation), the lead writes that scenario, proves it as in decision 5, and only then starts the verify review. The review files the same observation when the feature has no scenarios at all, not only when some exist.
**Why:** This is what makes the verify review fast (decision 2): the second walkthrough starts at the state instead of redoing it.
Alternative not taken: only the states the lead foresaw while planning get scenarios; the verify review reaches any other state by hand.
**The human (2026-11-16):** "Sounds good" — stands as planned.

## 8. A project whose drive cannot carry scenarios is flagged, never stopped
**Decision:** If the lead cannot set scenarios up because the project's drive is not ready for them (it does not start, or its `drive.env` does not carry the database the scenario must seed), the lead says so once (to the human, or to the epic on autopilot), recommends the orchestrator's project preparation, and goes on: the review sets the state up by hand, as today. The lead never changes the project's drive setup itself, and nothing stops a feature before its review.
**Why:** The brief keeps the project's own drive setup out of this feature; preparation is where it is fixed. Stopping a feature over it would stall an autopilot epic for days, which is worse than one slow review.
Alternative not taken: stop the feature before its first review until the drive is prepared; or let the lead fix `drive.env` itself.
**The human (2026-11-16):** "Sounds good" — stands as planned.

## 9. Fixtures form a ladder; scenarios stay thin
**Decision:** Scenario setup builds the shared fixtures as a ladder of steps, each calling its parent (signed up → onboarded → has a plan, and so on), and every scenario is a few lines: call the deepest step it needs, add its own bit, print where to land. When the app changes (a migration, a new signup step), fixing one step fixes every scenario above it. The permanent signed-in scenario of decision 6 is a thin wrapper over the onboarded step. Runcastle itself does not chain scenarios; the ladder lives in the project's own code. Both the lead's setup guidance and the ＋ New scenario chat's setup brief say this.
**Why:** The human: scenarios go stale, and "a single database migration and we would have to update 10s of scenarios"; stacking them on shared ancestors means drift is fixed once. Function calls in the project's language give that tree for free and typed, where runcastle chaining scripts would need a new contract for passing ids and tokens between them. A scenario built from a copy of drive data cannot sit on the ladder; those leave with their feature anyway. The human: "Yes, do it".
