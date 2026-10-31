# Decisions — Threads hold features

Planned with no human present (2026-10-31). Every decision below is the planner's until the human confirms it. The brief's own "Understood" list is the human's and is not repeated here.

## 1. The holder is one field on the feature
**Decision:** A feature row carries the id of the thread that holds it, or nothing. That field is the only answer to "who hears about this and who may act on it". It replaces `one-orchestrator-no-mode` decision 3 (followed features read from event stamps), and the words "no hidden ownership list" in its decision 2.
**Why:** The stamps say an orchestrator acted, never which thread, and an explicit take has to be able to override history. One field is the smallest thing that can do that.
**Assumed.** Alternative: add the thread id to the event stamp and read the holder as the latest stamp.

## 2. Every tool that changes a feature needs the hold
**Decision:** `send_to_feature`, `plan_feature`, `start_feature`, `drive` on a feature, `stop_feature_run`, `merge_feature`, `add_to_brief` and `set_feature_dependencies` (on the draft it reorders) all follow one rule. On a feature with no holder the call succeeds and the thread now holds it. On a feature held by this thread it succeeds. On a feature another thread holds it is refused, and the refusal names that thread. Reads never hold and are never refused: `get_feature_context`, `read_feature_chat`, `get_work_record` and the rest. A drive of the base branch touches no feature and is not affected.
**Why:** One rule is easier to trust than a list of exceptions. `add_to_brief` changes what the feature's agent reads, and `set_feature_dependencies` changes the order the holder is working to. Either one from a second thread is the same slip as the go-ahead that started this.
**Assumed.** Alternative: leave `add_to_brief` and `set_feature_dependencies` open to every thread, since neither starts any work.

## 3. Taking is its own tool and always works
**Decision:** A new tool, `take_feature({ slug })`, makes the calling thread the holder of any unshipped feature in its project, held or not, with no agent woken on the feature. It is refused only on a shipped feature. The thread that lost the feature gets one news line saying which thread took it and that it will hear nothing more. There is no release tool.
**Why:** The refusal needs one clear way past it. Telling the old holder matters because a thread mid-cut may be waiting on news that will now never reach it. Taking an unheld feature also gives a thread a way to start hearing about a feature without interrupting its agent, which was the challenge raised against `one-orchestrator-no-mode` decision 3.
**Assumed.** Alternative: the old holder is not told, and finds out from a refusal the next time it acts.

## 4. Holding binds threads, never the human
**Decision:** The human's buttons, and the feature's own agent, ignore holding entirely. The human stepping into a held feature's chat, driving it or merging it changes nothing about who holds it: the holder keeps hearing about it, as `one-orchestrator-no-mode` decision 14 wants for a feature the human steps into during a cut. A feature nobody holds stays the human's, and no human action creates a holder.
**Why:** Holding exists to stop threads colliding. A refusal aimed at the human would turn a routing fix into a lock on their own project, and it is why no release tool is needed.
**Assumed.** Alternative: the human opening a held feature's chat releases it.

## 5. The catch-up list goes
**Decision:** The "Since you were last live" section of a new project thread's briefing is removed, with the code behind it. It is not rebuilt per thread.
**Why:** Only a brand-new thread ever reads it, and a brand-new thread holds nothing, so a per-thread list is always empty. A thread that holds something hears its news as it happens, closed or not, because news starts it.
**Assumed.** Alternative: keep a per-thread list and show it each time a thread is reopened.
**Challenged:** the brief asked to fix the list, not delete it, and a thread with no holds may still want to know what is running; removing something the human can see should be their call.

## 6. Threads see holders in the portfolio; the human sees them on the timeline
**Decision:** The feature index in `get_project_context` and `get_feature_context` both name the holding thread, by the name the thread list shows. A hold and a take each put one line on the feature's timeline in Details. Nothing else in the app changes: no badge, no list, no "Held by" on the feature page. This narrows `one-orchestrator-no-mode` decision 15, which showed nothing anywhere.
**Why:** A thread needs the holder before it acts, so it does not walk into refusals. The human can ask any thread, or read the timeline. The brief asks for the refusal to name the thread and warns against re-cutting the thread list; a badge is a separate wish.
**Assumed.** Alternative: a "Held by <thread>" line on the feature page that opens that thread.

## 7. Features in flight get their real holder at first boot
**Decision:** One sweep, run once per project on the first boot after this ships, gives a holder to every unshipped feature that has an orchestrator-stamped event. It walks the feature's stamped events from newest to oldest and stops at the first one with an acting runcastle tool call in a project thread's log nearby, within the two minutes before it; the thread with the nearest call holds the feature. A feature the match cannot place stays unheld, and its timeline says so. There is no fallback to the newest thread.
**Why:** The brief forbids taking features from the thread running them or leaving them unreachable. Leaving them all unheld would silence news to a running cut until each next act. Tool arguments are not in the log, so the slug cannot be read from it, but timing can match. Run read-only against today's data, it placed all 13 in-flight features on the two threads actually working them, with no ties. A later run on a copy of the database showed why it walks back: one running feature's newest stamped event was a docs checkpoint with no tool call near it. Running once means a later boot cannot place a feature that has since been left unheld on purpose.
**Assumed.** Alternative: no sweep. In-flight features start unheld, keep going to the newest thread for now, and the first thread to act on each one holds it.
**Challenged:** a timing match with a fallback is a lot of machinery for one migration and can assign wrongly without saying so on a day of overlapping activity; the alternative is simpler at solo scale, at the cost of news going to the newest thread for a short while.
**Changed by the orchestrator:** the fallback to the newest thread is removed, because it could silently take a feature from the thread running it, which the brief forbids; an unplaced feature stays unheld and the timeline says so. The sweep runs once rather than on every boot.

