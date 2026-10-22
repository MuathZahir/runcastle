# Brief

## Why this feature exists

The human, 2026-10-18: "One thing I feel like the storybook would be useful for is designing. I feel like we can have a design mode where the component is shown and the agent is there too. We can iterate on the design then the agent creates the tickets, etc.."

Today a UI is designed in words, and the closest thing to seeing it before the burn is *Plan preview*: a hand-built HTML mock that approximates the real components and design system. Design mode shows **the real component**, rendered by the project's own story tool, and changes it live while the human and the agent talk.

## Settled in the project session

1. **Where it happens:** during planning, in the feature chat, docked beside a live story canvas, the same way the chat docks beside a drive (`one-chat-per-feature` decision 16).
   - The human talks ("make the expired state quieter") or points with the drive's existing **Select area**.
   - The agent edits the component and its story, and the canvas hot-reloads.
   - For a component that doesn't exist yet, the agent writes it plus a story with sample data, and it appears.
2. **What is designed is kept** (the human's choice, 2026-10-18). The components and stories approved in design mode are committed to the feature branch as real code.
   - The tickets then cover only what design mode didn't: loading real data, API calls, behaviour.
   - Nothing is built twice, and what the human approved is what ships.
   - Rejected: design mode as a throwaway mock that tickets rebuild. That costs every UI feature a rebuild, and the rebuild can drift from what was approved.
3. **What it runs:** the story tool's own dev server (`storybook dev`), a small Node process running the project's bundler that serves only components with sample data.
   - It runs **no app, no Docker, no database and no backend**. Pages that load data get fake data (usually MSW).
   - Hot reload is why it must run live. A static catalogue rebuild per edit takes 30 s to minutes, which is far too slow to iterate.
4. **What that requires: a chat worktree with dependencies installed.**
   - This changes charter locked decision 6 ("docs-only worktrees for talk… full-fat worktrees deferred until actually needed"). This is that need.
   - The planning chat now writes code as well as docs.
   - The project session writes the ADR once this feature's `decisions.md` settles the mechanics.
5. **Runcastle never renders components itself.** It runs the project's command and shows the URL it serves, so it stays language-agnostic (charter).

## What this feature must decide in its own session

- **The worktree:**
  - whether the feature's chat worktree gains installs, or design mode gets its own worktree;
  - how installs stay fast (a shared download cache, as ADR-0004 does for burners);
  - when the installs are removed.
- **How design commits land on the feature branch** alongside burns. See `one-chat-per-feature` decisions 2 and 9 on the chat worktree and the handoff at burn boundaries.
- **How the dev server is managed:**
  - started on demand and stopped when design mode closes or goes idle;
  - its port;
  - how several design sessions in one project behave.
- **A project with no stories yet:** whether design mode runs the stories setup itself in the chat, or the human waits for the setup ticket from *Features show their UI states as stories*.
- **How design mode relates to *Plan preview*:** in a project with stories, design mode likely replaces the HTML mock for UI. Decide whether the preview links the designed stories instead.
- **How the lead's plan uses the designed components:** tickets reference the stories they must connect.

## What this feature must NOT swallow

- **Setting up stories and showing changed stories on the feature page.** *Features show their UI states as stories* owns them.
- **The map.** *The map of stories and scenarios* owns it.
- **Drives.** Design mode never starts the app.

## Binding

- **Charter:** starting the app is the expensive step; language-agnostic by construction; individual developers first; minimal docs.
- **ADR-0004:** dependency caching.
- **`one-chat-per-feature`:** decisions 2, 9 and 16, plus whatever *The feature lead runs rounds* changes. That is why this waits on it: both change the feature chat.

## Decided 2026-10-20, in the re-scope of *The map shows every page and its states*

The human, driving that feature's first lap: "The reason I wanted these components showing in runcastle was so that I can iterate with the agent on specific components/screens/states without having to test drive every time, reach that state, then see how it looks. This was my main issue." Design mode is now **the** home of that need. These points override the sections above wherever they disagree.

**What changed around design mode**
- **The map is removed,** not reworked. *The map shows every page and its states* was re-scoped into a cleanup that deletes it.
- **Storybook is removed from runcastle,** with the whole catalogue pipeline: the build at every review pass, the base build, the stories port, the copy to main, `.runcastle/stories.json`, the feature page's "UI states" section, prepare's stories setup, and the planning rule that asked workers for story files. The brief's "What this feature must NOT swallow" lines about stories and the map are void: neither exists any more.
- **What survives, as plain TypeScript under `.runcastle/preview/`:** the fake network layer (answers the app's tRPC calls at the `fetch` edge, including named mutations), the faked session data the shell needs (one project, a prepared host…), and the helper that renders runcastle's real `App` at an address (clears storage, sets the URL, mounts the app). A silent stand-in for the live event stream lives with them. Design mode starts from these; they are typechecked by `bun run typecheck` and used by nothing else.

**How design mode works now (replaces settled point 3, "storybook dev")**
1. **No Storybook, no packages added to the user's project.** To show a state, the agent writes a small **preview page** that switches on the fakes and mounts the screen, then serves it with **the project's own frontend dev server** (Vite, Next.js…), which runs no backend, no Docker and no database. The project's own hot reload makes the pane update as the agent edits.
2. **Runcastle shows a URL in a pane beside the chat.** It never renders or understands components (settled point 5 stands). The agent tells runcastle the URL; runcastle only shows it.
3. **The agent opens the pane when it judges a design moment,** or when the human asks to see how something looks. It is not a mode the human has to switch on.
4. **Two ways to reach a state:**
   - mount the piece directly with made-up props (a message bubble with a long message), the quick route for anything small;
   - mount the whole app with the server faked: the fakes answer the screen's queries (and its mutations, so "send" works), and for states behind clicks (a dialog, a wizard step) the preview performs the clicks after load.

   States need no address and no backend.
5. **Preview files stay in the repo as a byproduct.** They are required by nothing and checked by nothing but typecheck. Nothing fails because one went stale; the next design session that opens it repairs it.
6. **Setup is per project, on first use, by the agent in the chat.** Prepare does nothing for design mode. The first time, the agent works out how to serve a preview in that project; in a Vite app that is a few lines, in Next.js a dev-only route kept out of production builds.
7. **Tweaks.** For a choice that is still open (an accent colour, density, which of two layouts, a radius), the agent adds a small collapsible **Tweaks** menu in a corner of the preview, whose controls change the screen live.
   - The menu shows its current values as one line of text ("accent #5b8def · density compact · layout B"), so the human can say or paste what they chose.
   - When the human settles, the agent writes the chosen values into the real code and deletes the menu: nothing from tweaks ships.
   - Three or four controls at most, only for genuinely open choices.
   - This is a prompt addition (design mode's guide), not runcastle logic.
8. **Honest limits, accepted:**
   - pages whose HTML the server builds (Next.js server components, Rails or Django templates) can't be previewed whole, though their client pieces can be mounted directly;
   - live content (streams, sockets) shows canned content;
   - native mobile has no browser to render in.

**Still open for design mode's own planning:** the open questions above about the chat worktree (installed dependencies, fast installs, cleanup), how design commits land beside burns, the dev server's port and lifecycle, the relation to *Plan preview*, and how the lead's tickets use what was designed. "A project with no stories yet" is answered by point 6.
