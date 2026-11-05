# The orchestrator prepares the project

## Problem

A new project with code lands on a separate Preparation page, with its own kind of chat (the `prepare` session) whose only job is to establish the project's host settings: the dev command, the test-drive setup and stop scripts, the dev-database reset, the sandbox's setup and verify commands, the known failures and the drive instructions. Then the human has to find the orchestrator, a different chat, to say what they want to build. That is two doors where one would do, one more session kind to keep alive, and an onboarding that makes a new user learn runcastle's internals before they have built anything. Preparation also belongs to the past: once that chat ends, nothing fixes a setting that later turns out wrong unless the human remembers to "Re-prepare".

## Approach

**What the human sees.** A new project (no orchestrator chat yet) opens on "Start the project": the project's name, one line on what happens next, and one primary button (designed: `apps/web/src/components/project/StartTheProject.tsx`, design page `/preview/start-the-project.html`, samples `code` and `empty`). Clicking it starts the orchestrator's first chat with no message from the human; the orchestrator speaks first. On a repo with code it reads the repo, says in a few lines what it understood, works through the open settings (asking only what it cannot find, and asking before it starts services or creates a database), runs the dry-run drive, sums up, and then asks what we are building. On an empty repo it asks straight away. There is no Preparation page, no "Prepare this project" row and no preparation chat any more. Buttons that used to open Preparation open a new orchestrator chat.

**When the orchestrator prepares.** A prepared key is *open* when it has no value and no finding (the provenance row `record_finding` writes). `record_finding` accepts a deliberate "none": an empty value with evidence, which closes the key with no value. At the start of every orchestrator chat, the server's start-of-session note (the `SessionStart` hook digest, today given to `prepare` sessions only) carries the open keys, whether the repo is empty, and whether the project has ever had a feature. The `runcastle:project` skill reads it:

- code + open keys + no feature ever → prepare first (the takeover above);
- code + open keys + features exist → one line in the opening offering to set them up;
- empty repo or nothing open → open as today.

The human can say "later" and the orchestrator drops preparation for that chat. A key it cannot settle stays open with the reason given in chat. The old "a prepare session has ended, so it is prepared" rule (`isPrepared`) and the `preparedAt` date are deleted; nothing in the UI asks "is this project prepared?" any more. The web reads only `empty` and the findings from `project.prep`; `prepared`, `preparedAt` and `dryRun` leave that view.

**Where the scripts are written and proven.** The orchestrator works in its own worktree on `runcastle/project`; drives run in the human's checkout. So:

- The orchestrator writes `.runcastle/` drive machinery in its worktree and commits it like any of its work.
- `dry_run_drive({ action: 'start' })`, now offered to the orchestrator (`project` kind) and no other, first lands `runcastle/project` onto the base branch with the existing landing (`landProjectBranch` → `mergeTempBranch`, the same path a closing orchestrator chat takes), then drives the human's checkout exactly as before. `start_feature` lands the same way before it cuts the feature branch.
- The landing behaves like a `git pull`: it is refused, never stashed or forced, on a conflict, when the human's uncommitted edits touch the same files, or when the checkout is not on the base branch. The tool's refusal names the reason so the orchestrator can ask the human to switch or commit. A successful mid-chat landing reports on the project timeline as landings already do.
- Commands the orchestrator proves outside the dry run (install, verify commands, known failures) run in its own worktree.

**The method moves.** The `runcastle:prepare` skill's content (the eight keys, the drive contract, scenarios, discovering the shape, the env-loading audit, the sandbox image, recording, the dry run) becomes `packages/skills/packs/runcastle/skills/project/references/preparation.md`, rewritten for the orchestrator: no "you may write only `.runcastle/`" exception (the orchestrator writes the whole repo from its worktree), the landing-before-dry-run step, the "later" and "can't finish" rules, and recording "none". The project skill's §0 ("Open by asking") gains the exception and points at that reference. The `prepare` skill directory is deleted, and its entry-skill wiring with it.

