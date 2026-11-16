# Decisions — Fable 5.2 in the model picker

Planned with nobody present, 2026-11-16. Decisions 1–3 are the human's, from the brief.

Check first: 4, 5, 6

## 1. Every model Settings lists can be picked
**Decision:** Fable 5.2, and any other model Settings lists, can be picked in the chat's model picker.
**Why:** Settings shows Fable 5.2 but the picker does not; the two lists must agree.

## 2. Where: the picker in every chat's message box
**Decision:** The change is in the model picker under every chat's message box.
**Why:** That is where the human picks a model.

## 3. Who: the human, for any chat
**Decision:** The human sees the full list when choosing a model for any chat.
**Why:** From the brief.

## 4. A model works mid-chat, not only in a new chat
**Decision:** Picking Fable 5.2 in a chat that is already running switches that chat to it on its next message, the same as any other model.
**Why:** Claude Code's own model list for a session lacks Fable 5.2, so today a mid-chat switch to it would be silently ignored. Showing a model that quietly does nothing is worse than not showing it.
**Assumed.** Alternative: models only Settings knows work when a chat starts, and the picker marks them "new chats only" in a running chat.

## 5. A model Claude Code refuses fails like any failed start
**Decision:** If Claude Code refuses a picked model (the account has no access, or it was retired), the chat shows its usual error line and stays usable; runcastle does not test every model before listing it.
**Why:** Testing each model costs a session start per model; the refusal already reaches the human in the chat.
**Assumed.** Alternative: check each model once when Settings discovers it, and leave failing ones out of the picker.

## 6. Codex chats get the same rule
**Decision:** A Codex chat's picker also lists every Codex model Settings lists.
**Why:** The brief says "any model Settings lists", and both runtimes share the one code path, so treating them alike is simpler than carving Codex out.
**Assumed.** Alternative: only Claude Code chats change; Codex keeps showing just what Codex reports.

## 7. Older versions stay listed, under "Older models"
**Decision:** With Fable 5.2 listed, Fable 5.2 is the Fable row the picker shows; older Fable versions Settings lists (5, 5.1) go under the picker's existing "Older models" fold.
**Why:** That is how the picker already treats older versions; no picker redesign (the brief rules it out).
**Assumed.** Alternative: hide versions Claude Code itself does not offer.
