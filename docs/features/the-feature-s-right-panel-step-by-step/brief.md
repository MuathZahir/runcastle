## Purpose

The human, 2026-10-28, wants the whole app to look professional and aesthetic, going screen by screen or phase by phase, each in its own feature. They named "how the documents are shown on the right sidebar" directly. This feature reworks the feature page's right panel (from docs/features/design-mode/: chat column on the left, one resizable panel on the right) at every step a feature passes through: the plan and its decisions/spec, tickets, the running round, review, shipped, and how docs are shown (apps/web/src/components/workspace/FeaturePanel.tsx, components/bodies/, components/inspector/, DocPeek, DocsMenu).

## Understood

- The foundation feature ("The whole app matches the sidebar") lands the shared style and building blocks first; this one applies them and fixes the panel's own layouts. The sidebar's roomier, calmer feel is the reference.
- Show directions first, rendered with design mode, before building.
- **This may be too wide for one feature.** If its planning session finds it is, it should say so early and propose a split (e.g. docs and plan vs. round, review and shipped), so the orchestrator can cut it in two.

## Must not swallow

- The shared theme and building blocks (the foundation's).
- The chat column ("The chat looks the part") and the test drive view ("Test drive looks the part"), even where review links into a drive.
- New behaviour. This is look and layout.

## Open

- Which steps look worst to the human; the docs view was named first.

## Ordering

Waits on "The whole app matches the sidebar"; starts by itself when it merges. Runs alongside the other screen features.

## Working agreement (the human, 2026-10-28)

Checkpoint: the human looks at each feature's designs before it builds. The orchestrator gathers ready designs into one message. Once the human has approved a feature's design, the orchestrator carries it through build, review and merge without asking for a test drive.