## 8. An ADR, written by the project session after merge
**Decision:** Holding is worth a project-scope ADR, because it reverses the "no ownership" call of `one-orchestrator-no-mode` decision 2. The project session writes it once this merges; this feature does not touch `docs/adr/` or `CONTEXT.md`.
**Why:** It is a lasting rule about who may act, and without an ADR a later reader finds only the old answer, in that feature's docs.
**Assumed.** Alternative: no ADR; this feature's decisions are the record.

## 9. The human's own request is enough to take; a cut's judgement is not
**Decision:** When a refusal comes back, the thread takes the feature only if the human, in this conversation, asked for this action on this feature, and it says so in its reply ("took X from <thread>"). In every other case, a working agreement and its own judgement included, it stops and tells the human which thread holds the feature. This lives in the project skill; the server does not check it.
**Why:** Asking "are you sure?" after the human has named the feature adds a turn and protects nothing, since the slip that started this came from news, not from the human. Inside a cut nobody is watching, so taking on judgement would let two cuts fight over a feature.
**Assumed.** Alternative: always ask the human before taking, even when they named the feature.

## 10. A hold lasts as long as the feature, and survives a chat too long to reopen
**Decision:** A hold stays through backlog, start, archive and unarchive, and ends only by a take or with the feature. Project threads have no archive or delete, so a holder cannot vanish. The one case where a thread is replaced is the re-entry cap, where reopening a chat grown too long opens a new thread instead: the new thread inherits everything the old one held, and its opening briefing lists those features.
**Why:** The brief's question about archived or deleted holders has a short answer, because a thread keeps its row for life. Without the inheritance, the human reopening their cut's chat would get a thread that is refused on its own features while the news wakes the old one.
**Assumed.** Alternative: no inheritance; the replacement thread takes each feature by hand.
**Challenged:** inheritance is a new code path for one case; treating the replacement like any other thread, which takes what it needs, is simpler (a weak preference).

## 11. The holder hears when its draft starts by itself, or fails to
**Decision:** Three more kinds of news reach a holder: its draft started by itself, it was skipped, or it failed to start. The first line says nothing is working on the feature yet.
**Why:** Starting by itself launches no agent, so a held draft can sit started with nobody planning it. Today's only hint is the shipped line about its dependency, and that now goes to the dependency's holder, which may be another thread.
**Assumed.** Alternative: no new lines; the holder of the dependency tells the other thread, or the human does.

## 12. A closed holder is woken for endings, not for the human's comings and goings
**Decision:** News that something ended or waits on it (a round, a plan, a waiting agent, a merge) starts a closed holder, as the brief says. News that the human opened a chat, went quiet, or started or stopped a drive reaches a holder only while its process runs, and is dropped otherwise. The project skill's sentence that nothing relaunches a closed project chat is corrected, because it is not true today and stays untrue.
**Why:** Those lines tell a working thread to wait or carry on. A closed thread is doing neither, and each one would cost a turn and grow an old chat every time the human opens a feature it holds. It reads the current state when something next wakes it.
**Assumed.** Alternative: every line wakes the holder, as every line wakes the newest thread today.
**Challenged:** two kinds of news with different wake rules is carried machinery; waking on every line is simpler and predictable, and the split should wait until the noise is a real problem.

## 13. Only a thread creating a feature holds it from the start
**Decision:** `create_feature` from a project thread makes that thread the holder. A feature the human creates in the app, or a draft a feature's agent parks in the backlog, starts with no holder and stays the human's until a thread acts on it or takes it.
**Why:** It follows the brief ("once it creates it") and keeps its promise that hand-run work is never held. A draft parked by a feature's agent came from a chat, not from an orchestrator's cut.
**Assumed.** Alternative: a draft parked by a feature's agent goes to the thread holding that feature.

## 14. A stuck holder is handled by a take, and news stays best effort
**Decision:** If a holder is wedged or its agent will not start, the way out is the human telling another thread to take the feature. A line that cannot be delivered is logged as it is today and is not rerouted to another thread. When two takes race, the later one wins, and each loser hears the usual line.
**Why:** Rerouting a lost line to a newer thread would bring back the slip this feature removes. A take always works, so a dead holder cannot lock a feature.
**Assumed.** Alternative: after a failed delivery, fall back to the newest thread.
