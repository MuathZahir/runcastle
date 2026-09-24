# Project-level test drive

## Problem

Test drives exist only inside a feature's review. Once several features have shipped, the human wants to drive the *merged whole*, meaning the app as it stands on main with everything landed, and capture what they notice with the same tooling a feature drive has. There is no surface for that today. The workaround is to run the app by hand and re-tell observations later, and by then they have been lost or flattened. The project already has everything a drive needs (drive setup/stop commands, the dev command, preparation's proof of them) and a place for project-scoped observations to go (the project-notes inbox and its triage chat). Nothing connects the two.

## Approach

### What the human sees

The approved UI is the prototype at `docs/features/project-level-test-drive/prototypes/project-drive.html` (published at https://claude.ai/artifact/W4AjzzEXCFRdWp827SZyVG). It is the reference for layout, copy and states. Match it in the app's own primitives and tokens (`apps/web/STYLE.md`).

**The Test drive card.** The project workspace's resting page gains a **Test drive** card between the New chat card and the Notes card. Its button is secondary; New chat stays the page's one solid button. Before any click, the card says what a drive will do:

- the branch the project checkout is currently on, with "your checkout, as it is — no branch switch"
- the identity it will run as (`project-drive`)
- the setup, dev and stop commands that will run, with each unset one shown as "nothing set" and a link to Settings.

The card has these states:

- **hidden**: the project is empty (born-empty: nothing but runcastle's docs).
- **prepare**: neither a setup nor a dev command is set. The button reads **Prepare drive** and opens the preparation workspace instead of starting anything.
- **ready**: the button reads **Test drive**.
- **blocked**: another drive holds the one slot. The button is disabled and names that drive.
- **running**: this project's drive is live. The card reads "running" and its button returns to the drive.

**The drive view.** Starting a drive hands the workspace body to the drive, the way a live project chat takes it over.

The left column holds:

- A header naming the branch being driven and the repo path, with **Project page** (step back to the resting page; the drive keeps running) and **Stop drive**.
- The feature drive's evidence stage: the app in its frame, **Select area** (drag-select screenshot), Reload, Open app ↗.
- The dev-server strip with Show output.

The right column is the project's **notes inbox, live**: notes from this drive first, then the notes that were already open, and a composer at the bottom. Every way of noting during a drive writes an ordinary **project note**: drag-select + text, the composer, and Ctrl/⌘+J. There is no video recording and no annotation player.

A **titlebar pill** shows on every in-project screen while a project drive is live, and clicking it returns to the drive. **Stop drive** tears the drive down and lands on the resting page, where the drive's notes are waiting on the Notes card for triage. Nothing else happens at stop: no summary, no prompt.

**Coexistence with a live project chat.** A live project chat and a project drive run at the same time. While both are up, a **Chat | Drive** switch in the drive header chooses which one fills the body. Neither refuses or ends the other.

**Drive notes are tagged.** A note taken during a drive is tagged `drive · <branch>` (commit on hover) in the rail and on the Notes card.

### Drive failure and unprepared states

- **Only a setup command set, no dev command.** The drive runs setup, and the stage shows the existing "bare" state. The notes rail works as normal.
- **Setup fails.** The stage shows the feature drive's failure state: the command, how it ended, and its output behind a disclosure. The drive stays up and the notes rail keeps working. The feature-scoped **Fix drive** is replaced by **Open preparation**.

### Server shape

**A third kind of drive in the one slot.** The machine-wide, in-memory drive state gains a **project** kind, alongside `feature` and `dryRun`. It is modelled on the preparation dry run, which already runs on the current HEAD with no checkout switch:

- **Start**:
  - Records the checked-out branch, the short HEAD SHA (suffixed `+dirty` when the tree has uncommitted changes) and the start time.
  - Runs the project's setup command with identity `RUNCASTLE_SLUG=project-drive` (so `RUNCASTLE_ID=project_drive`) and `RUNCASTLE_BRANCH=<real branch>`.
  - Reads `.runcastle/drive.env` and spawns the dev pane with the overlay.
  - It does **no branch switch, no worktree detach, and no dirty-tree guard**: the checkout is driven as it is, uncommitted edits included.
- **Stop**:
  - Frees the dev pane.
  - Runs the stop command with the same identity and `drive.env` values.
  - Deletes `drive.env` and clears the state.
  - No branch restore (nothing was switched) and no DB-drift check (no branch change).
- **Events**: start and stop emit project-scoped events, so the project page, the rail and the titlebar invalidate at once.
- **The slot**: a project drive holds the slot exactly like any other drive and nothing preempts it. A new project-scoped tRPC mutation starts and stops it. The existing drive-info query reports it.

**What the drive-info payload adds.** For a project drive, `DriveInfo` names it as one: its `projectId`, and its `commit` and `startedAt` alongside the existing `branch`, dev-pane and hook-failure fields. The UI can then tell a project drive apart from a feature drive and from a dry run, group "this drive" notes, and name the drive wherever it blocks something.

**Blocking drives are named.** Wherever a project drive blocks something, the refusal or disabled state names it ("a project drive of `<branch>` is running") and offers Stop it or a link to it. That covers:

- a feature's Test drive
- the review agent's drive denial (still `slot_held`, still retriable)
- preparation's dry-run start.

There is no idle timeout and no auto-stop.

**Merge.** When a project drive of the same project holds the slot, Merge stops it (running the stop command, as an ordinary Stop does) before merging. That is the treatment merge already gives a drive of the feature being merged. The merge confirmation dialog says so up front. Drives of other features keep today's hard refusal.

**Notes are stamped server-side.** `project_notes` gains two nullable columns, `driveBranch` and `driveCommit`. The project-notes service's one create function stamps both from the live drive state whenever a project drive of **that** project is live, whichever door the note came through. No client passes them. The `ProjectNote` wire type carries both. `list_project_notes` returns them, and the triage reference mentions them, so triage can read "noted while driving main @ 1882e87". This extends the existing store (project-notes decision #4). It is not a parallel store.

**DrivePanel gets a note target.** DrivePanel's capture currently writes a feature test note. It gains a target so the same capture writes a project note (create, then attach the screenshot) when the drive is a project drive. A wordless capture falls back to a default text, as it does today. Feature drives behave exactly as before.

## Seams

- **Project drive service (new, beside the dry run)**: start/stop of a project drive against a real temp git repo.
  - What it observes:
    - HEAD is unchanged across start and stop.
    - Setup and stop receive the `project-drive` identity and the real branch.
    - `drive.env` is overlaid into the dev pane and removed at stop.
    - The recorded commit carries `+dirty` for a dirty tree.
    - Start is refused with a holder-naming `slot_held` denial while another drive holds the slot, and every other drive start is refused while a project drive holds it.
  - How it is observed: the returned result and `activeDriveInfo()`.
- **`activeDriveInfo()` / the drive-info query (existing)**: the project drive's kind, `projectId`, `branch`, `commit`, `startedAt`, dev-pane and hook-failure fields.
- **Project-notes create function (existing)**: notes created during a live project drive of that project carry `driveBranch`/`driveCommit`. Notes created with no drive, or during a feature drive, or during another project's drive, carry nothing. Observed via the project-notes list (tRPC) and `list_project_notes` (MCP).
- **Merge (existing)**: with a project drive of the same project live, merge stops it (stop command runs) and lands. With a different feature's drive live, it is still refused.
- **Web pure helpers (new, lib tier)**:
  - The Test drive card's state from project settings, emptiness and drive info (hidden / prepare / ready / blocked / running).
  - The holder label for a blocking drive.
  - Splitting open notes into "this drive" and "already open" by the drive's start time.
  - Unit-testable without rendering.
- **Project workspace (existing component, component tier)**: resting page shows the card. Starting a drive swaps the body to the drive view with the notes rail. The Chat | Drive switch appears only when both a chat and a drive are live. Stop returns to the resting page.

## Out of scope

- Recording human drives (video), or any annotation player for them.
- Drive-machinery robustness: surviving a server restart or page reload, a `{{port}}` variable, the setup client timeout (`test-drive-improvements` #8, still parked).
- Any embedded browser beyond the existing app frame.
- A branch picker, or switching the checkout to main.
- Any change to how feature drives behave, beyond naming a blocking project drive.
- Auto-creating work from notes. Triage stays the project session's job, unchanged apart from reading the two new fields.
- Persisting drives or giving them ids.

## Open questions

- None blocking. Whether the project drive's database persists between drives is the project's setup script's call. Runcastle only injects the stable `project-drive` identity.
