## Why this feature exists

Part of the 2026-08-28 decision to redesign the runcastle web app **one flow at a time** on top of `web-ui-foundation-tailwind-tokens-primitives-and-carving-feature-ui`. This is flow 3 of 7: everything between "I have an idea" and "a feature card exists".

## The flow, as it exists

- `apps/web/src/components/ProjectWorkspace.tsx` — the project-scoped chat page: branch-lands-on selector, "Talk it through / New chat" card, past conversations (Transcript / Reopen per row), live chat takes the body over. `components/ConversationTranscript.tsx` reads an ended one.
- `components/QuickForm.tsx` inside `FormOverlay.tsx` — two modes: **Quick change** (title + one sentence per ticket → feature born at implementation, click Burn) and **Park a draft** (title + one-liner). This is the only non-chat door; the old NewFeatureForm was deleted by `ux-issues`.
- `components/bodies/DraftBody.tsx` — a parked draft with its Advanced base-branch picker; Start fires from the next-step bar.
- `components/DeleteFeatureDialog.tsx` — type-the-slug confirm (the prior audit called this exemplary; keep the idea).
- Server side: `packages/server/src/services/conversations.ts`, `transcripts.ts`, `talkToProject` in the project router; `features.quickChange`, `createFeature`, `startDraft`.

## Known issues going in (human's own words and prior audits)

- **The "lands on" branch input is confusing**: changing it only affects the *next* chat, not one already running (the page even says so in a line of grey text). Decide what this control is for and where it belongs; `docs/features/base-branch-control/` settled that the per-project default exists — it did not settle this UI.
- The conversation list shows raw kickoff/command text as titles (`<command-name>/clear</command-name>…`, "date unknown") for older rows — see the human's screenshot. `ux-issues` ticket 1 added title derivation and a nullable `created_at`; rows that predate it still look like that.
- `docs/features/ux-issues/outcome.md` "left undone": reopening a chat creates a new session row each time (conversation identity — group by `ccSessionId` or not), and a reopened project chat is greeted with the fresh-session kickoff ("invoke /runcastle:project and drive the session") instead of resume framing — feature sessions have `RESUME_KICKOFF_PREFIX`, project chats don't.
- Prior audit F25.2/F25.5: Escape vs click-outside dismissal semantics; the Quick form spawns a whole sibling feature and did not say so (now says so in a long paragraph — see screenshot — which is the opposite problem: too much explanatory text).
- The human's screenshots of this page show large explanatory paragraphs on every card. Cut copy to what a returning user needs; first-use explanation belongs in one place, not on every visit.

## How the ideation session must work (human's instruction, applies to every flow feature)

1. Walk the whole flow with agent-browser: New chat → conversation → create_feature from inside it; Quick change both modes; draft → Start; delete; reopen and transcript of an ended chat. Every branch, button, dead end.
2. Present the complete flow map to the human and get it confirmed before designing.
3. Redesign on the foundation's tokens and primitives; simplify and make spacious.
4. Code quality is in scope for this flow's files.
5. Migration rule: move this surface's rules out of `styles.css` into Tailwind and delete the old rules.

## What it must NOT swallow

- What the project chat *says* — that is the skills pack (`packages/skills/.../project/SKILL.md`) and the launcher's system prompt, already reworked by `ux-issues` ticket 2 and `project-session-open-by-asking-orient-lazily`. Own the page, not the agent's script.
- The sidebar doors' placement (project-shell flow) — own the forms and pages the doors open.
- Preparation (its own flow).

## Already settled

Charter decision 5/6 (docs in repo, docs-only worktrees); `draft-features` (draft = row + brief, no branch until Start); `scaffold-commit-lands-on-the-feature-branch-not-the-checkout`; `ux-issues` decision that New opens a *fresh* chat and that a quick change always closes with a review ticket.
