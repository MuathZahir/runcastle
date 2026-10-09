# Why this feature exists

Today the human learns what a feature will be by sitting through its grill one question at a time, then skimming the spec and tickets. In the project session on 2026-10-09 they said plainly that this is the wrong reading surface: a good artifact with visualization, UI and flows explains the whole feature better than the grill does, and when tired they accept recommendations without reading them. The plan needs something the human actually looks at before Burn.

They already do this by hand. `docs/features/flow-redesign-settings/decisions.md` decision 4 is "HTML prototype before spec", and decision 14 records the prototype as the approved visual reference after the human reacted to v2 and changed the design. Four shipped features carry a `prototype.html` (`flow-redesign-settings`, `flow-redesign-ideation-through-tickets`, `flow-redesign-project-shell-and-navigation`, `improve-map-workflow-ui-ux-make-markdown-render-correctly`) and `project-notes-jot-it-anywhere-triage-it-in-the-project-chat` carries a `flow.html`. No skill tells a session to make one, and the app cannot show one: the docs listing only picks up `.md` files (`packages/server/src/services/knowledge.ts:128,148`).

This is the first of two features cut from one intent: features plan themselves and the human approves by looking. The second, "Features plan themselves" (a draft waiting on this one), takes the human out of the grill. At that point this artifact is the human's only check before Burn. Design it for that job even though it lands first.

# Understood (settled in the project session; input, not open questions)

1. **Every planned feature, not only UI work.** The project session proposed a UI-only scope and the human rejected it. The session picks the form that explains this feature: a clickable prototype in the project's own styling for UI work; flows, use cases, before/after and clickable skeletons for work with no screen.
2. **A self-contained HTML file in the feature's docs**, written by the planning session.
3. **Shown in the app on the feature page, beside Burn.** The human looks, then either clicks Burn or keeps talking in the feature chat (`one-chat-per-feature`) to change the plan.
4. **It carries the decisions, not only the pictures.** The human skips questions when tired, so the artifact must show what was decided. Once the second feature lands, it must also show which decisions the agent made on the human's behalf, with the least certain ones marked. An artifact that is only a mock-up hides exactly what the human would have skipped.
5. **It works for today's human-run grill.** It is produced at the end of planning regardless of who answered the questions.
6. **Complexity is a hard boundary.** The human's words: "I don't want to increase the complexity considerably for something that doesn't bring much benefit." The first lap should be skill text plus rendering an HTML doc. No new server-run agent, no new pipeline state, no new gate.

# Open (for this feature's own session)

- The file convention: one file or several, and whether it keeps the existing `prototype.html` name.
- Where it sits on the feature page. Commit 819a5f4e (merged to main 2026-10-09) just retired the Tickets tab and rewrote `apps/web/src/components/workspace/FeatureViewTabs.tsx`, `apps/web/src/lib/workspace.ts` and `apps/web/src/lib/routes.ts`; the preview's home is on that page.
- Serving and safety: planning docs live on the unmerged feature branch in the talk worktree, and the file is agent-written HTML with scripts. How the server serves it and how the app sandboxes it.
- Staleness: what happens when decisions change after the preview was made. Anything here warns and never blocks (`four-states-and-two-hard-rules` decision 1).
- When in planning it is made: before the spec, as `flow-redesign-settings` decision 4 did, or after tickets.
- Whether burn agents receive it as a reference (`video-annotation-for-reviews` got images to the burner), and how a prototype is kept from being mistaken for the implementation.
- The smallest acceptable form for a small feature. Quick changes have no planning session and are out.
- Both runtimes: the skill text is shared by Claude Code and Codex sessions.
- What the human wants to test-drive first: open a planned feature, see the artifact, and judge whether it explains the feature better than the grill did.

# What this feature must NOT swallow

- **Who answers the grill, self-planning, launching a planning session at Start.** That is "Features plan themselves".
- **Annotating or commenting on the preview** (click an element, leave a note). A later feature if wanted.
- **Running the real app or rendering real components.** The artifact is a standalone file.
- **Auto-burn, lap judging, auto-merge, any agent-to-agent protocol.** Deliberately uncreated.
- **The review page and its video.** Untouched.
- **Publishing the artifact anywhere outside the machine.**

# Ordering

Lands first. "Features plan themselves" waits on it: both rewrite the ideate skill and the feature page, so they land in sequence, and self-planning has no audit surface until this exists.
