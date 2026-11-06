# Agents are woken only when it matters

## Problem

The orchestrator (the project thread that holds features and carries them to
merged) is started for a new turn by every `[runcastle]` news line about its
features. Over the fortnight analysed, 57% of its context tokens went to turns
those lines started, and half of those turns only replied "noted". Lines that
belong together (a "waits for you" and a "finished planning" for the same
feature) arrive tens of seconds apart and cost two turns, sometimes two messages
to the same lead. Background sub-agents finishing wake it once each.

Three failures sit on top of the waste. News restarts orchestrator chats that
are far too large, because the size check that stops the human reopening one is
skipped on the news path, so contexts reach 190–352k and never shrink. News
delivered while the provider's usage limit is hit is never acted on until the
human types "continue". And a feature's lead is woken for things that ask
nothing of it (a Stop while it sits idle), then re-fetches what its round's
return message already told it.

## Approach

**One rule.** A parent agent is woken only by a **handback** (the child's work
came back) or a **real question** it must answer. Everything else is **held**:
logged in the chat at once, and added to the agent's next prompt, whoever sends
it. A held message never starts a turn and is never lost. One shared function
decides wake or hold for every runcastle message to an orchestrator or a lead,
so workers can adopt it later unchanged.

**Orchestrator news.** The notifier keeps its event table and gathering window
(300 ms) and adds a wake/hold class to each line (decisions 3–5):

| Line | Class |
|---|---|
| lead waits for the human | wake |
| lead declared ready | wake |
| round failed | wake |
| test drive failed to start | wake |
| shipped (merged by the human) | wake |
| draft started by itself / could not start | wake |
| could not wake the lead | wake |
| self-planning run ended, feature not waiting on the human | wake |
| self-planning run ended, feature already waiting on the human | hold |
| round finished | hold |
| round cut off by a restart | hold |
| review / verification pass finished or failed | hold |
| another thread took the feature | hold |
| the human's own merge conflicted, or a conflict was resolved (decision 18) | hold |
| human talking to a chat / chat went quiet (running holder only) | hold |
| human started / stopped a test drive (running holder only) | hold |
| human had a feature plan itself (running holder only) | hold |

A gathered batch with any waking line goes out as one prompt, carrying every
held line ahead of it. A batch of only held lines is held. The dead
`session.run_ended` lines (nothing emits that event any more) are removed.

**Held lines that answer each other** (decision 13). A held line can carry a
replace key; a newer held line with the same key replaces the older one in what
the agent will read. The human-activity pairs use it: "chat went quiet"
replaces "talking to its chat", "stopped the test drive" replaces "started a
test drive", per feature. The chat history still shows both news blocks; only
the agent's next prompt is trimmed. This turns the thread host's held preface
from one string into an ordered list of entries, still kept on disk beside the
thread log.

**Held news looks held** (decision 12). The prompt display for a held delivery
is flagged, and the chat's news block shows "For its next turn" beside its time
in the same tertiary text. No other screen changes, so nothing was designed.

