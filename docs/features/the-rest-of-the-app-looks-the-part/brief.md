## Purpose

The last piece of the human's 2026-10-28 screen-by-screen cut to make the whole app look professional and aesthetic: the screens seen least. The all-projects home (PortfolioHome, ProjectCard), settings (components/settings/), the first-run setup steps (components/first-run/), the command palette, the run view (components/run/) and the app's dialogs and forms.

## Understood

- The foundation ("The whole app matches the sidebar") lands the shared style and building blocks; much of this may already look right once it merges. Start by checking what is still off, and keep the feature as small as that.
- Show directions first, rendered with design mode, before building.

## Must not swallow

- Any screen another feature of the cut owns: the chat, the feature's right panel, test drive, the Orchestrator's page, the sidebar.
- New behaviour.

## Ordering

Backlog: waits on "The whole app matches the sidebar" and then on the human's Start. It does not start by itself.

## Working agreement (the human, 2026-10-28)

Checkpoint: the human looks at each feature's designs before it builds. The orchestrator gathers ready designs into one message. Once the human has approved a feature's design, the orchestrator carries it through build, review and merge without asking for a test drive.

## Added by the orchestrator, 2026-10-30

## Working agreement changed (the human, 2026-10-30)

Autonomous for this feature: "complete the 'The rest of the app...' feature without waiting for me to check the design." This replaces the design checkpoint above. The agent still designs, but nobody waits for a look: the orchestrator gives the yes and merges.

Say what you changed and why in your report. A review pass is optional, your judgement, not a required step: tickets and review are tools the feature's agent uses when they help, and there are no gates to satisfy. The chat, right panel, test drive, Orchestrator's page and sidebar have all shipped, so their looks are the reference, and `apps/web/src/components/chat/thread/surfaces.ts` shows the one-material idea the human asked for: few card styles, each with one job.
