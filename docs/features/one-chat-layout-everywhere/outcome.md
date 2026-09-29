# Outcome — One chat layout everywhere

The feature chat has one layout in every state and page, and every button that starts or resumes a session lands you in it.

- Shipped: 2026-09-29
- Laps run: 1

## What shipped

12 commits · 59 files

### Lap 1
- 4 tickets landed: #1 Chat notices: event mapping, deck state and the notice deck component; #2 One ChatView: full-area Chat tab for features, project chat on the same component; #3 Addressable tabs, per-feature tab memory, land on Chat from every session button, mount the notice deck; #5 Ended project chat renders a separate read-back page, not ChatView's at-rest state — the two chats still differ once ended
- 0 waived
- 0 failed

## Review record

### Lap 1 · review

- Reviewed commit: a7248537e454858dde2d700a4ccc2eba55dcb969
- Landed since: 1
- Outcome: done

### Lap 1 · verification

- Reviewed commit: f1761bcd43ebd7990d6e35221a3aa6eb6600def1
- Landed since: 0
- Outcome: done

- No findings

## Notes record

- No human notes

## Per-ticket digests

### Lap 1

#### 1. Chat notices: event mapping, deck state and the notice deck component

# Ticket 1: chat notices (mapping, deck reducer, NoticeDeck)

## What was done
- `apps/web/src/lib/chat-notices.ts` holds `noticeFor(event, tickets?)` and `deckReducer(state, action)`. The actions are `push`, `dismiss` and `act`; the deck holds `DECK_CAP` = 4 notices, newest first. The `ChatNotice` shape matches the ticket.
- **Deviation: "Review ready".** No server event says "the review pass finished" on its own. The notice is raised by a `ticket.done` whose ticket is `kind: 'review'` and not `passKind: 'verification'`. `ticket.done` does not carry the ticket's kind, so `noticeFor` takes an optional second argument: the feature's tickets (`NoticeTicket` = id/kind/passKind/title). Whoever mounts the deck must pass the feature's tickets, or "Review ready" never fires. `review.agentic-minted` returns null (it fires when the pass is created). The reasoning is in a comment on the function.
- **Subtitles:**
  - spec → "spec.md"
  - tickets → the event message
  - ticket failed → "Ticket #n failed" parsed from "ticket n failed: headline"; the headline is the subtitle
  - run → the burner summary "x/y tickets done" becomes "x of y landed"; any other summary is shown as-is. A status other than `succeeded` gives "Run finished with failures" on the danger hue.
  - drive → `data.url`
- `apps/web/src/components/chat/NoticeDeck.tsx` takes props `{ notices, onAct(kind), onDismiss(kind) }`.
  - Placement: `absolute right-4 bottom-4 z-20` (the parent must be relative); `role=status aria-live=polite`.
  - Collapsed: only the front card is readable. Up to two older cards peek (translateY −9px each, scale 0.95/0.90); their content is `invisible` and `aria-hidden`. An "n notifications" hint shows.
  - Hover or focus-within fans every card out newest-at-bottom with an 8px gap.
  - Hue: phase or danger classes from a lookup map (chip, eyebrow, count pill, action, top-left radial glow). The icon is `PhaseIcon`, or `IconAlert` for danger.
  - Motion: the entry animation is `animate-rise-in`. Reduced motion is covered by the `motion-reduce:` utilities and the global clamp in theme.css.
- The action button is hand-rolled on `BARE_BUTTON` because `Button` has no phase-hued variant, and the ticket asked for new files only.
- Tests:
  - `test/chat-notices.test.ts` (tier 1, 23 tests)
  - `test/notice-deck.test.tsx` (tier 2 happy-dom, 7 tests)
- A `vite build` confirmed Tailwind emits the new classes, including `bg-radial-[…]` and the `/15` color-mix classes.

## Surprises
- The full suite had 1 failure: `packages/server/test/dev-pane.test.ts` › "kills the child process tree…". It also fails when that file runs alone. This ticket changed no server code, so it looks like a sandbox process-tree problem, but it is not in the baseline.
- `animate-rise-in` uses `both` fill mode, which pins `transform: none`. So the animation sits on the inner `<article>`, and the `<li>` keeps its peek transform.

