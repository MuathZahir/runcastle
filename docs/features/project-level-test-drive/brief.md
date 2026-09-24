## Why this exists

Test drives today only exist inside a feature's review phase. After shipping several features the human wants to drive the *merged whole* — main with everything landed — and capture what they notice with the same tooling: notes, the video/annotation viewer. There is no surface for that; the workaround is driving the app by hand and re-telling observations later, losing them or flattening them.

The drive *mechanics* are already project-level: `driveSetupCommand` / `driveStopCommand` and the whole preparation machinery (`preparation-supports-multi-service-projects`, `preparation-proves-its-findings`) live on the project row, not on any feature. What was feature-anchored is the *notes loop* — and that anchor now exists at project scope: `project-notes-jot-it-anywhere-triage-it-in-the-project-chat` owns the project-scoped note store, the open/done/promoted lifecycle, the inbox, and the hand-off to the project session. **This feature consumes that store; it does not design one.** It depends on `project-notes` having landed.

## What it is

1. **Launch a drive of a base branch (default: main) from the project surface.** No feature, no lap. Reuse the prep/drive commands and the dev-pane machinery. Wrinkle worth exploring in ideation: a drive of main may not need the worktree/checkout dance a feature drive needs — the human's checkout is often already there — so this may be *cheaper* than a feature drive, not a variant of it.
2. **Notes capture during the drive**, same UX as feature-drive notes, including the video/annotation viewer (`video-annotation-for-reviews`, shipped) if it ports cleanly. Every note written during a project drive is a **project note** — a row in the `project-notes` store, tagged with the drive it came from — so it shows up in the same inbox and reaches the project session the same way a quick-captured note does. Ideation decides how a drive is identified on the note (drive id / date / base branch) and whether the drive's video is attached.
3. **The exit is the inbox, nothing else.** When the drive ends, the human has open project notes; the project chat picks them up. Whether a mechanical one-click "note → quick change" promote exists is decided in `project-notes`'s ideation, not here — if it exists there, drive notes get it for free.

## What it must NOT swallow

- **The note store, lifecycle, inbox, or project-session seeding** — all `project-notes`. If ideation finds that store lacks something a drive needs (e.g. a drive tag, an image-vs-video distinction), that is a revisit of `project-notes`, not a parallel store here.
- **Drive-machinery robustness** (restart survival, `{{port}}`, `driveSetupCommand` client timeout) — parked in decision #8 of `test-drive-improvements`, still parked.
- **An embedded browser** — explicitly rejected in decision #1 of `test-drive-improvements`; would need its own case as its own feature.
- **Any change to how feature drives work** — this reuses their machinery, it does not refactor it.
- **The decomposition itself** — no auto-creation of features from notes; deciding what a note becomes stays the project session's job.

## Already settled / prior art to read

- `docs/features/project-notes-jot-it-anywhere-triage-it-in-the-project-chat/` — the store this writes to (read its decisions first; they bind the note shape).
- `docs/features/test-drive-improvements/decisions.md` — the feature-drive notes loop and its parked items.
- `docs/features/video-annotation-for-reviews/` — the annotation player to port.
- `docs/features/make-test-drive-clear/` — how drive behavior is explained to the user; the project-level drive needs the same clarity about what prep did or didn't run.
