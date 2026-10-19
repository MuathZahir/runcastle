# Brief

## Why this feature exists

The human wants runcastle to feel like an IDE, where you see what you are building and not only a list of changes. Today the sidebar answers "what needs me right now?". That is right for supervising agents and must survive, but it cannot answer "what is my app?".

**History, so nothing rejected is rebuilt (project session, 2026-10-17/18):**
- **"Areas" were rejected:** code globs, a doc per area, and a page of "work that touched X". The human: "The 'Work that touched …' isn't enough." Descriptions of code rot, and a page of collected links answers no question.
- **The first map was built on captures:** screenshots refreshed at merge and a before/after timeline per entry. The capture design was rejected as overengineered and too expensive, since it started the app repeatedly. That draft, *The map*, is archived.
- **This map is rebuilt on things that already exist and cost nothing to show:**
  - stories, from *Features show their UI states as stories*;
  - scenarios and `.http` calls, from the shipped *Drive scenarios*.

## Settled in the project session

1. **Sidebar, top to bottom:**
   - Talk to runcastle;
   - **Inbox**, pinned whatever view is open, counting only items waiting for the human;
   - a **Work | Map** switch, where Work is today's list.
   Chats are never listed in the sidebar.
2. **The map is grouped by product name** (Checkout, Auth), two levels at most. Each group pulls together:
   - **UI states:** that group's stories, rendered live from the static catalogue, with no app start;
   - **ways in:** its scenarios, each with *Open in drive*;
   - **calls:** its `.http` requests, each with *Try it*, which needs a running drive.
3. **Grouping is name matching, never tagging.** A story titled `Checkout/CouponField` and a scenario at `.runcastle/scenarios/checkout/` land in the same group. Only paths and text are involved, with no manifest and no globs.
4. **History comes from git:** each entry shows which features changed its story or scenario file, and when ("Coupons, Oct 12"). It cannot drift, and there is no capture timeline.
5. **Features and the map are decoupled views,** like source control and the explorer in an IDE. Neither owns the other, and nothing is tagged by hand.
6. **Runcastle never renders components itself.** It embeds the project's built catalogue, as the stories feature settles.

## The risk this feature must face honestly

Storybook already has its own sidebar of components. The map earns its place only by **pulling stories, scenarios and calls together in one place, with the feature history beside each entry**. If that combination doesn't hold up in use, don't build more of it.

## What this feature must decide in its own session

- **Empty states:**
  - a project with scenarios but no stories;
  - a backend-only project (calls only);
  - a project with neither.
- **Whether in-flight features show on entries,** e.g. "Coupons changes this, on its branch", since the branch diff says so.
- **Which catalogue build the map shows:** main's latest. Also when it is rebuilt after a merge.
- **The project home page,** now that Work, Map and the Inbox exist.

## What this feature must NOT swallow

- **Setting up stories and showing them on the feature page.** The stories feature owns both.
- **The scenario contract and the drive picker.** *Drive scenarios* owns them.

## Binding

- **Charter:** individual developers first; language-agnostic by construction; starting the app is the expensive step. The map never starts the app to show itself.
- **Design system:** `apps/web/DESIGN.md` (neutral greys, one accent, sentence case). The sidebar's existing attention grouping must not get worse.
