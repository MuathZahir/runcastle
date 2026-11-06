# Decisions — The orchestrator prepares the project

Planned without the human (a headless planning run, 2026-11-05). Every decision
marked **Assumed.** is the lead's own pick, open to the human's change. One
independent challenger read the brief and these decisions; where it changed a
decision the decision says so, and where it disagreed and lost, a
**Challenged:** line carries its reason.

Check first: 1, 3, 4, 13

## 1. "Start the project" is the opening of every new project
**Decision:** A project whose orchestrator has never had a chat opens on a "Start the project" moment in place of today's empty orchestrator chat ("What are we building?"). It shows for every new project, empty repo or not. Clicking it starts the orchestrator's first chat at once, and the orchestrator speaks first. Once any orchestrator chat exists, the project home is the orchestrator chat, as today.
**Why:** One door for every new project. Whether to prepare is the orchestrator's call, made from the repo, not the UI's, so the UI needs no notion of "prepared" at all.
**Assumed.** Alternative: show the button only on unprepared repos with code, and keep "What are we building?" for empty repos.

## 2. A prepared setting is "open" until it has a value or a recorded "none"
**Decision:** A key (one of the eight prepared settings) is open when it has no value and no finding, the provenance record `record_finding` writes. `record_finding` learns to record a deliberate "none", an empty value with evidence such as "this repo has no database", which closes the key without a value. The old rule "a preparation session has ended, so the project counts as prepared" is deleted, and so is the "Prepared on" date it produced. Clearing a key by hand still hands it back, as today.
**Why:** Some keys are legitimately empty forever. The old rule papered over that with "a session ended", which also fired when the human closed the chat halfway. Recording "none" says what was actually decided, key by key.
**Assumed.** Alternative: a single project-level "prepared" stamp the orchestrator sets when it finishes.

## 3. The orchestrator prepares first on a project with code, open keys and no features yet
**Decision:** At the start of every orchestrator chat, the server's start-of-session note tells it which keys are open and whether the repo is empty. If the repo has code, keys are open and the project has never had a feature, it does not open with "What are we building?": it reads the repo, says in a few lines what it understood, works through the open keys, closes with the dry-run drive, and only then asks what we are building. On a project that already has features, open keys get one line in its opening ("Dev server and test-drive setup aren't set yet; want me to set them up?"), and it prepares when the human agrees. An empty repo, or nothing open, opens as today. Either way this is an exception to the orchestrator's "open by asking" rule, not a reversal of it.
**Why:** The human chose prepare first, because features built before preparation have no working drive; that is the new-project moment. On a project already in use, taking over every chat because one key is open would nag. Keying on open keys rather than "first chat" means a chat closed halfway picks up where it left off, and a born-empty project is prepared at the first chat after code appears.
**Assumed.** Alternative: take over any chat on a project with code while any key is open.
**Changed after the challenge:** the lead first keyed the takeover on open keys alone, with a migration marking old projects prepared; the challenger showed that migration would invent "none" records nobody decided, and that keying on "no features yet" avoids it.

## 4. Preparation commits land on the main branch before the dry run and before a feature starts
**Decision:** The orchestrator writes the drive scripts (`.runcastle/`) in its own worktree and commits them there, as it commits everything. Starting the dry-run drive first lands the orchestrator's commits onto the project's base branch (the same landing a closing orchestrator chat does today), then drives the human's checkout as the old preparation did. Starting a feature lands them the same way before its branch is cut. The landing behaves like a `git pull` into the human's checkout: it is refused, never stashed or forced, when it would conflict, when the human's own uncommitted edits touch the same files, or when the checkout is on another branch; the orchestrator says why and asks the human to switch or commit. This also lands the orchestrator's other commits early, such as charter edits and draft briefs.
**Why:** Every drive runs in the human's checkout, so that is where the scripts must be proven. Features cut from main after preparation need the scripts on main too, and today the orchestrator's commits only arrive there when its chat closes. Reusing the existing landing adds no new git machinery.
**Assumed.** Alternative: run the dry-run drive inside the orchestrator's own worktree and leave landing at chat close.
**Challenged:** the worktree option deserves a real look, since it would prove the scripts in a clean copy without touching the human's checkout. The lead kept landing, because features cut from main would still lack the scripts, and every real drive runs in the checkout.

