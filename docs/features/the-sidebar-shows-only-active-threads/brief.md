## Purpose

The human works in one orchestrator thread, then comes back to an older one, and today has to remember "it was the second from the top". The list runs to five rows of mostly idle threads, in an order that looks random, under titles that often don't say what the thread is about. With orchestrator threads now holding features, they also can't see which thread holds what.

The job is finding your way back to a thread. A short list removes the need to remember a position, and good names let you recognise a thread at a glance.

From project notes triage on 2026-10-31. The original note: "Ordering of threads doesn't make much sense. I feel like we need active (need to define what "active" means) threads to be at the top (if not make it so that the threads showing are just the active ones. Maybe if I just opened runcastle, when clicking orchestrator it takes me to the conversations list.. Need to decide still". Screenshot: C:\Users\user\.runcastle\project-notes\pnote_03tklmhGX2Jm.png

## Understood (agreed with the human)

**Only active threads show in the Orchestrator's sidebar list.** A thread is active if any of these is true:
- it is working or waiting on the human;
- it holds a feature that is in flight or up next (a backlog feature does not count);
- it is the thread open now;
- the human wrote in it in the last 24 hours.

The 24-hour rule is there so a talk-only thread doesn't vanish the moment you click away, which is exactly the "come back to an older one" case. If it proves wrong it is one number to change.

**The order is fixed.** Active threads sort by when they started, so nothing moves under the pointer. There is no five-row cap, because the rule itself keeps the list short. Everything else lives on the Conversations page ("All N conversations" stays the way there), which already lists active chats first and then by last activity.

**Threads are named by what they're about.** Claude Code already generates a title for each conversation (`ai-title` entries in the transcript). Runcastle throws it away on orchestrator threads: `runtimeMayName` in `packages/server/src/threads/naming.ts` refuses it once runcastle's own briefing reached the conversation, so the title falls back to the human's first message cut short. The human asked for auto-naming; the agreed answer is to use the runtime's title and fall back to the first message when it is junk. Of the 13 most recent orchestrator threads with a generated title, 9 were useful ("Running Runcastle on a remote VPS", "Runcastle desktop app feasibility") and 4 said "Runcastle project session". A human's rename still wins over everything. Claude sets the title once and does not update it; that was accepted.

**You can see which threads hold features.** The human can tell at a glance which orchestrator threads hold features, without adding a line or a label: the thread row only fits the title and the age, and the human rejected a "3 features" label for that reason. The reverse is wanted too: a feature's page names the thread holding it, so you can go straight from a feature to its orchestrator. This reverses part of ADR-0016 ("Orchestrator threads hold features"), which said the human sees no "Held by" line in the app. That is the human's decision; an ADR amendment comes through the project session.

**Clicking Orchestrator:** if any thread is active, it opens one (the one with the latest activity when several are). If none is, it goes to the Conversations page. Today it opens the chat with the most recent activity, per decision 13 of `docs/features/the-orchestrator-s-page/decisions.md`.

## What this overturns

- `docs/features/threads-in-the-sidebar/decisions.md` decision 3: the five-row cap, and showing idle threads, for the Orchestrator's list. Its reason for sorting by start time (rows must not jump while agents post) still holds and is kept. Under a feature, threads are out of scope and stay as they are.
- `chat-as-web-components` decision 14, as far as it stops runtime titles naming briefed threads.

## Must not swallow

- The Conversations page's own list and grouping.
- The threads shown under a feature.
- Who holds a feature, or how holding works: this only shows it.
- Status truthfulness and thread loading speed: those are "Threads open fast and show the truth".
- Redesigning the rest of the sidebar.

## Open

- How holding shows on a row with no room for a label. One idea: a bare number in the age's spot, since age matters less in an active-only list. Where the feature names show (hover, or the thread).
- Does Codex give a generated title at all, and is it usable? Only Claude's were checked.
- How to spot a junk generated title. "Runcastle project session" is the one seen, and any rule must stay simple and not parse content beyond that.
- What a row says when a thread is active only because it holds a feature and nothing is happening.
- Whether renaming, the "..." menu and the fold behave unchanged on the shorter list.

## Design

**The human requires this feature's design work to use the `/frontend-design` skill.** It is a plugin skill at `C:\Users\user\.claude\plugins\marketplaces\claude-plugins-official\plugins\frontend-design\skills\frontend-design\SKILL.md`. If your session doesn't list it, read that file and follow it; don't conclude it isn't installed. Read `apps/web/STYLE.md` too. Show directions through design mode; the human steers visual work directly.

## Ordering

Starts now, from `main`. "Threads open fast and show the truth" is up next after this merges, only to avoid competing for the machine, not because it needs anything from this feature. "Runcastle on your phone" is in flight and will rework the sidebar for small screens, so whichever lands second may have conflicts to resolve.

Holding is on `main` but not in the installed runcastle 1.6.0, so a session on the installed version sees no holders in its own tools; the code on the branch has them.

## Working agreement

Agreed with the human for this cut (this feature and "Threads open fast and show the truth"), 2026-10-31:

Checkpoints: the human approves this feature's sidebar designs before it builds. Stop there and show the designs. Everything else is carried through to merged by the orchestrator without stopping. Publishing a release needs the human's yes.
