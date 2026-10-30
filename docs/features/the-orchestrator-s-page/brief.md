## Purpose

The human, 2026-10-28, wants the whole app to look professional and aesthetic, screen by screen. This feature reworks the Orchestrator's page (the project page the sidebar's Orchestrator row opens; apps/web/src/components/ProjectWorkspace.tsx and components/project/: notes, the past-conversation list, action rows, the test drive card), around the project chat.

## Understood

- Once "Threads in the sidebar" merges, the project chat's threads live in the sidebar, so the past-conversation list here may shrink or go. Decide that against what that feature shipped.
- The foundation ("The whole app matches the sidebar") lands the shared style first; this applies it. The sidebar's roomier, calmer feel is the reference.
- Show directions first, rendered with design mode, before building.

## Must not swallow

- The chat column itself ("The chat looks the part").
- The project drive screen ("Test drive looks the part").
- The shared theme and building blocks (the foundation's).
- New behaviour beyond tidying what the threads move made redundant.

## Ordering

Waits on "The whole app matches the sidebar" and "Threads in the sidebar"; starts by itself when both merge.

## Working agreement (the human, 2026-10-28)

Checkpoint: the human looks at each feature's designs before it builds. The orchestrator gathers ready designs into one message. Once the human has approved a feature's design, the orchestrator carries it through build, review and merge without asking for a test drive.

## Added by the orchestrator, 2026-10-30

## Merge order with "Test drive looks the part" (orchestrator, 2026-10-30)

"Test drive looks the part" merges before this feature. It replaces the scenario dropdown with one searchable list (`ScenarioPicker`) on the caret of the Test drive button, through an optional picker on the shared split button (`ui/split-button.tsx`), and it makes the drive a full page of its own with a notes rail (notes wait there for the orchestrator on a project drive). The project page's Test drive row (`TestDriveCard.tsx`) gets a small edit there.

This feature's new header Test drive button must use that same picker and that same way into the drive, not a second scenario menu. Take main after test drive lands, and build the header button on it. If it has not landed when this feature is otherwise done, wait for it rather than building a copy.