## 5. Preparation's tools and method move into the orchestrator for good
**Decision:** The dry-run drive tool (`dry_run_drive`) is offered to the orchestrator. The preparation method (the eight keys, the drive contract, the environment audit, the sandbox image, the dry run) moves from the `runcastle:prepare` skill into a reference file of the `runcastle:project` skill, read when preparation is due or a setting looks wrong. Commands it proves outside the dry run (install, the verify commands) run in its own worktree, never in the human's checkout.
**Why:** The brief: preparation tools live with the orchestrator for good, so it can fix a wrong setting the moment it sees one. A reference file loads only when needed, so chats that never prepare pay nothing for it.

## 6. The preparation session and its screens are deleted
**Decision:** Deleted: the `prepare` session kind, its launcher and resume paths, its entry skill, the Preparation page, the "Prepare / Re-prepare this project" row in the sidebar and the command palette, the preparation-only start-of-session note, and the special cases in the guards that exist for it. The buttons that opened Preparation ("Prepare drive" on the project drive, "Open preparation" on a failed drive) open a new orchestrator chat instead; the drive-fix chat stays the door for a drive whose scripts break. A running dry-run drive shows in the orchestrator's drive panel like any project drive, with its Stop. The project settings page keeps its read-only list of prepared settings with their provenance.
**Why:** The brief: prefer deleting machinery over carrying it.

## 7. The model step "Prepare" stays, renamed for what still uses it
**Decision:** The model-roster step `prepare` (Settings › Models) keeps choosing the model for the two host-side chats that remain, the scenario chat and the drive-fix chat. Its label changes from "Prepare" to "Drive chats". Preparation itself runs on the orchestrator's model.
**Why:** The step already serves those two kinds; removing it would silently move them onto another step's model.
**Assumed.** Alternative: drop the step and run scenario and drive-fix chats on the orchestrator's model.

## 8. The human can put preparation off, and preparation that can't finish moves on
**Decision:** The orchestrator works out what it can by reading and running things itself, asks only what it cannot find (a secret, a choice between two dev commands, whether the human uses Docker here), asks before anything that starts services or creates a database, and ends with one short summary to confirm. If the human says "later", it stops preparing for that chat and answers what they asked. A key it cannot settle (a missing secret, Docker down, a dry run that keeps failing) stays open with the reason said in the chat, and it moves on to what we are building.
**Why:** Smooth onboarding is the point of the feature; a preparation that holds the human hostage or asks eight questions is worse than the separate session it replaces.
**Assumed.** Alternative: preparation must finish before the orchestrator takes any other request.

