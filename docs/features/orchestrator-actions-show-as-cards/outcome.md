# Outcome — Orchestrator actions show as cards

When an agent creates, plans, starts, messages or merges features, and when runcastle's news lines arrive, the chat shows clean cards you can click through to the feature, instead of raw tool calls and slug text.

- Shipped: 2026-11-04

## What shipped

17 commits · 32 files

- 2 tickets landed: #1 Thread log: orchestrator actions and runcastle news carry what the human reads; #2 Chat: draw the features card, news block, runcastle notes and Orchestrator messages
- 0 waived
- 0 failed

## Review record

### Ticket 3 · review

- Reviewed commit: 9b3a3bafc98c990a255e25c64d42c320dab0d3ad
- Landed since: 0
- Outcome: done

- **The test gate failed: one terminal process-tree test (pty-bun "kills the whole tree") went red on the branch** — dismissed
- **The review's screenshot tool closed the browser and saved a blank picture, so the pictures here were taken by hand** — open
- **Only part of "old chats render as before" could be checked: the demo data has no old-style Runcastle lines** — open
- **The approved preview page can't be opened in a drive, so the comparison went against the decisions instead** — open

## Notes record

- No human notes

## Per-ticket digests

### 1. Thread log: orchestrator actions and runcastle news carry what the human reads

## What was done
- Core (`packages/core/src/thread.ts`): added `FeatureAction` and `PromptDisplay` (zod + types), the `feature_acted` event, the `features_card` item, and `display` on `prompt` events and `user` items. `foldThread` groups a turn's `feature_acted` events into one card (same feature = one row, actions appended; a prompt or new turn starts a new card). Rules doc comment updated. Tests in `packages/core/test/thread.test.ts`.
- Server tools: `recordFeatureAction` (orchestrator-tools.ts) is called after success by create_feature (parked/created), start_feature, plan_feature, stop_feature_run, add_to_brief (both draft and branch paths), take_feature, merge_feature (only when ok and not conflict, `into` = base), drive with a slug (not when `deniedReason`), and send_to_feature (messaged/relayed, `quote` = first non-empty line clipped to 120). Test: orchestrator-tools.test.ts covers created/parked/taken and refusals.
- Prompts: `PromptOptions.display`, logged by the host (`prompt()` and `hold()`). News: `orchestratorNewsFor` plus `humanWords` sit beside the unchanged agent line; `NotifyState.feature` gained `title`; the batch sends `display.news` grouped by feature. Kickoffs: `openingSummary` feeds `sayToThread` and the empty-thread router. Orchestrator messages: `LeadMessage.orchestrator`, `HeldLine` in lead-delivery, display only when every line going out is an orchestrator message. Tests added in orchestrator-notify, lead-delivery, and summary assertions in the self-plan, side, project and prepare launch tests.
- Typecheck is green; the narrowed core and server files pass (302 tests).

## Surprises
- `run.finished` carries no round number, so the news says "Round finished" unless `data.round` exists.
- Tests are not covered by the server tsconfig (`include: src`), so I only fixed `NotifyState` literals in the notify test by hand.

## Left undone
- No direct test for `send_to_feature`'s quote and `relayed` action (needs a full delivery harness); the display half is covered via `deliverToLead`.
- Round-end wakes, interrupted-round wakes, Stop, the all-designs-approved line and the scenario/docked chat follow-ups still pass no `display` (they keep today's look); `LeadMessage` has no summary field.
- `FeatureCards.tsx` still declares its own `FeatureAction`; the next ticket switches it to the core import. No drive machinery changes were needed.

### 2. Chat: draw the features card, news block, runcastle notes and Orchestrator messages

# Ticket 2 — chat draws the features card, news block, runcastle notes and Orchestrator messages

## What was done
- New `apps/web/src/components/chat/thread/FeatureCardItems.tsx`: `FeatureLinksContext` (`{ features, openFeature }`), `FeaturesCardItem` (maps a `features_card` item's rows to `FeatureActionRow` with the live `FeatureListItem` by id, or `null`), and `RuncastleDisplay` (`display.news` → `NewsBlock`, `display.summary` → `RuncastleNote`, `display.orchestrator` → one `OrchestratorMessage` per entry, `relayed` passed through). I put the context beside the feature cards, not in `design/ThreadCards.tsx`, because it serves these cards only.
- `ChatThread.tsx` `Item`: `features_card` → `FeaturesCardItem`, and a runcastle `user` item with a `display` → `RuncastleDisplay`, its agent text tag-stripped by a new `untagRuncastle` that `RuncastleLine` now uses too. A runcastle item with no `display` draws exactly as before. `opensTurn` is unchanged: these user items still open a turn, and a features card sits close under the work.
- `ProjectShell.tsx` provides the context from its existing `feature.list` query and `openChosen`, the sidebar's own `onSelect`, which opens a feature's chat on a phone. No new query.
- `FeatureCards.tsx` now takes `FeatureAction` from core through `lib/chat-thread.ts`. No markup changed.
- Project SKILL.md: one sentence after "one `create_feature` call per feature" (decision 9).
- Test `apps/web/test/thread-feature-cards.test.tsx` (tier 2) covers:
  - the "4 features created" heading, row titles, live state words ("In progress", "Plan to approve") and a click opening the feature;
  - a feature the list no longer holds is dimmed and does not open;
  - with no provider, rows have no live state and no clicks;
  - news shows titles, not slugs, and the agent text only after "What the agent read";
  - a summary note, and the old line for an item with no `display`;
  - an Orchestrator message in full, and the relayed caption.
- Checks: the web tsc passes, and so does a temporary tsconfig with the preview files (deleted afterwards). Root `bun run typecheck` passes. The new test, thread-design-cards and thread-column pass (44 tests), and so does `launch-artifacts.test.ts`, which reads the skill. No drive machinery changes were needed.

## Surprises
- With no provider, every row gets `feature: null`, so in a scenario chat the rows draw dimmed (opacity-70), like a feature that is gone. That fits "no live state, no clicks", but it is a visible look in those chats.
- User items carry no time, so `NewsBlock` gets no `when` and the "· 6m ago" part never shows.
- I did not render the 390px phone layout in a browser. The cards are container-query driven and their markup did not change.

## Left undone
- Adding a time to `user` items, so news blocks can say when they arrived.
- A non-dimmed "no links" row look for scenario chats, if wanted.
