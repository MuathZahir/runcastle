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

### 2. Making the pick take: stop and reopen (Route B)

The adapter refuses `set_config_option` for a model value it does not list
("Invalid value for config option model"); runcastle's request builder
(`configRequests` / `modelValue`) used to drop such a pick silently.

**Spike results (2026-11-16).** Route A, writing `availableModels` into the
session's settings file, cannot work: claude-agent-acp 0.97.0 reads only the
user, project, local and managed Claude settings, never the `--settings` file
runcastle writes. The adapter does pass `_meta.claudeCode.options.model` to the
CLI as its model, and does not override it on a fresh or resumed session. Run
directly through the Agent SDK, a resumed conversation launched on a model the
adapter does not list answered from that model; a made-up model failed with a
clear "There's an issue with the selected model" error (decision 5).

**Route B, as built** (`threads/host.ts`):
- A pick in an open session that the session's options do not offer
  (`offersModel` in `controls.ts`) applies its effort and fast mode, logs the
  pick with the catalog's id and label, and marks the thread to reopen. The
  next message stops the process ('idle') and starts a new one; the
  conversation resumes.
- A launch names the picked model when the adapter's saved catalog does not
  list it (`adapterLists` in `model-catalog.ts`); a listed model goes through
  the session's own switch as before. The opening `applyConfig` skips a model
  the session does not list, and the thread logs that model, not the one the
  adapter misreports.
- While a session runs on an unlisted model, the next switch to a listed one
  is sent even though the adapter claims it already runs on it.
- Roster 1M ids whose model the adapter lists stay `keepLongContext`'s call,
  so the merge adds no second 1M entry.

**The symptom went away on its own.** On 2026-11-16 the adapter's list caught
up (it now lists Fable 5.2 as `fable`). The human chose to build the guard
anyway (decision 8), so a lag like this never hides a model again.

Codex (6): the merge and Route B are runtime-neutral. Not tried against a real
Codex session.

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
- **The host (thread-controls tests):** a roster-only model in the picker; a
  pick that reopens the chat on it; a new chat that starts on it; the forced
  switch back.
- **A real chat (drive):** pick Fable 5.2 in a new chat and in a running one;
  the answer's model line and the chip say Fable 5.2.

## Out of scope

- Any redesign of Settings → Models or the picker (brief).
- New model-management features: hiding models, per-chat lists, model probes.
- Changing how discovery finds models.

## Open questions

- The brief's screenshot (`.runcastle-attachments/pnote_VvPipGPPZc8v.png`) was
  not in this worktree; the brief's text was used instead.