## 9. A drive learns which scenario it was started for
**Decision:** When a drive is started with a scenario, its drive setup script receives that scenario's file as `RUNCASTLE_SCENARIO`, beside the identity variables it gets today. This is general runcastle machinery, documented in the drive contract, so any project's setup can shape itself for a scenario. Runcastle's own drive setup uses it: for the onboarding scenario it starts the drive's data folder empty (no copy of the owner's database, `config.json` or `.env`) and gives the drive's server a private, empty git config file instead of the owner's.
**Why:** A scenario runs after the app boots, against what setup made; "start from a brand-new install" has to be decided before boot. One variable is the smallest door, and it changes nothing for drives started without a scenario.
**Assumed.** Alternative: the scenario empties the copied database after boot (it cannot undo config already loaded, and the owner's git identity would still make the wizard skip itself).

## 10. "Brand-new install" means new to runcastle, with the owner's real coding-agent login
**Decision:** The onboarding drive shows the setup wizard because its server sees no git identity (the private, empty git config of decision 9) and no saved settings. It keeps the machine's real Claude Code (and Codex) login, so the wizard's coding-agent step finds it ready and the orchestrator can actually run after "Start the project". The name and email typed into the wizard go to the drive's private git config, never the owner's.
**Why:** The wizard decides "set up" from checks on the machine, not from the data folder, so an empty data folder alone shows nothing. Hiding the agent login too would make the wizard look newer but leave the orchestrator unable to start, which is the half of the drive the human is judging.
**Superseded by 15:** the human kept the coding-agent login and the git identity both.

## 11. The sample repo is a small app committed with the scenario
**Decision:** A small, dependency-free Bun app (a notes web app with a SQLite file, a dev server and a test) lives as a scenario fixture in runcastle's repo. The onboarding scenario copies it into the drive's data folder as a fresh git repo with one commit and lands the human on the setup wizard. The wizard's own "open a project" step is where they open it, at a path the scenario prints.
**Why:** Real code with a dev server, a test and a database gives preparation every kind of key to work on. No dependencies keeps the drive fast and offline; living in the repo keeps it versioned with the scenario.
**Assumed.** Alternative: clone a small public repo from GitHub at drive time.

## 12. The orchestrator can start a drive on a scenario
**Decision:** The orchestrator's `drive` tool takes an optional scenario, as the human's Test drive button already does, so it can start the onboarding drive itself at the checkpoint the human set.
**Why:** The brief's working agreement: the orchestrator starts the onboarding drive and tells the human what to try.

## 13. Old preparation chats are deleted; old links land on the project home
**Decision:** The migration that removes the `prepare` kind deletes the old preparation chats (their rows and saved logs). A saved link to a project's Preparation page opens the project home. The settings and provenance those chats recorded are untouched. The orchestrator names this in its notes at the onboarding checkpoint, since it cannot be undone.
**Why:** What a preparation chat established lives on in the settings and their evidence; the chat itself is history nobody reopens, and keeping it readable would keep a whole session kind alive for it.
**Assumed.** Alternative: keep them as read-only history in the orchestrator's list of past chats.

## 14. Preparation's progress is told in the chat, with no new card
**Decision:** The orchestrator chat gets no preparation card or side list. The orchestrator says what it set as it goes and closes with the summary of decision 8; the settings page keeps the full record with provenance. The old Preparation page's list and its "dry run in progress" strip are deleted with it.
**Why:** The brief says delete machinery, and the one thing the old page held that has no other home, a Stop for a dry run left running, now lives on the drive panel (decision 6).
**Assumed.** Alternative: move the old page's list into the orchestrator's side panel as a Preparation card.
**Changed after the challenge:** the lead first planned that card; the challenger pointed out it is new UI in a feature about deleting UI, and that the Stop fits the existing drive panel.

## 15. The onboarding drive keeps the owner's git identity
**Decision:** The brand-new-install drive still starts with no database, `config.json` or `.env` of the owner's, but no longer hides git identity: the drive's server uses the machine's own git config. With git and a coding agent ready, the setup wizard is skipped, exactly as for a typical new user. The wizard's git identity step stays as it is for people who genuinely have none (git cannot commit without one).
**Why:** The human's call from the onboarding drive: hiding the identity forced a "Set your git identity" step most new users never see, which misrepresents their first minutes and read as a step that would push people away.
Supersedes: 10.

## 16. The usage ping is on by default and nobody is asked at the start
**Decision:** The wizard's intro step loses its "Send the usage ping" checkbox. An install that has never set the switch counts as on, so it pings from its first boot, and no notice or banner asks about it later. The off switch stays in Settings › General, and `DO_NOT_TRACK` still wins over everything. The README says so.
**Why:** The human's call from the onboarding drive: the user is never asked at the start, and anyone who minds can turn it off in Settings. Removing only the checkbox would have left a fresh install silent until it passed a step most users now skip (decision 15), and the old once-only "counts this install" banner would have asked every new user on their second visit.

## 17. On a new project the orchestrator talks about the user's app, in plain words
**Decision:** When the orchestrator sets a new project up, everything it says is for someone who has never seen runcastle. It opens with what it understood of their app and one sentence on why it is checking things first ("Before we build anything I'll check I can run your app and its tests, so every change can be tried for real. It takes a minute."). It never says runcastle's builder words to them unexplained (preparation, settings or keys, drive, dry run, gate, scenario, verified, closed, none) and says what it does instead ("I can start your app", "your tests pass"). It asks only what it truly needs, each question with a one-sentence why. It closes with what they can now do ("All set: I can start your app, run your tests, and let you try changes in a test drive. What do you want to build?"), not the list of what it recorded; that record stays in Settings › This project.
**Why:** The human's call from the onboarding drive: the first chat said "preparation", "all eight settings are closed", "the whole gate" and listed every key, and a new user would have no idea what was going on.