**What is deleted.** The `prepare` session kind (`SESSION_KINDS`, `PROJECT_SESSION_KINDS`), its launcher, resume and kickoff paths, `project.talkToPrep` / `project.prepSession`, the `prepare` arm of `thread.new`'s kind enum, the checkout guard's and edit guard's `prepare` cases, the hooks' preparation noun and digest arm (moved to the project arm, reshaped as above), the MCP audience entries naming `prepare`, and on the web: `PreparationWorkspace`, the `prepare` workspace view and `/p/<id>/prepare` route (a saved link opens the project home), the `preparing` workspace state, `PrepRow` and the Re-prepare menu item, the command-palette Preparation row, the glossary's preparation entry, `sessionKindName`'s prepare arm, the `prepare` role in chat sessions, and the dry-run strip with its "Stop it from Preparation" wording. A dry run in progress shows on the orchestrator's drive panel like a project drive, with its Stop. A database migration deletes `prepare` session rows and their saved logs; findings are untouched. The model-roster step `prepare` stays (scenario and drive-fix chats run on it) and is labelled "Drive chats".

**The onboarding drive.** A drive started with a scenario passes the scenario file to the drive setup hook as `RUNCASTLE_SCENARIO` (both `testDrive` and `projectDrive`, and the drive contract in the preparation reference documents it). Runcastle's own `.runcastle/drive-setup.ts` checks it: for `.runcastle/scenarios/onboarding/brand-new-install.ts` it skips copying the owner's database, `config.json` and `.env`, and writes `GIT_CONFIG_GLOBAL=<drive data dir>/gitconfig` (an empty file) and `GIT_CONFIG_NOSYSTEM=1` into `.runcastle/drive.env`, so the drive's server sees no git identity and shows the setup wizard. The real coding-agent login is kept. The scenario copies a small, dependency-free Bun notes app (a fixture under `.runcastle/scenarios/_fixtures/`) into the drive's data folder as a fresh git repo with one commit, prints the repo's path, and prints `ENTRY_URL=/`, which lands on the wizard. The human walks the wizard, opens the sample repo in its last step, lands on "Start the project", and watches the orchestrator prepare it. The orchestrator's `drive` tool takes an optional `scenario`, so it can start this drive itself at the human's checkpoint.

## Seams

- **`record_finding` and `keysToPrepare` (existing).** Recording a "none" closes a key; clearing a key by hand reopens it; open keys are exactly the keys with no value and no finding.
- **The `SessionStart` hook for a `project` session (existing route, new content).** Observe the digest: open keys, empty repo, ever-had-a-feature, for each combination in the Approach.
- **`dry_run_drive` and `start_feature` MCP tools (existing).** Offered to `project` only; start lands `runcastle/project` first; refusals on conflict, overlapping dirty files and wrong branch; the existing stamps after a clean pass.
- **`project.talkToProject` without `holdOpening` (existing procedure).** The Start button calls it; the session launches with its kickoff line and no human message, so the orchestrator's first turn is its own. (The designed wiring calls `thread.new`, which only creates the row; the ticket switches it.)
- **`workspaceView` / `ProjectWorkspace` (existing).** A project with no orchestrator chat renders `StartTheProject`; no input ever yields a prepare view; `/p/<id>/prepare` parses to the project home.
- **Drive setup environment (existing `driveIdentityEnv`, new variable).** `RUNCASTLE_SCENARIO` is present exactly when a drive was started with a scenario.
- **The onboarding drive itself (new scenario).** Started from the drive menu or the orchestrator's `drive` tool: wizard, sample repo, Start the project, preparation.
- **The DB migration (new).** No `prepare` session rows remain; findings unchanged.

## Out of scope

- The setup wizard's own design: it stays as is; anything rough the drive shows goes back as more rounds.
- The `scenario` and `drive-fix` session kinds stay as they are.
- The project settings page's provenance list stays, read-only.
- Prompting an orchestrator chat that is already open when a born-empty project first gets code; the next chat prepares it.
- A fully separate home folder for the onboarding drive (agent logged out too).

## Open questions

- Runcastle's own project has no scenario runner recorded today (`bun {file}` would do). The onboarding drive needs one before its scenario can run; the human sets it in project settings, or the first ＋ New scenario chat does.
- The two "Start the project" designs and their one open Tweak (the three numbered steps shown or not) wait for the human's approval.
