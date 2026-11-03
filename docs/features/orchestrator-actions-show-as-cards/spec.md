# Orchestrator actions show as cards

## Problem

The Orchestrator's chat is where features get created, started, planned, messaged and merged, and where runcastle reports back on them. Today none of that reads well. Every action is a tool call folded inside "Worked for 1m 12s": nothing in the chat says "4 features created" or lets the human click through to them, so the agent repeats the list in prose, by slug. Runcastle's news arrives as one grey line of agent plumbing (`designs-and-the-plan-get-their-own-place merged to main: shipped. … Read it with get_feature_context({ slug: … })`), cut after the first sentence behind Show more. A feature's own chat has the same problem with its kickoff ("Proceed with your task: no human is present…") and with messages from the Orchestrator, which arrive as a grey line opening "From the project's orchestrator, not the human:" with the actual message folded away.

## Approach

**What the human sees.** One row shape stands for "a feature" everywhere in a chat: the feature's sidebar glyph, its title (never its slug), a line saying what happened, and where the feature is now in the sidebar's own words (amber when it needs the human). Clicking a row opens the feature exactly as its sidebar row does.

- **The features card** (decisions 1, 2, 3, 12, 13, 14). After a turn's work and before its final words, one card lists every feature the turn acted on. A heading counts what the rows share ("4 features created"); a card of one row, or of rows with different actions, has none. Each row says what the turn did: Created, Parked in the backlog, Started, Planning started, Planning stopped, Sent a message (with the message's first line quoted), Passed on your answer, Brief updated, Taken into this chat, Merged into main (green, with the merge icon, and no live state), Test drive started or stopped. A feature acted on twice in a turn is one row ("Created · Planning started"). Reads, note triage, drives of the base branch and refused calls stay in the fold only. The fold keeps every call.
- **The news block** (decisions 5, 6, 7). Each delivery of runcastle's news is one quiet block: the Runcastle mark, "Runcastle · 6m ago", then one row per feature with an icon for the tone (done, needs you, failed) and the events in plain words, joined when one delivery says several things about one feature ("Round 2 finished · Review pass finished · Ready to test"). Blocks are never merged across deliveries. "What the agent read" on the block opens the raw text the agent got.
- **Runcastle's other lines** (decision 8). A kickoff, a wake or a briefing shows one plain line ("Runcastle · Started this chat to plan the feature by itself") with "What the agent read" for the full text. Lines without a summary keep today's look.
- **The Orchestrator in a feature's chat** (decision 8). Its message shows in full, on the left, under the Orchestrator's mark and name. An answer it relays shows on the human's side as their bubble, with "Your answer, relayed by the Orchestrator" under it.
- **The Orchestrator's words** (decision 9). The project skill tells it the card shows the features, so its words say why and what comes next.
- **Phone** (decision 11). Rows stack at the chat's width: title (two lines at most), what happened, then the live state. Nothing is dropped.

The look is designed and approved with the plan: `apps/web/src/components/chat/thread/FeatureCards.tsx` (`FeaturesCard`, `NewsBlock`, `RuncastleNote`, `OrchestratorMessage`, the shared `FeatureRow` and `LiveState`), shown on the preview page `/preview/orchestrator-cards.html` with its sample data. Two choices are left to the human as Tweaks on that page: which rows carry the live state (every row, as decision 3 says, or only the newest row per feature, as the challenger argued, or none), and whether news sits quietly in the thread or in a card. Whatever they pick is written into the components and the Tweaks menu deleted.

**The shape of it.** Everything rides on the thread log, which the server writes and both the server and the web fold with one pure reducer (`foldThread` in `packages/core/src/thread.ts`).

1. *A new log event for actions* (decision 4). When an orchestrator tool succeeds on a feature, the server appends to the calling thread's log, the way `show_plan` appends `plan_shown`:

   ```ts
   { type: 'feature_acted', featureId: string, title: string, action: FeatureAction, quote?: string, into?: string }
   ```

   `FeatureAction` is the designed component's union (`created | parked | started | planning | planningStopped | messaged | relayed | brief | taken | merged | driveStarted | driveStopped`); it moves to core so both sides share it. The tools are `create_feature` (both shapes, so a lead parking a draft gets the card too), `start_feature`, `plan_feature`, `stop_feature_run`, `send_to_feature` (`messaged`, or `relayed` with `relaysHuman`), `add_to_brief`, `take_feature`, `merge_feature` (only when it merged, not on a conflict) and `drive` with a slug. A refused or failed call appends nothing.

