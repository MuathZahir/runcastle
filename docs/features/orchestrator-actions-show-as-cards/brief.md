## Purpose
The human (2026-11-03), looking at the orchestrator's chat: "these little notifications and tool calls (when the agent creates features, starts their planning, etc.) should have a better looking card. Maybe when creating a feature, a card should appear with the created features. Clicking on a feature takes you there, etc. Make sure the cards look good and professional (matching the rest of the app)."

What they see today, in the orchestrator's chat (screenshot taken by the human):
- **Runcastle's news lines** render as one grey line: a small logo, "Runcastle ·", then raw text like `designs-and-the-plan-get-their-own-place merged to main: shipped.` with the slug as plain text, and "Show more" to see the rest (the full line includes things like "Read it with get_feature_context({ slug: … })", which is agent plumbing). This is `RuncastleLine` in apps/web/src/components/chat/…/ChatThread.tsx (~508-533). The same line kind carries kickoff text ("Proceed with your task: invoke /runcastle:feature…").
- **The orchestrator's actions** (create_feature, plan_feature, start_feature, send_to_feature, merge_feature, drive, add_to_brief, take_feature, triage_project_note…) are MCP tool calls folded into "Worked for Xs". Nothing in the chat says "4 features created" or lets you click through to them.

## What the human wants
- An orchestrator action that matters to the human shows as a **card in the chat**, in the same family as the cards that already exist: Review Package (ReviewPackageCard.tsx), shown files (ShownFiles.tsx), and the plan/design cards shipped by "Designs and the plan get their own place" (PlanCard, DesignCard). Creating features shows **one card listing the features created**, each row clickable to open that feature. Other actions (planning started, a message sent to a feature, a merge, a drive) get the treatment that fits them.
- **News lines** look professional too: the feature named by its title (not its slug) and clickable, the event in plain words, and no agent plumbing ("Read it with get_feature_context…") shown to the human.
- They look good and professional, matching the rest of the app (apps/web/STYLE.md, theme.css tokens, existing primitives).

## Understood
- It's mainly about the orchestrator's (project session's) chat, where these actions and news lines pile up. A feature lead's chat shows some of the same kinds (kickoff lines, runcastle lines) and should get the same look where it applies.
- Which actions get a card, a compact line, or stay in the fold is this feature's own design call. Prefer few card kinds over one per tool.

## Open (for this feature's own grill)
- Whether a card shows the feature's live state (e.g. "Planning", "Needs you") or only what happened.
- Whether repeated news about the same feature groups together.
- Phone: the phone renders the same chat, so the cards must work at 390px.

## Must not swallow
- The waiting states, header buttons and pings (shipped in "You always know what's waiting").
- Plan/design card internals (shipped).
- App-wide vocabulary renames: "Ready to publish" is planning in parallel and settles one word per concept (round, chat/thread…). Read its decisions.md (read_feature_doc on slug ready-to-publish, or its branch) and use its word choices in the new card text. Whichever of the two merges second fixes any words that disagree.

## Ordering
Runs now, in parallel with "Ready to publish".

## Working agreement (made 2026-11-03)
The human: "Start the feature and run it. Stop at the design." Plan headlessly, build the designs, and stop for the human's own look at the designs. They approve designs themselves. After their yes, the orchestrator carries it through rounds, review and merge, as with the earlier cut. End with a review round as usual.
