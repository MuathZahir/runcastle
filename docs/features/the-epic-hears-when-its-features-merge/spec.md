# The epic hears when its features merge

## Problem

An orchestrator chat (an "epic") cuts a lump of intent into several features, but after
"One place to answer" most of those features belong to the human, and the epic hears
nothing about a feature it does not own. Merges included: today no merge produces any
line for any orchestrator, the human's or its own. So the epic cannot check that the
pieces it cut fit together once they land, and a sibling still being built never hears
that the ground under it moved until it hits a conflict at its own merge.

## Approach

**What the human sees.** When a feature that came from an epic merges, a "Merged" row
appears in that epic's chat under the feature, in runcastle's existing news style (the
"done" tone, the same row "Started by itself" uses), saying who merged it. If the epic
still has other features in progress, it wakes, reads what merged against those
siblings, and messages only the siblings the merge affects (as the orchestrator's note,
asking their leads to bring the new main in when their files are touched). A clean merge
ends there, with no words to the human. If the epic finds a real misfit, it says so in its
chat in a few lines, offers a fix (a new feature, or the sibling the fix belongs in) and
sends one phone notification. With no sibling in progress, the row still appears but the
epic does not wake.

**The shape.**

- **The trigger.** The merge flow (shared by the Merge button and the orchestrator's
  `merge_feature` tool) already emits the feature-shipped event and then starts any
  up-next drafts waiting on the merged feature. The merge news is produced after those
  starts, so the wake test sees them as started.
- **Who hears it.** The feature's epic field (the chat it came from, `chat_id`), not its
  owner (`held_by`). "One place to answer" keeps the two apart; replacement chats already
  inherit `chat_id`. No epic, or an epic chat that no longer exists: nothing is sent.
- **The wake test.** The epic's other features (same `chat_id`, not the merged one) with
  status active. Drafts, shipped and archived features do not count. Pure function over
  the feature rows; unit-tested.
- **Delivery.** Through the orchestrator notifier, the one module that turns events into
  orchestrator lines and the news rows the human sees. Today it delivers only to a
  feature's holder and only ever wakes. It gains:
  - a route by epic for the merge event (every other event stays holder-only, unchanged);
  - a held delivery: the agent host's existing `hold` option logs the prompt, shows its
    news row, starts no turn, and carries the text ahead of the thread's next prompt.
    A batch is held only when every line in it is held; any waking line wakes it.
  - the test-drive guard that never starts a chat the drive did not start still applies.
- **When it is held.** No sibling active (decision 6), or the epic itself called
  `merge_feature` for this merge (decision 9; the merge event carries the acting chat).
- **The line.** `[runcastle] <slug> merged into <base> by <the human | this chat | the chat "<name>">.`
  ("the human", not "you": the orchestrator's lines already use "you" for the
  orchestrator itself), then either the in-progress siblings (slug, title, owner: the
  human or which chat) with where to read the change (the merge commit and the feature's
  outcome doc), or, when held, "Nothing of this epic is in progress, so there is nothing
  to check." A line held because the epic merged it itself still lists the siblings.
  The human's news row reads "Merged by you" or "Merged by <chat name>".
- **`merge_feature`'s answer** lists the same in-progress siblings, so an epic that
  merges its own feature checks fit in that turn.
- **The skill.** The project skill's "Messages from runcastle" gains the merge line and
  what to do on it (decisions 3, 10, 11, 13): read the merge against each in-progress
  sibling; `send_to_feature` only to those it touches; no tests, drives or reviews; speak
  to the human only on a problem, with an offer and one `notify_human`; never ask in a
  feature it does not own; a held merge line needs no action. Its intro "each wakes you"
  becomes accurate again with that exception named. The orchestrator-notify module's
  header comment and the decision-23 record are amended to name merges as the one
  exception.
- **Decision record.** `agents-are-woken-only-when-it-matters` decision 23 gets a
  superseding note pointing here; the exception to charter decisions 17 and 18 (news
  goes only to the agent that owns the work) is the project session's to write into
  `CONTEXT.md`.

## Seams

- **The orchestrator notifier's line and news functions** (existing): given a
  feature-shipped event and the feature state, the line text, the news row, the target
  thread (the epic) and whether it holds. Unit tests next to the existing notifier tests.
- **The wake test** (new, pure): the epic's features and the merged one in, wake or hold
  out.
- **The merge flow** (existing): after a merge, the epic's thread received one prompt,
  woken or held, with a news row; a feature with no epic sends nothing; up-next drafts
  started by the merge count as in progress. Integration test with a fake agent host, as
  the up-next and notifier tests do.
- **`merge_feature`** (existing): its answer lists in-progress siblings, and the line it
  causes for its own epic is held.
- **The project skill text** (existing): the skill-text test asserts the merge line's
  guidance is there.

## Out of scope

- Any other news line: rounds, reviews, planning runs, waits, drives and takes stay as
  `agents-are-woken-only-when-it-matters` left them.
- Ownership and where the human answers ("One place to answer").
- Checking features outside the merged feature's epic, and features with no epic
  (decision 12). A project-wide integration check would be its own feature.
- Running tests, drives or reviews on a merge (decision 13).
- Joining merges that queue behind a busy epic turn (decision 15).
- A new look for the news row: it reuses the existing one.

## Open questions

- Settled in the build: a held prompt keeps its news row in the chat log and the
  thread's fold, as a woken one does (tests in the merge-news test file); no chat-view
  change was needed.
- The live feature-shipped event fires before up-next drafts start, so the merge flow
  announces the merge to the epic itself, after those starts; the live event sends no
  line.
- The named exception to charter decisions 17 and 18 belongs in `CONTEXT.md`, which only
  the project session writes; it should be told at merge.
