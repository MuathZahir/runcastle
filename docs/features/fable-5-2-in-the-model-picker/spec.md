# Fable 5.2 in the model picker

## Problem

Settings → Models lists Fable 5.2, but a chat's model picker does not: it shows
Fable 5.1, Opus 5.5, Opus 5.5 (1M), Sonnet 5.5 and Haiku 5.5. The human cannot
pick the newest model for any chat.

## Approach

From the human's side: the picker lists every model Settings lists for the
chat's runtime (decisions 1, 6). Fable 5.2 becomes the Fable row; older Fable
versions move under "Older models" (7). Picking it works in a new chat and in a
running one (4). A model Claude Code refuses fails in the chat like any failed
start (5).

### Why it happens

The picker's list is the runtime's model catalog (`modelCatalog` in the
server's thread model-catalog module). Once any session has reported Claude
Code's own model list, that saved list is the catalog, and the roster (what
Settings shows: curated, discovered and the operator's own models) only adds
1M variants of models already listed, plus notes. The roster's Fable 5.2 never
gets in. The roster discovers models through the Agent SDK it runs itself; the
Claude Code adapter (`claude-agent-acp` 0.97.0) reports a list that, on this
machine, lacks Fable 5.2.

### 1. The list: merge the roster into the saved catalog

`modelCatalog` adds every roster entry for the runtime that the saved catalog
has no entry for (matched as today: by id, else by the label the adapter would
give it), labelled the way the adapter labels models (`rosterLabel`, so
`claude-fable-5-2` reads "Fable 5.2"). Notes and 1M splicing stay as they are,
and run after the merge so a roster-only model's 1M twin is listed too. Effort
levels for such a model come from `withKnownControls` (its family's, else the
runtime's), so no new controls logic. The picker's grouping (newest per family,
older under "Older models") needs no change.

`catalogEntry` and `threadModels` read the same merged catalog, so a thread that
names Fable 5.2 resolves to it and its chip says "Fable 5.2".

### 2. Making the pick take: first a spike, then one of two routes

The adapter refuses `set_config_option` for a model value it does not list
("Invalid value for config option model"); runcastle's request builder
(`configRequests` / `modelValue`) already drops such a pick silently before
sending. And a session opens on its own choice (CLI settings, or a resumed
conversation's last model), so the launch's model is not enough on its own.

**Spike, before any code** (one scratch Claude Code session through the ACP
host, run by hand):
- start a fresh session with launch model `claude-fable-5-2`; record the
  adapter's reported current model and the model the API answers with;
- in that session, try `set_config_option` with `claude-fable-5-2`;
- write the session's settings file with an `availableModels` list holding
  `default`, the adapter's own values and `claude-fable-5-2`, and check the
  adapter then offers Fable 5.2 and switches to it, and that subagents
  (which use aliases such as `haiku`) still run.

**Route A (preferred if the spike passes):** the launcher writes
`availableModels` into each Claude Code session's settings file: `default`, the
saved catalog's adapter values, and the roster's Claude Code ids. The adapter
then lists every roster model itself (it synthesises an entry for an id its SDK
does not know), so set-model, the catalog learning and resume all work through
the existing paths. `catalogFromOptions` must label a synthesised entry (its
name equals its raw id) with `rosterLabel`, so the saved catalog says "Fable
5.2", not `claude-fable-5-2`.

**Route B (if the allowlist narrows what Claude Code may run):** when the human
picks a model the running session does not offer, the host records the pick and
stops the thread's process (as the edit-and-fork path already does); the next
message reopens the conversation with the picked model as the launch model, and
the opening `applyConfig` is skipped for a model the session does not list. The
spike must show a resumed conversation honours the launch model; if neither
route holds, stop and bring the human decision 4's alternative.

Codex (6): the merge applies the same way. If Codex's adapter also refuses
unlisted ids mid-session, Route B's stop-and-reopen covers it; check with one
Codex session in the spike if Codex is installed, else note it untested.

### Refusals (5)

No new handling: a start or turn on a refused model surfaces through the
existing session-error path. Verify once with a made-up id in the spike that
the chat shows an error and the next pick of a good model works.

## Seams

- **`threadModels` / `modelCatalog` (existing):** given a saved catalog and a
  roster, the list the picker gets. The main unit seam; the "a runtime's one
  model catalog" tests change (the one asserting exactly 3 models after an
  adapter report now expects the roster's extra models).
- **`configRequests` (existing):** which set-config requests a pick produces,
  for Route B's "not offered" case.
- **`catalogFromOptions` (existing):** labels of synthesised entries (Route A).
- **The launcher's settings artifact (existing):** the `availableModels` it
  writes (Route A).
- **A real chat (drive):** pick Fable 5.2 in a new chat and in a running one;
  the answer's model line and the chip say Fable 5.2.

## Out of scope

- Any redesign of Settings → Models or the picker (brief).
- New model-management features: hiding models, per-chat lists, model probes.
- Changing how discovery finds models.

## Open questions

- Which route holds is settled by the spike, not by the human.
- The brief's screenshot (`.runcastle-attachments/pnote_VvPipGPPZc8v.png`) was
  not in this worktree; the brief's text was used instead.