## Left undone
- The deck is not mounted anywhere, and nothing feeds it events that happen while Chat is in front. That belongs to another ticket, which must pass tickets to `noticeFor` and switch to `notice.target` in `onAct`, then dispatch `act`.
- The drive machinery needed no change (web-only files, no new service or env).

#### 2. One ChatView: full-area Chat tab for features, project chat on the same component

# Ticket 2 — One ChatView, full-area Chat tab

**What was done.** I added `components/chat/ChatView.tsx`. It has a strip (live dot, context line, End session through `EndSessionButton`), the full-area terminal, an at-rest state (read-back transcript with Resume, or "No conversation yet" with Start), and a positioned `children` overlay slot where a later ticket can mount the notice deck. The not-ready and check-in notices moved from the deleted `SessionPanel` into `chat/SessionNotices.tsx`.

`LiveChat` is now a thin wrapper: the project topbar plus `ChatView`. It is still mounted-but-hidden, and `data-live-chat` is kept.

Feature pages now use:
- `workspace/FeatureViewTabs.tsx`: Overview | Tickets | Chat for every non-draft feature, with a live dot on Chat. Drafts get no tabs.
- `workspace/FeatureChat.tsx`: the live session of any kind, with context lines "Chat · lap N", "Waypoint · <title>", "Converge" and "Drive fix" from `chatContextLine`. With nothing live it falls back to `featureChat()` (the renamed `dockedChat`). It is always mounted for non-drafts and hidden behind the other tabs.
- `workspace/LiveSessionBar.tsx`: the Overview line "<Kind> live · lap N", with Open chat (selects the Chat tab) and End session. It replaces `LiveSessionAlert`. `liveSessionLine` no longer returns a `phase`, and `sessionHome` is gone.

The bar's Chat door now launches only if nothing is live, then sets the view to Chat through local state.

**Removed:**
- The chat aside (`ChatPanel`).
- `chatPanelOpen` and `runcastle.chatpanel.open`.
- `bodySessions`/`chatDocked`.
- `SessionPanel` and `SessionStrip`.
- The planning, tickets (Show/Hide plus its sessionStorage), run and shipped terminals.
- NextStepBar's `hideChat`, so the bar's Chat door is visible again, as decision 8 requires.

**Deviations:**
- With the terminal gone, `GrillBody` renders the artifact or map full width. Their collapse no longer had anything to make room for, so `ArtifactPane`'s `collapsed`/`onToggle` and the whole `artifactPaneCollapsed` state (`runcastle.artifact.collapsed`) were removed. `MapRail`'s `onToggle` is now optional.
- The Tickets tab now always shows for non-drafts, even while the ledger is the Overview body (it shows `PinnedTickets`).

**Surprises:**
- The full suite fails exactly one test, `packages/server/test/dev-pane.test.ts` "kills the child process tree…". It is server-side, untouched by this diff, and also fails when run alone, so I believe it is a sandbox fault. `project-drive.test.ts` failed once in the first full run, then passed alone and in the second full run.
- The web tsconfig does not flag unused imports. `ProjectWorkspace` already had unused `Button`/`StatusDot` imports, which I left alone.

**Left undone:**
- Landing on Chat from other launch paths (iterate, resolve, converge, workWaypoint, fixDrive, draft start) is for the ticket that centralises landing. Only the bar's Chat door lands on Chat today.
- Tab memory and addressable routes are not built.
- The `--artifact-w`, `--maprail-w` and `--chat-panel-w` tokens in `theme.css` are now unused.
- `mapRailCollapsed` is only passed to `PinnedBody`'s section layout, which ignores it.
- I did not run the app visually: the sandbox has no services. No drive machinery changed: no new service, env var, seed or process.

#### 3. Addressable tabs, per-feature tab memory, land on Chat from every session button, mount the notice deck

# Ticket 3: addressable tabs, tab memory, land on Chat, notice deck mount