2. *The fold groups them.* Consecutive `feature_acted` events in one turn become one new item, placed with the existing `placeCard` (after the turn's work, before its words):

   ```ts
   { kind: 'features_card'; id: string; rows: { featureId: string; title: string; actions: FeatureAction[]; quote?: string; into?: string }[] }
   ```

   A second action on a feature already in the card appends to its row. A steered message or a new turn starts a new card.

3. *Runcastle prompts carry what the human should read* (decisions 5, 7, 8). The `prompt` event gains one optional field, written by the server beside the agent's text and never sent to the agent:

   ```ts
   display?:
     | { news: { featureId: string; title: string; events: { tone: 'done' | 'needsYou' | 'failed' | 'info'; words: string }[] }[] }
     | { summary: string }
     | { orchestrator: { text: string; relayed: boolean }[] }
   ```

   The fold copies it onto the `user` item. `PromptOptions` gains `display`, and the host logs it with the prompt. The news notifier (`orchestrator-notify.ts`) writes, for each event, a plain-words `{ tone, words }` beside the line it already writes for the agent, and joins a batch's news by feature. The kickoff and wake senders pass a `summary`. `deliverToLead` passes `orchestrator` entries for messages from `send_to_feature` (held messages that go out together are several entries).

4. *The web draws them.* `ChatThread`'s item switch maps `features_card` to `FeaturesCard`, a runcastle `user` item with `display.news` to `NewsBlock`, with `display.summary` to `RuncastleNote`, with `display.orchestrator` to one `OrchestratorMessage` per entry, and anything else to today's `RuncastleLine`. Rows read the live feature from the project's feature list query (the one the sidebar already polls), by id; a feature the list no longer holds shows its logged title, dimmed and not clickable. Clicks go through a small context the project shell provides (the shell's open-a-feature function), so the same thread component works in the Orchestrator's column, a feature's chat and the phone. A thread with no such context (a scenario chat) draws rows that do not open.

## Seams

- **`foldThread`** (existing, `packages/core`). Log in, items out. Observes: `feature_acted` events grouping into one `features_card` per turn, rows merging by feature, the card's place between the work and the final words, `display` reaching the `user` item, and old logs folding exactly as before.
- **The news notifier's pure half** (existing: `orchestratorLineFor`, extended or joined by a sibling). Event plus state in; the agent's line and the human's `{ tone, words }` out. Observes every event type in its table, and that the agent's line is unchanged.
- **The orchestrator's tool handlers** (existing, exercised as `show_plan`'s tests do). A tool call in; the calling thread's log out. Observes that success appends `feature_acted` with the right action and refusal appends nothing.
- **`FeatureCards.tsx`** (new, designed). Props in; DOM out. Component tests at the app's existing tier (STYLE.md) observe headings, row words, the merged row, the quote, the toggle and the non-clickable gone feature.
- **`ChatThread`** (existing). Items in; the right card out, and today's look for items with no `display`.

## Out of scope

- Rebuilding cards from tool calls in chats from before this feature (decision 4): old chats keep their look.
- Buttons on cards (Approve, Test drive) (decision 14): the feature page's next-step bar keeps them.
- Grouping a feature's news across deliveries (decision 6).
- Changing what the agent receives: its lines, tool results and kickoffs stay word for word.
- The waiting states, header buttons and pings, and the plan and design cards' insides (the brief's "must not swallow").
- App-wide word changes, which "Ready to publish" owns (decision 10).

## Open questions

- The two Tweaks on `/preview/orchestrator-cards.html`: live state on every row, the newest row per feature, or none; news quiet or in a card. The human picks before round 1. The defaults if they say nothing are every row and quiet.
- Card words follow the app's current words. If "Ready to publish" merges first with different words, this feature adopts them; if this one merges first, that one fixes them (decision 10).