**Oversized orchestrator chats are compacted in place** (decisions 16, 17).
`lead-chats-stay-small` gives the agent host automatic compaction for feature
leads: the existing compact path (the runtime's `/compact` as a hidden prompt),
run above a context threshold before an idle stop and before a turn after a long
gap, plus the runtime's own mid-turn auto-compact ceiling, invisible to feature
state, with keep-instructions and a re-read of the record afterwards. This
feature extends those same triggers to orchestrator threads and builds no second
mechanism. Because the before-a-turn trigger sits in the host's turn path, a news
wake that restarts a stopped orchestrator compacts it first, which closes the gap
the brief found. The orchestrator's keep-instructions and the project skill say:
after a compaction, re-read `get_project_context` and the briefs of the held
features (each carries its cut's working agreement) before acting. The thread,
its holds and its held lines stay where they are. The launcher's resume cap stops
starting fresh orchestrator chats, since its 1 MB test measures the whole
transcript file and not the context after the last compaction. If resuming a
transcript over 1 MB proves unworkable even after compaction, a hand-over to a
fresh chat comes back as the fallback, and the report says why.

This part is built last, after `lead-chats-stay-small` merges to main and this
branch takes main (decision 17).

**Usage limit** (decision 9). When a turn runcastle started (news, or a message
to a lead) ends with the provider's usage-limit reply, recognised with the same
classifier the burner and rounds already use for provider halts, the thread host
holds that prompt's text again and schedules one wake for the reset time the
runtime's usage read reports. The wake is a short runcastle line saying the limit
reset and the news it carries was not acted on; the held text rides it. No known
reset time: the text stays held for the next prompt. A re-sent turn that hits the
limit again waits for the next reset, so each message is tried at most once per
usage window. The timer lives in memory; a server restart loses only the timer,
not the held text. A human's own prompt that hits the limit is untouched.

**Lead messages** (decisions 10, 11). Lead delivery takes the same wake/hold
class. Human messages, the orchestrator's messages and relays, Resume after a
provider halt, a round's return, and the last design approval wake. The Stop
notice wakes only a lead whose turn is running (queued to that turn's end, as
today) and is held for an idle lead. The round's return message keeps its
ticket list, gates and findings; its closing line says it holds the whole round
and that `get_ticket` is for a digest the lead needs (a failed ticket, a
finding), not for seeing the round again. The feature skill's round guidance
says the same.

**Background sub-agents** (decision 6). The project session's skill tells the
orchestrator to do boot-time and other short reads in the foreground, as parallel
calls in one message, and to start a background sub-agent only for long
independent work.

**No opt-in wakes** (decision 14): there is no tool or setting to be woken by a
held kind.

## Seams

- **The orchestrator line function (existing, pure)** — today returns the line
  for an event and a `NotifyState`; it gains the line's class. A table test over
  every event type pins decision 3's list, including the conditional
  self-plan line and the running-holder gate.
- **`notifyOrchestrator` against a fake agent host (existing)** — observes, for
  a gathered batch, whether the host got a prompt or a hold, the text and news
  display it got.
- **The agent host's prompt with `hold` (existing, extended)** — with the fake
  transport: held entries ride the next prompt in order; a replace key drops the
  older entry; a runcastle-sourced turn ending on a usage-limit reply re-holds its
  text and wakes once at the reported reset (an injected clock), while a human
  turn does not.
- **`deliverToLead` (existing)** — observes that Stop to an idle lead is held,
  Stop to a running lead is queued, and the other messages wake; the round-return
  text's closing line.
- **The agent host's automatic compaction (from `lead-chats-stay-small`)** —
  the same fake-runtime tests, run for an orchestrator thread: above the
  threshold it is compacted before an idle stop and before a turn after a long
  gap, including a turn a news wake starts; the compaction leaves its holds and
  held lines in place.
- **The project launch (existing)** — opening an orchestrator thread past the
  1 MB transcript size resumes it rather than starting a fresh chat.
- **The news block (existing component)** — renders "For its next turn" for a
  held delivery and nothing for a waking one.

## Out of scope

- Workers and handbacks themselves (`workers-prototype…`, `interactive-workers`,
  `burns-become-workers`); this feature works on today's news lines and lead
  deliveries, with the rule written so they adopt it.
- Compaction of feature chats and long lead chats → `lead-chats-stay-small`.
- Slimming runcastle's tool results and skills beyond the two guidance lines
  above → `tools-and-skills-say-less`.
- Turning off background sub-agents through runtime settings.
- Any tool or setting for asking to be woken by a held kind (decision 14).

- A second compaction mechanism, or handing an orchestrator's features to a
  fresh chat, unless resuming proves unworkable (decision 16).

## Open questions

- Whether Claude Code resumes a compacted conversation from its last
  compaction regardless of the transcript file's size; checked by hand while
  building decision 16.

- Whether the background sub-agent guidance actually cuts those wakes is only
  measurable afterwards, with the same token analysis that found them.
- Live sessions run the globally installed runcastle, so the behaviour is
  checked by hand-starting this branch's server, not through a normal drive.
