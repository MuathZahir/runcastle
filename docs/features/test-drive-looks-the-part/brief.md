## Purpose

The human, 2026-10-28: "We also need to fix how the test drive looks." Part of a screen-by-screen cut to make the whole app look professional and aesthetic. This feature reworks the test drive screens: the feature drive and the project drive (apps/web/src/components/review/FeatureDriveView.tsx, DrivePanel, ScenarioDrive, EvidenceStage, NotesRail; components/project/ProjectDriveView.tsx, TestDriveCard), and how scenarios are picked and shown.

## Understood

- The scenarios dropdown has the same problem the thread dropdown had: with many entries it runs down the whole screen. The foundation ("The whole app matches the sidebar") fixes the shared dropdown block (bounded height, scrolls); this feature decides whether a dropdown is even the right way to pick a scenario here, and lays the screen out around it.
- The foundation lands the shared style first; this one applies it and fixes the drive screens' own layouts. The sidebar's roomier, calmer feel is the reference.
- Show directions first, rendered with design mode, before building.

## Must not swallow

- The shared theme and building blocks (the foundation's).
- The review step in the feature's right panel ("The feature's right panel, step by step").
- New drive behaviour. This is look and layout.

## Open

- What about the drive looks wrong to the human beyond the scenarios dropdown. Ask with previews.

## Ordering

Waits on "The whole app matches the sidebar"; starts by itself when it merges. Runs alongside the other screen features.

## Working agreement (the human, 2026-10-28)

Checkpoint: the human looks at each feature's designs before it builds. The orchestrator gathers ready designs into one message. Once the human has approved a feature's design, the orchestrator carries it through build, review and merge without asking for a test drive.
