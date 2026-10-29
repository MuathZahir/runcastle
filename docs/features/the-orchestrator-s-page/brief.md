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
