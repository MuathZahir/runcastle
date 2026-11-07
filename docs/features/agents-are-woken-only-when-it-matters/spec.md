# Agents are woken only when it matters

## Problem

The orchestrator (the project chat that holds features and carries them to
merge) is started for a new turn by runcastle's `[runcastle]` news lines about
everything that happens on its features. Over the fortnight analysed, 57% of its
context tokens went to turns those lines started, and half of those turns only
replied "noted". The human watched it get pinged about fifteen times during one
grill. Meanwhile the one thing it needed to hear could go unsaid: a lead that
answers "the branch is ready to merge" in its own chat tells nobody.

Machine events with no agent behind them fall through the other way. A server
restart cuts every chat off mid-turn and nothing tells them to carry on; a usage
limit stops a turn and nothing picks it up when the limit resets. And the
orchestrator's chat is never compacted, carrying 190k–352k tokens into every
turn.

## Approach

**Agents talk by tool call** (decisions 19–22). runcastle no longer decides which
of its news lines reach the orchestrator. A lead tells the orchestrator by calling
`hand_back({ summary })`, the same tool a worker hands back to its lead with
(`interactive-workers`), one level up. The summary says what is done, what is
left and what the lead needs, including anything the human told it directly.
runcastle adds one line of the feature's state (ready to test or not, whether it
waits on the human and why, the latest round) and delivers it to the orchestrator
thread that holds the feature as a handback card, waking it once. The orchestrator
answers by replying (`send_to_feature`), merging, or doing nothing. With no
orchestrator holding the feature the tool is refused and says so.

The lead's skill says when to hand back, and only while an orchestrator holds the
feature: the work is ready (declared ready, or the human said it is good to
merge); it finished something the orchestrator asked for; or it is blocked on
something the orchestrator can settle (a decision the cut's working agreement
covers, a sibling clash, a dependency). A question only the human can answer
stays the human's ping. `wait_for_you` and `declare_ready` keep pinging the human
and showing "needs you", but send the orchestrator nothing.

**Machine events go to the agent that owns the work** (decisions 23–25).

- *The orchestrator* hears only of its own work, and each wakes it: a drive it
  started failed to start; a backlog feature it holds started by itself or could
  not start; a lead it messaged could not be woken. Every other news line is
  removed: rounds, reviews, planning runs, the human's chats, drives, merges and
  their conflicts, and another chat taking a feature. Nothing is held for the
  orchestrator, so the held-news label ("For its next turn") and the keyed
  replacing of held lines are removed.
- *A restart*: once the server is back, each lead or orchestrator chat that was
  cut off mid-turn (the boot reconcile already finds them) gets one runcastle
  message, "a server restart cut off your turn; carry on where you were", which
  wakes it. A lead whose round was cut off is skipped (its round message already
  goes), as are side chats and workers. A chat cut off while waiting on a
  permission or question is woken too and asks again.
- *The usage limit*: one install-wide setting on Settings' General page, "Carry on
  when the usage limit resets", off by default. Whenever the limit stops a turn,
  that chat shows one quiet line: off, "The usage limit stopped this turn.
  Runcastle can carry on by itself when the limit resets.", with "carry on by
  itself" opening the setting (the existing message-with-settings-link pattern);
  on, "Runcastle carries on at <time>." While the limit is known to be hit,
  runcastle's own messages are held rather than sent into it. With the setting on,
  each stopped chat is woken once at the reset the runtime's usage read reports,
  turns the human's own messages started included, and what was held rides that
  wake; a repeat hit waits for the next reset. With it off, nothing wakes and the
  held text rides the human's next message. An unknown reset time wakes nothing.

**Stop** (decision 10, as built). The Stop notice reaches a lead whose turn is
running, or waiting on an ask, at that turn's end, and is held for an idle lead's
next message.

**Orchestrator chats are compacted like leads** (decision 26). The automatic
compaction `lead-chats-stay-small` built for feature leads also applies to
orchestrator (project) threads: the same quiet moments (before an idle stop,
before a turn after a long gap), the same 150k-token floor, the same divider. The
orchestrator's compaction instructions and the project skill tell it to re-read
`get_project_context` and the briefs of the features it holds before acting. The
launcher's 1 MB resume cap stops starting fresh orchestrator chats.

**No micromanaging** (decision 27). No skill guidance on how agents read, and the
round-return message to a lead loses its "no need to fetch again" line.

**What survives from the first build.** The thread host's held prompts (logged
`held`, kept on disk until the prompt carrying them is sent, kept through an edit)
stay: Stop and the usage limit use them. The orchestrator notifier keeps its
event subscription and gathering, with its table cut to the three events above.
The shared wake tag stays for lead messages. Held prompts still never end a
lead's wait on the human or show as waiting to start.

## Seams

- **The orchestrator line function (existing, pure)** — returns a line only for
  the three events; a table test pins that every other event gives none.
- **The lead's `hand_back` tool (new, in the MCP server's lead tool set)** — with
  a holder: the holder gets one runcastle prompt whose display is a feature
  handback card carrying the summary and the state line; without one: refused.
- **The feature handback card (existing component, new variant)** — renders the
  feature's title, "handed back", the state line, the summary and "Open its chat".
- **Boot reconcile (existing)** — returns the chats it found cut off mid-turn; a
  test observes the carry-on prompt reaching each lead and orchestrator chat, and
  none for a side chat, a worker, or a lead whose round wake goes.
- **The agent host with the fake runtime (existing)** — usage limit: the notice
  line in both settings; held runcastle prompts during the limit; with the setting
  on, one wake at the reset for runcastle- and human-started turns alike; with it
  off, none.
- **The settings descriptor and General page (existing)** — the new setting reads,
  writes and renders; the chat's notice opens it.
- **The agent host's automatic compaction (existing)** — an orchestrator thread
  above the floor is compacted at the same moments as a lead.
- **The project launch (existing)** — an orchestrator thread over 1 MB resumes.
- **Skill text tests (existing)** — the lead's hand-back rule, the project skill's
  news paragraph, the re-read after compaction.

## Out of scope

- Workers' own handback, failure and messaging (`interactive-workers`, merged).
- Compaction of feature leads (`lead-chats-stay-small`, merged).
- Retiring rounds (`burns-become-workers`).
- Any rule for how agents read or use sub-agents (decision 27).
- A tool or setting to ask for extra wakes.

## Open questions

- Whether Claude Code resumes a compacted conversation from its last compaction
  regardless of the transcript file's size; checked by hand while building.
- Live sessions run the globally installed runcastle, so the behaviour is checked
  by hand-starting this branch's server.
