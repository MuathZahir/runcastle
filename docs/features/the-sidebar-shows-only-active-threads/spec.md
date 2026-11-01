# The sidebar shows only active threads

## Problem

The human works in one Orchestrator thread and later comes back to another. Today they have to remember "it was the second from the top". The list shows the five newest threads, mostly idle, in an order that looks random, under titles that are often just the first message cut short. They also can't see which thread holds which feature, or get from a feature to its thread.

## Approach

**What the human sees.** With the Orchestrator open, its card lists only active threads, newest started first, with no cap. "All N conversations" sits under them whenever any thread is not listed. Rows show no time. A thread that holds features in flight or up next ends with those features' progress rings, up to three and then "+N", and a thread holding none shows nothing after its title. Hovering a holding row names those features, and the row's "…" menu lists them above Rename and opens one. Threads are named by what they are about. Clicking Orchestrator opens the active thread with the latest activity, the Conversations page if none is active, or an empty new chat if the project has none. A feature's header starts with the thread holding it, and clicking that crumb opens the thread.

**The active rule.** A thread is active if any of these is true: its state is working or waiting (waiting meaning an open question, the list's existing state), it holds a feature in flight or up next, it is the thread in front, or the human wrote in it in the last 24 hours. A pure function in the sidebar threads module owns this, taking the thread, the thread in front, the project's features and the time. The sidebar's list and the Orchestrator's landing both use it, so they can't disagree. "In flight" is status active. "Up next" is a draft marked up next. The 24 hours is one named constant.

**What the server adds.** A thread entry gains when the human last wrote: the newest live prompt from the human that is not hidden, read from the fold of the log the list already keeps. An entry with no log has none. The feature list already carries who holds each feature, so holdings are derived in the web app from the query the sidebar already reads, with no new endpoint. The feature read gains the holder as id and title, using the existing holder lookup, and returns nothing once a feature has shipped.

**Naming.** Whether the runtime's title may name a thread now depends on the thread as well as its log: an Orchestrator thread may use it even after a briefing, and every other kind keeps today's rule. A generated title containing one of the junk phrases ("project session", "project skill", "resume conversation", any case) is ignored wherever a title is chosen, so a thread falls through to the human's first message. Only titles from the log are affected, so logged threads pick up their names at once and terminal-era threads stay as they are. The runtime-title check in the thread host and the name function share the rule. Renames still win. The name a holder goes by follows, because it is the same function.

**The Orchestrator's landing.** On arrival with no chat addressed, the page picks the Orchestrator chat with the latest activity among active threads, as today's pick does among all of them, and picks once. If none is active and chats exist, it replaces the address with the Conversations page rather than pushing it, so Back doesn't bounce. If the project has none, it opens an empty new chat. Closing a scenario errand lands by the same rule. Scenario chats are never picked. While an errand is open its row stays listed.

**Designed pieces.** The row and list changes are made in the sidebar's parts: a mark and tip per row (a row's mark replaces its age, and an empty mark means nothing shows), a filter on the list in place of the five, and the rings and names. The Orchestrator list passes these, and a feature's own thread list passes none, so it is unchanged. The action menu gains a rule after an item, and the tooltip can close as soon as the pointer leaves its trigger. The feature's header adds the holder as a first crumb capped at about 176px, and uses the quiet last-crumb treatment only when a thread crumb follows, so the feature stays the emphasised item. These are uncommitted until the human approves them, along with the preview pages `/preview/active-threads.html` and `/preview/held-feature.html`.

## Seams

- **Thread naming** (existing): the name function over a row and its events. Shows Orchestrator threads taking a good title after a briefing, junk falling back to the first message, renames winning, and feature threads unchanged.
- **Thread list read** (existing): the project's thread list. Shows the human's last-written time, including that hidden and rewound prompts don't count.
- **The active rule** (new): the pure function. Shows each of the four clauses, backlog holds not counting, and 24 hours as the edge.
- **The Orchestrator's landing** (new): a pure function from threads and features to "open this chat", "Conversations" or "new chat". Shows all three outcomes, with scenario chats never picked.
- **The sidebar thread list** (existing): static markup. Shows the filter, the rings with their "+N", no age on an Orchestrator row, the "All N conversations" row, and a feature's list unchanged with its ages.
- **The feature read** (existing): shows the holder while unshipped and none once shipped.

## Out of scope

- The Conversations page's list and grouping (its titles change only because a thread's name does).
- Threads under a feature, who holds a feature, and how holding works.
- Status truthfulness and thread loading speed, which are "Threads open fast and show the truth".
- The ADR-0016 amendment for showing holders in the app, which comes through the project session.
- A way to hide a row by hand.
- Renaming terminal-era threads.

## Open questions

- Whether Codex sends a title: this machine has no Codex threads. Either answer works (decision 8).
- "Runcastle on your phone" is reworking the sidebar for small screens, so whichever lands second may have conflicts in the sidebar's parts. Hover does not exist on a phone, which is why the "…" menu carries the same list.
- The holder's place on the feature page is an open Tweak for the human.
