# Flow redesign: project chat and creation doors

## Problem

Everything between "I have an idea" and "a feature card exists" is carried by surfaces that explain themselves in paragraphs and still confuse. The project workspace fronts a "lands on" branch setting that only affects the *next* chat — a lie the page apologises for in grey text. The conversation list is unusable: most rows are titled after a `/clear`, an image paste or an interruption, and every Reopen mints a duplicate row of the same thread. A live chat is a dead end whose only exit is End session. The Quick overlay buries what matters (a new branch, a review ticket) under two explanatory paragraphs; a draft parked from it can never carry a brief. The draft body hides its one real control behind an "Advanced" disclosure. And all of it still sits on legacy `styles.css` rules instead of the foundation's tokens and primitives.

## Approach

Rebuild the flow's five surfaces on the foundation primitives, cut copy to what a returning user needs, and fix the two data rules the list depends on. All decisions are locked in `decisions.md`; the confirmed prototype (`prototypes/creation-doors-prototype.html`) is the visual reference for every screen.

**Project workspace at rest** (decision 6) is three pieces: a header line (`PROJECT · <name>` plus one quiet line naming the session branch and landing branch), the New chat card ("Talk it through", one line of copy, **New chat** with an inline `landing on <branch> ▾` menu), and a `CONVERSATIONS` list. The explanatory cards, the static branch chip, the landing note and the "What every chat here already has" card are deleted.

**The landing branch becomes a launch-time choice** (decision 3): the inline branch menu beside New chat replaces the page-chrome select. The pick still persists per project via the existing `sessionBranch` setting; the menu hides `runcastle/*`, `worktree-*` and `afk/*` branches; a gone branch is the one error state and blocks New chat until another is picked.

**Conversation identity and titles move server-side with the list** (decisions 1, 4, 5). One list row per Claude Code conversation: sessions sharing a `ccSessionId` collapse into one row dated by first launch, open when the latest session is live, Reopen resuming the latest session; rows with no `ccSessionId` are not listed. Title derivation skips slash-command turns and `[Request interrupted by user]`, strips `[Image #n]` tokens, falls back to "Untitled" (uncached); junk cached titles (starting `<command-name>` or `[`) are cleared once so they re-derive.

**A live chat fills the body** under a strip — `← Conversations` · title chip · live dot · `→ <branch>` chip · short id · **End session** (decision 7). Going back re-shows the list with the open conversation as its top row; its action reads **Open** and reattaches to the running terminal without launching anything. **New while a chat is live** (decision 12) navigates to the workspace and shows an inline notice on the New chat card — "A chat is already open." with **Open it** and **End it and start new** — no toast, no silent redirect.

**The transcript pane** (decision 11) keeps its shape — `← Conversations` · title · date · Reopen/Open header, plain bubbles — but assistant bubbles render Markdown and the empty states collapse to one dim line naming the case.

**The Quick overlay** (decision 8) keeps its two tabs and loses both paragraphs; each mode gets one line under its heading. The base picker becomes the inline `from <branch> ▾` in the footer summary `feature/<slug> · from main ▾ · N tickets + review`; that line and the **Create feature** button carry the "this is its own feature" message. Park a draft gains an optional **Notes** textarea stored as the draft's brief via the existing create path.

**The draft body** (decision 10) shows `PARKED` kicker · title · one-liner · brief as Markdown ("No notes." when empty). The next-step bar keeps **Start** and gains the always-visible inline `from <branch> ▾` picker; with no usable base the menu reads `from … ▾` in the warn colour and Start is disabled with "pick a branch first".

**Delete** (decision 11) keeps type-the-slug arming, rebuilt on the `Dialog` (sm) and `Field` primitives with a two-sentence lead and a bold "This cannot be undone."

**Structure and styling** (decisions 9, 13): every surface sits on one vertical rhythm on Tailwind's 4px scale — 8px inside a control group, 16px between fields, 24px between sections, 32px header-to-body. The workspace component splits into list, live strip and transcript pane; the Quick form becomes two mode components over a shared shell; the inline branch menu is one shared primitive (`BranchMenu`) used by the New chat card, the Quick footer and the draft bar. Every legacy stylesheet rule this flow owns is deleted; shared rules stay with their owning flows.

## Seams

- **`project.talkToProject` (existing)** — launching and resuming project chats. Observes: fresh launch vs `--resume` of the latest session in a conversation, the landing-branch argument, the one-live-session rule the inline notice reflects.
- **`project.listConversations` / `listProjectConversations` service (existing, behaviour changes)** — the grouped list. Observes: one row per `ccSessionId`, first-launch dating, open flag, exclusion of never-picked-up rows.
- **`deriveTitle` in the conversations service (existing, behaviour changes)** — pure function over transcript turns. Observes: slash-command/interruption skipping, `[Image #n]` stripping, "Untitled" fallback, plus the one-time junk-cache clearing beside it.
- **`project.sessionBranch` + `settings.update` (existing)** — the landing-branch default behind the `BranchMenu`. Observes: persistence of the pick, detected-origin default, gone-branch error state.
- **`feature.quickChange`, `feature.createFeature`, `feature.startDraft` (existing)** — the creation doors. Observes: quick change's tickets + review, draft creation now carrying a brief from Notes, Start's base-branch argument. Contract change: draft creation accepts the optional brief (already in the schema — drafts have briefs; the form just never sent one).
- **The transcript endpoint (existing)** — unchanged contract; the pane renders assistant turns as Markdown client-side.
- **Component render seams (new)** — the split workspace pieces (list, live strip, transcript pane), the two Quick mode components over their shell, `BranchMenu`, and the rebuilt delete dialog, each testable in isolation per the web app's component-test tiers.

## Out of scope

- What the project chat *says* — the skills pack and launcher system prompt.
- The sidebar doors' placement (project-shell flow); this feature owns what the doors open.
- Preparation (its own flow).
- The per-project default branch semantics settled by `base-branch-control` — only its UI moves.
- Shared stylesheet rules owned by other flows (`.grill-*`, `.peek*`).

## Open questions

None — all decisions locked and the prototype confirmed by the human on 2026-08-31.

## Later laps

None planned; this is a one-lap feature (decision 2).