## What was done
- **Routes** (`lib/routes.ts`): `FeatureView` / `FeatureTab` now live here, and `FeatureViewTabs` imports them. The feature location has an optional `tab: 'tickets'|'chat'`. `pathFor`, `parsePath` and `locationFor` (new `featureView` input) round-trip `/f/:slug`, `/tickets` and `/chat`. Any other 5th segment, `overview` included, parses as null. `featureViewOf(loc)` turns an absent tab into overview.
- **Tab state moved into `useWorkspace`** as `featureView`. `select(id, view = 'overview')` and `selectView(view)` write `runcastle.feature.tab:<featureId>`. They write on the deliberate act, not from an effect, so the mount-time guess never overwrites what was stored. Pure `initialTab({stored, hasLiveSession, isDraft})` and `rememberedView(id, listRow)` read the list row's `liveSession` and `status`.
- **`ProjectShell.openFeature(id, view?)`** replaces `ws.select` for the Sidebar, the palette and QuickForm. With no view, it restores the remembered one.
  - Landing: a URL tab wins. A bare feature URL, or a restored selection, uses the remembered tab.
  - popstate: a bare path means Overview exactly, so Back can reach it.
  - Drafts are forced to Overview in the location.
- **Land on Chat**: `lib/land-on-chat.ts` exports `useLandOnChat(featureId)`, a context the shell provides as `select(id, 'chat')`. It does nothing outside a shell.
  - Workspace lands from the `onSuccess` of the `launch`, `converge`, `workWaypoint` and `fixDrive` mutations. That covers Chat/Start, draft Start, iterate, the triage carry, stop drive & iterate, and End session & …. The burn road never lands.
  - `useResolveConflict` lands itself, which covers the bar, the conflict card and the merge dialog.
  - RunBody "Resolve in terminal", WaypointCard and DriveSetupFailed each call the hook.
  - A research waypoint returns `{runId}`, not a session, so it does not land.
  - Converge's `onViewPhase(null)` was dropped, because `select` already clears the pin.
- **Deck**: the new `chat/FeatureNoticeDeck.tsx` sits in ChatView's children slot in `FeatureChat` only, fed from Workspace's `useEventLog` plus `full.tickets` (so "Review ready" works).
  - It raises notices only while active, and only for events with `ts` at or after the moment Chat came to front. I used the timestamp rather than an id watermark because the log loads its whole history after mount.
  - View calls `onView(target)`, then `act`. The deck state lives per feature, since Workspace is keyed by feature.
- **Tests**: `routes`, `workspace-state` (initialTab and memory), `history-sync` (tab push, Back, reload), the new `land-on-chat.test.tsx` (the operation, the resolve hook, and a source ratchet that every module creating a feature-session launch mutation calls `useLandOnChat`), the new `feature-notice-deck.test.tsx`, and `chat-view` (the project chat has no deck).

## Surprises
- The full suite still fails only `packages/server/test/dev-pane.test.ts` › "kills the child process tree…". It is the same sandbox fault tickets 1 and 2 reported, and this diff touches no server code. Typecheck is clean.

## Left undone
- I could not run the app to click through reload and Back: the sandbox has no services. No drive machinery changed (no new service, env var, seed or process).
- Deck cards survive leaving and returning to Chat (they never expire). Only events that arrive while you are away are skipped.

#### 6. Verify the fixes that landed

Drive verification pass — pass #4, one landed fix, held

The fix for #5 holds: an ended project chat now looks like an ended feature chat. Open runcastle-demo, go to Project, and click an "Untitled chat" in the Chats list. You no longer get the separate read-back page. Instead you get the same layout as the feature Chat tab at rest:

- a strip naming the chat ("Project chat · lands on main");
- the transcript filling the content area;
- a centred "Resume the conversation" button at the bottom.

The old read-back page is gone: no top-right "Reopen" and no "Started …" line on any of the three ended chats. For comparison, Entry tags → Chat tab (`/f/entry-tags/chat`) shows the same structure: the "Chat · lap 1" strip, the transcript area and the same bottom Resume button. Both render through `[data-chat-view]`, labelled "Project chat" and "Feature chat".

I also clicked Resume on the ended project chat. It relaunched the session in place: the same ChatView, now live, with the session id and "End session" in the strip and a live terminal. Ending it returned to the project overview with a "session ended" toast. The browser logged no page errors during the tour.

Not a defect, just noted: reloading the page while an ended chat is open returns to the project overview rather than the chat. The chat selection has no URL of its own, the same as before this lap. As in pass #4, the bar's Chat door on a pre-existing feature could not launch in the drive environment, because the talk worktree was already held by the real install. That is an environment limit, not a regression.

The walkthrough is at `walkthrough.webm`. No findings were reported.

REVIEW-MODE: drive
REVIEW-VERDICT: verified
REVIEW-REASON: fix #5 held on the tour; ended project chat renders ChatView at rest, matching the feature Chat tab
