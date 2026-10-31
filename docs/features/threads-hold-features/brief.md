## Purpose

The human runs several orchestrator threads at once. On 2026-10-31 one thread received news about features another thread was running, gave one of them its go-ahead without knowing it wasn't its own, and the thread really running the work never heard the news. The human's words: "We might have to somehow give orchestrators a way to 'take' features so they get notified."

The cause is in `packages/server/src/services/orchestrator-notify.ts`. `notifyOrchestrator` sends every line to the project's newest project thread (`newestThread`), and `followedFeatures` counts a feature as followed if any orchestrator ever acted on it. So opening a new chat takes the news away from the thread doing the work. The catch-up list ("Since you were last live") has the same flaw: it is per project, not per thread.

This feature is first in the phone cut because it is useful alone and because "Agents can notify your phone" depends on it: holding decides who may notify the human.

## Understood (agreed with the human)

- A thread holds a feature once it creates it or first acts on it.
- News about a feature goes only to its holder, even when a newer chat exists. Runcastle's prompt already starts a thread with no running process, so a closed holder can still be reached.
- A thread that tries to act on a feature another thread holds is refused until it explicitly takes that feature. A refusal, not a warning: a warning relies on the agent listening, which is the slip that started this.
- Delivery is runcastle's own, not Claude Code's agent-to-agent messaging. That messaging only reaches a live Claude Code session and may not exist for Codex. The human suggested it, and it is the stopgap in use until this ships (threads forward each other's news by hand).

## Must not swallow

- Anything about phones or notifications to the human ("Agents can notify your phone").
- Features the human runs by hand becoming held. A feature with no holder stays the human's.
- Re-cutting the thread list or the open note about thread ordering.

## Open

- This replaces `one-orchestrator-no-mode` decision 3 (the orchestrator follows what it acted on), which is read from event stamps with no thread recorded on them. Decide what stores the holder, and whether a project-scope ADR is wanted; the project session writes that.
- Which acting tools are refused for a non-holder. `send_to_feature`, `plan_feature`, `start_feature`, `drive`, `stop_feature_run` and `merge_feature` are the obvious ones. Decide `add_to_brief` and `set_feature_dependencies`.
- What happens to features already in flight when this ships. Another thread is running a cut right now, so migration must not take features away from it or leave them unreachable.
- What happens to the holder when its thread is archived or deleted, or how a draft that starts itself (up next) stays with its holder.
- Whether the human can see who holds a feature. `one-orchestrator-no-mode` decision 15 chose to show no such list. A refusal should at least name the holding thread.
- Keep it small: solo scale, flexible guidance over brittle machinery.

## Ordering

First in this cut. "Agents show files in chat" and the rest start after it merges. "Agents can notify your phone" also needs it directly.

Fixes reach live sessions only after a release is published and installed, so the human keeps the forwarding stopgap until then.

## Working agreement

Agreed with the human for this whole cut (Threads hold features, Agents show files in chat, Review keeps its screenshots, Runcastle on your phone, Agents can notify your phone):

Checkpoints:
1. The human approves the phone view's design before "Runcastle on your phone" builds.
2. The human tries the finished phone link and a real notification on their actual phone, before those features merge.

Everything else is carried through to merged by the orchestrator without stopping. This feature has no checkpoint of its own. Publishing a release needs the human's yes.

## Added by the orchestrator, 2026-10-31

## Working agreement correction (orchestrator, 2026-10-31)

Checkpoint 2 splits in two, because notifications start only after the phone view merges: the human tries the phone link before "Runcastle on your phone" merges, and receives a real notification before "Agents can notify your phone" merges. This feature still has no checkpoint of its own.
