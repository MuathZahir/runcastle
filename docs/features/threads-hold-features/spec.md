# Threads hold features

## Problem

The human runs several orchestrator threads at once. Today runcastle's news about any feature goes to the project's newest thread, so opening a new chat silently takes the news away from the thread doing the work. On 2026-10-31 a thread received news about features another thread was running, gave one its go-ahead without knowing it wasn't its own, and the thread really running the work never heard.

## Approach

**For the human.** Each orchestrator thread holds the features it created or acted on. News about a feature goes to its holder and no other thread, even if the holder's process has stopped and a newer chat exists. A thread that tries to act on a feature another thread holds is refused, and the refusal names the holder. To move a feature, the human tells a thread to take it. Features the human runs by hand, and the human's own buttons, are not touched by any of this.

**The holder.** One new nullable column on the feature row holds a thread id. It is exposed on the feature wire type, and everything else reads it. It replaces "followed", which was derived from `actor: 'orchestrator'` event stamps. The stamp itself stays: the notifier still uses it to avoid repeating back what a thread's own call just answered.

**A holding service.** One small service owns the rule, and nothing else writes the column:

- Read the holder of a feature, and the name to show for it (the name the thread list shows: `threadName`, since most project rows have a null `title`). "Agents can notify your phone" reads this too.
- Require the hold for an acting call: claim on a feature with no holder, pass for this thread, refuse with a `GateError` naming the holder and saying that `take_feature` moves it. The one claim emits `feature.held`, with `data.threadId`.
- Take: set this thread, refused on a shipped feature, emits `feature.taken` with `data.from` and `data.threadId`. Later writer wins.
- Inherit: move every hold from one thread to another, for the re-entry cap.
- Sweep: the boot assignment for features in flight.

**Acting tools.** `requireProjectFeature` stays for reads. A new requirement on top of it guards `toolStartFeature`, `toolPlanFeature`, `toolStopFeatureRun`, `toolDrive` when a slug is given, `toolMergeFeature`, `toolAddToBrief`, `toolSendToFeature` and `set_feature_dependencies` (on the dependent only; the features it names are read, not acted on). `toolReadFeatureChat` keeps the plain lookup. `toolCreateFeature` from a project thread sets the holder as it creates. `take_feature` joins the orchestrator tools, the per-kind tool map and the session's allowed-tool list.

**News.** `notifyOrchestrator` resolves the event's feature, then its holder, and sends to that thread alone. With no holder there is no line. `orchestratorLineFor` stays pure: its state carries the holder rather than `followed`.

- `newestThread` is no longer used by the notifier. Lines still gather per thread for 300 ms.
- Three new END lines: `feature.started` with `data.autoStartedBy`, `AUTOSTART_SKIPPED`, `AUTOSTART_FAILED`. The first says nothing is working on the feature yet.
- `feature.taken` makes one line, sent to `data.from`, naming the new holder.
- ACT lines are dropped when the holder's process is not running (the host's `isRunning`). END lines start it, as `prompt` does today.
- A failed delivery is logged and not rerouted.

**Catch-up.** `orchestratorCatchUp`, the `catchUp` launch input and both briefing lines go. The one exception is below.

**Re-entry cap.** When `launchProjectSession` opens a new thread because the named one is past the cap, it moves that thread's holds to the new one, and the kickoff lists the features it now holds. A new thread with nothing inherited gets no line.

**Boot sweep.** Once per project, before the notifier starts. A project-level `holders.swept` event is the marker: a project that has one is skipped, so a later boot cannot place a feature left unheld on purpose. For each unshipped feature with no holder and at least one `actor: 'orchestrator'` event: read each project thread's log for acting runcastle tool calls (`mcp__runcastle__<tool>`, in the log's `title`), walk the feature's stamped events from newest to oldest, and stop at the first with a call from two minutes before it to three seconds after (a call can be logged a moment after the server handled it). The thread with the nearest call holds the feature. The walk matters because the newest stamped event can be a side effect, such as a docs checkpoint, with no call near it. Log arguments are not recorded, so the match is by time. A placed feature emits `feature.held` with `data.swept: true`. A feature no call matches stays unheld and emits `feature.hold_unplaced`, which puts a line on its timeline. There is no fallback to the newest thread. A read-only trial on 2026-10-31 placed all 13 in-flight features on the two threads really working them.

Exact shape of the rule, which pins decision 2:

```
act(thread, feature):
  no holder        → holder := thread, emit feature.held, go on
  holder = thread  → go on
  otherwise        → refuse, naming the holder; suggest take_feature
```

**Portfolio.** `featureIndexLine` trails `held by "<thread>"`, and for the calling thread `held by you`. `get_feature_context({ slug })` returns the holder's name.

**Skill text (project pack).** Replace "You hear about the features you have acted on", the follow advice, and "Your tools work on any feature". Add the `take_feature` entry and the refusal rule from decision 9: take only when the human asked for this action on this feature, say so in the reply, and otherwise stop and name the holder. Correct "nothing relaunches you", because news does. Update the event table at the top of the notifier. `CLAUDE.md`'s tool count moves to 25.

**Build.** The lead builds this itself in one window. The work is one sequence through one service, the notifier and the tools. Nothing splits into parallel pieces worth a container each.

## Seams

- `orchestratorLineFor(event, state)` — existing, pure. Which lines exist and for whom: new END lines, the take line, ACT dropped when not running.
- `startOrchestratorNotifier` with a fake host — existing seam of the notifier test. Delivery goes to the holder when a newer thread exists, a closed holder gets END lines, an unheld feature gets nothing.
- `tool*` functions with a session row — existing. Each acting tool: claim, pass, refuse; the refusal text names the holder; reads neither claim nor refuse; `set_feature_dependencies` guards only the dependent.
- `toolTakeFeature` — new, the highest point for take: moves the hold, tells the old holder, refused on shipped.
- `sweepHolders(ctx)` — new, boot. Given thread logs and events, which thread is chosen; an unmatched feature stays unheld with a timeline line; a second run changes nothing, even for a feature left unheld since.
- `launchProjectSession` past the cap — existing. Holds move, and the kickoff lists them.
- `featureIndexLine` — existing. The holder mark.

## Out of scope

- Anything about phones or notifying the human (`agents-can-notify-your-phone`). It reads the holder when it is built.
- Any app screen. The timeline shows `feature.held` and `feature.taken` through what it already renders.
- Re-cutting the thread list or the open note about thread ordering.
- A release tool, or holds on feature chats.
- The ADR and any `CONTEXT.md` change, which the project session writes after merge.
- Publishing a release, which needs the human's yes. The human keeps forwarding news by hand until then.

## Open questions

- News stays best effort. If a holder's agent will not start, the cut stalls with only a log line, as it does today. This should be revisited if it happens in practice.
- A feature held by a thread the human abandoned keeps waking that thread for endings until the feature ships or is taken. Decision 12 limits this and does not remove it.
