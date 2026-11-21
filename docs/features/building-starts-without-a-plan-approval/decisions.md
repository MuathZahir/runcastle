# Decisions — Building starts without a plan approval

Planned by the lead with nobody present (2026-11-21). Decisions 1–3 come from
ADR-0023 decision 6, which the human agreed in the Runcastle Rethink epic; there
was no brief, so they are listed to check first too.

Check first: 1, 5, 4, 7

## 1. A lead asks only when a decision of yours is open, otherwise it plays back and builds
**Decision:** Nothing waits for a yes to a plan. A lead asks the human only when what they get, where it lives, who sees it, or another decision of theirs is open; their answers are the approval. When nothing of theirs is open, the lead says in a few lines what it will build and starts building in the same turn. Workers start the same way: the lead names them in its playback, and no yes is asked for them.
**Why:** ADR-0023 decision 6. A required plan yes made every feature pay the same fixed cost whatever its size ("Features that could have finished in less than 30 mins taking hours is unacceptable").

## 2. Designs still need your yes
**Decision:** A new or changed screen is still designed in design mode and waits for the human's approval of that design before it is built. Nothing else about designs changes.
**Why:** ADR-0023 decision 6. A screen is the one thing the human must see before it is built.

## 3. The Plan tab goes; a drawn plan page is optional and shown in the chat
**Decision:** The feature panel loses its Plan tab, the chat's "Open the plan" card and the plan's unseen dot. A lead draws a plan page only when a picture helps (a big feature, or one where a question is easier shown than told), and shows it in the chat as a file card the human opens in the file viewer.
**Why:** ADR-0023 decision 6. The Plan tab existed for the approval; without it, a page nobody must read does not need its own place.

## 4. The brief, decisions and spec are read in Details → Docs
**Decision:** With the Plan tab gone, the feature's brief, decisions and spec are read from the Docs list in the Details panel, which already lists them in that order and opens each in its reader. Nothing new is added.
**Why:** It already exists, and the next feature (`one-file-per-feature-and-reviews-that-scale`) folds these into one file anyway.
**Assumed.** Alternative: keep a small "Docs" tab where Plan was, holding decisions and spec only.

## 5. "Plan automatically" ends on the decisions it made for you, not on a plan yes
**Decision:** The automatic planning run still plans without building. It ends by listing the decisions it made for the human (the check-first ones first) and asking them to change any or say go. Their answer starts the build. If it made no decision of theirs and designed no screen, it plays back what it will build and builds in the same run.
**Why:** Decisions a lead made for the human are still theirs and still open, so decision 1 says to ask them. What the human checks shrinks from a whole plan page to a short list.
**Assumed.** Alternative: the run always stops at the end of planning and waits for a "go", even with nothing of theirs to check.

## 6. Old plan cards and links keep working
**Decision:** A plan card already in a chat opens its plan page as a file in the file viewer. An old link or address to a feature's Plan opens the feature with its Details panel.
**Why:** Old chats stay readable, and no old link leads nowhere.
**Assumed.** Alternative: old plan cards drop out of chats, and old Plan links open the chat with no panel.

## 7. On autopilot the epic gets no plan to approve
**Decision:** A feature on autopilot no longer hands its plan to the epic for a yes. It hands back only what it hands back today besides the plan: open questions, designs and "ready".
**Why:** Decision 1 applies to every feature. Autopilot itself goes in a later feature (after `how-involved-am-i`); until then it should not keep a gate the rest of runcastle has dropped.
**Assumed.** Alternative: autopilot keeps the plan yes until autopilot itself is removed.
