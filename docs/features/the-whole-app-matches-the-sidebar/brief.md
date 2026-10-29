## Purpose

The human, 2026-10-28: the recently redesigned project sidebar (docs/features/sidebar-refresh-less-clutter-more-character/) looks good, but the rest of the app does not fit it yet. The sidebar is "a little more spaced out and comfortable to look at", and its style is a little different. The human wants everything consistent across the app, and beyond consistency, wants the whole application to look professional and aesthetic.

This is the **foundation** of a seven-feature UI cut. It changes the shared things every screen is built from: the theme tokens in apps/web/src/theme.css, the shared building blocks in apps/web/src/ui/ and apps/web/src/components/ (menus, dropdowns, buttons, cards, panels, dialogs, spacing and type scale), and apps/web/DESIGN.md / STYLE.md so the design guide describes the new look. The screen features that follow restyle their own layouts on top of what this one lands, so the shared change must happen here, once, and not drift across five features.

## Understood

- **The sidebar is the reference.** Its spacing, density and feel are what the rest should match. It was built toward the T3 Code look the human liked.
- **Dropdowns are badly designed.** The thread dropdown in the chat header "goes all the way to the bottom of the screen" with many threads; the scenarios dropdown (test drive) has the same problem. This feature owns the shared menu/dropdown building block: a bounded height that scrolls, and a look that matches. Fixing the block fixes every dropdown built from it. (The thread switcher itself is being removed by the sibling feature "Threads in the sidebar"; do not redesign it here, but the scenarios dropdown and all others ride this fix.)
- **The grain at the top of the sidebar looks weird.** The human calls it a "white green effect" at the top of the sidebar. It is the film grain behind the sidebar head (`SidebarGrain` in apps/web/src/components/SidebarParts.tsx over the `film-grain` utility in theme.css), made about four times stronger by docs/features/make-the-sidebar-grain-visible/. Tone it down a lot or remove it; show the human both and let them pick.
- **Show directions first.** This is a visual feature: render the new look with design mode (fake data, the project's own dev server) on a few representative screens before building, and let the human react to pictures.

## Must not swallow

- Per-screen layout work: the chat, the feature's right panel, test drive, the Orchestrator's page and the remaining screens each have their own feature (see Ordering). This feature changes the shared style and building blocks; it may touch a screen only as far as picking up the shared change requires.
- New behaviour. Threads moving into the sidebar is "Threads in the sidebar".

## Open

- How far the shared style moves from today's tokens (spacing scale, radius, surfaces, type), and whether DESIGN.md's general rules need amending or only its examples. The human's eye decides from previews.
- Remove the grain, or keep a much fainter one.

## Ordering

First in the cut. These wait on it and start by themselves when it merges: "The chat looks the part", "The feature's right panel, step by step", "Test drive looks the part", "The Orchestrator's page". "The rest of the app looks the part" waits on it in the backlog. "Threads in the sidebar" runs in parallel with it.

## Working agreement (the human, 2026-10-28)

Checkpoint: the human looks at each feature's designs before it builds. The orchestrator gathers ready designs into one message. Once the human has approved a feature's design, the orchestrator carries it through build, review and merge without asking for a test drive.
